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

// All pre-allocated work buffers shared across every fitSinglePrimitive call.
type ScratchBuffers = {
  // Solver
  cp: Float64Array; dp: Float64Array;
  y: Float64Array; z: Float64Array;
  u_vec: Float64Array; T_diag_adj: Float64Array;
  d: Float64Array; rhs: Float64Array;
  // Ray tests
  tested: Uint32Array; genBox: { gen: number };
  // Current origins/directions (size N)
  origX: Float64Array; origY: Float64Array;
  dirX: Float64Array; dirY: Float64Array;
  // Ray-extent output (size N)
  r_max: Float64Array;
  // resamplePoints intermediate buffers
  inflX: Float64Array; inflY: Float64Array;
  tgtInflX: Float64Array; tgtInflY: Float64Array;
  arcLen: Float64Array; // size N+1
  tmpX: Float64Array; tmpY: Float64Array; // safe write targets for new origins
  // Radii (avoids per-call allocation in fitSinglePrimitive)
  r: Float64Array; r_tgt: Float64Array; r_init: Float64Array;
  newR: Float64Array; newRTgt: Float64Array;
};

export function localPrimitiveFitting(
  path: paper.CompoundPath,
  medialSkeleton: MedialAxisGraph,
  options: Partial<PrimitiveFittingOptions> = {},
  prebuiltBoundary?: FlatBoundary,
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

  // 2. Flatten boundary once for fast ray intersection throughout all primitives
  const flatBoundary = prebuiltBoundary ?? buildFlatBoundary(path);

  // 3. Prepare Optimization Buffers (Shared for all primitives)
  const N = opts.num_directions;
  const scratch: ScratchBuffers = {
    cp: new Float64Array(N), dp: new Float64Array(N),
    y: new Float64Array(N), z: new Float64Array(N),
    u_vec: new Float64Array(N), T_diag_adj: new Float64Array(N),
    d: new Float64Array(N), rhs: new Float64Array(N),
    tested: new Uint32Array(flatBoundary.count), genBox: { gen: 0 },
    origX: new Float64Array(N), origY: new Float64Array(N),
    dirX: new Float64Array(N), dirY: new Float64Array(N),
    r_max: new Float64Array(N),
    inflX: new Float64Array(N), inflY: new Float64Array(N),
    tgtInflX: new Float64Array(N), tgtInflY: new Float64Array(N),
    arcLen: new Float64Array(N + 1),
    tmpX: new Float64Array(N), tmpY: new Float64Array(N),
    r: new Float64Array(N), r_tgt: new Float64Array(N),
    r_init: new Float64Array(N),
    newR: new Float64Array(N), newRTgt: new Float64Array(N),
  };

  // Pre-compute uniform circle directions for vertex primitives (once)
  const circDirX = new Float64Array(N);
  const circDirY = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const rad = (i / N) * 2 * Math.PI;
    circDirX[i] = Math.cos(rad);
    circDirY[i] = Math.sin(rad);
  }

  // --- Process 1: Free-standing Vertices (Generalized Disks) ---
  for (let i = 0; i < skeleton.points.length; i++) {
    const center = skeleton.points[i];
    for (let j = 0; j < N; j++) {
      scratch.origX[j] = center.x;
      scratch.origY[j] = center.y;
    }
    scratch.dirX.set(circDirX);
    scratch.dirY.set(circDirY);

    const fitted = fitSinglePrimitive(N, flatBoundary, opts, scratch);
    skeleton.primitives.push({ type: "point", elementIdx: i, ...fitted });
  }

  // --- Process 2: Medial Edges (Generalized Capsules/Slabs) ---
  for (let i = 0; i < skeleton.segments.length; i++) {
    const [idxA, idxB] = skeleton.segments[i];
    const pA = skeleton.points[idxA];
    const pB = skeleton.points[idxB];
    const cp = skeleton.controlPoints?.[i];

    generateCapsuleDiscretization(
      pA.x, pA.y, pB.x, pB.y, N,
      scratch.origX, scratch.origY, scratch.dirX, scratch.dirY,
      cp?.[0], cp?.[1],
    );

    const fitted = fitSinglePrimitive(N, flatBoundary, opts, scratch);
    skeleton.primitives.push({ type: "edge", elementIdx: i, ...fitted });
  }

  return skeleton;
}

