import paper from "paper";

import { MedialAxisGraph } from "@/app/pathUtils/medialAxis";

// --- Interfaces ---

interface FittedMedialAxisGraph extends MedialAxisGraph {
  primitives: Primitive[];
}

export interface Primitive {
  type: "point" | "edge";
  elementIdx: number; // Index into `points` (if type="point") or `segments` (if type="edge")

  // Geometric definition of the fitted primitive
  // For "point": origin is the center.
  // For "edge": origins trace the medial segment (the "bone").
  origins: paper.Point[];
  directions: paper.Point[];
  radii: number[];
}

type PrimitiveFittingOptions = {
  // The "resolution" of your generalized primitive. Must be even.
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
): FittedMedialAxisGraph {
  const opts = {
    num_directions: options.num_directions ?? 128,
    w_expansion: options.w_expansion ?? 0.1,
    w_penalty: options.w_penalty ?? 10000,
    max_progressions: options.max_progressions ?? 25,
    expansion_rate: options.expansion_rate ?? 1.1,
    max_alternating_iters: options.max_alternating_iters ?? 15,
  };

  const skeleton = {
    ...medialSkeleton,
    primitives: [] as Primitive[],
  } as FittedMedialAxisGraph;

  // 1. Analyze Topology to identify isolated vertices
  const degree = new Int32Array(skeleton.points.length).fill(0);
  for (const [idxA, idxB] of skeleton.segments) {
    degree[idxA]++;
    degree[idxB]++;
  }

  // 2. Prepare Optimization Buffers (Shared for all primitives)
  // We use the same resolution N for both vertices and edges to reuse these buffers.
  const SCRATCH_N = opts.num_directions;
  const scratch = {
    // Buffers for solveTridiagonal
    cp: new Float64Array(SCRATCH_N),
    dp: new Float64Array(SCRATCH_N),
    // Buffers for solveCyclicTridiagonal
    y: new Float64Array(SCRATCH_N),
    z: new Float64Array(SCRATCH_N),
    u_vec: new Float64Array(SCRATCH_N),
    T_diag_adj: new Float64Array(SCRATCH_N),
    d: new Float64Array(SCRATCH_N),
    rhs: new Float64Array(SCRATCH_N),
  };

  // --- Process 1: Free-standing Vertices (Generalized Disks) ---
  // "We don't need to extract an envelope for a vertex that is part of an edge"
  const circleDirections = generateUniformDirections(opts.num_directions);

  for (let i = 0; i < skeleton.points.length; i++) {
    if (degree[i] === 0) {
      const center = skeleton.points[i];
      // For a vertex, all rays originate from the center
      const origins = Array(opts.num_directions).fill(center);

      const fittedRadii = fitSinglePrimitive(
        origins,
        circleDirections,
        path,
        opts,
        scratch,
      );

      skeleton.primitives.push({
        type: "point",
        elementIdx: i,
        origins: origins, // Note: In a real app, you might optimize this storage
        directions: circleDirections,
        radii: fittedRadii,
      });
    }
  }

  // --- Process 2: Medial Edges (Generalized Capsules/Slabs) ---
  // "Extract a 2d enveloping 'mesh' that is equally spaced around the edge"

  for (let i = 0; i < skeleton.segments.length; i++) {
    const [idxA, idxB] = skeleton.segments[i];
    const pA = skeleton.points[idxA];
    const pB = skeleton.points[idxB];

    // Generate capsule discretization (Origins + Directions) specific to this segment
    const { origins, directions } = generateCapsuleDiscretization(
      pA,
      pB,
      opts.num_directions,
    );

    const fittedRadii = fitSinglePrimitive(
      origins,
      directions,
      path,
      opts,
      scratch,
    );

    skeleton.primitives.push({
      type: "edge",
      elementIdx: i,
      origins: origins,
      directions: directions,
      radii: fittedRadii,
    });
  }

  return skeleton;
}

// --- Core Optimization Routine (Reused for Point & Edge) ---

