import paper from "paper";

import {
  FlatBoundary,
  buildFlatBoundary,
  nearestDistFlatBoundary,
  rayIntersectFlatBoundary,
} from "@/app/pathUtils/flatBoundary";
import { MedialAxisGraph } from "@/app/pathUtils/skeleton/medialAxis";
import { Vec2D } from "@/app/utils/types";

// --- Interfaces ---

export interface FittedMedialAxisGraph extends MedialAxisGraph {
  primitives: Primitive[];
}

export interface Primitive {
  type: "point" | "edge";
  elementIdx: number; // Index into `points` (if type="point") or `segments` (if type="edge")

  // Geometric definition of the fitted primitive
  // For "point": origin is the center.
  // For "edge": origins trace the medial segment (the "bone").
  origins: Vec2D[];
  directions: Vec2D[];
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
  // ensure the balloon always inflates sufficiently even if it starts microscopic
  min_absolute_growth: number;
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
    min_absolute_growth: options.min_absolute_growth ?? 1.0,
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

  // 2. Flatten boundary once for fast ray intersection throughout all primitives
  const flatBoundary = buildFlatBoundary(path);

  // 3. Prepare Optimization Buffers (Shared for all primitives)
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
    // Shared ray-test buffer — generation counter avoids fill(0) between calls
    tested: new Uint32Array(flatBoundary.count),
    genBox: { gen: 0 },
  };

  // --- Process 1: Free-standing Vertices (Generalized Disks) ---
  // "We don't need to extract an envelope for a vertex that is part of an edge"
  const circleDirections = generateUniformDirections(opts.num_directions);

  for (let i = 0; i < skeleton.points.length; i++) {
    const center = skeleton.points[i];
    // For a vertex, all rays originate from the center
    const origins = Array(opts.num_directions).fill(center);

    const fitted = fitSinglePrimitive(
      origins,
      circleDirections,
      flatBoundary,
      opts,
      scratch,
    );

    skeleton.primitives.push({
      type: "point",
      elementIdx: i,
      origins: fitted.origins,
      directions: fitted.directions,
      radii: fitted.radii,
    });
  }

  // --- Process 2: Medial Edges (Generalized Capsules/Slabs) ---
  // "Extract a 2d enveloping 'mesh' that is equally spaced around the edge"

  for (let i = 0; i < skeleton.segments.length; i++) {
    const [idxA, idxB] = skeleton.segments[i];
    const pA = skeleton.points[idxA];
    const pB = skeleton.points[idxB];

    const cp = skeleton.controlPoints?.[i];
    // Generate capsule discretization (Origins + Directions) specific to this segment
    const { origins, directions } = generateCapsuleDiscretization(
      new paper.Point(pA),
      new paper.Point(pB),
      opts.num_directions,
      cp?.[0],
      cp?.[1],
    );

    const fitted = fitSinglePrimitive(
      origins,
      directions,
      flatBoundary,
      opts,
      scratch,
    );

    skeleton.primitives.push({
      type: "edge",
      elementIdx: i,
      origins: fitted.origins,
      directions: fitted.directions,
      radii: fitted.radii,
    });
  }

  return skeleton;
}

// --- Core Optimization Routine (Reused for Point & Edge) ---

function resamplePoints(
  origins: paper.Point[],
  directions: paper.Point[],
  r: Float64Array,
  r_tgt: Float64Array,
): {
  origins: paper.Point[];
  directions: paper.Point[];
  r: Float64Array;
  r_tgt: Float64Array;
} {
  const N = origins.length;

  // Expand to flat arrays — avoids ~1000 paper.Point intermediates per call
  const inflX = new Float64Array(N);
  const inflY = new Float64Array(N);
  const tgtInflX = new Float64Array(N);
  const tgtInflY = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    inflX[i] = origins[i].x + directions[i].x * r[i];
    inflY[i] = origins[i].y + directions[i].y * r[i];
    tgtInflX[i] = origins[i].x + directions[i].x * r_tgt[i];
    tgtInflY[i] = origins[i].y + directions[i].y * r_tgt[i];
  }

  // Build cumulative arc-length from inflated positions (closed curve)
  const cumLen = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const ni = (i + 1) % N;
    const dx = inflX[ni] - inflX[i], dy = inflY[ni] - inflY[i];
    cumLen[i + 1] = cumLen[i] + Math.sqrt(dx * dx + dy * dy);
  }
  const totalLen = cumLen[N];
  const spacing = totalLen / N;

  const newOrigins: paper.Point[] = [];
  const newDirections: paper.Point[] = [];
  const newR = new Float64Array(N);
  const newRTgt = new Float64Array(N);

  let segIdx = 0;
  for (let k = 0; k < N; k++) {
    const targetLen = k * spacing;
    while (segIdx < N && cumLen[segIdx + 1] <= targetLen) segIdx++;

    const next = (segIdx + 1) % N;
    const segLen = cumLen[segIdx + 1] - cumLen[segIdx];
    const t = segLen > 1e-10 ? (targetLen - cumLen[segIdx]) / segLen : 0;
    const s = 1 - t;

    const noX = origins[segIdx].x * s + origins[next].x * t;
    const noY = origins[segIdx].y * s + origins[next].y * t;
    newOrigins.push(new paper.Point(noX, noY));

    const npX = inflX[segIdx] * s + inflX[next] * t;
    const npY = inflY[segIdx] * s + inflY[next] * t;
    const dX = npX - noX, dY = npY - noY;
    const dLen = Math.sqrt(dX * dX + dY * dY);
    newR[k] = dLen;
    newDirections.push(dLen > 1e-10
      ? new paper.Point(dX / dLen, dY / dLen)
      : new paper.Point(1, 0));

    const ntX = tgtInflX[segIdx] * s + tgtInflX[next] * t;
    const ntY = tgtInflY[segIdx] * s + tgtInflY[next] * t;
    const tdX = ntX - noX, tdY = ntY - noY;
    newRTgt[k] = Math.sqrt(tdX * tdX + tdY * tdY);
  }

  return {
    origins: newOrigins,
    directions: newDirections,
    r: newR,
    r_tgt: newRTgt,
  };
}

