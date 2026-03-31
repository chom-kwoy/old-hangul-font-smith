import { Delaunay } from "d3-delaunay";
import paper from "paper";

export type Point = {
  x: number;
  y: number;
};

// Define the new return type
export interface MedialAxisGraph {
  points: Point[];
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
  const { points: boundaryPoints, subPathRanges } = sampleBoundary(
    path,
    sampleSpacing,
  );

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

  // 2. Compute Voronoi Diagram
  const delaunay = Delaunay.from(pointsArray);
  const voronoi = delaunay.voronoi([
    path.bounds.left - 10,
    path.bounds.top - 10,
    path.bounds.right + 10,
    path.bounds.bottom + 10,
  ]);

  // Output structures
  const uniquePoints: Point[] = [];
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

      // Filter A: Interior Edge Check
      // Keep a Voronoi edge if its midpoint is inside the shape, OR if both
      // circumcenter endpoints are inside. The midpoint check handles the common
      // case. The both-endpoints check handles narrow concavities where the edge
      // dips slightly outside at its midpoint even though both circumcenters are
      // genuinely interior — filtering such edges disconnects the medial axis at
      // thin sections of the stroke.
      const midPoint = vStart.add(vEnd).divide(2);
      if (
        !path.contains(midPoint) &&
        !(path.contains(vStart) && path.contains(vEnd))
      ) {
        continue;
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

  connectIsolatedComponents(uniquePoints, segments);

  return {
    points: uniquePoints,
    segments: segments,
  };
}

/**
 * Post-processing: connects isolated components to the main (largest) component
 * by adding an edge from the closest cross-component node pair.
 *
 * This handles rare geometry-induced disconnections at narrow or concave path
 * sections where the Voronoi edge filters incorrectly drop bridge edges.
 * Mutates `segments` in place.
 */
function connectIsolatedComponents(
  points: Point[],
  segments: [number, number][],
): void {
  if (points.length === 0) return;

  // Build adjacency list
  const adj: number[][] = Array.from({ length: points.length }, () => []);
  for (const [u, v] of segments) {
    adj[u].push(v);
    adj[v].push(u);
  }

  // BFS to label connected components
  const comp = new Int32Array(points.length).fill(-1);
  let numComps = 0;
  for (let start = 0; start < points.length; start++) {
    if (comp[start] !== -1) continue;
    const queue = [start];
    comp[start] = numComps;
    for (let qi = 0; qi < queue.length; qi++) {
      const node = queue[qi];
      for (const n of adj[node]) {
        if (comp[n] === -1) {
          comp[n] = numComps;
          queue.push(n);
        }
      }
    }
    numComps++;
  }

  if (numComps === 1) return;

  // Find the index of the largest component
  const compSizes = new Int32Array(numComps);
  for (const c of comp) compSizes[c]++;
  let mainComp = 0;
  for (let i = 1; i < numComps; i++) {
    if (compSizes[i] > compSizes[mainComp]) mainComp = i;
  }

  // For each non-main component, add an edge from its closest node to the
  // closest node in the main component.
  for (let c = 0; c < numComps; c++) {
    if (c === mainComp) continue;
    let bestDist = Infinity;
    let bestU = -1,
      bestV = -1;
    for (let u = 0; u < points.length; u++) {
      if (comp[u] !== c) continue;
      const pu = points[u];
      for (let v = 0; v < points.length; v++) {
        if (comp[v] !== mainComp) continue;
        const pv = points[v];
        const dx = pu.x - pv.x;
        const dy = pu.y - pv.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestU = u;
          bestV = v;
        }
      }
    }
    if (bestU !== -1) {
      segments.push([bestU, bestV]);
    }
  }
}

export function sampleBoundary(
  path: paper.CompoundPath,
  step: number,
): { points: paper.Point[]; subPathRanges: Array<{ start: number; end: number }> } {
  const points: paper.Point[] = [];
  const subPathRanges: Array<{ start: number; end: number }> = [];

  for (const child of path.children as paper.Path[]) {
    const rangeStart = points.length;

    for (const curve of child.curves) {
      // Always include the anchor point at the start of this curve segment.
      points.push(curve.point1.clone());
      // Then add evenly-spaced interior samples along the curve.
      const curveLen = curve.length;
      const numInterior = Math.floor(curveLen / step);
      for (let i = 1; i <= numInterior; i++) {
        const pt = curve.getPointAt(i * step);
        if (pt) points.push(pt);
      }
    }

    subPathRanges.push({ start: rangeStart, end: points.length });
  }

  return { points, subPathRanges };
}

function getNextHalfedge(e: number): number {
  // If we are at the end of a triangle triplet (indices 2, 5, 8...), wrap back.
  // Otherwise, just advance by 1.
  return e % 3 === 2 ? e - 2 : e + 1;
}
