import paper from "paper";

import { sampleBoundary } from "@/app/pathUtils/flatBoundary";
import {
  evalBezier,
  fitBezierCPs,
  fitBezierCPsFromSamples,
} from "@/app/pathUtils/skeleton/bezierFitting";
import { localPrimitiveFitting } from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { MedialAxisGraph } from "@/app/pathUtils/skeleton/medialAxis";
import { coverageAndUncovered } from "@/app/pathUtils/skeleton/medialSkeletonPoints";
import { Vec2D } from "@/app/utils/types";

export type SimplifySkeletonOptions = {
  /** Tikhonov regularisation strength for merged-edge Bezier CP fitting. */
  bezierRegularization: number;
  /** Number of interior samples for the merged-edge inside-shape validity check. */
  validityNSamples: number;
  /** Max fractional coverage drop that still permits a contraction. */
  coverageTolerance: number;
  /** Total sample count for composite Bezier fitting across the merged segments. */
  nFitSamples: number;
  /** Samples per segment used to estimate arc length before allocating fit samples. */
  nArcEstSamples: number;
};

const DEFAULTS: SimplifySkeletonOptions = {
  bezierRegularization: 0.5,
  validityNSamples: 20,
  coverageTolerance: 0.001,
  nFitSamples: 30,
  nArcEstSamples: 10,
};

/**
 * Post-processes a medial skeleton by contracting degree-2 chain edges.
 *
 * For each edge [u, v] where both u and v have degree 2, two options are tried:
 *   A) remove v — fit a single Bezier over the composite u→v→x path
 *   B) remove u — fit a single Bezier over the composite w→u→v path
 * The option whose merged Bezier gives the lower mean-squared residual is chosen.
 * The contraction is accepted only if the new edge stays inside the shape and
 * coverage does not decrease.
 *
 * Multi-pass greedy: repeats until a full pass produces no simplifications.
 */
export function simplifyMedialSkeleton(
  skeleton: MedialAxisGraph,
  rawMedialAxis: MedialAxisGraph,
  path: paper.CompoundPath,
  options: Partial<SimplifySkeletonOptions> = {},
): MedialAxisGraph {
  const opts: SimplifySkeletonOptions = { ...DEFAULTS, ...options };
  const rawPoints = rawMedialAxis.points;
  const rawAdj = buildAdj(rawMedialAxis);

  const boundarySamples = sampleBoundary(path, { step: 10 }).points.map(
    (p) => new paper.Point(p.x, p.y),
  );

  let current = skeleton;
  let baselineCoverage = computeCoverage(current, path, boundarySamples);

  while (true) {
    const result = tryOneContraction(
      current, rawPoints, rawAdj, path, boundarySamples, baselineCoverage, opts,
    );
    if (!result) break;
    current = result.skeleton;
    baselineCoverage = result.coverage;
  }

  return current;
}

// ---------------------------------------------------------------------------
// Core single-pass: find and apply the first acceptable contraction.
// ---------------------------------------------------------------------------

type Candidate = {
  removed: number;        // vertex to be removed (degree-2)
  kept: number;           // endpoint of new edge on the "near" side (kept vertex's neighbour)
  farEnd: number;         // endpoint of new edge on the "far" side (removed vertex's other neighbour)
  pKept: Vec2D;
  pFar: Vec2D;
  cp1: Vec2D;
  cp2: Vec2D;
  residual: number;       // mean squared distance of samples to fitted Bezier (Infinity if no samples)
  mergedRawPath: number[];
};

/**
 * Try removing `removed` (must be degree-2) from edge ei = [kept, removed].
 * Returns null if the operation is invalid (no other neighbour, missing raw nodes,
 * no path in raw graph, or geometry is degenerate).
 */