function fitSinglePrimitive(
  origins: paper.Point[],
  directions: paper.Point[],
  boundary: FlatBoundary,
  opts: {
    num_directions: number;
    w_expansion: number;
    w_penalty: number;
    max_progressions: number;
    expansion_rate: number;
    max_alternating_iters: number;
    min_absolute_growth: number;
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
    tested: Uint32Array;
    genBox: { gen: number };
  },
): { origins: paper.Point[]; directions: paper.Point[]; radii: number[] } {

  // 1. Compute Max Extents (r_max)
  let curOrigins = origins;
  let curDirections = directions;
  let r_max = computeMaxExtents(curOrigins, curDirections, boundary, scratch.tested, scratch.genBox);

  // 2. Initialize Radii — per-ray inscribed radius from each origin to S
  const r = new Float64Array(opts.num_directions);
  for (let i = 0; i < opts.num_directions; i++) {
    const inscribed = nearestDistFlatBoundary(
      curOrigins[i].x,
      curOrigins[i].y,
      boundary,
    );
    r[i] = inscribed > 1e-4 ? inscribed * 0.99 : 1e-3;
  }
  const r_tgt = new Float64Array(r);
  const r_init = new Float64Array(r); // store initial radii for additive growth

  // 3. Progressive Expansion
  for (let prog = 0; prog < opts.max_progressions; prog++) {
    // Increase target additively by 10% of initial radius (paper Sec. 5.2)
    for (let k = 0; k < opts.num_directions; k++) {
      r_tgt[k] = Math.max(
        r_tgt[k] + 0.1 * r_init[k],
        r_tgt[k] + opts.min_absolute_growth, // floor for near-zero initial radii
      );
    }

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

    if (prog % 3 == 0 && prog < opts.max_progressions - 1) {
      const resampled = resamplePoints(curOrigins, curDirections, r, r_tgt);
      curOrigins = resampled.origins;
      curDirections = resampled.directions;
      r.set(resampled.r);
      r_tgt.set(resampled.r_tgt);

      // recompute max extents because the origins and directions have changed
      r_max = computeMaxExtents(curOrigins, curDirections, boundary, scratch.tested, scratch.genBox);
    }
  }

  return {
    origins: curOrigins,
    directions: curDirections,
    radii: Array.from(r),
  };
}

// --- Geometry Helpers ---

function cubicBezierPoint(
  pA: Vec2D, cp1: Vec2D, cp2: Vec2D, pB: Vec2D, t: number,
): Vec2D {
  const u = 1 - t;
  return {
    x: u*u*u*pA.x + 3*u*u*t*cp1.x + 3*u*t*t*cp2.x + t*t*t*pB.x,
    y: u*u*u*pA.y + 3*u*u*t*cp1.y + 3*u*t*t*cp2.y + t*t*t*pB.y,
  };
}

function cubicBezierTangent(
  pA: Vec2D, cp1: Vec2D, cp2: Vec2D, pB: Vec2D, t: number,
): Vec2D {
  const u = 1 - t;
  return {
    x: 3*(u*u*(cp1.x-pA.x) + 2*u*t*(cp2.x-cp1.x) + t*t*(pB.x-cp2.x)),
    y: 3*(u*u*(cp1.y-pA.y) + 2*u*t*(cp2.y-cp1.y) + t*t*(pB.y-cp2.y)),
  };
}

/**
 * Generates origins and directions for a "Capsule" primitive around a segment.
 * When cp1/cp2 are supplied the bone follows a cubic Bezier instead of a chord,
 * with outward normals always perpendicular to the local tangent.
 */
