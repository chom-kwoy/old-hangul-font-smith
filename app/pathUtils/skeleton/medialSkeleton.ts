import { MinPriorityQueue } from "@datastructures-js/priority-queue";
import paper from "paper";

import {
  FlatBoundary,
  buildFlatBoundary,
  nearestDistFlatBoundary,
} from "@/app/pathUtils/flatBoundary";
import { MedialAxisGraph } from "@/app/pathUtils/skeleton/medialAxis";
import { Vec2D } from "@/app/utils/types";

/**
 * Constructs the Medial Skeleton (M_S) from selected vertices (V) and the Raw Medial Axis (M).
 * Implements Section 5.1: Medial Skeleton Construction.
 *
 * Robust design: every output vertex corresponds to exactly one raw axis node.
 * A global rawToOut map deduplicates so that T-junctions shared by multiple seed-pair
 * paths become a single shared vertex — preventing duplicate vertices, zero-length
 * edges, and back-and-forth loops.
 */
export function constructMedialSkeleton(
  selectedPoints: paper.Point[],
  rawMedialAxis: MedialAxisGraph,
  originalPath: paper.CompoundPath,
): MedialAxisGraph {
  // ---------------------------------------------------------
  // Pre-processing
  // ---------------------------------------------------------
  const rawAdj = buildAdjacencyList(rawMedialAxis);
  const rawPoints = rawMedialAxis.points;
  const numNodes = rawPoints.length;

  if (!isGraphConnected(rawAdj)) {
    throw new Error("Raw Medial Axis is not connected!");
  }

  // ---------------------------------------------------------
  // Step 1: Restricted Voronoi Diagram (multi-source Dijkstra)
  // ---------------------------------------------------------
  const seedIndices: number[] = selectedPoints.map((p) =>
    getNearestNodeIndex(p, rawPoints),
  );

  const nodeOwner = new Int32Array(numNodes).fill(-1);
  const distToSeed = new Float64Array(numNodes).fill(Infinity);

  const pq = new MinPriorityQueue<{ dist: number; u: number; owner: number }>(
    (x) => x.dist,
  );
  seedIndices.forEach((rawNodeIdx, seedIdx) => {
    nodeOwner[rawNodeIdx] = seedIdx;
    distToSeed[rawNodeIdx] = 0;
    pq.push({ dist: 0, u: rawNodeIdx, owner: seedIdx });
  });
  while (!pq.isEmpty()) {
    const { dist, u, owner } = pq.pop()!;
    if (dist > distToSeed[u] + 1e-5) continue;
    for (const v of rawAdj[u]) {
      const w = new paper.Point(rawPoints[u]).getDistance(rawPoints[v]);
      if (!Number.isFinite(w)) continue;
      const nd = dist + w;
      if (nd < distToSeed[v]) {
        distToSeed[v] = nd;
        nodeOwner[v] = owner;
        pq.push({ dist: nd, u: v, owner });
      }
    }
  }

  // Step 1.5: Enforce single connected component per Voronoi cell
  for (let seedIdx = 0; seedIdx < selectedPoints.length; seedIdx++) {
    const seedRaw = seedIndices[seedIdx];
    const mainCC = new Set<number>([seedRaw]);
    const bfsQ = [seedRaw];
    while (bfsQ.length > 0) {
      const curr = bfsQ.shift()!;
      for (const nb of rawAdj[curr]) {
        if (!mainCC.has(nb) && nodeOwner[nb] === seedIdx) {
          mainCC.add(nb);
          bfsQ.push(nb);
        }
      }
    }
    const orphanVisited = new Set<number>();
    for (let i = 0; i < numNodes; i++) {
      if (nodeOwner[i] !== seedIdx || mainCC.has(i) || orphanVisited.has(i)) continue;
      const cc: number[] = [];
      const ccQ = [i];
      orphanVisited.add(i);
      while (ccQ.length > 0) {
        const curr = ccQ.shift()!;
        cc.push(curr);
        for (const nb of rawAdj[curr]) {
          if (!orphanVisited.has(nb) && nodeOwner[nb] === seedIdx) {
            orphanVisited.add(nb);
            ccQ.push(nb);
          }
        }
      }
      let cx = 0, cy = 0;
      for (const n of cc) { cx += rawPoints[n].x; cy += rawPoints[n].y; }
      cx /= cc.length; cy /= cc.length;
      let minD = Infinity, nearest = seedIdx;
      for (let s = 0; s < selectedPoints.length; s++) {
        if (s === seedIdx) continue;
        const d = Math.hypot(selectedPoints[s].x - cx, selectedPoints[s].y - cy);
        if (d < minD) { minD = d; nearest = s; }
      }
      for (const n of cc) nodeOwner[n] = nearest;
    }
  }

  const flatBoundary = buildFlatBoundary(originalPath);
  const rawNodeR = new Float64Array(numNodes);
  for (let i = 0; i < numNodes; i++)
    rawNodeR[i] = nearestDistFlatBoundary(rawPoints[i].x, rawPoints[i].y, flatBoundary);

  // ---------------------------------------------------------
  // Step 2: Detect adjacent seed pairs via interface raw edges
  // ---------------------------------------------------------
  const adjacentPairs = new Set<string>();
  for (const [u, v] of rawMedialAxis.segments) {
    const oU = nodeOwner[u], oV = nodeOwner[v];
    if (oU < 0 || oV < 0 || oU === oV) continue;
    const [sA, sB] = oU < oV ? [oU, oV] : [oV, oU];
    adjacentPairs.add(`${sA}-${sB}`);
  }

  // ---------------------------------------------------------
  // Step 3: For each adjacent pair, find raw path(s) and collect T-junctions.
  // ---------------------------------------------------------
  // Use BFS constrained to the A+B Voronoi region so paths don't roam through
  // thin junctions owned by third seeds.  For ring shapes the raw axis has a
  // cycle, so after finding the first path we re-run BFS with those edges
  // removed; if a second path exists it represents the other side of the ring.
  const essentialRawNodes = new Set<number>(seedIndices);
  const pairPaths: Array<{ seedA: number; seedB: number; path: number[] }> = [];

  for (const key of adjacentPairs) {
    const [aStr, bStr] = key.split("-");
    const seedA = parseInt(aStr), seedB = parseInt(bStr);
    const rawA = seedIndices[seedA];
    const rawB = seedIndices[seedB];

    // Filter: only visit nodes owned by seedA or seedB
    const inAB = (n: number) => nodeOwner[n] === seedA || nodeOwner[n] === seedB;

    const path1 = bfsPathFiltered(rawA, rawB, rawAdj, inAB);
    if (!path1) continue;

    for (const node of path1) {
      if (rawAdj[node].length >= 3) essentialRawNodes.add(node);
    }
    pairPaths.push({ seedA, seedB, path: path1 });

    // Ring detection: build edge-exclusion set from path1, try to find a second path
    const excludeEdges = new Set<string>();
    for (let i = 0; i + 1 < path1.length; i++) {
      const a = path1[i], b = path1[i + 1];
      excludeEdges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
    const path2 = bfsPathFiltered(rawA, rawB, rawAdj, inAB, excludeEdges);
    if (path2) {
      for (const node of path2) {
        if (rawAdj[node].length >= 3) essentialRawNodes.add(node);
      }
      pairPaths.push({ seedA, seedB, path: path2 });
    }
  }

  // ---------------------------------------------------------
  // Step 4: Create one output vertex per essential raw node (global dedup)
  // ---------------------------------------------------------
  // Seeds use their MSD-optimized positions (selectedPoints); all other essential
  // nodes use the raw axis position.
  const rawToOut = new Map<number, number>();
  const finalPoints: paper.Point[] = [];

  // Seeds first — preserves indices 0..nSeeds-1 for the leaf-snap loop,
  // and stores the MSD-optimized position rather than the raw-node position.
  for (let si = 0; si < selectedPoints.length; si++) {
    const rn = seedIndices[si];
    if (!rawToOut.has(rn)) {
      rawToOut.set(rn, finalPoints.length);
      finalPoints.push(new paper.Point(selectedPoints[si]));
    }
  }

  function getOrAddVertex(rn: number): number {
    let idx = rawToOut.get(rn);
    if (idx !== undefined) return idx;
    idx = finalPoints.length;
    rawToOut.set(rn, idx);
    finalPoints.push(new paper.Point(rawPoints[rn]));
    return idx;
  }

  for (const rn of essentialRawNodes) getOrAddVertex(rn);

  // ---------------------------------------------------------
  // Step 5: Build output edges from essential chains; check centrality
  // ---------------------------------------------------------
  const newSegments: [number, number][] = [];
  const segmentSet = new Set<string>();
  const MAX_TOTAL_VERTICES = 25;
  const MAX_BISECT_DEPTH = 4;

  function addSegment(u: number, v: number): void {
    if (u === v) return;
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (segmentSet.has(key)) return;
    segmentSet.add(key);
    newSegments.push([u, v]);
  }

  // Emit a skeleton edge along a specific raw-axis sub-path.
  // Steiner candidates are picked from rawPath itself (not from a fresh BFS),
  // so ring shapes whose two pair-paths share the same endpoints still produce
  // distinct Steiner nodes (one from each half of the raw ring).
  function emitEdge(rawPath: number[], depth: number, maxDepth = MAX_BISECT_DEPTH): void {
    if (rawPath.length < 2) return;
    const rawA = rawPath[0];
    const rawB = rawPath[rawPath.length - 1];
    if (rawA === rawB) return;
    const idxA = rawToOut.get(rawA)!;
    const idxB = rawToOut.get(rawB)!;
    if (idxA === idxB) return;

    if (depth >= maxDepth || finalPoints.length >= MAX_TOTAL_VERTICES) {
      addSegment(idxA, idxB);
      return;
    }

    const pA = finalPoints[idxA];
    const pB = finalPoints[idxB];
    if (isEdgeCentred(pA, pB, flatBoundary)) {
      addSegment(idxA, idxB);
      return;
    }

    // Find Steiner candidates within rawPath (interior nodes only).
    // Priority: T-junction, then max-R, then path midpoint.
    let branchCandIdx = -1, maxRCandIdx = -1, maxR = -1;
    for (let i = 1; i < rawPath.length - 1; i++) {
      const n = rawPath[i];
      if (branchCandIdx < 0 && rawAdj[n].length >= 3) branchCandIdx = i;
      if (rawNodeR[n] > maxR) { maxR = rawNodeR[n]; maxRCandIdx = i; }
    }
    const midCandIdx = rawPath.length >= 3 ? Math.floor((rawPath.length - 1) / 2) : -1;

    for (const ci of [branchCandIdx, maxRCandIdx, midCandIdx]) {
      if (ci <= 0 || ci >= rawPath.length - 1) continue;
      const candRaw = rawPath[ci];
      const candPt = new paper.Point(rawPoints[candRaw]);
      if (isEdgeCentred(pA, candPt, flatBoundary, CENTRE_THRESHOLD_VALID) &&
          isEdgeCentred(candPt, pB, flatBoundary, CENTRE_THRESHOLD_VALID)) {
        getOrAddVertex(candRaw);
        emitEdge(rawPath.slice(0, ci + 1), depth + 1, maxDepth);
        emitEdge(rawPath.slice(ci), depth + 1, maxDepth);
        return;
      }
    }

    addSegment(idxA, idxB);
  }

  for (const { path } of pairPaths) {
    // Identify where each essential node sits in the raw path, then emit
    // sub-paths between consecutive essential nodes.
    const chainPositions: number[] = [];
    for (let i = 0; i < path.length; i++) {
      if (rawToOut.has(path[i]) &&
          (chainPositions.length === 0 || path[chainPositions[chainPositions.length - 1]] !== path[i])) {
        chainPositions.push(i);
      }
    }
    for (let i = 0; i + 1 < chainPositions.length; i++) {
      const subPath = path.slice(chainPositions[i], chainPositions[i + 1] + 1);
      emitEdge(subPath, 0);
    }
  }

  // ---------------------------------------------------------
  // Step 6: Snap leaf seeds to raw medial-axis tips
  // ---------------------------------------------------------
  // Seed positions are snapped to nearest raw node which may be short of the
  // actual stroke tip. For each leaf seed, snap to the raw degree-1 node in
  // its Voronoi region that is most aligned with the outward direction.
  // Only direct-snap if tipR ≥ origR × 0.65; otherwise append as a stub leaf
  // (keeps the original wide-coverage disk while adding a tip for the cap).

  const outDegree = new Int32Array(finalPoints.length);
  for (const [u, v] of newSegments) { outDegree[u]++; outDegree[v]++; }

  const nSeeds = selectedPoints.length;
  for (let si = 0; si < nSeeds; si++) {
    const seedOutIdx = rawToOut.get(seedIndices[si])!;
    if (outDegree[seedOutIdx] !== 1) continue;

    let nbIdx = -1;
    for (const [u, v] of newSegments) {
      if (u === seedOutIdx) { nbIdx = v; break; }
      if (v === seedOutIdx) { nbIdx = u; break; }
    }
    if (nbIdx < 0) continue;
    const nbPt = finalPoints[nbIdx];

    const siPt = finalPoints[seedOutIdx];
    const brDx = siPt.x - nbPt.x, brDy = siPt.y - nbPt.y;
    const brLen = Math.hypot(brDx, brDy);
    const outX = brLen > 1e-6 ? brDx / brLen : 1;
    const outY = brLen > 1e-6 ? brDy / brLen : 0;

    const rawTips: Array<{ rn: number; dist: number }> = [];
    for (let rn = 0; rn < numNodes; rn++) {
      if (nodeOwner[rn] !== si || rawAdj[rn].length !== 1) continue;
      const dist = Math.hypot(rawPoints[rn].x - siPt.x, rawPoints[rn].y - siPt.y);
      if (dist < 2) continue;
      rawTips.push({ rn, dist });
    }

    const origR = rawNodeR[seedIndices[si]];

    // Direct snap: try tips sorted by outward-projection score (score-first).
    // Moves the seed vertex to the raw tip position when the edge is centred.
    let directSnapRn = -1;
    rawTips.sort((a, b) => {
      const sA = (rawPoints[a.rn].x - siPt.x) * outX + (rawPoints[a.rn].y - siPt.y) * outY;
      const sB = (rawPoints[b.rn].x - siPt.x) * outX + (rawPoints[b.rn].y - siPt.y) * outY;
      return sB - sA;
    });
    for (const { rn } of rawTips) {
      if (finalPoints.length >= MAX_TOTAL_VERTICES) break;
      const tipR = rawNodeR[rn];
      if (tipR >= origR * 0.65 && isEdgeCentred(rawPoints[rn], nbPt, flatBoundary)) {
        finalPoints[seedOutIdx] = new paper.Point(rawPoints[rn]);
        directSnapRn = rn;
        break;
      }
    }

    // Stub: route from seed to farthest raw tip via emitEdge (handles curved arms).
    // Always add UNLESS direct snap already reached that exact tip.
    // emitEdge bisects using actual path midpoints so curved arms stay centred.
    rawTips.sort((a, b) => b.dist - a.dist);
    if (rawTips.length > 0 && finalPoints.length < MAX_TOTAL_VERTICES) {
      const { rn: tipRn } = rawTips[0];
      if (tipRn !== directSnapRn) {
        getOrAddVertex(tipRn);
        const inSeed = (n: number) => nodeOwner[n] === si;
        const stubPath = bfsPathFiltered(seedIndices[si], tipRn, rawAdj, inSeed);
        // Limit stub to 1 bisection: deeper recursion can't help since the
        // tip-side sub-segment always fails isEdgeCentred (r→0 at the tip).
        if (stubPath) emitEdge(stubPath, 0, 1);
      }
    }
  }

  return { points: finalPoints, segments: newSegments };
}

// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------

// BFS shortest path from `from` to `to`; returns node sequence or null if unreachable.
function bfsPath(from: number, to: number, adj: number[][]): number[] | null {
  if (from === to) return [from];
  const parent = new Int32Array(adj.length).fill(-2);
  parent[from] = -1;
  const queue = [from];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] === -2) {
        parent[nb] = curr;
        if (nb === to) { found = true; break outer; }
        queue.push(nb);
      }
    }
  }
  if (!found) return null;
  const path: number[] = [];
  let curr = to;
  while (curr !== -1) { path.push(curr); curr = parent[curr]; }
  path.reverse();
  return path;
}