// --- Core Optimization Routine ---

function resamplePoints(N: number, scratch: ScratchBuffers): void {
  const {
    origX, origY, dirX, dirY,
    inflX, inflY, tgtInflX, tgtInflY,
    arcLen, tmpX, tmpY,
    r, r_tgt, newR, newRTgt,
  } = scratch;

  // Phase 1: inflated positions from current origins/directions/radii
  for (let i = 0; i < N; i++) {
    inflX[i] = origX[i] + dirX[i] * r[i];
    inflY[i] = origY[i] + dirY[i] * r[i];
    tgtInflX[i] = origX[i] + dirX[i] * r_tgt[i];
    tgtInflY[i] = origY[i] + dirY[i] * r_tgt[i];
  }

  // Phase 2: cumulative arc-length along inflated contour (closed)
  arcLen[0] = 0;
  for (let i = 0; i < N; i++) {
    const ni = (i + 1) % N;
    const dx = inflX[ni] - inflX[i], dy = inflY[ni] - inflY[i];
    arcLen[i + 1] = arcLen[i] + Math.sqrt(dx * dx + dy * dy);
  }
  const spacing = arcLen[N] / N;

  // Phase 3: resample uniformly along the inflated contour.
  // New origins go to tmpX/tmpY (can't overwrite origX/origY mid-loop since we read them).
  // New directions go directly to dirX/dirY (dirX/dirY not read after Phase 1).
  // New radii go to newR/newRTgt (r/r_tgt read via interpolation).
  let segIdx = 0;
  for (let k = 0; k < N; k++) {
    const targetLen = k * spacing;
    while (segIdx < N && arcLen[segIdx + 1] <= targetLen) segIdx++;

    const next = (segIdx + 1) % N;
    const segLen = arcLen[segIdx + 1] - arcLen[segIdx];
    const t = segLen > 1e-10 ? (targetLen - arcLen[segIdx]) / segLen : 0;
    const s = 1 - t;

    const noX = origX[segIdx] * s + origX[next] * t;
    const noY = origY[segIdx] * s + origY[next] * t;
    tmpX[k] = noX;
    tmpY[k] = noY;

    const npX = inflX[segIdx] * s + inflX[next] * t;
    const npY = inflY[segIdx] * s + inflY[next] * t;
    const dX = npX - noX, dY = npY - noY;
    const dLen = Math.sqrt(dX * dX + dY * dY);
    newR[k] = dLen;
    if (dLen > 1e-10) {
      dirX[k] = dX / dLen;
      dirY[k] = dY / dLen;
    } else {
      dirX[k] = 1;
      dirY[k] = 0;
    }

    const ntX = tgtInflX[segIdx] * s + tgtInflX[next] * t;
    const ntY = tgtInflY[segIdx] * s + tgtInflY[next] * t;
    const tdX = ntX - noX, tdY = ntY - noY;
    newRTgt[k] = Math.sqrt(tdX * tdX + tdY * tdY);
  }

  origX.set(tmpX);
  origY.set(tmpY);
  r.set(newR);
  r_tgt.set(newRTgt);
}

