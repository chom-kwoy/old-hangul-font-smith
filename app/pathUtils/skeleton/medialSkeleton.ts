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
 */
export function constructMedialSkeleton(
  selectedPoints: paper.Point[],
  rawMedialAxis: MedialAxisGraph,
  originalPath: paper.CompoundPath,
): MedialAxisGraph {
  // ---------------------------------------------------------
  // Pre-processing: Build Adjacency List for Raw Axis
  // ---------------------------------------------------------
  const rawAdj = buildAdjacencyList(rawMedialAxis);
  const rawPoints = rawMedialAxis.points;
  const numNodes = rawPoints.length;

  const isRawGraphConnected = isGraphConnected(rawAdj);
  if (!isRawGraphConnected) {
    throw new Error("Raw Medial Axis is not connected!");
  }

  // ---------------------------------------------------------
  // Step 1: Computing the Restricted Voronoi Diagram (RVD)
  // ---------------------------------------------------------
  // In the paper, this partitions the mesh M into regions R_v.
  // In 2D, we partition the Raw Graph nodes.
  // We use Multi-Source Dijkstra to ensure Geodesic proximity and connectedness.

  // 1.1 Map selected points to nearest Raw Nodes (Snap to grid)
  const seedIndices: number[] = selectedPoints.map((p) =>
    getNearestNodeIndex(p, rawPoints),
  );

  // 1.2 Compute Ownership (Voronoi Partitioning on Graph)
  // nodeOwner[i] = index of the seed that owns raw node i
  const nodeOwner = new Int32Array(numNodes).fill(-1);
  // Using Float64Array to match JavaScript number precision and avoid float casting bugs
  const distToSeed = new Float64Array(numNodes).fill(Infinity);

  // Priority Queue for Dijkstra
  // Stores objects { dist, u, owner }
  // We prioritize by smallest 'dist'
  const pq = new MinPriorityQueue<{ dist: number; u: number; owner: number }>(
    (x) => x.dist,
  );

  // Initialize queue with seeds
  seedIndices.forEach((rawNodeIdx, seedIdx) => {
    nodeOwner[rawNodeIdx] = seedIdx;
    distToSeed[rawNodeIdx] = 0;
    pq.push({ dist: 0, u: rawNodeIdx, owner: seedIdx });
  });

  // Run Dijkstra / Flood Fill
  while (!pq.isEmpty()) {
    const { dist, u, owner } = pq.pop()!;

    // Optimization: Skip stale entries
    // Uses a small epsilon (1e-5) to handle floating point inequality safely
    if (dist > distToSeed[u] + 1e-5) continue;

    // Explore neighbors
    const neighbors = rawAdj[u];
    for (const v of neighbors) {
      const weight = new paper.Point(rawPoints[u]).getDistance(rawPoints[v]);

      // Safety: Prevent NaN propagation if geometry is invalid
      if (!Number.isFinite(weight)) continue;

      const newDist = dist + weight;

      if (newDist < distToSeed[v]) {
        distToSeed[v] = newDist;
        nodeOwner[v] = owner;
        pq.push({ dist: newDist, u: v, owner: owner });
      }
    }
  }

  // ---------------------------------------------------------
  // Step 1.5: Enforce single connected component per Voronoi cell (BFS)
  // ---------------------------------------------------------
  // Graph Voronoi cells can be disconnected on graphs with cycles (e.g. ring shapes).
  // BFS from each seed within its owned region; orphan CCs get reassigned to the
  // nearest seed by centroid distance.
  for (let seedIdx = 0; seedIdx < selectedPoints.length; seedIdx++) {
    const seedNodeIdx = seedIndices[seedIdx];
    const mainCC = new Set<number>();
    const bfsQueue = [seedNodeIdx];
    mainCC.add(seedNodeIdx);
    while (bfsQueue.length > 0) {
      const curr = bfsQueue.shift()!;
      for (const neighbor of rawAdj[curr]) {
        if (!mainCC.has(neighbor) && nodeOwner[neighbor] === seedIdx) {
          mainCC.add(neighbor);
          bfsQueue.push(neighbor);
        }
      }
    }

    // Find orphans not reached from the seed
    const orphanVisited = new Set<number>();
    for (let i = 0; i < numNodes; i++) {
      if (nodeOwner[i] !== seedIdx || mainCC.has(i) || orphanVisited.has(i))
        continue;

      // BFS to collect this orphan CC
      const cc: number[] = [];
      const ccQueue = [i];
      orphanVisited.add(i);
      while (ccQueue.length > 0) {
        const curr = ccQueue.shift()!;
        cc.push(curr);
        for (const neighbor of rawAdj[curr]) {
          if (!orphanVisited.has(neighbor) && nodeOwner[neighbor] === seedIdx) {
            orphanVisited.add(neighbor);
            ccQueue.push(neighbor);
          }
        }
      }

      // Centroid of orphan CC
      let cx = 0,
        cy = 0;
      for (const node of cc) {
        cx += rawPoints[node].x;
        cy += rawPoints[node].y;
      }
      cx /= cc.length;
      cy /= cc.length;

      // Nearest seed by centroid distance
      let minDist = Infinity;
      let nearestSeed = seedIdx;
      for (let s = 0; s < selectedPoints.length; s++) {
        if (s === seedIdx) continue;
        const d = Math.hypot(selectedPoints[s].x - cx, selectedPoints[s].y - cy);
        if (d < minDist) {
          minDist = d;
          nearestSeed = s;
        }
      }
      for (const node of cc) nodeOwner[node] = nearestSeed;
    }
  }

  // Build flat boundary for centrality checks on emitted edges.
  const flatBoundary = buildFlatBoundary(originalPath);

  // Precompute inscribed radius at each raw medial axis node for max-r Steiner selection.
  const rawNodeR = new Float64Array(numNodes);
  for (let i = 0; i < numNodes; i++) {
    rawNodeR[i] = nearestDistFlatBoundary(rawPoints[i].x, rawPoints[i].y, flatBoundary);
  }

  // ---------------------------------------------------------
  // Step 2: Computing the Restricted Delaunay Triangulation (RDT)
  // ---------------------------------------------------------
  // Connect seeds whose RVD regions are adjacent (share a boundary on M).
  // Collect ALL interface points per seed pair before emitting edges — this
  // correctly handles k > 1 interfaces (genus-fix for ring-shaped shapes).

  const newSegments: [number, number][] = [];
  const finalPoints = [...selectedPoints];
  // Parallel to finalPoints: raw medial axis node index for each output point (-1 if not snapped to a raw node).
  const finalPointRawNode: number[] = selectedPoints.map((_, i) => seedIndices[i]);
  const seedToOutputIndex = selectedPoints.map((_, i) => i);

  // Map from undirected edge key → list of interface midpoints
  const interfaceMap = new Map<string, paper.Point[]>();

  for (const [u, v] of rawMedialAxis.segments) {
    const ownerU = nodeOwner[u];
    const ownerV = nodeOwner[v];
    if (ownerU === -1 || ownerV === -1 || ownerU === ownerV) continue;

    const idxA = seedToOutputIndex[ownerU];
    const idxB = seedToOutputIndex[ownerV];
    const key = idxA < idxB ? `${idxA}-${idxB}` : `${idxB}-${idxA}`;

    const interfacePt = new paper.Point(rawPoints[u]).add(rawPoints[v]).divide(2);
    if (!interfaceMap.has(key)) interfaceMap.set(key, []);
    interfaceMap.get(key)!.push(interfacePt);
  }

  // Budget for Steiner insertions — tied to the vertex-count limit so the check is always coherent.
  // MAX_BISECT_DEPTH bounds recursion depth; vertex count is the hard cap.
  const MAX_TOTAL_VERTICES = 25;
  const MAX_BISECT_DEPTH = 4;

  // Recursive Steiner insertion for a single bad skeleton edge.
  // Tries branch (T-junction) node first, then max-r node, using finalPointRawNode to
  // look up raw axis indices even for Steiner-inserted points (depth > 0).
  // Falls back to interface midpoint (depth=0) or projected midpoint (depth>0).
  const emitEdge = (
    idxA: number, idxB: number,
    interfacePt: paper.Point | null,
    depth: number,
  ): void => {
    if (finalPoints.length >= MAX_TOTAL_VERTICES || depth >= MAX_BISECT_DEPTH) {
      newSegments.push([idxA, idxB]);
      return;
    }
    const pA = finalPoints[idxA];
    const pB = finalPoints[idxB];
    if (isEdgeCentred(pA, pB, flatBoundary)) {
      newSegments.push([idxA, idxB]);
      return;
    }

    // Try structural raw-axis nodes as Steiner: branch (T-junction) first, then max-r.
    // Uses finalPointRawNode to resolve raw axis indices at any depth, not just depth=0.
    const nA = finalPointRawNode[idxA];
    const nB = finalPointRawNode[idxB];
    if (nA >= 0 && nB >= 0) {
      const branchId = findBranchSteinerId(nA, nB, rawAdj);
      const maxRId = findMaxRSteinerId(nA, nB, rawAdj, rawNodeR);

      for (const candId of [branchId, maxRId]) {
        if (candId < 0) continue;
        const candPt = new paper.Point(rawPoints[candId]);
        if (isEdgeCentred(pA, candPt, flatBoundary, CENTRE_THRESHOLD_VALID) &&
            isEdgeCentred(candPt, pB, flatBoundary, CENTRE_THRESHOLD_VALID)) {
          const sPtIdx = finalPoints.length;
          finalPoints.push(candPt);
          finalPointRawNode.push(candId);
                    emitEdge(idxA, sPtIdx, null, depth + 1);
          emitEdge(sPtIdx, idxB, null, depth + 1);
          return;
        }
      }
    }

    // Fall back: interface midpoint (depth=0 only) or projected midpoint.
    let steinPt: paper.Point;
    let steinRawNode: number;
    if (depth === 0 && interfacePt !== null) {
      steinPt = interfacePt;
      steinRawNode = -1;
    } else {
      const midX = (pA.x + pB.x) / 2, midY = (pA.y + pB.y) / 2;
      const ni = getNearestNodeIndex(new paper.Point(midX, midY), rawPoints);
      steinPt = new paper.Point(rawPoints[ni]);
      steinRawNode = ni;
    }

    // Guard against degenerate near-zero-length sub-edges.
    if (Math.hypot(steinPt.x - pA.x, steinPt.y - pA.y) < 1 ||
        Math.hypot(steinPt.x - pB.x, steinPt.y - pB.y) < 1) {
      newSegments.push([idxA, idxB]);
      return;
    }

    const sPtIdx = finalPoints.length;
    finalPoints.push(steinPt);
    finalPointRawNode.push(steinRawNode);
        emitEdge(idxA, sPtIdx, null, depth + 1);
    emitEdge(sPtIdx, idxB, null, depth + 1);
  };

  for (const [key, interfaces] of interfaceMap) {
    const [aStr, bStr] = key.split("-");
    const idxA = parseInt(aStr);
    const idxB = parseInt(bStr);

    if (interfaces.length === 1) {
      emitEdge(idxA, idxB, interfaces[0], 0);
    } else {
      for (const interfacePt of interfaces) {
        const sPtIdx = finalPoints.length;
        finalPoints.push(interfacePt);
        finalPointRawNode.push(-1); // interface midpoint — not snapped to a raw axis node
                // Also check centrality of the two sub-edges created by the interface Steiner.
        emitEdge(idxA, sPtIdx, null, 1);
        emitEdge(sPtIdx, idxB, null, 1);
      }
    }
  }

  // ---------------------------------------------------------
  // Post-processing: snap leaf seeds to raw medial axis tips
  // ---------------------------------------------------------
  // The seed positions were snapped to the *nearest* raw axis node, which may not be
  // the degree-1 (tip) node at the actual stroke end. This causes the capsule cap and
  // vertex disk to originate a few units short of the stroke cap, leaving it uncovered.
  // Fix: for each leaf seed (degree-1 in the output skeleton), find the raw degree-1 node
  // in its Voronoi region that lies farthest from its output neighbor, and move the seed there.

  const outDegree = new Int32Array(finalPoints.length);
  for (const [u, v] of newSegments) { outDegree[u]++; outDegree[v]++; }

  for (let si = 0; si < selectedPoints.length; si++) {
    if (outDegree[si] !== 1) continue; // only leaf seeds

    // Find the single output neighbor of this leaf.
    let nbIdx = -1;
    for (const [u, v] of newSegments) {
      if (u === si) { nbIdx = v; break; }
      if (v === si) { nbIdx = u; break; }
    }
    if (nbIdx < 0) continue;
    const nbPt = finalPoints[nbIdx];

    // Collect ALL degree-1 raw nodes in this seed's Voronoi region, sorted by
    // alignment with the outward branch direction (most aligned = most likely main tip).
    const siPt = finalPoints[si];
    const brDx = siPt.x - nbPt.x, brDy = siPt.y - nbPt.y;
    const brLen = Math.hypot(brDx, brDy);
    const outX = brLen > 1e-6 ? brDx / brLen : 1;
    const outY = brLen > 1e-6 ? brDy / brLen : 0;
    const rawTips: Array<{ rn: number; score: number }> = [];
    for (let rn = 0; rn < numNodes; rn++) {
      if (nodeOwner[rn] !== si || rawAdj[rn].length !== 1) continue;
      // Ignore tips too close to the current position (degenerate edges).
      if (Math.hypot(rawPoints[rn].x - siPt.x, rawPoints[rn].y - siPt.y) < 2) continue;
      const score = (rawPoints[rn].x - siPt.x) * outX + (rawPoints[rn].y - siPt.y) * outY;
      rawTips.push({ rn, score });
    }
    rawTips.sort((a, b) => b.score - a.score); // most-aligned first

    // Process each tip: direct snap for the first that passes, then append the rest.
    // Don't direct-snap if the tip's inscribed radius is much smaller than the original
    // seed's inscribed radius — that would move the seed away from the wide coverage area.
    const origR = rawNodeR[seedIndices[si]];
    let directSnapped = false;
    for (const { rn } of rawTips) {
      if (finalPoints.length >= MAX_TOTAL_VERTICES) break;
      const tipPt = new paper.Point(rawPoints[rn]);
      const tipR = rawNodeR[rn];
      const canDirectSnap = tipR >= origR * 0.65;
      if (!directSnapped && canDirectSnap && isEdgeCentred(tipPt, nbPt, flatBoundary)) {
        finalPoints[si] = tipPt;
        directSnapped = true;
      } else if (isEdgeCentred(tipPt, finalPoints[si], flatBoundary)) {
        const tipIdx = finalPoints.length;
        finalPoints.push(tipPt);
        newSegments.push([si, tipIdx]);
      }
    }
  }

  return {
    points: finalPoints,
    segments: newSegments,
  };
}

// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------

// Finds the node with maximum inscribed radius strictly between nodeA and nodeB on the
// BFS shortest path. Returns -1 if A and B are directly adjacent (no internal nodes).
function findMaxRSteinerId(
  nodeA: number, nodeB: number,
  adj: number[][],
  nodeR: Float64Array,
): number {
  if (nodeA === nodeB) return -1;
  const n = adj.length;
  const parent = new Int32Array(n).fill(-2); // -2 = unvisited
  parent[nodeA] = -1; // A is BFS root
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
  // Walk from parent(B) back to A; collect internal nodes (excluding A and B).
  let maxR = -1, bestNode = -1;
  let curr = parent[nodeB];
  while (curr !== nodeA && curr !== -1) {
    if (nodeR[curr] > maxR) { maxR = nodeR[curr]; bestNode = curr; }
    curr = parent[curr];
  }
  return bestNode;
}

// Finds the first degree-3+ (T-junction) node on the BFS shortest path from nodeA to nodeB.
// Returns -1 if no such node exists (path is entirely degree-1/2 nodes, excluding A and B themselves).
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
  // Walk from parent(B) back to A; find first degree-3+ node (T-junction).
  let curr = parent[nodeB];
  while (curr !== nodeA && curr !== -1) {
    if (adj[curr].length >= 3) return curr;
    curr = parent[curr];
  }
  if (nodeA !== nodeB && adj[nodeA].length >= 3) return nodeA;
  return -1;
}