function generateCapsuleDiscretization(
  pA: paper.Point,
  pB: paper.Point,
  N: number,
  cp1?: Vec2D,
  cp2?: Vec2D,
) {
  const origins: paper.Point[] = [];
  const directions: paper.Point[] = [];

  // Divide N samples into 4 parts: Side1, CapB, Side2, CapA
  const quarter = Math.floor(N / 4);
  const remainder = N - quarter * 4;
  const nSide = quarter + Math.floor(remainder / 2);
  const nCap = quarter;

  if (cp1 && cp2) {
    // Bezier bone: tangent varies along the curve
    const tanAtT = (t: number) => {
      const raw = cubicBezierTangent(pA, cp1, cp2, pB, t);
      const len = Math.hypot(raw.x, raw.y);
      return len > 1e-8 ? { x: raw.x / len, y: raw.y / len } : { x: 1, y: 0 };
    };
    const angleAtT = (t: number) => {
      const tn = tanAtT(t);
      return Math.atan2(tn.y, tn.x) * (180 / Math.PI);
    };

    const baseAngleA = angleAtT(0);
    const baseAngleB = angleAtT(1);

    // Section 1: Side A→B (+normal)
    for (let i = 0; i < nSide; i++) {
      const t = nSide > 1 ? i / (nSide - 1) : 0;
      const pt = cubicBezierPoint(pA, cp1, cp2, pB, t);
      const ang = (angleAtT(t) + 90) * (Math.PI / 180);
      origins.push(new paper.Point(pt.x, pt.y));
      directions.push(new paper.Point(Math.cos(ang), Math.sin(ang)));
    }

    // Section 2: Cap B — fan from +90° to −90° of tangent at t=1
    const startAngleB = baseAngleB + 90;
    const endAngleB = baseAngleB - 90;
    for (let i = 0; i < nCap; i++) {
      const t = (i + 1) / (nCap + 1);
      const ang = (startAngleB + t * (endAngleB - startAngleB)) * (Math.PI / 180);
      origins.push(pB);
      directions.push(new paper.Point(Math.cos(ang), Math.sin(ang)));
    }

    // Section 3: Side B→A (−normal)
    for (let i = 0; i < nSide; i++) {
      const t = nSide > 1 ? i / (nSide - 1) : 0;
      const pt = cubicBezierPoint(pA, cp1, cp2, pB, 1 - t);
      const ang = (angleAtT(1 - t) + 270) * (Math.PI / 180); // +270° = −90° = opposite normal
      origins.push(new paper.Point(pt.x, pt.y));
      directions.push(new paper.Point(Math.cos(ang), Math.sin(ang)));
    }

    // Section 4: Cap A — fan from −90° to −270° of tangent at t=0
    const startAngleA = baseAngleA - 90;
    const endAngleA = baseAngleA - 270;
    for (let i = 0; i < nCap; i++) {
      const t = (i + 1) / (nCap + 1);
      const ang = (startAngleA + t * (endAngleA - startAngleA)) * (Math.PI / 180);
      origins.push(pA);
      directions.push(new paper.Point(Math.cos(ang), Math.sin(ang)));
    }
  } else {
    // Straight-line bone (original behaviour)
    const v = pB.subtract(pA);
    const baseAngle = v.angle;
    const normalAngle = baseAngle + 90;
    const normalRad = normalAngle * (Math.PI / 180);
    const normal = new paper.Point(Math.cos(normalRad), Math.sin(normalRad));

    for (let i = 0; i < nSide; i++) {
      const t = i / (nSide - 1 || 1);
      origins.push(pA.add(v.multiply(t)));
      directions.push(normal);
    }

    const startAngleB = baseAngle + 90;
    const endAngleB = baseAngle - 90;
    for (let i = 0; i < nCap; i++) {
      const t = (i + 1) / (nCap + 1);
      const ang = (startAngleB + t * (endAngleB - startAngleB)) * (Math.PI / 180);
      origins.push(pB);
      directions.push(new paper.Point(Math.cos(ang), Math.sin(ang)));
    }

    for (let i = 0; i < nSide; i++) {
      const t = i / (nSide - 1 || 1);
      origins.push(pB.subtract(v.multiply(t)));
      directions.push(normal.multiply(-1));
    }

    const startAngleA = baseAngle - 90;
    const endAngleA = baseAngle - 270;
    for (let i = 0; i < nCap; i++) {
      const t = (i + 1) / (nCap + 1);
      const ang = (startAngleA + t * (endAngleA - startAngleA)) * (Math.PI / 180);
      origins.push(pA);
      directions.push(new paper.Point(Math.cos(ang), Math.sin(ang)));
    }
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
  boundary: FlatBoundary,
  tested: Uint32Array,
  genBox: { gen: number },
): number[] {
  return directions.map((dir, i) => {
    return rayIntersectFlatBoundary(
      origins[i].x,
      origins[i].y,
      dir.x,
      dir.y,
      boundary,
      tested,
      ++genBox.gen,
    );
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
