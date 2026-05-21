import { Delaunay } from "d3-delaunay";
import paper from "paper";

import {
  FlatBoundary,
  buildFlatBoundary,
  nearestDistFlatBoundary,
  sampleBoundary,
} from "@/app/pathUtils/flatBoundary";
import { MedialAxisGraph } from "@/app/pathUtils/skeleton/medialAxis";
import { Vec2D } from "@/app/utils/types";

// Energy weights (paper Sec. 5.3)
const C1 = 1;    // centrality
const C2 = 1e-3; // count

/**
 * Computes the Medial Skeletal Diagram (Optimized Skeleton) for a 2D shape.
 * Implements the Global Optimization pipeline from Section 5.3 of Guo et al. (2024).
 */
export function computeMedialSkeletonPoints(
  path: paper.CompoundPath,
  medialAxis: MedialAxisGraph,
  _tolerance: number = 3.0, // eslint-disable-line @typescript-eslint/no-unused-vars
  verbose: boolean = false,
): paper.Point[] {
  const { points: boundarySamples } = sampleBoundary(path, { step: 10 });
  const flatBoundary = buildFlatBoundary(path);

  // Step 8: Farthest-point initial seeds on M (default |V⁰| = 10)
  let V = farthestPointSeeds(medialAxis, 10);

  if (verbose) {
    console.info("Initial seeds:", V.length, V.map(fmt).join(", "));
  }

  // Incremental outer loop
  const MAX_OUTER = 20;    // max outer iterations
  const NM_ITERS = 200;    // NM iterations per inner call
  const GROWTH_START = 50; // start adding n=5 vertices after this many NM evals
  const N_NEW = 3;         // base vertices to add per growth step
  const STAGNATION = 5;    // break if energy flat this many outer iters

  let nmEvalCount = 0;
  let lastEnergy = Infinity;
  let stagnantIters = 0;

  // Frozen vertices from previous NM runs; only V_new is optimized each round
  let frozenV: paper.Point[] = [];

  for (let outerIter = 0; outerIter < MAX_OUTER; outerIter++) {
    const freeV = V.slice(frozenV.length); // only optimize the unfrozen suffix

    // Step 10: Nelder-Mead over freeV (flat x array: [x0,y0, x1,y1, ...])
    const x0 = pointsToFlat(freeV);

    const result = nelderMead(
      (x: number[]) => {
        nmEvalCount++;
        const currentFree = flatToPoints(x);
        const allV = [...frozenV, ...currentFree];
        return computeEnergy(allV, medialAxis, boundarySamples, flatBoundary);
      },
      x0,
      { maxIterations: NM_ITERS },
    );

    V = [...frozenV, ...flatToPoints(result.x)];
    V = V.map((p) => projectToMedialAxis(p, medialAxis));
    V = deduplicateSeeds(V, 10); // remove seeds within 10 em-units of each other

    const energy = computeEnergy(V, medialAxis, boundarySamples, flatBoundary);

    if (verbose) {
      console.info(`Outer iter ${outerIter}: energy=${energy.toFixed(4)}, |V|=${V.length}`);
    }

    // Step 11: Stagnation check (relative: < 0.01% improvement)
    if (energy >= lastEnergy * (1 - 1e-4)) {
      stagnantIters++;
      if (stagnantIters >= STAGNATION) break;
    } else {
      stagnantIters = 0;
    }
    lastEnergy = energy;

    // Check full coverage
    const uncovered = getUncoveredArcs(V, boundarySamples, flatBoundary);
    if (uncovered.length === 0) break;

    // Step 11: Freeze current V; add N_NEW new vertices in uncovered regions
    frozenV = V.slice();

    // Growth schedule: add vertices starting at GROWTH_START NM evals
    const nNew =
      nmEvalCount >= GROWTH_START
        ? N_NEW + (outerIter % 2 === 0 ? 2 : 0) // alternates 3 and 5
        : 1;

    const newSeeds = pickNewSeeds(uncovered, V, medialAxis, nNew);
    V = [...frozenV, ...newSeeds];
  }

  return V;
}

// ---------------------------------------------------------------------------
// Step 9: Energy function (Sec. 5.3) — uses inscribed-radius medial balls.
// Full primitive fitting is NOT called here; it runs once after optimization.
// ---------------------------------------------------------------------------