// BFS shortest path constrained to nodes passing nodeFilter (endpoints always included).
// Optional excludeEdges set (keys "u-v" with u<v) skips those edges entirely.
function bfsPathFiltered(
  from: number, to: number, adj: number[][],
  nodeFilter: (n: number) => boolean,
  excludeEdges?: Set<string>,
): number[] | null {
  if (from === to) return [from];
  const parent = new Int32Array(adj.length).fill(-2);
  parent[from] = -1;
  const queue = [from];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] !== -2) continue;
      if (nb !== to && !nodeFilter(nb)) continue;
      if (excludeEdges) {
        const ek = curr < nb ? `${curr}-${nb}` : `${nb}-${curr}`;
        if (excludeEdges.has(ek)) continue;
      }
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

// Max inscribed-radius node strictly between nodeA and nodeB on BFS shortest path.
function findMaxRSteinerId(
  nodeA: number, nodeB: number,
  adj: number[][], nodeR: Float64Array,
): number {
  if (nodeA === nodeB) return -1;
  const n = adj.length;
  const parent = new Int32Array(n).fill(-2);
  parent[nodeA] = -1;
  const queue = [nodeA];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] === -2) {
        parent[nb] = curr;
        if (nb === nodeB) { found = true; break outer; }
        queue.push(nb);
      }
    }
  }
  if (!found) return -1;
  let maxR = -1, best = -1;
  let curr = parent[nodeB];
  while (curr !== nodeA && curr !== -1) {
    if (nodeR[curr] > maxR) { maxR = nodeR[curr]; best = curr; }
    curr = parent[curr];
  }
  return best;
}