function fitSinglePrimitive(
  N: number,
  boundary: FlatBoundary,
  opts: PrimitiveFittingOptions,
  scratch: ScratchBuffers,
): { origins: Vec2D[]; directions: Vec2D[]; radii: number[] } {
  const { origX, origY, r, r_tgt, r_init, r_max } = scratch;

  // 1. Compute max extents
  computeMaxExtents(N, scratch, boundary);

  // 2. Initialize radii from inscribed distance at each origin.
  // Fast-path: vertex primitives have all origins at the same point — call once.
  if (origX[0] === origX[N >> 1] && origY[0] === origY[N >> 1]) {
    const inscribed = nearestDistFlatBoundary(origX[0], origY[0], boundary);
    r.fill(inscribed > 1e-4 ? inscribed * 0.99 : 1e-3);
  } else {
    for (let i = 0; i < N; i++) {
      const inscribed = nearestDistFlatBoundary(origX[i], origY[i], boundary);
      r[i] = inscribed > 1e-4 ? inscribed * 0.99 : 1e-3;
    }
  }
  r_tgt.set(r);
  r_init.set(r);

  // 3. Progressive Expansion
  for (let prog = 0; prog < opts.max_progressions; prog++) {
    for (let k = 0; k < N; k++) {
      r_tgt[k] = Math.max(
        r_tgt[k] + 0.1 * r_init[k],
        r_tgt[k] + opts.min_absolute_growth,
      );
    }

    // Solver loop
    for (let iter = 0; iter < opts.max_alternating_iters; iter++) {
      scratch.d.fill(2 + opts.w_expansion);
      let constraintsActive = false;

      for (let j = 0; j < N; j++) {
        scratch.rhs[j] = opts.w_expansion * r_tgt[j];
        if (r[j] > r_max[j]) {
          constraintsActive = true;
          scratch.d[j] += opts.w_penalty;
          scratch.rhs[j] += opts.w_penalty * r_max[j];
        }
      }

      solveCyclicTridiagonal(scratch.d, -1, -1, scratch.rhs, r, scratch);
      if (!constraintsActive) break;
    }

    if (prog % 3 === 0 && prog < opts.max_progressions - 1) {
      resamplePoints(N, scratch);
      computeMaxExtents(N, scratch, boundary);
    }
  }

  // Copy flat buffers into Vec2D[] for the public Primitive interface
  const origins: Vec2D[] = new Array(N);
  const directions: Vec2D[] = new Array(N);
  for (let i = 0; i < N; i++) {
    origins[i] = { x: scratch.origX[i], y: scratch.origY[i] };
    directions[i] = { x: scratch.dirX[i], y: scratch.dirY[i] };
  }
  return { origins, directions, radii: Array.from(r) };
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
 * Writes origins and directions for a capsule primitive into the provided
 * Float64Arrays. When cp1/cp2 are supplied the bone follows a cubic Bezier.
 * All angles computed in radians; no paper.Point allocations.
 */
function generateCapsuleDiscretization(
  pAx: number, pAy: number,
  pBx: number, pBy: number,
  N: number,
  origX: Float64Array, origY: Float64Array,
  dirX: Float64Array, dirY: Float64Array,
  cp1?: Vec2D, cp2?: Vec2D,
): void {
  const quarter = Math.floor(N / 4);
  const remainder = N - quarter * 4;
  const nSide = quarter + Math.floor(remainder / 2);
  const nCap = quarter;
  let j = 0;

  if (cp1 && cp2) {
    const pA: Vec2D = { x: pAx, y: pAy };
    const pB: Vec2D = { x: pBx, y: pBy };

    const unitTan = (t: number): Vec2D => {
      const raw = cubicBezierTangent(pA, cp1, cp2, pB, t);
      const len = Math.hypot(raw.x, raw.y);
      return len > 1e-8 ? { x: raw.x / len, y: raw.y / len } : { x: 1, y: 0 };
    };

    const tanA = unitTan(0);
    const tanB = unitTan(1);
    const baseAngleA = Math.atan2(tanA.y, tanA.x);
    const baseAngleB = Math.atan2(tanB.y, tanB.x);

    // Section 1: Side A→B (+90° normal to tangent)
    for (let i = 0; i < nSide; i++) {
      const t = nSide > 1 ? i / (nSide - 1) : 0;
      const pt = cubicBezierPoint(pA, cp1, cp2, pB, t);
      const tn = unitTan(t);
      origX[j] = pt.x; origY[j] = pt.y;
      dirX[j] = -tn.y; dirY[j] = tn.x;
      j++;
    }

    // Section 2: Cap B — fan from +90° to −90° around tangent at t=1
    const startB = baseAngleB + Math.PI / 2;
    for (let i = 0; i < nCap; i++) {
      const ang = startB - ((i + 1) / (nCap + 1)) * Math.PI;
      origX[j] = pBx; origY[j] = pBy;
      dirX[j] = Math.cos(ang); dirY[j] = Math.sin(ang);
      j++;
    }

    // Section 3: Side B→A (−90° normal)
    for (let i = 0; i < nSide; i++) {
      const t = nSide > 1 ? i / (nSide - 1) : 0;
      const pt = cubicBezierPoint(pA, cp1, cp2, pB, 1 - t);
      const tn = unitTan(1 - t);
      origX[j] = pt.x; origY[j] = pt.y;
      dirX[j] = tn.y; dirY[j] = -tn.x;
      j++;
    }

    // Section 4: Cap A — fan from −90° to −270° around tangent at t=0
    const startA = baseAngleA - Math.PI / 2;
    for (let i = 0; i < nCap; i++) {
      const ang = startA - ((i + 1) / (nCap + 1)) * Math.PI;
      origX[j] = pAx; origY[j] = pAy;
      dirX[j] = Math.cos(ang); dirY[j] = Math.sin(ang);
      j++;
    }
  } else {
    // Straight-line bone
    const vx = pBx - pAx, vy = pBy - pAy;
    const vLen = Math.sqrt(vx * vx + vy * vy);
    const nX = vLen > 1e-10 ? -vy / vLen : 0;  // +90° normal
    const nY = vLen > 1e-10 ? vx / vLen : 1;
    const baseAngle = Math.atan2(vy, vx);

    // Section 1: Side A→B
    for (let i = 0; i < nSide; i++) {
      const t = i / (nSide - 1 || 1);
      origX[j] = pAx + vx * t; origY[j] = pAy + vy * t;
      dirX[j] = nX; dirY[j] = nY;
      j++;
    }

    // Section 2: Cap B
    const startB = baseAngle + Math.PI / 2;
    for (let i = 0; i < nCap; i++) {
      const ang = startB - ((i + 1) / (nCap + 1)) * Math.PI;
      origX[j] = pBx; origY[j] = pBy;
      dirX[j] = Math.cos(ang); dirY[j] = Math.sin(ang);
      j++;
    }

    // Section 3: Side B→A
    for (let i = 0; i < nSide; i++) {
      const t = i / (nSide - 1 || 1);
      origX[j] = pBx - vx * t; origY[j] = pBy - vy * t;
      dirX[j] = -nX; dirY[j] = -nY;
      j++;
    }

    // Section 4: Cap A
    const startA = baseAngle - Math.PI / 2;
    for (let i = 0; i < nCap; i++) {
      const ang = startA - ((i + 1) / (nCap + 1)) * Math.PI;
      origX[j] = pAx; origY[j] = pAy;
      dirX[j] = Math.cos(ang); dirY[j] = Math.sin(ang);
      j++;
    }
  }
}

/**
 * Computes max ray extent for each sample, writing results into scratch.r_max.
 */
function computeMaxExtents(
  N: number,
  scratch: ScratchBuffers,
  boundary: FlatBoundary,
): void {
  const { origX, origY, dirX, dirY, r_max, tested, genBox } = scratch;
  for (let i = 0; i < N; i++) {
    r_max[i] = rayIntersectFlatBoundary(
      origX[i], origY[i], dirX[i], dirY[i],
      boundary, tested, ++genBox.gen,
    );
  }
}

// --- Solver Functions ---

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