function fitSinglePrimitive(
  origins: paper.Point[],
  directions: paper.Point[],
  path: paper.CompoundPath,
  opts: {
    num_directions: number;
    w_expansion: number;
    w_penalty: number;
    max_progressions: number;
    expansion_rate: number;
    max_alternating_iters: number;
  },
  scratch: {
    cp: Float64Array;
    dp: Float64Array;
    T_diag_adj: Float64Array;
    u_vec: Float64Array;
    y: Float64Array;
    z: Float64Array;
    d: Float64Array;
    rhs: Float64Array;
  },
): number[] {
  // 1. Compute Max Extents (r_max)
  const r_max = computeMaxExtents(origins, directions, path);

  // 2. Initialize Radii
  const minMax = Math.min(...r_max);
  const initialRadius = minMax > 1e-4 ? minMax * 0.99 : 1e-3;

  const r = new Float64Array(opts.num_directions).fill(initialRadius);
  const r_tgt = new Float64Array(r);

  // 3. Progressive Expansion
  for (let prog = 0; prog < opts.max_progressions; prog++) {
    // Increase target
    for (let k = 0; k < opts.num_directions; k++)
      r_tgt[k] *= opts.expansion_rate;

    // Solver Loop
    for (let iter = 0; iter < opts.max_alternating_iters; iter++) {
      scratch.d.fill(2 + opts.w_expansion);
      let constraintsActive = false;

      for (let j = 0; j < opts.num_directions; j++) {
        scratch.rhs[j] = opts.w_expansion * r_tgt[j];
        if (r[j] > r_max[j]) {
          constraintsActive = true;
          scratch.d[j] += opts.w_penalty;
          scratch.rhs[j] += opts.w_penalty * r_max[j];
        }
      }

      // Solve (L + wI + P)r = RHS
      // L is always cyclic tridiagonal for a closed boundary (disk or capsule)
      solveCyclicTridiagonal(scratch.d, -1, -1, scratch.rhs, r, scratch);

      if (!constraintsActive) break;
    }
  }

  return Array.from(r);
}

// --- Geometry Helpers ---
/**
 * Generates origins and directions for a "Capsule" primitive around a segment.
 * FIXED: Uses relative angles to ensure caps always bulge outward.
 */
function generateCapsuleDiscretization(
  pA: paper.Point,
  pB: paper.Point,
  N: number,
) {
  const origins: paper.Point[] = [];
  const directions: paper.Point[] = [];

  // 1. Setup Bone Geometry
  const v = pB.subtract(pA);
  const baseAngle = v.angle; // Degrees

  // Normal vector (90 degrees relative to bone)
  // We calculate this explicitly from angle to ensure consistency with the caps
  const normalAngle = baseAngle + 90;
  const normalRad = normalAngle * (Math.PI / 180);
  const normal = new paper.Point(Math.cos(normalRad), Math.sin(normalRad));

  // 2. Sample Distribution
  // We divide N samples into 4 parts: Side1, CapB, Side2, CapA
  const quarter = Math.floor(N / 4);
  const remainder = N - quarter * 4;
  const nSide = quarter + Math.floor(remainder / 2);
  const nCap = quarter;

  // --- SECTION 1: Side A->B (+Normal side) ---
  for (let i = 0; i < nSide; i++) {
    const t = i / (nSide - 1 || 1);
    origins.push(pA.add(v.multiply(t)));
    directions.push(normal);
  }

  // --- SECTION 2: Cap B (The Tip) ---
  // Must sweep from +90 to -90 (Clockwise visual / Decreasing degrees)
  // Start: baseAngle + 90
  // End:   baseAngle - 90
  const startAngleB = baseAngle + 90;
  const endAngleB = baseAngle - 90;

  for (let i = 0; i < nCap; i++) {
    // Interpolate t from 0..1 (exclusive of corners to avoid duplicate normals)
    const t = (i + 1) / (nCap + 1);

    // Linear interpolation of angle
    const ang = startAngleB + t * (endAngleB - startAngleB);
    const rad = ang * (Math.PI / 180);

    origins.push(pB); // Fan originates from endpoint B
    directions.push(new paper.Point(Math.cos(rad), Math.sin(rad)));
  }

  // --- SECTION 3: Side B->A (-Normal side) ---
  for (let i = 0; i < nSide; i++) {
    const t = i / (nSide - 1 || 1);
    // Move backwards from B to A
    origins.push(pB.subtract(v.multiply(t)));
    directions.push(normal.multiply(-1));
  }

  // --- SECTION 4: Cap A (The Tail) ---
  // Must sweep from -90 to -270 (Clockwise visual / Decreasing degrees)
  // Start: baseAngle - 90
  // End:   baseAngle - 270
  const startAngleA = baseAngle - 90;
  const endAngleA = baseAngle - 270;

  for (let i = 0; i < nCap; i++) {
    const t = (i + 1) / (nCap + 1);

    const ang = startAngleA + t * (endAngleA - startAngleA);
    const rad = ang * (Math.PI / 180);

    origins.push(pA); // Fan originates from endpoint A
    directions.push(new paper.Point(Math.cos(rad), Math.sin(rad)));
  }

  return { origins, directions };
}

