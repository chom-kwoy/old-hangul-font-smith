import { Delaunay } from "d3-delaunay";
import paper from "paper";

import { sampleBoundary } from "@/app/pathUtils/medialAxis";

type Segment = [paper.Point, paper.Point];

/**
 * Computes the Medial Skeletal Diagram (Optimized Skeleton) for a 2D shape.
 * Implements the Global Optimization pipeline from Section 5.3 of Guo et al. (2023).
 *
 * @param path - The target 2D shape (closed CompoundPath).
 * @param medialAxis - The raw medial axis segments (computed previously).
 * @param tolerance - The coverage tolerance (delta in the paper).
 * @returns An optimal subset of points V* defining the sparse skeleton.
 */
export function computeMedialSkeletalDiagram(
  path: paper.CompoundPath,
  medialAxis: Segment[],
  tolerance: number = 2.0,
): paper.Point[] {
  // 1. Initialization: Start with a minimal seed set (e.g., endpoints of the MA)
  // We flatten the MA to a traversable graph or point set for projection.
  let V: paper.Point[] = getInitialSeeds(medialAxis);

  console.log(
    "Initial seeds:",
    V.map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).join(","),
  );

  const boundarySamples = sampleBoundary(path, 10);

  const MAX_ITERATIONS = 20;
  const LLOYD_STEPS = 5;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // --- Step A: Optimization (Centrality & Smoothness) ---
    // The paper minimizes E_centrality (Eq. 8).
    // We approximate this using Lloyd's Relaxation constrained to the Medial Axis.
    for (let l = 0; l < LLOYD_STEPS; l++) {
      V = optimizePositions(V, path, medialAxis);
    }

    console.log(
      "Iteration",
      iter,
      "V:",
      V.map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).join(","),
    );

    // --- Step B: Coverage Check & Incremental Addition ---
    // Identify uncovered regions and add new seeds.
    const uncoveredPoints = getUncoveredBoundaryPoints(
      V,
      path,
      boundarySamples,
      tolerance,
    );

    console.log(
      "num uncovered:",
      uncoveredPoints.length,
      "points:",
      uncoveredPoints
        .map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`)
        .join(","),
    );

    if (uncoveredPoints.length === 0) {
      break; // Fully covered
    }

    // Heuristic: Add a new seed for the largest cluster of uncovered points.
    // We pick the uncovered point that is furthest from existing V.
    const worstPoint = findFurthestPoint(uncoveredPoints, V);
    const newSeed = projectToMedialAxis(worstPoint, medialAxis);

    // Prevent stacking duplicate points
    if (!isDuplicate(newSeed, V)) {
      V.push(newSeed);
    } else {
      break; // Convergence or stagnation
    }
  }

  return V;
}

/**
 * Optimizes vertex positions to minimize Centrality Energy.
 * Moves v towards the centroid of its Restricted Voronoi Cell (RVC).
 */
function optimizePositions(
  currentV: paper.Point[],
  path: paper.CompoundPath,
  medialAxis: Segment[],
): paper.Point[] {
  // 1. Compute Voronoi Diagram of V
  const pointsArray = currentV.map((p) => [p.x, p.y] as [number, number]);
  const delaunay = Delaunay.from(pointsArray);
  const voronoi = delaunay.voronoi([
    path.bounds.left,
    path.bounds.top,
    path.bounds.right,
    path.bounds.bottom,
  ]);

  const newV: paper.Point[] = [];

  for (let i = 0; i < currentV.length; i++) {
    // 2. Compute Restricted Voronoi Cell (RVC)
    // RVC = Voronoi Cell (i) INTERSECT Shape S [cite: 1493]
    const cellPolygon = new paper.Path(voronoi.cellPolygon(i));

    // In Paper.js, we intersect the cell with the shape to get the RVC
    const rvc = path.intersect(cellPolygon);

    if (!rvc.isEmpty()) {
      // 3. Move to Centroid (Lloyd's step)
      // The centroid of the RVC minimizes the distance energy.
      const centroid = getCentroid(rvc);

      // 4. Constraint Projection
      // The vertex must stay on the Medial Axis[cite: 1755].
      const constrainedPt = projectToMedialAxis(centroid, medialAxis);
      newV.push(constrainedPt);
    } else {
      // If cell is empty (numerical error or outside), keep original
      newV.push(currentV[i]);
    }

    // Cleanup Paper.js temporary items
    cellPolygon.remove();
    rvc.remove();
  }

  return newV;
}

/**
 * Evaluates E_coverage.
 * Returns points on the boundary of S that are NOT covered by the primitives defined by V.
 */
function getUncoveredBoundaryPoints(
  V: paper.Point[],
  path: paper.CompoundPath,
  boundarySamples: paper.Point[],
  tolerance: number,
): paper.Point[] {
  const uncovered: paper.Point[] = [];

  // For 2D MSD, the primitive is defined by the Maximal Inscribed Circle (radius r).
  // The shape is reconstructed as the Union of these primitives.
  // Note: A full reconstruction would envelope the connections (Cones),
  // but checking distance to the nearest Sphere is a standard approximation for coverage.

  for (const sample of boundarySamples) {
    let isCovered = false;
    for (const v of V) {
      // Radius at v is the distance to the nearest boundary point
      const radius = getDistanceToBoundary(v, path);

      // Check if sample is inside the primitive (Circle at v)
      if (sample.getDistance(v) < radius + tolerance) {
        isCovered = true;
        break;
      }
    }

    // Note: The paper also envelopes edges between V.
    // Ideally, we check distance to the Skeleton Graph V_edges, not just vertices.
    // For simplicity of this snippet, we check vertex coverage.

    if (!isCovered) {
      uncovered.push(sample);
    }
  }
  return uncovered;
}

// --- Helper Functions ---

function getInitialSeeds(medialAxis: Segment[]): paper.Point[] {
  if (medialAxis.length === 0) return [];
  if (medialAxis.length === 1) return [medialAxis[0][0]];

  const getRandomPoint = () => {
    const segIndex = Math.floor(Math.random() * medialAxis.length);
    const segment = medialAxis[segIndex];
    // Pick either start (0) or end (1) of the segment
    const ptIndex = Math.random() > 0.5 ? 1 : 0;
    return segment[ptIndex];
  };

  const p1 = getRandomPoint();
  let p2 = getRandomPoint();

  // Try to find a distinct second point
  let attempts = 0;
  while (p1.getDistance(p2) < 1.0 && attempts < 10) {
    p2 = getRandomPoint();
    attempts++;
  }

  return [p1, p2];
}

function projectToMedialAxis(
  pt: paper.Point,
  segments: Segment[],
): paper.Point {
  let closestPt = segments[0][0];
  let minDst = Infinity;

  for (const [p1, p2] of segments) {
    // Project pt onto line segment p1-p2
    const line = new paper.Path.Line(p1, p2);
    const proj = line.getNearestPoint(pt);
    const dst = proj.getDistance(pt);

    if (dst < minDst) {
      minDst = dst;
      closestPt = proj;
    }
    line.remove(); // Cleanup
  }
  return closestPt;
}

function getDistanceToBoundary(
  pt: paper.Point,
  path: paper.CompoundPath,
): number {
  return path.getNearestPoint(pt).getDistance(pt);
}

function getCentroid(item: paper.Item): paper.Point {
  // Paper.js `position` of a Path is its bounding box center,
  // but for RVC we generally want the area centroid.
  // `item.bounds.center` is a fast approx; `position` is often sufficient.
  // For strict accuracy, one would integrate, but Paper.js doesn't expose moment integrals directly.
  return item.bounds.center;
}

function findFurthestPoint(
  candidates: paper.Point[],
  references: paper.Point[],
): paper.Point {
  let maxMinDist = -1;
  let bestCand = candidates[0];

  for (const c of candidates) {
    let minDist = Infinity;
    for (const r of references) {
      const d = c.getDistance(r);
      if (d < minDist) minDist = d;
    }
    if (minDist > maxMinDist) {
      maxMinDist = minDist;
      bestCand = c;
    }
  }
  return bestCand;
}

function isDuplicate(pt: paper.Point, list: paper.Point[]): boolean {
  return list.some((p) => p.getDistance(pt) < 1.0);
}