// First degree-3+ node on BFS shortest path from nodeA to nodeB (excluding endpoints).
function findBranchSteinerId(
  nodeA: number, nodeB: number,
  adj: number[][],
): number {
  if (nodeA === nodeB) return -1;
  const n = adj.length;
  const parent = new Int32Array(n).fill(-2);
  parent[nodeA] = -1;
  const queue = [nodeA];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] === -2) {
        parent[nb] = curr;
        if (nb === nodeB) { found = true; break outer; }
        queue.push(nb);
      }
    }
  }
  if (!found) return -1;
  let curr = parent[nodeB];
  while (curr !== nodeA && curr !== -1) {
    if (adj[curr].length >= 3) return curr;
    curr = parent[curr];
  }
  if (adj[nodeA].length >= 3) return nodeA;
  return -1;
}

const CENTRE_THRESHOLD = 0.35;
const CENTRE_THRESHOLD_VALID = 0.25;
const CENTRE_N_SAMP = 12;

function isEdgeCentred(pA: Vec2D, pB: Vec2D, fb: FlatBoundary, threshold = CENTRE_THRESHOLD): boolean {
  let minDist = Infinity, maxDist = 0;
  for (let k = 0; k <= CENTRE_N_SAMP; k++) {
    const t = k / CENTRE_N_SAMP;
    const x = pA.x + t * (pB.x - pA.x);
    const y = pA.y + t * (pB.y - pA.y);
    const d = nearestDistFlatBoundary(x, y, fb);
    if (d < minDist) minDist = d;
    if (d > maxDist) maxDist = d;
  }
  if (maxDist <= 0) return true;
  return minDist / maxDist >= threshold;
}

function isGraphConnected(adj: number[][]): boolean {
  const n = adj.length;
  if (n <= 1) return true;
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    for (const nb of adj[queue.shift()!]) {
      if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
    }
  }
  return visited.size === n;
}

function buildAdjacencyList(graph: MedialAxisGraph): number[][] {
  const adj: number[][] = Array.from({ length: graph.points.length }, () => []);
  for (const [u, v] of graph.segments) { adj[u].push(v); adj[v].push(u); }
  return adj;
}

function getNearestNodeIndex(pt: paper.Point, nodes: Vec2D[]): number {
  let minDst = Infinity, idx = -1;
  for (let i = 0; i < nodes.length; i++) {
    const d = pt.getDistance(nodes[i]);
    if (d < minDst) { minDst = d; idx = i; }
  }
  return idx;
}
