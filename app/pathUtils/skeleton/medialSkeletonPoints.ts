import { MinPriorityQueue } from "@datastructures-js/priority-queue";
import paper from "paper";

import {
  FlatBoundary,
  buildFlatBoundary,
  nearestDistFlatBoundary,
  sampleBoundary,
} from "@/app/pathUtils/flatBoundary";
import { MedialAxisGraph } from "@/app/pathUtils/skeleton/medialAxis";
import {
  Primitive,
  localPrimitiveFitting,
  primitivePts,
} from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { constructMedialSkeleton } from "@/app/pathUtils/skeleton/medialSkeleton";
import { Vec2D } from "@/app/utils/types";

// Energy weights (paper Sec. 5.3) — used as defaults for SkeletonPointsOptions.
const C1 = 1;     // centrality
const C2 = 1e-3;  // count — penalises excess vertices (paper value)

export type SkeletonPointsOptions = {
  /** Maximum outer (NM) iterations. Default: 12. */
  maxOuterIter: number;
  /** Minimum NM iterations per inner call. Default: 50. */
  nmItersMin: number;
  /** NM iterations added per free-seed dimension. Default: 20. */
  nmItersPerDim: number;
  /** NM eval count threshold before starting to add extra seeds. Default: 50. */
  growthStart: number;
  /** Base number of new seeds added per growth step. Default: 1. */
  nNew: number;
  /** Energy weight for centrality term (paper §5.3). Default: 1. */
  c1: number;
  /** Energy weight for seed-count penalty (paper §5.3). Default: 1e-3. */
  c2: number;
};

export type SkeletonIterCallback = (
  iter: number,    // iteration index; MAX_OUTER = final state after loop
  V: paper.Point[],
  cov: number,     // true primitive coverage fraction (paper's E_coverage metric)
  covGain: number, // improvement over previous iteration
  adding: number,  // how many new seeds are about to be added (0 = stopping)
  nmEvals: number, // cumulative NM evaluations so far
) => void;

/**
 * Computes the Medial Skeletal Diagram (Optimized Skeleton) for a 2D shape.
 * Implements the Global Optimization pipeline from Section 5.3 of Guo et al. (2024).
 */
export function computeMedialSkeletonPoints(
  path: paper.CompoundPath,
  medialAxis: MedialAxisGraph,
  _tolerance: number = 3.0, // eslint-disable-line @typescript-eslint/no-unused-vars
  verbose: boolean = false,
  onIteration?: SkeletonIterCallback,
  options: Partial<SkeletonPointsOptions> = {},
): paper.Point[] {
  const opts: SkeletonPointsOptions = {
    maxOuterIter:  options.maxOuterIter  ?? 12,
    nmItersMin:    options.nmItersMin    ?? 50,
    nmItersPerDim: options.nmItersPerDim ?? 20,
    growthStart:   options.growthStart   ?? 50,
    nNew:          options.nNew          ?? 1,
    c1:            options.c1            ?? C1,
    c2:            options.c2            ?? C2,
  };

  const { points: boundarySamples } = sampleBoundary(path, { step: 10 });
  const flatBoundary = buildFlatBoundary(path);

  // Precompute inscribed radius at each medial axis node (for E_centrality)
  const medialAxisR = new Float64Array(medialAxis.points.length);
  for (let i = 0; i < medialAxis.points.length; i++) {
    const p = medialAxis.points[i];
    medialAxisR[i] = nearestDistFlatBoundary(p.x, p.y, flatBoundary);
  }

  // Precompute maxDim² for E_centrality normalization (paper normalizes to [0,1])
  let axisMinX = Infinity, axisMaxX = -Infinity, axisMinY = Infinity, axisMaxY = -Infinity;
  for (const p of medialAxis.points) {
    if (p.x < axisMinX) axisMinX = p.x;
    if (p.x > axisMaxX) axisMaxX = p.x;
    if (p.y < axisMinY) axisMinY = p.y;
    if (p.y > axisMaxY) axisMaxY = p.y;
  }
  const normSq = Math.max((axisMaxX - axisMinX) ** 2, (axisMaxY - axisMinY) ** 2, 1);

  // Step 8: Farthest-point initial seeds on M (default |V⁰| = 5)
  let V = farthestPointSeeds(medialAxis, 5);

  if (verbose) {
    console.info("Initial seeds:", V.length, V.map(fmt).join(", "));
  }

  // Incremental outer loop
  let nmEvalCount = 0;
  let lastCovFraction = 0;

  // Frozen vertices from previous NM runs; only V_new is optimized each round
  let frozenV: paper.Point[] = [];

  for (let outerIter = 0; outerIter < opts.maxOuterIter; outerIter++) {
    const freeV = V.slice(frozenV.length); // only optimize the unfrozen suffix

    // Step 10: Nelder-Mead over freeV (flat x array: [x0,y0, x1,y1, ...])
    // Pre-compute projections + inscribed radii for frozen seeds once per outer iter.
    const frozenProj = frozenV.map((p) => projectToMedialAxis(p, medialAxis, medialAxisR));
    const projFrozen = frozenProj.map((r) => r.point);
    const inscribedFrozen = frozenProj.map((r) => r.inscribed);

    const x0 = pointsToFlat(freeV);

    const result = nelderMead(
      (x: number[]) => {
        nmEvalCount++;
        const currentFree = flatToPoints(x);
        return computeEnergyPartial(
          projFrozen, inscribedFrozen,
          currentFree, medialAxis, boundarySamples, medialAxisR, flatBoundary, normSq,
          opts.c1, opts.c2,
        );
      },
      x0,
      { maxIterations: Math.max(opts.nmItersMin, x0.length * opts.nmItersPerDim) },
    );

    V = [...frozenV, ...flatToPoints(result.x)];
    V = V.map((p) => projectToMedialAxis(p, medialAxis).point);
    V = deduplicateSeeds(V, 10); // remove seeds within 10 em-units of each other

    // Evaluate true coverage using fitted primitives (paper's E_coverage metric).
    // Called once per outer iteration — not inside NM where it would be too slow.
    const skeleton = constructMedialSkeleton(V, medialAxis, path);
    const fitted = localPrimitiveFitting(path, skeleton, {}, flatBoundary);
    const { coverage: trueCov, uncovered } = coverageAndUncovered(boundarySamples, fitted.primitives);

    if (verbose) {
      console.info(`Outer iter ${outerIter}: cov=${(trueCov*100).toFixed(1)}%, |V|=${V.length}`);
    }

    const covGain = trueCov - lastCovFraction;
    lastCovFraction = trueCov;

    // Stop when coverage is achieved or no samples remain uncovered.
    // Bad-centrality edges are fixed structurally by Steiner points in constructMedialSkeleton.
    const willStop = trueCov >= 0.98 || uncovered.length === 0;

    const nNew = willStop ? 0 :
      nmEvalCount >= opts.growthStart
        ? opts.nNew + (outerIter % 3 === 0 ? 1 : 0)
        : 1;

    onIteration?.(outerIter, V.slice(), trueCov, covGain, nNew, nmEvalCount);

    if (willStop) break;

    frozenV = V.slice();
    V = [...frozenV, ...pickNewSeeds(uncovered, V, medialAxis, nNew)];
  }

  return V;
}

