import paper from "paper";

import { MedialAxisGraph } from "@/app/pathUtils/medialAxis";

/**
 * Constructs the Medial Skeleton (M_S) from selected vertices (V) and the Raw Medial Axis (M).
 * Implements Section 5.1: Medial Skeleton Construction.
 *
 * @param selectedPoints - The sparse set of optimized vertices (V).
 * @param rawMedialAxis - The dense, noisy raw medial axis (M).
 * @param originalPath - The boundary shape (S) for geometry validation.
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
  const nodeOwner = new Int32Array(rawPoints.length).fill(-1);
  const distToSeed = new Float32Array(rawPoints.length).fill(Infinity);

  // Priority Queue for Dijkstra: [distance, rawNodeIndex, ownerSeedIndex]
  // Using a simple array sort for simplicity (can use MinHeap for speed optimization)
  const queue: { dist: number; u: number; owner: number }[] = [];

  // Initialize queue with seeds
  seedIndices.forEach((rawNodeIdx, seedIdx) => {
    nodeOwner[rawNodeIdx] = seedIdx;
    distToSeed[rawNodeIdx] = 0;
    queue.push({ dist: 0, u: rawNodeIdx, owner: seedIdx });
  });

  // Run Dijkstra / Flood Fill
  while (queue.length > 0) {
    // Sort to simulate Priority Queue (pop smallest distance)
    queue.sort((a, b) => b.dist - a.dist);
    const { dist, u, owner } = queue.pop()!;

    if (dist > distToSeed[u]) continue;

    // Explore neighbors
    const neighbors = rawAdj[u];
    for (const v of neighbors) {
      const weight = rawPoints[u].getDistance(rawPoints[v]);
      const newDist = dist + weight;

      if (newDist < distToSeed[v]) {
        distToSeed[v] = newDist;
        nodeOwner[v] = owner;
        queue.push({ dist: newDist, u: v, owner: owner });
      }
    }
  }

  // ---------------------------------------------------------
  // Step 2: Computing the Restricted Delaunay Triangulation (RDT)
  // ---------------------------------------------------------
  // Connect seeds if their RVD regions are adjacent.
  // Regions are adjacent if a raw edge connects a node owned by A to a node owned by B.

  const newSegments: [number, number][] = [];
  const adjacencySet = new Set<string>();

  // Use a map to handle "Geometry Fix" (subdivision)
  // If we need to add extra points, we append them to this list.
  const finalPoints = [...selectedPoints];

  // Map identifying which output index corresponds to which seed index
  // (Initially 1:1, but grows if we split edges)
  const seedToOutputIndex = selectedPoints.map((_, i) => i);

  for (const [u, v] of rawMedialAxis.segments) {
    const ownerU = nodeOwner[u];
    const ownerV = nodeOwner[v];

    // If both nodes are claimed (should be true if graph is connected) AND owners differ
    if (ownerU !== -1 && ownerV !== -1 && ownerU !== ownerV) {
      // We found an "Interface" on the raw graph between region U and region V.
      // Candidate edge: Connect Seed(U) <-> Seed(V)
      const idxA = seedToOutputIndex[ownerU];
      const idxB = seedToOutputIndex[ownerV];

      // Sort to create a unique key for the Set
      const key = idxA < idxB ? `${idxA}-${idxB}` : `${idxB}-${idxA}`;

      if (!adjacencySet.has(key)) {
        // ---------------------------------------------------------
        // Step 3: Geometry & Topology Fix
        // ---------------------------------------------------------
        // Check if the straight line between seeds is valid (inside shape).
        // If invalid, we "subdivide" by adding the interface point (the raw edge midpoint).

        const pA = finalPoints[idxA];
        const pB = finalPoints[idxB];

        if (isSegmentValid(pA, pB, originalPath)) {
          // Case A: Valid direct connection
          newSegments.push([idxA, idxB]);
          adjacencySet.add(key);
        } else {
          // Case B: Invalid connection (crosses hole/concavity).
          // Fix: Introduce the "Interface Point" as a new Steiner point.
          // The interface is the midpoint of the raw edge [u, v] where domains switch.
          const interfacePt = rawPoints[u].add(rawPoints[v]).divide(2);

          const newPtIdx = finalPoints.length;
          finalPoints.push(interfacePt);

          // Connect A -> New -> B
          newSegments.push([idxA, newPtIdx]);
          newSegments.push([newPtIdx, idxB]);

          // Mark as processed to avoid duplicate interface handling for this boundary
          adjacencySet.add(key);
        }
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

function buildAdjacencyList(graph: MedialAxisGraph): number[][] {
  const adj: number[][] = Array.from({ length: graph.points.length }, () => []);
  for (const [u, v] of graph.segments) {
    adj[u].push(v);
    adj[v].push(u);
  }
  return adj;
}

function getNearestNodeIndex(pt: paper.Point, nodes: paper.Point[]): number {
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
  // We set insertItems=false to avoid DOM overhead
  const line = new paper.Path.Line({ from: p1, to: p2, insert: false });
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
