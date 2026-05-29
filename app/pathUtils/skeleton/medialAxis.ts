import { Delaunay } from "d3-delaunay";
import paper from "paper";

import {
  buildFlatBoundary,
  rayIntersectFlatBoundary,
  sampleBoundary,
} from "@/app/pathUtils/flatBoundary";
import { Vec2D } from "@/app/utils/types";

// Define the new return type
export interface MedialAxisGraph {
  points: Vec2D[];
  segments: [number, number][]; // pairs of indices into `points`
  // Cubic Bezier interior control points, one pair per segment (parallel to `segments`).
  // controlPoints[i] = [cp1, cp2] for segments[i].  Absent → treat as straight line.
  controlPoints?: [Vec2D, Vec2D][];
  // Diagnostic: raw-path quartile samples [q1, mid, q3] per segment (parallel to `segments`).
  rawPathSamples?: [Vec2D, Vec2D, Vec2D][];
  // Maps output vertex index → raw medial axis node index. Used by skeleton simplification.
  vertexRawNodes?: number[];
}

/**
 * Extracts the 2D Medial Axis (Skeleton) from a Paper.js CompoundPath.
 * Returns a graph structure with unique points and indexed segments.
 */
export function extractMedialAxis(
  path: paper.CompoundPath,
  sampleSpacing: number = 10,
): MedialAxisGraph {
  // 1. Sampling: Use the helper function
  const { points: boundaryPoints, subPathRanges } = sampleBoundary(path, {
    step: sampleSpacing,
  });

  function isAdjacentOnPath(a: number, b: number): boolean {
    for (const { start, end } of subPathRanges) {
      if (a >= start && a < end && b >= start && b < end) {
        const localDiff = Math.abs(a - b);
        const len = end - start;
        // Adjacent if consecutive within the sub-path, or first/last (wrap-around).
        return localDiff === 1 || localDiff === len - 1;
      }
    }
    // Points on different sub-paths are never adjacent.
    return false;
  }

  // d3-delaunay requires a flat array of [x, y] coordinate pairs
  const pointsArray = boundaryPoints.map((p) => [p.x, p.y] as [number, number]);

  // 2. Build flat boundary for accurate ray-based interior testing
  const fb = buildFlatBoundary(path);
  const tested = new Uint32Array(fb.count);
  let rayGen = 0;

  // 3. Compute Voronoi Diagram
  const delaunay = Delaunay.from(pointsArray);
  const voronoi = delaunay.voronoi([
    path.bounds.left - 10,
    path.bounds.top - 10,
    path.bounds.right + 10,
    path.bounds.bottom + 10,
  ]);

  // Output structures
  const uniquePoints: Vec2D[] = [];
  const segments: [number, number][] = [];

  // Map from Delaunay Triangle Index -> Index in uniquePoints array
  const triangleToPointIndex = new Map<number, number>();

  /**
   * Helper to get or create a point index for a specific Delaunay triangle.
   */
  const getOrAddPointIndex = (triangleIndex: number): number => {
    if (triangleToPointIndex.has(triangleIndex)) {
      return triangleToPointIndex.get(triangleIndex)!;
    }

    const x = voronoi.circumcenters[triangleIndex * 2];
    const y = voronoi.circumcenters[triangleIndex * 2 + 1];
    const pt = new paper.Point(x, y);

    const newIndex = uniquePoints.length;
    uniquePoints.push({ x: pt.x, y: pt.y });
    triangleToPointIndex.set(triangleIndex, newIndex);
    return newIndex;
  };

  // 4. Process Voronoi Edges
  for (let e = 0; e < delaunay.halfedges.length; e++) {
    if (e < delaunay.halfedges[e]) {
      const t1 = Math.floor(e / 3);
      const t2 = Math.floor(delaunay.halfedges[e] / 3);

      const p1x = voronoi.circumcenters[t1 * 2];
      const p1y = voronoi.circumcenters[t1 * 2 + 1];
      const p2x = voronoi.circumcenters[t2 * 2];
      const p2y = voronoi.circumcenters[t2 * 2 + 1];

      const vStart = new paper.Point(p1x, p1y);

      // 5. Filtering Strategy

      // Filter A: Interior Edge Check
      // Cast a ray from vStart toward vEnd; if the boundary is hit before
      // reaching vEnd the edge exits the path and should be rejected.
      if (!path.contains(vStart)) continue;
      const edgeDx = p2x - p1x;
      const edgeDy = p2y - p1y;
      const edgeLen = Math.hypot(edgeDx, edgeDy);
      if (edgeLen > 1e-10) {
        const dist = rayIntersectFlatBoundary(
          p1x,
          p1y,
          edgeDx / edgeLen,
          edgeDy / edgeLen,
          fb,
          tested,
          ++rayGen,
        );
        if (dist < edgeLen) continue;
      }

      // Filter B: "Spur" Pruning (Adjacency Filter)
      // The two Delaunay vertices that share edge `e` are consecutive halfedges
      // within triangle t1. If those boundary samples are adjacent on the same
      // sub-path the Voronoi edge is a near-boundary spur and should be pruned.
      const indexA = delaunay.triangles[e];
      const indexB = delaunay.triangles[getNextHalfedge(e)];

      if (!isAdjacentOnPath(indexA, indexB)) {
        const idx1 = getOrAddPointIndex(t1);
        const idx2 = getOrAddPointIndex(t2);
        segments.push([idx1, idx2]);
      }
    }
  }

  return {
    points: uniquePoints,
    segments: segments,
  };
}

function getNextHalfedge(e: number): number {
  // If we are at the end of a triangle triplet (indices 2, 5, 8...), wrap back.
  // Otherwise, just advance by 1.
  return e % 3 === 2 ? e - 2 : e + 1;
}
