import { Delaunay } from "d3-delaunay";
import paper from "paper";

type Segment = [paper.Point, paper.Point];

/**
 * Extracts the 2D Medial Axis (Skeleton) from a Paper.js CompoundPath.
 * Uses a Voronoi-based approximation strategy.
 * @param path - The input shape (must be closed).
 * @param sampleSpacing - Distance between sample points on the boundary (lower = more accurate but slower).
 * @returns An array of Segments representing the medial axis.
 */
export function extractMedialAxis(
  path: paper.CompoundPath,
  sampleSpacing: number = 5,
): Segment[] {
  // 1. Sampling: Discretize the path boundaries into a cloud of points
  const boundaryPoints: paper.Point[] = [];

  // We need to keep track of the logical index to filter "adjacent" noise later
  // Each point will carry its index in the flattened array
  const pointsArray: [number, number][] = [];

  // Helper to sample a single path item
  const sampleItem = (item: paper.Path) => {
    const length = item.length;
    const count = Math.ceil(length / sampleSpacing);
    for (let i = 0; i < count; i++) {
      const offset = (i / count) * length;
      const pt = item.getPointAt(offset);
      boundaryPoints.push(pt);
      pointsArray.push([pt.x, pt.y]);
    }
  };

  path.children.forEach((c) => sampleItem(c as paper.Path));

  // 2. Compute Voronoi Diagram
  // The Medial Axis is a subset of the Voronoi Diagram of the boundary points.
  const delaunay = Delaunay.from(pointsArray);
  const voronoi = delaunay.voronoi([
    path.bounds.left - 10,
    path.bounds.top - 10,
    path.bounds.right + 10,
    path.bounds.bottom + 10,
  ]);

  const medialSegments: Segment[] = [];

  // 3. Process Voronoi Edges
  // The Voronoi diagram consists of edges. Each edge separates two generating points (sites).
  // We iterate through the Delaunay triangles to find the Voronoi edges (which connect circumcenters).

  // d3-delaunay stores half-edges.
  // e is the half-edge index.
  for (let e = 0; e < delaunay.halfedges.length; e++) {
    // We only process each edge once (if e < opposite)
    if (e < delaunay.halfedges[e]) {
      // Get the indices of the two triangles sharing this edge
      const t1 = Math.floor(e / 3);
      const t2 = Math.floor(delaunay.halfedges[e] / 3);

      // Get the Circumcenters of these two triangles (these are the Voronoi vertices)
      // x, y of circumcenter t1
      const p1x = voronoi.circumcenters[t1 * 2];
      const p1y = voronoi.circumcenters[t1 * 2 + 1];
      // x, y of circumcenter t2
      const p2x = voronoi.circumcenters[t2 * 2];
      const p2y = voronoi.circumcenters[t2 * 2 + 1];

      const vStart = new paper.Point(p1x, p1y);
      const vEnd = new paper.Point(p2x, p2y);

      // 4. Filtering Strategy

      // Filter A: Containment
      // Check start, end, AND midpoint to ensure the segment is fully inside.
      const midPoint = vStart.add(vEnd).divide(2);

      // We assume if start, middle, and end are inside, the whole segment is inside.
      // Note: path.contains() might fail for points exactly on the boundary due to precision,
      // but Voronoi vertices for the medial axis should ideally be strictly interior.
      if (
        !path.contains(midPoint) ||
        !path.contains(vStart) ||
        !path.contains(vEnd)
      ) {
        continue;
      }

      // Filter B: "Spur" Pruning (Adjacency Filter)
      // A raw Voronoi diagram has "spurs" connecting the skeleton to the boundary.
      // These spurs form between points that are neighbors on the boundary outline.
      // The true "Spine" forms between points that are far apart on the boundary.

      // The Delaunay edge associated with this Voronoi edge connects two boundary points:
      const indexA = delaunay.triangles[e];
      const indexB = delaunay.triangles[getNextHalfedge(e)];

      // Check the "index distance" between the generating points.
      // If the points are adjacent in our array, this Voronoi edge is likely
      // a bisector between neighbors (a spur), so we skip it.
      // Note: This assumes simple sequential sampling. For robust results on complex
      // compound paths, you might need Geodesic Distance pruning.
      const indexDiff = Math.abs(indexA - indexB);

      // 1 means neighbors. We also check wrap-around (approximate).
      const isAdjacent =
        indexDiff === 1 || indexDiff > boundaryPoints.length - 5;

      if (!isAdjacent) {
        medialSegments.push([vStart, vEnd]);
      }
    }
  }

  return medialSegments;
}

function getNextHalfedge(e: number): number {
  // If we are at the end of a triangle triplet (indices 2, 5, 8...), wrap back.
  // Otherwise, just advance by 1.
  return e % 3 === 2 ? e - 2 : e + 1;
}