function tryRemove(
  skeleton: MedialAxisGraph,
  rawPoints: Vec2D[],
  rawAdj: number[][],
  opts: SimplifySkeletonOptions,
  ei: number,
  kept: number,
  removed: number,
  pKept: Vec2D,
  rawKept: number,
): Candidate | null {
  // farEnd = removed's other neighbour ≠ kept
  const farEnd = otherNeighbour(skeleton, removed, kept);
  if (farEnd < 0 || farEnd === kept) return null;
  const rawFar = skeleton.vertexRawNodes?.[farEnd] ?? -1;
  if (rawFar < 0) return null;
  const edgeRemFar = findEdgeIndex(skeleton, removed, farEnd);
  if (edgeRemFar < 0) return null;

  const pFar = skeleton.points[farEnd];

  // Sample the composite Bezier kept→removed→farEnd (oriented from kept toward farEnd)
  const samples = sampleTwoSegments(
    skeleton, ei, kept, removed, edgeRemFar, farEnd, opts,
  );

  let cp1: Vec2D, cp2: Vec2D, residual: number;
  if (samples) {
    [cp1, cp2] = fitBezierCPsFromSamples(
      samples.samples, samples.ts, pKept, pFar, opts.bezierRegularization,
    );
    residual = computeResidual(samples.samples, samples.ts, pKept, cp1, cp2, pFar);
  } else {
    const rp = bfsPath(rawKept, rawFar, rawAdj);
    if (!rp) return null;
    [cp1, cp2] = fitBezierCPs(rp, rawPoints, pKept, pFar, opts.bezierRegularization);
    residual = Infinity;
  }

  const mergedRawPath = bfsPath(rawKept, rawFar, rawAdj);
  if (!mergedRawPath) return null;

  return { removed, kept, farEnd, pKept, pFar, cp1, cp2, residual, mergedRawPath };
}

