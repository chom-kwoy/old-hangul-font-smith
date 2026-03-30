import { Delaunay } from "d3-delaunay";
import paper from "paper";
import seedrandom from "seedrandom";

import {
  FlatBoundary,
  buildFlatBoundary,
  nearestDistFlatBoundary,
  rayIntersectFlatBoundary,
} from "@/app/pathUtils/flatBoundary";
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
  const random = seedrandom("42");

  // 1. Initialization: Start with a minimal seed set (e.g., endpoints of the MA)
  // We flatten the MA to a traversable graph or point set for projection.
  let V: paper.Point[] = getInitialSeeds(medialAxis, random);

  if (verbose) {
    console.info(
      "Initial seeds:",
      V.map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).join(","),
    );
  }

  const boundarySamples = sampleBoundary(path, 10);
  const flatBoundary = buildFlatBoundary(path);
  // Reusable buffer for ray-intersection segment tracking
  const tested = new Uint8Array(flatBoundary.count);

  const MAX_ITERATIONS = 20;
  const LLOYD_STEPS = 5;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // --- Step A: Optimization (Centrality & Smoothness) ---
    // The paper minimizes E_centrality (Eq. 8).
    // We approximate this using Lloyd's Relaxation constrained to the Medial Axis.
    for (let l = 0; l < LLOYD_STEPS; l++) {
      V = optimizePositions(V, medialAxis, boundarySamples);
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
      flatBoundary,
      tested,
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
 * Uses Lloyd's Relaxation via Delaunay nearest-cell assignment on boundary
 * samples — avoids expensive paper.js boolean path intersection.
 */
function optimizePositions(
  currentV: paper.Point[],
  medialAxis: MedialAxisGraph,
  boundarySamples: paper.Point[],
): paper.Point[] {
  const pointsArray = currentV.map((p) => [p.x, p.y] as [number, number]);
  const delaunay = Delaunay.from(pointsArray);

  // Accumulate the centroid of boundary samples belonging to each Voronoi cell.
  const sumX = new Float64Array(currentV.length);
  const sumY = new Float64Array(currentV.length);
  const counts = new Int32Array(currentV.length);

  for (const sample of boundarySamples) {
    const idx = delaunay.find(sample.x, sample.y);
    sumX[idx] += sample.x;
    sumY[idx] += sample.y;
    counts[idx]++;
  }

  const newV: paper.Point[] = [];
  for (let i = 0; i < currentV.length; i++) {
    if (counts[i] > 0) {
      const cx = sumX[i] / counts[i];
      const cy = sumY[i] / counts[i];
      const proj = projectToMedialAxisFast(cx, cy, medialAxis);
      newV.push(new paper.Point(proj.x, proj.y));
    } else {
      newV.push(currentV[i]);
    }
  }

  return newV;
}

/**
 * Evaluates E_coverage for Generalized Enveloping Primitives.
 */
function getUncoveredBoundaryPoints(
  V: paper.Point[],
  flatBoundary: FlatBoundary,
  tested: Uint8Array,
  samples: paper.Point[],
  stretchTolerance: number = 3.0,
): paper.Point[] {
  const inscribedRadii = V.map((v) =>
    nearestDistFlatBoundary(v.x, v.y, flatBoundary),
  );

  const uncovered: paper.Point[] = [];

  for (const sample of samples) {
    let isCovered = false;

    let bestV: paper.Point | null = null;
    let inscribedRadius = Infinity;
    let minDist = Infinity;

    for (let i = 0; i < V.length; i++) {
      const v = V[i];
      const dist = Math.hypot(sample.x - v.x, sample.y - v.y);
      if (dist < minDist) {
        minDist = dist;
        bestV = v;
        inscribedRadius = inscribedRadii[i];
      }
    }

    if (bestV) {
      const stretchRatio = minDist / (inscribedRadius + 0.001);
      if (stretchRatio <= stretchTolerance) {
        if (isVisible(bestV, sample, flatBoundary, tested)) {
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
 * Checks if the line segment from start to end is unobstructed by the boundary.
 * Casts a ray from start toward end; if the first boundary intersection is at
 * or beyond the endpoint, the view is clear.
 */
function isVisible(
  start: paper.Point,
  end: paper.Point,
  fb: FlatBoundary,
  tested: Uint8Array,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;

  tested.fill(0);
  const d = rayIntersectFlatBoundary(
    start.x,
    start.y,
    dx / len,
    dy / len,
    fb,
    tested,
  );
  // Any intersection significantly before the endpoint means the view is blocked.
  return d >= len - 1.0;
}

// --- Helper Functions ---

function getInitialSeeds(
  medialAxis: MedialAxisGraph,
  random: seedrandom.PRNG,
): paper.Point[] {
  if (medialAxis.segments.length === 0) return [];
  if (medialAxis.segments.length === 1) {
    return [
      new paper.Point(medialAxis.points[medialAxis.segments[0][0]]),
      new paper.Point(medialAxis.points[medialAxis.segments[0][1]]),
    ];
  }

  const getRandomPoint = () => {
    const segIndex = Math.floor(random() * medialAxis.segments.length);
    const segment = medialAxis.segments[segIndex];
    // Pick either start (0) or end (1) of the segment
    const ptIndex = random() > 0.5 ? 1 : 0;
    return new paper.Point(medialAxis.points[segment[ptIndex]]);
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

/**
 * Projects a point onto the nearest location on any medial axis segment.
 * Pure arithmetic — no paper.js object allocation.
 */
function projectToMedialAxisFast(
  px: number,
  py: number,
  medialAxis: MedialAxisGraph,
): { x: number; y: number } {
  let bestX = medialAxis.points[0].x;
  let bestY = medialAxis.points[0].y;
  let minDist = Infinity;

  for (const [i1, i2] of medialAxis.segments) {
    const ax = medialAxis.points[i1].x,
      ay = medialAxis.points[i1].y;
    const dx = medialAxis.points[i2].x - ax,
      dy = medialAxis.points[i2].y - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 1e-10 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + t * dx,
      cy = ay + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < minDist) {
      minDist = dist;
      bestX = cx;
      bestY = cy;
    }
  }
  return { x: bestX, y: bestY };
}

function projectToMedialAxis(
  pt: paper.Point,
  medialAxis: MedialAxisGraph,
): paper.Point {
  const p = projectToMedialAxisFast(pt.x, pt.y, medialAxis);
  return new paper.Point(p.x, p.y);
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
      const d = Math.hypot(c.x - r.x, c.y - r.y);
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
  return list.some(
    (p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 1.0,
  );
}
