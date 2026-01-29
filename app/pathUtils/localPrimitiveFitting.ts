import paper from "paper";

import { MedialAxisGraph } from "@/app/pathUtils/medialAxis";

// Extend interface locally
interface FittedMedialAxisGraph extends MedialAxisGraph {
  primitives: Primitive[];
}

export interface Primitive {
  center: paper.Point;
  directions: paper.Point[];
  radii: number[];
}

type PrimitiveFittingOptions = {
  // The "resolution" of your generalized primitive.
  num_directions: number;
  // How aggressively the balloon tries to expand towards the target size
  w_expansion: number;
  // The hardness of the walls (the "Brakes").
  w_penalty: number;
  // The number of "growth stages."
  max_progressions: number;
  // The growth rate per stage.
  expansion_rate: number;
  // The "collision resolution" attempts per growth stage.
  max_alternating_iters: number;
};

export function localPrimitiveFitting(
  path: paper.CompoundPath,
  medialSkeleton: MedialAxisGraph,
  options: Partial<PrimitiveFittingOptions> = {},
) {
  options.num_directions = options.num_directions ?? 128;
  options.w_expansion = options.w_expansion ?? 10;
  options.w_penalty = options.w_penalty ?? 10000;
  options.max_progressions = options.max_progressions ?? 25;
  options.expansion_rate = options.expansion_rate ?? 1.1;
  options.max_alternating_iters = options.max_alternating_iters ?? 15;

  const skeleton: FittedMedialAxisGraph = {
    ...medialSkeleton,
    primitives: [],
  };

  const SCRATCH_N = options.num_directions;
  const scratch = {
    // Buffers for solveTridiagonal
    cp: new Float64Array(SCRATCH_N),
    dp: new Float64Array(SCRATCH_N),
    // Buffers for solveCyclicTridiagonal
    y: new Float64Array(SCRATCH_N),
    z: new Float64Array(SCRATCH_N),
    u_vec: new Float64Array(SCRATCH_N),
    T_diag_adj: new Float64Array(SCRATCH_N),
  };

  // 1. Pre-compute constant directions (Optimization: Hoist out of loop)
  const directions = generateUniformDirections(options.num_directions);

  for (let i = 0; i < skeleton.points.length; i++) {
    const center = skeleton.points[i];

    // 2. Compute Max Extents (r_max)
    // Optimization: Use { insert: false } to avoid scene graph overhead
    const r_max = computeMaxExtents(center, directions, path);

    // 3. Initialize Radii
    const minMax = Math.min(...r_max);
    // Ensure we have a valid non-zero starting radius
    const initialRadius = minMax > 1e-4 ? minMax * 0.99 : 1e-3;

    let r: Float64Array = new Float64Array(options.num_directions).fill(
      initialRadius,
    );
    const r_tgt = new Float64Array(r);

    // 4. Progressive Expansion
    for (let prog = 0; prog < options.max_progressions; prog++) {
      // Increase target radius
      for (let k = 0; k < options.num_directions; k++)
        r_tgt[k] *= options.expansion_rate;

      // Alternating Optimization Loop
      for (let iter = 0; iter < options.max_alternating_iters; iter++) {
        // Build the diagonal and RHS for the solver directly here.
        // System: (L + wI + penalty_diag) * r = (w * r_tgt + penalty_rhs)

        // Diagonal 'd' starts with 2 (from L) + w (expansion)
        const d = new Float64Array(options.num_directions).fill(
          2 + options.w_expansion,
        );
        const rhs = new Float64Array(options.num_directions);

        let constraintsActive = false;

        for (let j = 0; j < options.num_directions; j++) {
          rhs[j] = options.w_expansion * r_tgt[j];

          if (r[j] > r_max[j]) {
            constraintsActive = true;
            d[j] += options.w_penalty;
            rhs[j] += options.w_penalty * r_max[j];
          }
        }

        // Solve cyclic tridiagonal system
        // L contributes -1 to off-diagonals and corners
        r = solveCyclicTridiagonal(d, -1, -1, rhs, scratch);

        if (!constraintsActive) break;
      }
    }

    skeleton.primitives[i] = {
      center: center,
      directions: directions, // Reference the shared array
      radii: Array.from(r),
    };
  }
}

// --- Specialized O(N) Solver ---

/**
 * Solves Ax = b where A is a symmetric cyclic tridiagonal matrix.
 * Uses Sherman-Morrison formula: A = T' + uv^T
 */
