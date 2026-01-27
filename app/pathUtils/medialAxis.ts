import { Delaunay } from "d3-delaunay";
import paper from "paper";

// Define the new return type
export interface MedialAxisGraph {
  points: paper.Point[];
  segments: [number, number][]; // pairs of indices into `points`
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
  const boundaryPoints = sampleBoundary(path, sampleSpacing);

  // d3-delaunay requires a flat array of [x, y] coordinate pairs
  const pointsArray = boundaryPoints.map((p) => [p.x, p.y] as [number, number]);

  // 2. Compute Voronoi Diagram
  const delaunay = Delaunay.from(pointsArray);
  const voronoi = delaunay.voronoi([
    path.bounds.left - 10,
    path.bounds.top - 10,
    path.bounds.right + 10,
    path.bounds.bottom + 10,
  ]);

  // Output structures
  const uniquePoints: paper.Point[] = [];
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
    uniquePoints.push(pt);
    triangleToPointIndex.set(triangleIndex, newIndex);
    return newIndex;
  };

  // 3. Process Voronoi Edges
  for (let e = 0; e < delaunay.halfedges.length; e++) {
    if (e < delaunay.halfedges[e]) {
      const t1 = Math.floor(e / 3);
      const t2 = Math.floor(delaunay.halfedges[e] / 3);

      const p1x = voronoi.circumcenters[t1 * 2];
      const p1y = voronoi.circumcenters[t1 * 2 + 1];
      const p2x = voronoi.circumcenters[t2 * 2];
      const p2y = voronoi.circumcenters[t2 * 2 + 1];

      const vStart = new paper.Point(p1x, p1y);
      const vEnd = new paper.Point(p2x, p2y);

      // 4. Filtering Strategy

      // Filter A: Strict Containment
      const midPoint = vStart.add(vEnd).divide(2);

      if (
        !path.contains(midPoint) ||
        !path.contains(vStart) ||
        !path.contains(vEnd)
      ) {
        continue;
      }

      // Filter B: "Spur" Pruning (Adjacency Filter)
      const indexA = delaunay.triangles[e];
      const indexB = delaunay.triangles[getNextHalfedge(e)];

      const indexDiff = Math.abs(indexA - indexB);
      const isAdjacent =
        indexDiff === 1 || indexDiff > boundaryPoints.length - 5;

      if (!isAdjacent) {
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

export function sampleBoundary(
  path: paper.CompoundPath,
  step: number,
): paper.Point[] {
  // 1. Sampling: Discretize the path boundaries into a cloud of points
  const boundaryPoints: paper.Point[] = [];

  // Helper to sample a single path item
  const sampleItem = (item: paper.Path) => {
    const length = item.length;
    const count = Math.ceil(length / step);
    for (let i = 0; i < count; i++) {
      const offset = (i / count) * length;
      const pt = item.getPointAt(offset);
      boundaryPoints.push(pt);
    }
  };

  path.children.forEach((c) => sampleItem(c as paper.Path));

  return boundaryPoints;
}

function getNextHalfedge(e: number): number {
  // If we are at the end of a triangle triplet (indices 2, 5, 8...), wrap back.
  // Otherwise, just advance by 1.
  return e % 3 === 2 ? e - 2 : e + 1;
}