// Returns true if the straight-line edge from pA to pB has acceptable centrality.
// Uses min(boundary_dist) / max(boundary_dist) along the line. This approximates
// minDist/prim.meanR better than min/mean because primMeanR scales with maxDist
// (the primitive expands to fill the widest cross-section it can reach).
// Threshold 0.35 catches edges that exit thin junctions relative to wide stroke
// areas while allowing naturally tapered or uniformly thin strokes.
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
  const numNodes = adj.length;
  if (numNodes <= 1) return true;

  const visited = new Set<number>();
  const queue: number[] = [0];
  visited.add(0);

  while (queue.length > 0) {
    const currentNode = queue.shift()!;
    for (const neighbor of adj[currentNode]) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size === numNodes;
}

function buildAdjacencyList(graph: MedialAxisGraph): number[][] {
  const adj: number[][] = Array.from({ length: graph.points.length }, () => []);
  for (const [u, v] of graph.segments) {
    adj[u].push(v);
    adj[v].push(u);
  }
  return adj;
}

function getNearestNodeIndex(pt: paper.Point, nodes: Vec2D[]): number {
  let minDst = Infinity;
  let idx = -1;
  for (let i = 0; i < nodes.length; i++) {
    const d = pt.getDistance(nodes[i]);
    if (d < minDst) {
      minDst = d;
      idx = i;
    }
  }
  return idx;
}