function tryOneContraction(
  skeleton: MedialAxisGraph,
  rawPoints: Vec2D[],
  rawAdj: number[][],
  path: paper.CompoundPath,
  boundarySamples: paper.Point[],
  baselineCoverage: number,
  opts: SimplifySkeletonOptions,
): { skeleton: MedialAxisGraph; coverage: number } | null {
  const deg = computeDegrees(skeleton);

  for (let ei = 0; ei < skeleton.segments.length; ei++) {
    const [u, v] = skeleton.segments[ei];
    const uIs2 = deg[u] === 2;
    const vIs2 = deg[v] === 2;
    if (!uIs2 && !vIs2) continue;

    const rawU = skeleton.vertexRawNodes?.[u] ?? -1;
    const rawV = skeleton.vertexRawNodes?.[v] ?? -1;
    if (rawU < 0 || rawV < 0) continue;

    const pU = skeleton.points[u], pV = skeleton.points[v];

    // Option A: remove v (requires v degree-2), fit u→x over composite u→v→x
    const candA = vIs2
      ? tryRemove(skeleton, rawPoints, rawAdj, opts, ei, u, v, pU, rawU)
      : null;

    // Option B: remove u (requires u degree-2), fit w→v over composite w→u→v
    const candB = uIs2
      ? tryRemove(skeleton, rawPoints, rawAdj, opts, ei, v, u, pV, rawV)
      : null;

    // Skip if both options exist and they create the same merged edge (3-cycle)
    if (candA && candB && candA.farEnd === candB.farEnd) continue;

    // Pick the candidate with lower residual; if only one is valid, use it.
    let chosen: Candidate | null;
    if (candA && candB) chosen = candA.residual <= candB.residual ? candA : candB;
    else chosen = candA ?? candB;
    if (!chosen) continue;

    if (!isMergedEdgeInside(chosen.pKept, chosen.cp1, chosen.cp2, chosen.pFar, path, opts)) continue;

    const simplified = buildContractedSkeleton(
      skeleton, chosen.removed, chosen.kept, chosen.farEnd,
      chosen.mergedRawPath, rawPoints, chosen.cp1, chosen.cp2,
    );
    const cov = computeCoverage(simplified, path, boundarySamples);
    if (cov >= baselineCoverage - opts.coverageTolerance) {
      const pRem = skeleton.points[chosen.removed];
      const tag = candA && candB ? (chosen === candA ? "A" : "B")
                : candA          ? "A only"
                :                  "B only";
      console.log(
        `  [simplify] removed v${chosen.removed}(${pRem.x.toFixed(1)},${pRem.y.toFixed(1)}) ` +
        `(option ${tag}, e${ei}: v${u}–v${v}) → v${chosen.kept}–v${chosen.farEnd}  ` +
        `coverage ${(baselineCoverage * 100).toFixed(2)}%→${(cov * 100).toFixed(2)}%`,
      );
      return { skeleton: simplified, coverage: cov };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Build contracted skeleton: remove one vertex and its two incident edges,
// add a new edge between its two neighbours.
// ---------------------------------------------------------------------------

function buildContractedSkeleton(
  sk: MedialAxisGraph,
  removed: number,
  a: number,
  b: number,
  mergedRawPath: number[],
  rawPoints: Vec2D[],
  cp1: Vec2D,
  cp2: Vec2D,
): MedialAxisGraph {
  const oldToNew = new Int32Array(sk.points.length).fill(-1);
  let nextIdx = 0;
  for (let i = 0; i < sk.points.length; i++) {
    if (i !== removed) oldToNew[i] = nextIdx++;
  }

  const removedSegs = new Set<number>();
  for (let ei = 0; ei < sk.segments.length; ei++) {
    const [p, q] = sk.segments[ei];
    if (p === removed || q === removed) removedSegs.add(ei);
  }

  const newPoints: Vec2D[] = sk.points.filter((_, i) => i !== removed);
  const newSegments: [number, number][] = [];
  const newCPs: [Vec2D, Vec2D][] = [];
  const newSamples: [Vec2D, Vec2D, Vec2D][] = [];
  const newVRN: number[] = sk.vertexRawNodes
    ? sk.points.map((_, i) => sk.vertexRawNodes![i]).filter((_, i) => i !== removed)
    : [];

  for (let ei = 0; ei < sk.segments.length; ei++) {
    if (removedSegs.has(ei)) continue;
    const [p, q] = sk.segments[ei];
    newSegments.push([oldToNew[p], oldToNew[q]]);
    if (sk.controlPoints) newCPs.push(sk.controlPoints[ei]);
    if (sk.rawPathSamples) newSamples.push(sk.rawPathSamples[ei]);
  }

  newSegments.push([oldToNew[a], oldToNew[b]]);
  if (sk.controlPoints) newCPs.push([cp1, cp2]);
  if (sk.rawPathSamples) {
    const n = mergedRawPath.length;
    newSamples.push([
      rawPoints[mergedRawPath[Math.floor(n / 4)]],
      rawPoints[mergedRawPath[Math.floor(n / 2)]],
      rawPoints[mergedRawPath[Math.floor((3 * n) / 4)]],
    ]);
  }

  return {
    points: newPoints,
    segments: newSegments,
    ...(sk.controlPoints ? { controlPoints: newCPs } : {}),
    ...(sk.rawPathSamples ? { rawPathSamples: newSamples } : {}),
    ...(sk.vertexRawNodes ? { vertexRawNodes: newVRN } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeCoverage(
  skeleton: MedialAxisGraph,
  path: paper.CompoundPath,
  boundarySamples: paper.Point[],
): number {
  const fitted = localPrimitiveFitting(path, skeleton);
  return coverageAndUncovered(boundarySamples, fitted.primitives).coverage;
}

function isMergedEdgeInside(
  pA: Vec2D, cp1: Vec2D, cp2: Vec2D, pB: Vec2D,
  path: paper.CompoundPath,
  opts: SimplifySkeletonOptions,
): boolean {
  for (let k = 1; k < opts.validityNSamples; k++) {
    const { x, y } = evalBezier(pA, cp1, cp2, pB, k / opts.validityNSamples);
    if (!path.contains(new paper.Point(x, y))) return false;
  }
  return true;
}

/**
 * Mean squared distance from each sample to the Bezier evaluated at the
 * corresponding arc-length parameter.  Used to compare option A vs B.
 */
function computeResidual(
  samples: Vec2D[],
  ts: Float64Array,
  pA: Vec2D, cp1: Vec2D, cp2: Vec2D, pB: Vec2D,
): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const bt = evalBezier(pA, cp1, cp2, pB, ts[i]);
    const dx = bt.x - samples[i].x, dy = bt.y - samples[i].y;
    sum += dx * dx + dy * dy;
  }
  return sum / samples.length;
}

function computeDegrees(sk: MedialAxisGraph): Int32Array {
  const deg = new Int32Array(sk.points.length);
  for (const [a, b] of sk.segments) { deg[a]++; deg[b]++; }
  return deg;
}

function otherNeighbour(sk: MedialAxisGraph, node: number, exclude: number): number {
  for (const [a, b] of sk.segments) {
    if (a === node && b !== exclude) return b;
    if (b === node && a !== exclude) return a;
  }
  return -1;
}

function buildAdj(graph: MedialAxisGraph): number[][] {
  const adj: number[][] = Array.from({ length: graph.points.length }, () => []);
  for (const [u, v] of graph.segments) { adj[u].push(v); adj[v].push(u); }
  return adj;
}

function findEdgeIndex(sk: MedialAxisGraph, a: number, b: number): number {
  for (let i = 0; i < sk.segments.length; i++) {
    const [p, q] = sk.segments[i];
    if ((p === a && q === b) || (p === b && q === a)) return i;
  }
  return -1;
}

function orientedCPs(
  sk: MedialAxisGraph, ei: number, from: number, to: number,
): [Vec2D, Vec2D] {
  void to;
  const [cp1, cp2] = sk.controlPoints![ei];
  const [a] = sk.segments[ei];
  return a === from ? [cp1, cp2] : [cp2, cp1];
}

/**
 * Samples the composite Bezier curve pFrom→pMid→pTo across two consecutive
 * skeleton edges, with arc-length-proportional sample counts per segment.
 */
function sampleTwoSegments(
  skeleton: MedialAxisGraph,
  edge1Idx: number,
  from1: number,
  mid: number,
  edge2Idx: number,
  to2: number,
  opts: SimplifySkeletonOptions,
): { samples: Vec2D[]; ts: Float64Array } | null {
  if (!skeleton.controlPoints) return null;

  const pFrom = skeleton.points[from1];
  const pMid  = skeleton.points[mid];
  const pTo   = skeleton.points[to2];

  const [cp1S1, cp2S1] = orientedCPs(skeleton, edge1Idx, from1, mid);
  const [cp1S2, cp2S2] = orientedCPs(skeleton, edge2Idx, mid,   to2);

  function segLen(pA: Vec2D, c1: Vec2D, c2: Vec2D, pB: Vec2D): number {
    let len = 0, prev = pA;
    for (let k = 1; k <= opts.nArcEstSamples; k++) {
      const pt = evalBezier(pA, c1, c2, pB, k / opts.nArcEstSamples);
      len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = pt;
    }
    return len;
  }

  const len1 = segLen(pFrom, cp1S1, cp2S1, pMid);
  const len2 = segLen(pMid,  cp1S2, cp2S2, pTo);
  const totalEst = len1 + len2;
  if (totalEst < 1e-6) return null;

  const n1 = Math.max(2, Math.round(opts.nFitSamples * len1 / totalEst));
  const n2 = Math.max(2, Math.round(opts.nFitSamples * len2 / totalEst));

  const pts: Vec2D[] = [];
  for (let k = 0; k <= n1; k++) pts.push(evalBezier(pFrom, cp1S1, cp2S1, pMid, k / n1));
  for (let k = 1; k <= n2; k++) pts.push(evalBezier(pMid,  cp1S2, cp2S2, pTo,  k / n2));

  const cumLen = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++)
    cumLen[i] = cumLen[i-1] + Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  const totalLen = cumLen[pts.length - 1];
  const ts = totalLen > 1e-6
    ? Float64Array.from(cumLen, c => c / totalLen)
    : Float64Array.from({ length: pts.length }, (_, i) => i / (pts.length - 1));

  return { samples: pts, ts };
}

function bfsPath(from: number, to: number, adj: number[][]): number[] | null {
  if (from === to) return [from];
  const parent = new Int32Array(adj.length).fill(-2);
  parent[from] = -1;
  const queue = [from];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] !== -2) continue;
      parent[nb] = curr;
      if (nb === to) { found = true; break outer; }
      queue.push(nb);
    }
  }
  if (!found) return null;
  const path: number[] = [];
  let curr = to;
  while (curr !== -1) { path.push(curr); curr = parent[curr]; }
  path.reverse();
  return path;
}