function generateUniformDirections(n: number): paper.Point[] {
  const directions: paper.Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 360;
    const rad = (angle * Math.PI) / 180;
    directions.push(new paper.Point(Math.cos(rad), Math.sin(rad)));
  }
  return directions;
}

/**
 * Computes max extent for each ray defined by (origin[i], direction[i]).
 */
function computeMaxExtents(
  origins: paper.Point[],
  directions: paper.Point[],
  boundary: paper.CompoundPath,
): number[] {
  // Reuse a single path item to avoid GC
  const ray = new paper.Path.Line({ from: [0, 0], to: [0, 0], insert: false });
  const largeDist =
    Math.max(boundary.bounds.width, boundary.bounds.height) * 2 + 1000;

  return directions.map((dir, i) => {
    const origin = origins[i];

    // Update ray segments manually
    const p0 = ray.segments[0].point;
    p0.x = origin.x;
    p0.y = origin.y;

    const p1 = ray.segments[1].point;
    p1.x = origin.x + dir.x * largeDist;
    p1.y = origin.y + dir.y * largeDist;

    const intersections = boundary.getIntersections(ray);
    if (intersections.length === 0) return 1e-4;

    let minDist = Infinity;
    for (const intersection of intersections) {
      // Distance from the specific ray origin
      const dist = origin.getDistance(intersection.point);
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  });
}

// --- Solver Functions (Unchanged logic, just re-included for completeness) ---

function solveCyclicTridiagonal(
  d: Float64Array,
  e: number,
  f: number,
  b: Float64Array,
  out: Float64Array,
  scratch: {
    cp: Float64Array;
    dp: Float64Array;
    T_diag_adj: Float64Array;
    u_vec: Float64Array;
    y: Float64Array;
    z: Float64Array;
  },
): void {
  const n = d.length;
  scratch.T_diag_adj.set(d);
  scratch.T_diag_adj[0] -= f;
  scratch.T_diag_adj[n - 1] -= f;
  scratch.u_vec.fill(0);
  scratch.u_vec[0] = 1.0;
  scratch.u_vec[n - 1] = 1.0;

  solveTridiagonal(scratch.T_diag_adj, e, b, scratch.y, scratch);
  solveTridiagonal(scratch.T_diag_adj, e, scratch.u_vec, scratch.z, scratch);

  const v_dot_y = f * (scratch.y[0] + scratch.y[n - 1]);
  const v_dot_z = f * (scratch.z[0] + scratch.z[n - 1]);
  const factor = v_dot_y / (1.0 + v_dot_z);

  for (let i = 0; i < n; i++) out[i] = scratch.y[i] - factor * scratch.z[i];
}

function solveTridiagonal(
  diag: Float64Array,
  e: number,
  rhs: Float64Array,
  out: Float64Array,
  scratch: { cp: Float64Array; dp: Float64Array },
): void {
  const n = diag.length;
  scratch.cp[0] = e / diag[0];
  scratch.dp[0] = rhs[0] / diag[0];

  for (let i = 1; i < n; i++) {
    const denom = diag[i] - e * scratch.cp[i - 1];
    if (i < n - 1) scratch.cp[i] = e / denom;
    scratch.dp[i] = (rhs[i] - e * scratch.dp[i - 1]) / denom;
  }

  out[n - 1] = scratch.dp[n - 1];
  for (let i = n - 2; i >= 0; i--)
    out[i] = scratch.dp[i] - scratch.cp[i] * out[i + 1];
}