// ---------------------------------------------------------------------------
// Step 9: Energy function (Sec. 5.3) — uses inscribed-radius medial balls.
// Full primitive fitting is NOT called here; it runs once after optimization.
// ---------------------------------------------------------------------------

// Variant used inside the NM loop: frozen seeds are pre-projected; only free seeds
// need projection each call.
function computeEnergyPartial(
  projFrozen: paper.Point[],
  inscribedFrozen: number[],
  freeV: paper.Point[],
  medialAxis: MedialAxisGraph,
  boundarySamples: paper.Point[],
  medialAxisR: Float64Array,
  flatBoundary: FlatBoundary,
  normSq: number,
  c1: number,
  c2: number,
): number {
  const freeProjected = freeV.map((p) => projectToMedialAxis(p, medialAxis, medialAxisR));
  const projFree = freeProjected.map((r) => r.point);
  const inscribedFree = freeProjected.map((r) => r.inscribed);
  const projV = [...projFrozen, ...projFree];
  const inscribed = [...inscribedFrozen, ...inscribedFree];
  return computeEnergyCore(projV, inscribed, medialAxis, boundarySamples, medialAxisR, flatBoundary, normSq, c1, c2);
}


function computeEnergyCore(
  projV: paper.Point[],
  inscribed: number[],
  medialAxis: MedialAxisGraph,
  boundarySamples: paper.Point[],
  medialAxisR: Float64Array,
  _flatBoundary: FlatBoundary,
  normSq: number,
  c1: number,
  c2: number,
): number {
  if (projV.length === 0) return 0;
  const nSeeds = projV.length;

  // E_coverage: fraction of boundary samples inside inscribed medial ball of nearest seed.
  // Linear nearest-seed scan — faster than Delaunay for nSeeds ≤ 22; no allocations.
  // Compare squared distances to avoid sqrt; also skip Math.hypot allocation.
  let covered = 0;
  for (const s of boundarySamples) {
    let best = 0, bestDistSq = Infinity;
    for (let i = 0; i < nSeeds; i++) {
      const dx = s.x - projV[i].x, dy = s.y - projV[i].y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) { bestDistSq = dSq; best = i; }
    }
    const r = inscribed[best];
    if (bestDistSq <= r * r) covered++;
  }
  const eCoverage = -(covered / boundarySamples.length);

  // E_centrality: radius-weighted centroid of each seed's Voronoi cell on M.
  // Pulls each seed toward the thick-axis center of its region (away from thin junctions).
  // Normalized by maxDim² so c1=1 balances correctly (paper normalizes to [0,1]).
  const cellWX = new Float64Array(nSeeds);
  const cellWY = new Float64Array(nSeeds);
  const cellW = new Float64Array(nSeeds);
  for (let mu = 0; mu < medialAxis.points.length; mu++) {
    const pu = medialAxis.points[mu];
    const rmu = medialAxisR[mu];
    let best = 0, bestDistSq = Infinity;
    for (let i = 0; i < nSeeds; i++) {
      const dx = pu.x - projV[i].x, dy = pu.y - projV[i].y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) { bestDistSq = dSq; best = i; }
    }
    cellWX[best] += pu.x * rmu;
    cellWY[best] += pu.y * rmu;
    cellW[best] += rmu;
  }
  let eCentrality = 0;
  for (let i = 0; i < nSeeds; i++) {
    if (cellW[i] > 0) {
      const cx = cellWX[i] / cellW[i];
      const cy = cellWY[i] / cellW[i];
      eCentrality += ((projV[i].x - cx) ** 2 + (projV[i].y - cy) ** 2) / normSq;
    }
  }

  return eCoverage + c1 * eCentrality + c2 * nSeeds;
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
// Step 11: Primitive coverage — paper's true E_coverage metric
// ---------------------------------------------------------------------------