function computeEnergy(
  V: paper.Point[],
  medialAxis: MedialAxisGraph,
  boundarySamples: paper.Point[],
  flatBoundary: FlatBoundary,
): number {
  if (V.length === 0) return 0;

  const projV = V.map((p) => projectToMedialAxis(p, medialAxis));
  const inscribed = projV.map((p) =>
    nearestDistFlatBoundary(p.x, p.y, flatBoundary),
  );
  const delaunay = Delaunay.from(projV.map((p) => [p.x, p.y] as [number, number]));

  // Accumulate coverage + Voronoi centroids in one pass over boundary samples
  let covered = 0;
  const sumX = new Float64Array(projV.length);
  const sumY = new Float64Array(projV.length);
  const counts = new Int32Array(projV.length);

  for (const s of boundarySamples) {
    const idx = delaunay.find(s.x, s.y);
    const v = projV[idx];
    const dist = Math.hypot(s.x - v.x, s.y - v.y);
    if (dist <= inscribed[idx]) covered++;
    sumX[idx] += s.x;
    sumY[idx] += s.y;
    counts[idx]++;
  }

  // E_coverage: fraction of boundary samples inside their nearest medial ball
  const eCoverage = -(covered / boundarySamples.length);

  // E_centrality: squared distance from each V to its Voronoi centroid
  let eCentrality = 0;
  for (let i = 0; i < projV.length; i++) {
    if (counts[i] > 0) {
      const cx = sumX[i] / counts[i];
      const cy = sumY[i] / counts[i];
      eCentrality += (projV[i].x - cx) ** 2 + (projV[i].y - cy) ** 2;
    }
  }

  return eCoverage + C1 * eCentrality + C2 * projV.length;
}

// ---------------------------------------------------------------------------
// Step 8: Farthest-point sampling on M
// ---------------------------------------------------------------------------

function farthestPointSeeds(
  medialAxis: MedialAxisGraph,
  n: number,
): paper.Point[] {
  const pts = medialAxis.points;
  if (pts.length === 0) return [];

  const adj = buildGraphAdj(medialAxis);
  const seeds: number[] = [0]; // start with first node
  const distToSeeds = new Float64Array(pts.length).fill(Infinity);

  // Initialize distances from seed 0
  dijkstraFrom(0, adj, pts, distToSeeds);

  while (seeds.length < n && seeds.length < pts.length) {
    // Pick the farthest node from any existing seed
    let maxDist = -1, best = -1;
    for (let i = 0; i < pts.length; i++) {
      if (distToSeeds[i] > maxDist) { maxDist = distToSeeds[i]; best = i; }
    }
    if (best === -1 || maxDist === 0) break;
    seeds.push(best);

    // Update distances: new seed may be closer to some nodes
    const newDists = new Float64Array(pts.length).fill(Infinity);
    dijkstraFrom(best, adj, pts, newDists);
    for (let i = 0; i < pts.length; i++) {
      distToSeeds[i] = Math.min(distToSeeds[i], newDists[i]);
    }
  }

  return seeds.map((i) => new paper.Point(pts[i].x, pts[i].y));
}

// ---------------------------------------------------------------------------
// Step 11: Uncovered arc detection and new seed placement
// ---------------------------------------------------------------------------

function getUncoveredArcs(
  V: paper.Point[],
  boundarySamples: paper.Point[],
  flatBoundary: FlatBoundary,
): paper.Point[] {
  // Check coverage using inscribed radius heuristic (fast — avoids re-fitting)
  const inscribed = V.map((v) =>
    nearestDistFlatBoundary(v.x, v.y, flatBoundary),
  );
  const pointsArray = V.map((p) => [p.x, p.y] as [number, number]);
  const delaunay = Delaunay.from(pointsArray);

  const uncovered: paper.Point[] = [];
  for (const sample of boundarySamples) {
    const idx = delaunay.find(sample.x, sample.y);
    const v = V[idx];
    const dist = Math.hypot(sample.x - v.x, sample.y - v.y);
    if (dist > inscribed[idx] * 1.5) {
      uncovered.push(sample);
    }
  }
  return uncovered;
}

function pickNewSeeds(
  uncovered: paper.Point[],
  currentV: paper.Point[],
  medialAxis: MedialAxisGraph,
  n: number,
): paper.Point[] {
  // Pick n uncovered points that are farthest from existing V
  const newSeeds: paper.Point[] = [];
  const remaining = [...uncovered];

  for (let k = 0; k < n && remaining.length > 0; k++) {
    const allRef = [...currentV, ...newSeeds];
    let maxDist = -1, bestIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      let minD = Infinity;
      for (const r of allRef) {
        minD = Math.min(minD, Math.hypot(remaining[i].x - r.x, remaining[i].y - r.y));
      }
      if (minD > maxDist) { maxDist = minD; bestIdx = i; }
    }
    const proj = projectToMedialAxis(remaining[bestIdx], medialAxis);
    newSeeds.push(proj);
    remaining.splice(bestIdx, 1);
  }
  return newSeeds;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pointsToFlat(pts: paper.Point[]): number[] {
  const x: number[] = [];
  for (const p of pts) { x.push(p.x, p.y); }
  return x;
}

function flatToPoints(x: number[]): paper.Point[] {
  const pts: paper.Point[] = [];
  for (let i = 0; i < x.length; i += 2) {
    pts.push(new paper.Point(x[i], x[i + 1]));
  }
  return pts;
}

