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

const BEZIER_REGULARIZATION = 0.5;
const VALIDITY_N_SAMP = 20;
const COVERAGE_TOLERANCE = 0.001;
const N_FIT_SAMPLES = 30; // total samples for composite Bezier fitting
const N_ARC_EST = 10; // samples per segment for arc-length estimation

/**
 * Post-processes a medial skeleton by contracting degree-2 chain edges.
 *
 * An edge [u, v] where both u and v have degree 2 is a pure interior chain node —
 * it has no topological significance. Contracting it merges the three edges
 * (w–u, u–v, v–x) into a single edge (w–x). The merge is accepted only if the
 * new edge stays inside the shape and coverage does not decrease.
 *
 * Multi-pass greedy: repeats until a full pass produces no simplifications.
 */
export function simplifyMedialSkeleton(
  skeleton: MedialAxisGraph,
  rawMedialAxis: MedialAxisGraph,
  path: paper.CompoundPath,
): MedialAxisGraph {
  const rawPoints = rawMedialAxis.points;
  const rawAdj = buildAdj(rawMedialAxis);

  // Boundary samples for coverage evaluation (same step as the NM optimizer uses)
  const boundarySamples = sampleBoundary(path, { step: 10 }).points.map(
    (p) => new paper.Point(p.x, p.y),
  );

  let current = skeleton;
  let baselineCoverage = computeCoverage(current, path, boundarySamples);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = tryOneContraction(
      current,
      rawPoints,
      rawAdj,
      path,
      boundarySamples,
      baselineCoverage,
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

function tryOneContraction(
  skeleton: MedialAxisGraph,
  rawPoints: Vec2D[],
  rawAdj: number[][],
  path: paper.CompoundPath,
  boundarySamples: paper.Point[],
  baselineCoverage: number,
): { skeleton: MedialAxisGraph; coverage: number } | null {
  const deg = computeDegrees(skeleton);

  for (let ei = 0; ei < skeleton.segments.length; ei++) {
    const [u, v] = skeleton.segments[ei];
    if (deg[u] !== 2 || deg[v] !== 2) continue;

    // Find the other neighbour of u (≠ v) and of v (≠ u)
    const w = otherNeighbour(skeleton, u, v);
    const x = otherNeighbour(skeleton, v, u);
    if (w < 0 || x < 0 || w === x) continue;

    // Raw nodes for the merge endpoints
    const rawW = skeleton.vertexRawNodes?.[w] ?? -1;
    const rawX = skeleton.vertexRawNodes?.[x] ?? -1;
    if (rawW < 0 || rawX < 0) continue;

    // BFS for merged raw path
    const mergedRawPath = bfsPath(rawW, rawX, rawAdj);
    if (!mergedRawPath) continue;

    // Fit Bezier CPs by sampling the composite of the three existing fitted Beziers
    const pW = skeleton.points[w];
    const pX = skeleton.points[x];
    const composite = sampleCompositeBezier(skeleton, ei, u, v, w, x);
    const [cp1, cp2] = composite
      ? fitBezierCPsFromSamples(
          composite.samples,
          composite.ts,
          pW,
          pX,
          BEZIER_REGULARIZATION,
        )
      : fitBezierCPs(mergedRawPath, rawPoints, pW, pX, BEZIER_REGULARIZATION);

    // Validity: all sampled Bezier points must be inside the shape
    if (!isMergedEdgeInside(pW, cp1, cp2, pX, path)) continue;

    // Build the simplified skeleton and evaluate coverage
    const simplified = buildSimplifiedSkeleton(
      skeleton,
      ei,
      u,
      v,
      w,
      x,
      rawW,
      rawX,
      mergedRawPath,
      rawPoints,
      cp1,
      cp2,
    );
    const cov = computeCoverage(simplified, path, boundarySamples);
    if (cov >= baselineCoverage - COVERAGE_TOLERANCE) {
      const pu = skeleton.points[u],
        pv = skeleton.points[v];
      console.log(
        `  [simplify] contracted e${ei}: ` +
          `v${u}(${pu.x.toFixed(1)},${pu.y.toFixed(1)})–` +
          `v${v}(${pv.x.toFixed(1)},${pv.y.toFixed(1)}) → ` +
          `v${w}–v${x}  coverage ${(baselineCoverage * 100).toFixed(2)}%→${(cov * 100).toFixed(2)}%`,
      );
      return { skeleton: simplified, coverage: cov };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Build the simplified skeleton (remove u, v and their incident edges; add w–x)
// ---------------------------------------------------------------------------

function buildSimplifiedSkeleton(
  sk: MedialAxisGraph,
  contractedEdgeIdx: number,
  u: number,
  v: number,
  w: number,
  x: number,
  rawW: number,
  rawX: number,
  mergedRawPath: number[],
  rawPoints: Vec2D[],
  cp1: Vec2D,
  cp2: Vec2D,
): MedialAxisGraph {
  // Vertex remap: skip u and v
  const oldToNew = new Int32Array(sk.points.length).fill(-1);
  let nextIdx = 0;
  for (let i = 0; i < sk.points.length; i++) {
    if (i !== u && i !== v) oldToNew[i] = nextIdx++;
  }

  // Which segment indices to remove (all edges incident to u or v)
  const removedSegs = new Set<number>();
  for (let ei = 0; ei < sk.segments.length; ei++) {
    const [a, b] = sk.segments[ei];
    if (a === u || a === v || b === u || b === v) removedSegs.add(ei);
  }

  const newPoints: Vec2D[] = sk.points.filter((_, i) => i !== u && i !== v);
  const newSegments: [number, number][] = [];
  const newCPs: [Vec2D, Vec2D][] = [];
  const newSamples: [Vec2D, Vec2D, Vec2D][] = [];
  const newVRN: number[] = sk.vertexRawNodes
    ? sk.points
        .map((_, i) => sk.vertexRawNodes![i])
        .filter((_, i) => i !== u && i !== v)
    : [];

  for (let ei = 0; ei < sk.segments.length; ei++) {
    if (removedSegs.has(ei)) continue;
    const [a, b] = sk.segments[ei];
    newSegments.push([oldToNew[a], oldToNew[b]]);
    if (sk.controlPoints) newCPs.push(sk.controlPoints[ei]);
    if (sk.rawPathSamples) newSamples.push(sk.rawPathSamples[ei]);
  }

  // Add the merged edge w–x
  newSegments.push([oldToNew[w], oldToNew[x]]);
  if (sk.controlPoints) newCPs.push([cp1, cp2]);
  if (sk.rawPathSamples) {
    const n = mergedRawPath.length;
    newSamples.push([
      rawPoints[mergedRawPath[Math.floor(n / 4)]],
      rawPoints[mergedRawPath[Math.floor(n / 2)]],
      rawPoints[mergedRawPath[Math.floor((3 * n) / 4)]],
    ]);
  }
  if (sk.vertexRawNodes) {
    // vertexRawNodes for w and x are already in newVRN (they weren't filtered out)
    // The merged edge doesn't add new vertices, so nothing extra needed here.
    void rawW;
    void rawX; // used in caller for BFS; raw nodes stay on w and x
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
  pW: Vec2D,
  cp1: Vec2D,
  cp2: Vec2D,
  pX: Vec2D,
  path: paper.CompoundPath,
): boolean {
  for (let k = 1; k < VALIDITY_N_SAMP; k++) {
    const { x, y } = evalBezier(pW, cp1, cp2, pX, k / VALIDITY_N_SAMP);
    if (!path.contains(new paper.Point(x, y))) return false;
  }
  return true;
}

function computeDegrees(sk: MedialAxisGraph): Int32Array {
  const deg = new Int32Array(sk.points.length);
  for (const [a, b] of sk.segments) {
    deg[a]++;
    deg[b]++;
  }
  return deg;
}

/** Returns the neighbour of `node` in skeleton that is not `exclude`, or -1. */
function otherNeighbour(
  sk: MedialAxisGraph,
  node: number,
  exclude: number,
): number {
  for (const [a, b] of sk.segments) {
    if (a === node && b !== exclude) return b;
    if (b === node && a !== exclude) return a;
  }
  return -1;
}

function buildAdj(graph: MedialAxisGraph): number[][] {
  const adj: number[][] = Array.from({ length: graph.points.length }, () => []);
  for (const [u, v] of graph.segments) {
    adj[u].push(v);
    adj[v].push(u);
  }
  return adj;
}

/** Returns the index of the segment connecting a and b (either direction), or -1. */
function findEdgeIndex(sk: MedialAxisGraph, a: number, b: number): number {
  for (let i = 0; i < sk.segments.length; i++) {
    const [p, q] = sk.segments[i];
    if ((p === a && q === b) || (p === b && q === a)) return i;
  }
  return -1;
}

/** Returns control points for segment ei oriented from `from` to `to`. */
function orientedCPs(
  sk: MedialAxisGraph,
  ei: number,
  from: number,
  to: number,
): [Vec2D, Vec2D] {
  void to;
  const [cp1, cp2] = sk.controlPoints![ei];
  const [a] = sk.segments[ei];
  return a === from ? [cp1, cp2] : [cp2, cp1];
}

/**
 * Densely samples the composite cubic Bezier curve w→u→v→x, assigning
 * arc-length-proportional sample counts to each of the three segments.
 * Returns the samples and their global arc-length fractions for use with
 * fitBezierCPsFromSamples.
 */
function sampleCompositeBezier(
  skeleton: MedialAxisGraph,
  edgeUV: number,
  u: number,
  v: number,
  w: number,
  x: number,
): { samples: Vec2D[]; ts: Float64Array } | null {
  if (!skeleton.controlPoints) return null;
  const edgeWU = findEdgeIndex(skeleton, w, u);
  const edgeVX = findEdgeIndex(skeleton, v, x);
  if (edgeWU < 0 || edgeVX < 0) return null;

  const pW = skeleton.points[w];
  const pU = skeleton.points[u];
  const pV = skeleton.points[v];
  const pX = skeleton.points[x];

  const [cp1WU, cp2WU] = orientedCPs(skeleton, edgeWU, w, u);
  const [cp1UV, cp2UV] = orientedCPs(skeleton, edgeUV, u, v);
  const [cp1VX, cp2VX] = orientedCPs(skeleton, edgeVX, v, x);

  // Estimate arc length of each segment
  function segLen(pA: Vec2D, c1: Vec2D, c2: Vec2D, pB: Vec2D): number {
    let len = 0;
    let prev = pA;
    for (let k = 1; k <= N_ARC_EST; k++) {
      const pt = evalBezier(pA, c1, c2, pB, k / N_ARC_EST);
      len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = pt;
    }
    return len;
  }

  const lenWU = segLen(pW, cp1WU, cp2WU, pU);
  const lenUV = segLen(pU, cp1UV, cp2UV, pV);
  const lenVX = segLen(pV, cp1VX, cp2VX, pX);
  const totalEst = lenWU + lenUV + lenVX;
  if (totalEst < 1e-6) return null;

  // Arc-length-proportional sample counts (at least 2 per segment)
  const nWU = Math.max(2, Math.round((N_FIT_SAMPLES * lenWU) / totalEst));
  const nUV = Math.max(2, Math.round((N_FIT_SAMPLES * lenUV) / totalEst));
  const nVX = Math.max(2, Math.round((N_FIT_SAMPLES * lenVX) / totalEst));

  // Sample each segment; skip the t=0 duplicate at UV and VX starts
  const pts: Vec2D[] = [];
  for (let k = 0; k <= nWU; k++)
    pts.push(evalBezier(pW, cp1WU, cp2WU, pU, k / nWU));
  for (let k = 1; k <= nUV; k++)
    pts.push(evalBezier(pU, cp1UV, cp2UV, pV, k / nUV));
  for (let k = 1; k <= nVX; k++)
    pts.push(evalBezier(pV, cp1VX, cp2VX, pX, k / nVX));

  // Compute global arc-length fractions
  const cumLen = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++)
    cumLen[i] =
      cumLen[i - 1] +
      Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const totalLen = cumLen[pts.length - 1];
  const ts =
    totalLen > 1e-6
      ? Float64Array.from(cumLen, (c) => c / totalLen)
      : Float64Array.from(
          { length: pts.length },
          (_, i) => i / (pts.length - 1),
        );

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
      if (nb === to) {
        found = true;
        break outer;
      }
      queue.push(nb);
    }
  }
  if (!found) return null;
  const path: number[] = [];
  let curr = to;
  while (curr !== -1) {
    path.push(curr);
    curr = parent[curr];
  }
  path.reverse();
  return path;
}