function solveCyclicTridiagonal(
  d: Float64Array,
  e: number, // Off-diagonal value (-1)
  f: number, // Corner value (-1)
  b: Float64Array,
  scratch: {
    cp: Float64Array;
    dp: Float64Array;
    T_diag_adj: Float64Array;
    u_vec: Float64Array;
    y: Float64Array;
    z: Float64Array;
  },
): Float64Array {
  const n = d.length;

  // 1. Construct the adjusted diagonal for T'
  // T' must subtract 'f' from the corners to account for rank-1 addition
  scratch.T_diag_adj.set(d);
  scratch.T_diag_adj[0] -= f;
  scratch.T_diag_adj[n - 1] -= f;

  // 2. Define the perturbation vector u
  // u = [1, 0, ..., 0, 1]
  scratch.u_vec.fill(0);
  scratch.u_vec[0] = 1.0;
  scratch.u_vec[n - 1] = 1.0;

  // 3. Solve the two tridiagonal systems (Result stored in scratch buffers)
  // Solve T' * y = b
  solveTridiagonal(scratch.T_diag_adj, e, b, scratch.y, scratch);

  // Solve T' * z = u
  solveTridiagonal(scratch.T_diag_adj, e, scratch.u_vec, scratch.z, scratch);

  // 4. Compute the scaling factor
  // factor = (v . y) / (1 + v . z)
  // Since v = [f, 0...0, f], the dot product is f * (vec[0] + vec[n-1])
  const v_dot_y = f * (scratch.y[0] + scratch.y[n - 1]);
  const v_dot_z = f * (scratch.z[0] + scratch.z[n - 1]);

  const factor = v_dot_y / (1.0 + v_dot_z);

  // 5. Compute final result x
  // x = y - factor * z
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = scratch.y[i] - factor * scratch.z[i];
  }

  return x;
}

/**
 * Optimized Thomas Algorithm.
 * Writes result into 'out' buffer.
 */
function solveTridiagonal(
  diag: Float64Array,
  e: number,
  rhs: Float64Array,
  out: Float64Array,
  scratch: {
    cp: Float64Array;
    dp: Float64Array;
  },
): void {
  const n = diag.length;

  // Forward sweep
  // cp[0] = c[0] / b[0]
  scratch.cp[0] = e / diag[0];
  scratch.dp[0] = rhs[0] / diag[0];

  for (let i = 1; i < n; i++) {
    const c_val = i < n - 1 ? e : 0; // upper diag
    const a_val = e; // lower diag

    const denom = diag[i] - a_val * scratch.cp[i - 1];

    // Check for division by zero or instability if needed (rare in Laplacian systems)
    if (Math.abs(denom) < 1e-12) {
      // Fallback or error handling could go here
    }

    if (i < n - 1) {
      scratch.cp[i] = c_val / denom;
    }

    scratch.dp[i] = (rhs[i] - a_val * scratch.dp[i - 1]) / denom;
  }

  // Back substitution
  out[n - 1] = scratch.dp[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    out[i] = scratch.dp[i] - scratch.cp[i] * out[i + 1];
  }
}

// --- Geometry Helpers ---

function generateUniformDirections(n: number): paper.Point[] {
  const directions: paper.Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 360;
    const rad = (angle * Math.PI) / 180;
    directions.push(new paper.Point(Math.cos(rad), Math.sin(rad)));
  }
  return directions;
}

function computeMaxExtents(
  center: paper.Point,
  directions: paper.Point[],
  boundary: paper.CompoundPath,
): number[] {
  // Optimization: Create path with insert: false
  // We reuse this object reference (updating segments) to avoid GC churn
  const ray = new paper.Path.Line({
    from: [0, 0],
    to: [0, 0],
    insert: false,
  });

  // Safe large distance (ensure it covers bounds)
  const largeDist =
    Math.max(boundary.bounds.width, boundary.bounds.height) * 2 + 1000;

  return directions.map((dir) => {
    // Update existing ray object
    ray.segments[0].point = center;
    ray.segments[1].point = center.add(dir.multiply(largeDist));

    const intersections = boundary.getIntersections(ray);

    if (intersections.length === 0) return 1e-4;

    let minDist = Infinity;
    for (const intersection of intersections) {
      const dist = center.getDistance(intersection.point);
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  });
}
