import { Delaunay } from "d3-delaunay";
import paper from "paper";

import { MedialAxisGraph, sampleBoundary } from "@/app/pathUtils/medialAxis";

/**
 * Computes the Medial Skeletal Diagram (Optimized Skeleton) for a 2D shape.
 * Implements the Global Optimization pipeline from Section 5.3 of Guo et al. (2023).
 *
 * @param path - The target 2D shape (closed CompoundPath).
 * @param medialAxis - The raw medial axis segments (computed previously).
 * @param tolerance - The coverage tolerance (delta in the paper).
 * @param verbose - Whether to print intermediate results to the console.
 * @returns An optimal subset of points V* defining the sparse skeleton.
 */
export function computeMedialSkeletonPoints(
  path: paper.CompoundPath,
  medialAxis: MedialAxisGraph,
  tolerance: number = 100.0,
  verbose: boolean = false,
): paper.Point[] {
  // 1. Initialization: Start with a minimal seed set (e.g., endpoints of the MA)
  // We flatten the MA to a traversable graph or point set for projection.
  let V: paper.Point[] = getInitialSeeds(medialAxis);

  if (verbose) {
    console.info(
      "Initial seeds:",
      V.map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).join(","),
    );
  }

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

    if (verbose) {
      console.info(
        "Iteration",
        iter,
        "V:",
        V.map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).join(","),
      );
    }

    // --- Step B: Coverage Check & Incremental Addition ---
    // Identify uncovered regions and add new seeds.
    const uncoveredPoints = getUncoveredBoundaryPoints(
      V,
      path,
      boundarySamples,
      tolerance,
    );

    if (verbose) {
      console.info(
        "num uncovered:",
        uncoveredPoints.length,
        "points:",
        uncoveredPoints
          .map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`)
          .join(","),
      );
    }

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
  medialAxis: MedialAxisGraph,
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
    // RVC = Voronoi Cell (i) INTERSECT Shape S
    const cell = voronoi.cellPolygon(i);
    const segments = cell.map((point) => new paper.Segment(point));
    const cellPolygon = new paper.Path(segments);

    // In Paper.js, we intersect the cell with the shape to get the RVC
    const rvc = path.intersect(cellPolygon);

    if (!rvc.isEmpty()) {
      // 3. Move to Centroid (Lloyd's step)
      // The centroid of the RVC minimizes the distance energy.
      const centroid = getCentroid(rvc);

      // 4. Constraint Projection
      // The vertex must stay on the Medial Axis.
      const constrainedPt = projectToMedialAxis(centroid, medialAxis);
      newV.push(constrainedPt);
    } else {
      // If cell is empty (numerical error or outside), keep original
      newV.push(currentV[i]);
    }
  }

  return newV;
}

/**
 * Evaluates E_coverage for Generalized Enveloping Primitives.
 * Uses robust ray-casting (getIntersections) to ensure visibility.
 */
function getUncoveredBoundaryPoints(
  V: paper.Point[],
  path: paper.CompoundPath,
  samples: paper.Point[],
  stretchTolerance: number = 3.0,
): paper.Point[] {
  const inscribedRadii = V.map((v) => getDistanceToBoundary(v, path));

  const uncovered: paper.Point[] = [];

  for (const sample of samples) {
    let isCovered = false;

    // Find the best candidate primitive (closest skeleton vertex)
    let bestV: paper.Point | null = null;
    let inscribedRadius = Infinity;
    let minDist = Infinity;

    for (let i = 0; i < V.length; i++) {
      const v = V[i];
      const radius = inscribedRadii[i];
      const dist = sample.getDistance(v);
      if (dist < minDist) {
        minDist = dist;
        bestV = v;
        inscribedRadius = radius;
      }
    }

    if (bestV) {
      // 1. Geometric Check (Stretch Ratio)
      // Check if the primitive can physically stretch this far
      const stretchRatio = minDist / (inscribedRadius + 0.001);

      if (stretchRatio <= stretchTolerance) {
        // 2. Topology Check (Visibility)
        // Use robust ray casting instead of midpoint check
        if (isVisible(bestV, sample, path)) {
          isCovered = true;
        }
      }
    }

    if (!isCovered) {
      uncovered.push(sample);
    }
  }
  return uncovered;
}

/**
 * Checks if a line segment between two points is strictly contained within the shape.
 * Uses Paper.js `getIntersections` to detect boundary crossings.
 */
function isVisible(
  start: paper.Point,
  end: paper.Point,
  path: paper.CompoundPath,
): boolean {
  // Create a temporary ray
  const ray = new paper.Path.Line(start, end);

  // Compute intersections with the shape boundary
  const intersections = ray.getIntersections(path);

  // Analysis:
  // We expect an intersection at 'end' (the boundary sample).
  // Any intersection significantly BEFORE 'end' means the view is blocked.
  for (const loc of intersections) {
    // If we hit an obstacle more than 1 pixel away from the target sample,
    // it's a blockage.
    if (loc.point.getDistance(end) > 1.0) {
      return false; // Blocked
    }
  }

  return true; // Clear line of sight
}

// --- Helper Functions ---

function getInitialSeeds(medialAxis: MedialAxisGraph): paper.Point[] {
  if (medialAxis.segments.length === 0) return [];
  if (medialAxis.segments.length === 1) {
    return [
      medialAxis.points[medialAxis.segments[0][0]],
      medialAxis.points[medialAxis.segments[0][1]],
    ];
  }

  const getRandomPoint = () => {
    const segIndex = Math.floor(Math.random() * medialAxis.segments.length);
    const segment = medialAxis.segments[segIndex];
    // Pick either start (0) or end (1) of the segment
    const ptIndex = Math.random() > 0.5 ? 1 : 0;
    return medialAxis.points[segment[ptIndex]];
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
  medialAxis: MedialAxisGraph,
): paper.Point {
  let closestPt = medialAxis.points[medialAxis.segments[0][0]];
  let minDst = Infinity;

  for (const [i1, i2] of medialAxis.segments) {
    const p1 = medialAxis.points[i1];
    const p2 = medialAxis.points[i2];
    // Project pt onto line segment p1-p2
    const line = new paper.Path.Line(p1, p2);
    const proj = line.getNearestPoint(pt);
    const dst = proj.getDistance(pt);

    if (dst < minDst) {
      minDst = dst;
      closestPt = proj;
    }
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