function projectToMedialAxis(
  pt: paper.Point,
  medialAxis: MedialAxisGraph,
): paper.Point {
  const pts = medialAxis.points;
  let bestX = pts[0].x, bestY = pts[0].y, minDist = Infinity;
  for (const [i1, i2] of medialAxis.segments) {
    const ax = pts[i1].x, ay = pts[i1].y;
    const dx = pts[i2].x - ax, dy = pts[i2].y - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 1e-10 ? ((pt.x - ax) * dx + (pt.y - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(pt.x - cx, pt.y - cy);
    if (d < minDist) { minDist = d; bestX = cx; bestY = cy; }
  }
  return new paper.Point(bestX, bestY);
}


function deduplicateSeeds(V: paper.Point[], minSep: number): paper.Point[] {
  const out: paper.Point[] = [];
  for (const p of V) {
    if (!out.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < minSep))
      out.push(p);
  }
  return out;
}

function buildGraphAdj(medialAxis: MedialAxisGraph): number[][] {
  const adj: number[][] = Array.from({ length: medialAxis.points.length }, () => []);
  for (const [u, v] of medialAxis.segments) {
    adj[u].push(v);
    adj[v].push(u);
  }
  return adj;
}

function dijkstraFrom(
  start: number,
  adj: number[][],
  pts: Vec2D[],
  dist: Float64Array,
): void {
  // Simple Dijkstra using a sorted array (good enough for small graphs)
  dist[start] = 0;
  const visited = new Uint8Array(pts.length);
  const queue: [number, number][] = [[0, start]]; // [dist, node]

  while (queue.length > 0) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, u] = queue.shift()!;
    if (visited[u]) continue;
    visited[u] = 1;
    for (const v of adj[u]) {
      const w = Math.hypot(pts[u].x - pts[v].x, pts[u].y - pts[v].y);
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        queue.push([nd, v]);
      }
    }
  }
}

function fmt(p: paper.Point): string {
  return `(${p.x.toFixed(0)},${p.y.toFixed(0)})`;
}

// ---------------------------------------------------------------------------
// Minimal Nelder-Mead optimizer (replaces fmin to avoid ESM interop issues)
// Standard algorithm: Nelder & Mead (1965), coefficients ρ=1 χ=2 γ=0.5 σ=0.5
// ---------------------------------------------------------------------------

function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  params?: { maxIterations?: number },
): { fx: number; x: number[] } {
  const n = x0.length;
  const maxIter = params?.maxIterations ?? 200;

  // Build initial simplex: perturb each coordinate by 5% (or 0.00025 if zero)
  const S: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const v = x0.slice();
    v[i] += v[i] !== 0 ? 0.05 * Math.abs(v[i]) : 0.00025;
    S.push(v);
  }
  const fS = S.map(f);

  for (let iter = 0; iter < maxIter; iter++) {
    // Sort so S[0] = best, S[n] = worst
    const ord = fS.map((_, i) => i).sort((a, b) => fS[a] - fS[b]);
    const Ss = ord.map((i) => S[i].slice());
    const fSs = ord.map((i) => fS[i]);

    // Centroid of all but worst
    const c = Array<number>(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) c[j] += Ss[i][j] / n;

    // Reflect
    const xr = c.map((cj, j) => 2 * cj - Ss[n][j]);
    const fr = f(xr);

    if (fr < fSs[0]) {
      // Expand
      const xe = c.map((cj, j) => 3 * cj - 2 * Ss[n][j]);
      const fe = f(xe);
      Ss[n] = fe < fr ? xe : xr;
      fSs[n] = fe < fr ? fe : fr;
    } else if (fr < fSs[n - 1]) {
      Ss[n] = xr;
      fSs[n] = fr;
    } else {
      // Contract (inside if fr ≥ worst, outside otherwise)
      const inside = fr >= fSs[n];
      const xc = inside
        ? c.map((cj, j) => 0.5 * (cj + Ss[n][j]))
        : c.map((cj, j) => 0.5 * (cj + xr[j]));
      const fc = f(xc);
      if (fc < (inside ? fSs[n] : fr)) {
        Ss[n] = xc;
        fSs[n] = fc;
      } else {
        // Shrink: pull all vertices halfway toward best
        for (let i = 1; i <= n; i++) {
          Ss[i] = Ss[0].map((v, j) => 0.5 * (v + Ss[i][j]));
          fSs[i] = f(Ss[i]);
        }
      }
    }
    for (let i = 0; i <= n; i++) {
      S[i] = Ss[i];
      fS[i] = fSs[i];
    }
  }

  let bi = 0;
  for (let i = 1; i <= n; i++) if (fS[i] < fS[bi]) bi = i;
  return { fx: fS[bi], x: S[bi] };
}