type PrimPolygon = {
  vx: Float64Array; vy: Float64Array;
  minX: number; maxX: number; minY: number; maxY: number;
};

function buildPrimPolygons(primitives: Primitive[], delta: number): PrimPolygon[] {
  return primitives.map((prim) => {
    const pts = primitivePts(prim);
    const N = pts.length;
    const vx = new Float64Array(N);
    const vy = new Float64Array(N);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      vx[i] = pts[i].x;
      vy[i] = pts[i].y;
      if (vx[i] < minX) minX = vx[i];
      if (vx[i] > maxX) maxX = vx[i];
      if (vy[i] < minY) minY = vy[i];
      if (vy[i] > maxY) maxY = vy[i];
    }
    return { vx, vy, minX: minX - delta, maxX: maxX + delta, minY: minY - delta, maxY: maxY + delta };
  });
}

function polyCovers(px: number, py: number, poly: PrimPolygon, delta: number): boolean {
  if (px < poly.minX || px > poly.maxX || py < poly.minY || py > poly.maxY) return false;
  const { vx, vy } = poly;
  const N = vx.length;
  let inside = false;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    if (vy[i] > py !== vy[j] > py &&
        px < ((vx[j] - vx[i]) * (py - vy[i])) / (vy[j] - vy[i]) + vx[i])
      inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    const ax = vx[j], ay = vy[j], bx = vx[i], by = vy[i];
    const ddx = bx - ax, ddy = by - ay;
    const lenSq = ddx * ddx + ddy * ddy;
    let t = lenSq > 1e-10 ? ((px - ax) * ddx + (py - ay) * ddy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(px - (ax + t * ddx), py - (ay + t * ddy)) < delta) return true;
  }
  return false;
}

export function coverageAndUncovered(
  samples: paper.Point[],
  primitives: Primitive[],
  delta = 5.0,
): { coverage: number; uncovered: paper.Point[] } {
  if (samples.length === 0) return { coverage: 1, uncovered: [] };
  const polys = buildPrimPolygons(primitives, delta);
  let covered = 0;
  const uncovered: paper.Point[] = [];
  for (const s of samples) {
    let hit = false;
    for (const poly of polys) {
      if (polyCovers(s.x, s.y, poly, delta)) { hit = true; break; }
    }
    if (hit) covered++;
    else uncovered.push(s);
  }
  return { coverage: covered / samples.length, uncovered };
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
    const proj = projectToMedialAxis(remaining[bestIdx], medialAxis).point;
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
  medialAxisR?: Float64Array,
): { point: paper.Point; inscribed: number } {
  const pts = medialAxis.points;
  let bestX = pts[0].x, bestY = pts[0].y, minDist = Infinity;
  let bestI1 = 0, bestI2 = 0, bestT = 0;
  for (const [i1, i2] of medialAxis.segments) {
    const ax = pts[i1].x, ay = pts[i1].y;
    const dx = pts[i2].x - ax, dy = pts[i2].y - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 1e-10 ? ((pt.x - ax) * dx + (pt.y - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(pt.x - cx, pt.y - cy);
    if (d < minDist) { minDist = d; bestX = cx; bestY = cy; bestI1 = i1; bestI2 = i2; bestT = t; }
  }
  const inscribed = medialAxisR
    ? (1 - bestT) * medialAxisR[bestI1] + bestT * medialAxisR[bestI2]
    : 0;
  return { point: new paper.Point(bestX, bestY), inscribed };
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
  dist[start] = 0;
  const visited = new Uint8Array(pts.length);
  const pq = new MinPriorityQueue<[number, number]>((x) => x[0]);
  pq.push([0, start]);

  while (!pq.isEmpty()) {
    const [d, u] = pq.pop()!;
    if (visited[u]) continue;
    visited[u] = 1;
    for (const v of adj[u]) {
      const w = Math.hypot(pts[u].x - pts[v].x, pts[u].y - pts[v].y);
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        pq.push([nd, v]);
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

    // Early exit when simplex has converged (coordinates are in ~[0,1000] em space)
    let xSpread = 0;
    for (let d = 0; d < n; d++) xSpread = Math.max(xSpread, Math.abs(Ss[n][d] - Ss[0][d]));
    if (fSs[n] - fSs[0] < 1e-5 && xSpread < 1.0) break;

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
