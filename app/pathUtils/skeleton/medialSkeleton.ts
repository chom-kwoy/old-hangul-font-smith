import { MinPriorityQueue } from "@datastructures-js/priority-queue";
import paper from "paper";

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

  // ---------------------------------------------------------
  // Step 2: Computing the Restricted Delaunay Triangulation (RDT)
  // ---------------------------------------------------------
  // Connect seeds whose RVD regions are adjacent (share a boundary on M).
  // Collect ALL interface points per seed pair before emitting edges — this
  // correctly handles k > 1 interfaces (genus-fix for ring-shaped shapes).

  const newSegments: [number, number][] = [];
  const finalPoints = [...selectedPoints];
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

  // Emit skeleton edges — one per interface, with iterative pierce-S subdivision
  for (const [key, interfaces] of interfaceMap) {
    const [aStr, bStr] = key.split("-");
    const idxA = parseInt(aStr);
    const idxB = parseInt(bStr);
    const pA = finalPoints[idxA];
    const pB = finalPoints[idxB];

    if (interfaces.length === 1) {
      // Single interface: direct edge if valid, else iteratively subdivided path
      addSkeletonChain(
        pA,
        idxA,
        pB,
        idxB,
        rawPoints,
        rawMedialAxis.segments,
        originalPath,
        finalPoints,
        newSegments,
      );
    } else {
      // Multiple interfaces (k > 1): one subdivided path per interface via its Steiner point
      for (const interfacePt of interfaces) {
        const sPtIdx = finalPoints.length;
        finalPoints.push(interfacePt);
        addSkeletonChain(
          pA,
          idxA,
          interfacePt,
          sPtIdx,
          rawPoints,
          rawMedialAxis.segments,
          originalPath,
          finalPoints,
          newSegments,
        );
        addSkeletonChain(
          interfacePt,
          sPtIdx,
          pB,
          idxB,
          rawPoints,
          rawMedialAxis.segments,
          originalPath,
          finalPoints,
          newSegments,
        );
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

/**
 * Projects a point onto the nearest location on any medial axis segment.
 */
function projectToMedialAxisOnGraph(
  pt: paper.Point,
  rawPoints: Vec2D[],
  segments: [number, number][],
): paper.Point {
  let bestX = rawPoints[0].x;
  let bestY = rawPoints[0].y;
  let minDist = Infinity;
  for (const [i1, i2] of segments) {
    const ax = rawPoints[i1].x,
      ay = rawPoints[i1].y;
    const dx = rawPoints[i2].x - ax,
      dy = rawPoints[i2].y - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 1e-10 ? ((pt.x - ax) * dx + (pt.y - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx,
      cy = ay + t * dy;
    const dist = Math.hypot(pt.x - cx, pt.y - cy);
    if (dist < minDist) {
      minDist = dist;
      bestX = cx;
      bestY = cy;
    }
  }
  return new paper.Point(bestX, bestY);
}

/**
 * Recursively bisects segment [pA, pB] until each sub-segment passes
 * isSegmentValid, projecting each midpoint onto the medial axis.
 * Returns intermediate points (excluding pA and pB themselves).
 */
function subdivideSegment(
  pA: paper.Point,
  pB: paper.Point,
  rawPoints: Vec2D[],
  segments: [number, number][],
  originalPath: paper.CompoundPath,
  maxDepth: number,
): paper.Point[] {
  if (maxDepth <= 0 || isSegmentValid(pA, pB, originalPath)) return [];
  const midRaw = pA.add(pB).divide(2);
  const mid = projectToMedialAxisOnGraph(midRaw, rawPoints, segments);
  return [
    ...subdivideSegment(pA, mid, rawPoints, segments, originalPath, maxDepth - 1),
    mid,
    ...subdivideSegment(mid, pB, rawPoints, segments, originalPath, maxDepth - 1),
  ];
}

/**
 * Adds a chain of skeleton edges from idxA to idxB, inserting subdivided
 * intermediate points onto finalPoints/newSegments as needed.
 */
function addSkeletonChain(
  pA: paper.Point,
  idxA: number,
  pB: paper.Point,
  idxB: number,
  rawPoints: Vec2D[],
  segments: [number, number][],
  originalPath: paper.CompoundPath,
  finalPoints: paper.Point[],
  newSegments: [number, number][],
): void {
  if (isSegmentValid(pA, pB, originalPath)) {
    newSegments.push([idxA, idxB]);
    return;
  }
  const intermediates = subdivideSegment(pA, pB, rawPoints, segments, originalPath, 8);
  let prevIdx = idxA;
  for (const mid of intermediates) {
    const newIdx = finalPoints.length;
    finalPoints.push(mid);
    newSegments.push([prevIdx, newIdx]);
    prevIdx = newIdx;
  }
  newSegments.push([prevIdx, idxB]);
}

/**
 * Checks if a straight line segment stays strictly inside the shape.
 * Used for the Geometry Fix.
 */
function isSegmentValid(
  p1: paper.Point,
  p2: paper.Point,
  path: paper.CompoundPath,
): boolean {
  // 1. Midpoint Check (Fast fail)
  const mid = p1.add(p2).divide(2);
  if (!path.contains(mid)) return false;

  // 2. Ray Intersections (Robust check)
  // Ensure the line segment doesn't intersect boundaries (except maybe at ends)
  const line = new paper.Path.Line({ from: p1, to: p2 });
  const intersections = line.getIntersections(path);

  // If we intersect "walls" (excluding the start/end proximity), it's invalid.
  for (const hit of intersections) {
    const d1 = hit.point.getDistance(p1);
    const d2 = hit.point.getDistance(p2);
    // Tolerance of 1.0 to ignore intersections at the vertices themselves
    if (d1 > 1.0 && d2 > 1.0) {
      return false;
    }
  }

  return true;
}
