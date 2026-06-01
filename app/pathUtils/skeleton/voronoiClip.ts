import { Delaunay } from "d3-delaunay";
import paper from "paper";

import { evalBezier } from "@/app/pathUtils/skeleton/bezierFitting";
import {
  BoundaryTag,
  FittedMedialAxisGraph,
} from "@/app/pathUtils/skeleton/localPrimitiveFitting";

interface Sample {
  x: number;
  y: number;
  primIdx: number;
}

export type VoronoiClipOptions = {
  /** Approximate samples per em-unit of bezier arc length. */
  samplesPerEmUnit: number;
  /** Minimum samples per edge primitive regardless of arc length. */
  minSamplesPerEdge: number;
  /** Grid spacing used when matching anchor coords to canonical Voronoi vertices. */
  vertexSnapTolerance: number;
  /** Bounds padding added to `path.bounds` before clipping the Voronoi diagram. */
  boundsPadding: number;
};

const DEFAULTS: VoronoiClipOptions = {
  samplesPerEmUnit: 0.5,
  minSamplesPerEdge: 16,
  vertexSnapTolerance: 1e-6,
  boundsPadding: 15,
};

/**
 * Computes the merged Voronoi cell (a polygon paper.PathItem) for each
 * primitive. Exposed for debugging/visualisation (drawing the raw Voronoi
 * partition) and reused internally by clipPrimitivesToVoronoiCells.
 *
 * Returns null if there are too few samples to form a Voronoi diagram.
 * Caller owns the returned cell paths and must .remove() them.
 */
export function computePrimitiveVoronoiCells(
  fitted: FittedMedialAxisGraph,
  bounds: paper.Rectangle,
  options: Partial<VoronoiClipOptions> = {},
): {
  cellPaths: Map<number, paper.PathItem>;
} | null {
  const opts: VoronoiClipOptions = { ...DEFAULTS, ...options };

  // 1. Sample features.
  const samples: Sample[] = [];
  for (let pi = 0; pi < fitted.primitives.length; pi++) {
    samplePrimitive(fitted, pi, opts, samples);
  }
  if (samples.length < 2) return null;

  // 2. Compute Voronoi on the padded bounding rectangle.
  const xmin = bounds.left - opts.boundsPadding;
  const ymin = bounds.top - opts.boundsPadding;
  const xmax = bounds.right + opts.boundsPadding;
  const ymax = bounds.bottom + opts.boundsPadding;

  const flat = new Float64Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    flat[2 * i] = samples[i].x;
    flat[2 * i + 1] = samples[i].y;
  }
  const delaunay = new Delaunay(flat);
  const voronoi = delaunay.voronoi([xmin, ymin, xmax, ymax]);

  // 3. Collect cell polygons.
  const cellPolys: ([number, number][] | null)[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    cellPolys[i] = voronoi.cellPolygon(i) as [number, number][] | null;
  }

  // 4. Build a merged Voronoi-cell paper.Path per primitive.
  const cellPaths = buildPerPrimitiveCellPaths(
    samples,
    cellPolys,
    fitted.primitives.length,
  );

  return { cellPaths };
}

/**
 * Partitions the fitted primitives' coverage into non-overlapping regions by
 * a capsule-restricted Voronoi rule: a point belongs to edge i iff capsule_i
 * covers it AND edge i is the nearest skeleton among primitives whose capsule
 * covers it.
 *
 * Concretely, with CLAIMED_j = capsule_j ∩ cell_j (each primitive's first-tier
 * Voronoi territory), each primitive's region is computed as
 *
 *     region_i = capsule_i  \  ⋃_{j≠i} CLAIMED_j
 *
 * This keeps every region inside the union of capsules (glyph-aware — no
 * exclaves), heals the junction gaps where one capsule fell short of the
 * bisector (the short side's territory stays with the capsule that does cover
 * it), and makes genuinely-shared boundaries symmetric: the straight bisector
 * segment that primitive i exposes by subtracting CLAIMED_j is the exact same
 * cell-edge that primitive j keeps as part of CLAIMED_j, so both reference
 * identical Float64 coordinates.
 *
 * Each primitive's `boundaryTags` is populated, one tag per clippedPath curve:
 * - bezier: non-linear boundary unique to this primitive (capsule/shape edge).
 * - shared:n: straight bisector segment that primitive n mirrors exactly.
 * - outer: straight boundary with no mirror (a sole-coverage tail or a
 *   straight bit of the capsule/shape edge).
 *
 * Must run after `clipPrimitivesToShape` has populated `clippedPath`.
 */
export function clipPrimitivesToVoronoiCells(
  fitted: FittedMedialAxisGraph,
  bounds: paper.Rectangle,
  options: Partial<VoronoiClipOptions> = {},
): void {
  const opts: VoronoiClipOptions = { ...DEFAULTS, ...options };
  const computed = computePrimitiveVoronoiCells(fitted, bounds, opts);
  if (!computed) return;
  const { cellPaths } = computed;

  const n = fitted.primitives.length;

  // Capture the pre-Voronoi capsules (clipPrimitivesToShape output). Cloned so
  // we can overwrite prim.clippedPath while still referencing the original.
  const capsules: (paper.PathItem | null)[] = fitted.primitives.map((p) =>
    p.clippedPath ? (p.clippedPath.clone({ insert: false }) as paper.PathItem) : null,
  );

  // CLAIMED_i = capsule_i ∩ cell_i (largest connected component).
  const claimed: (paper.Path | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const cap = capsules[i];
    const cell = cellPaths.get(i);
    if (!cap || !cell) continue;
    claimed[i] = largestComponent(cap.intersect(cell, { insert: false }));
  }

  // region_i = capsule_i \ ⋃_{j≠i} CLAIMED_j.
  // Non-overlapping CLAIMED_j (distant primitives) are skipped by bounds test,
  // so the subtraction only touches genuine neighbours.
  const regions: (paper.Path | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const cap = capsules[i];
    if (!cap) continue;
    let region: paper.PathItem = cap.clone({ insert: false }) as paper.PathItem;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const cj = claimed[j];
      if (!cj) continue;
      if (!region.bounds.intersects(cj.bounds)) continue;
      const sub = region.subtract(cj, { insert: false });
      region.remove();
      region = sub;
    }
    regions[i] = largestComponent(region);
  }

  // Commit regions, replacing each primitive's clippedPath.
  for (let i = 0; i < n; i++) {
    const region = regions[i];
    if (!region || region.segments.length < 3) {
      region?.remove();
      continue;
    }
    fitted.primitives[i].clippedPath?.remove();
    fitted.primitives[i].clippedPath = region;
  }

  // Tag boundary curves by cross-referencing mirrored straight segments.
  tagAllBoundaries(fitted, opts.vertexSnapTolerance);

  // Clean up intermediates.
  for (const p of cellPaths.values()) p.remove();
  for (const c of capsules) c?.remove();
  for (const c of claimed) c?.remove();
}

/** Returns the largest-area connected component of a boolean result as an
 * owned, un-inserted paper.Path; consumes the input item. */
function largestComponent(item: paper.PathItem | null): paper.Path | null {
  if (!item) return null;
  if (item instanceof paper.CompoundPath) {
    let best: paper.Path | null = null;
    let bestArea = 0;
    for (const c of item.children as paper.Path[]) {
      const a = Math.abs(c.area);
      if (a > bestArea) {
        bestArea = a;
        best = c;
      }
    }
    const res = best ? (best.clone({ insert: false }) as paper.Path) : null;
    item.remove();
    return res;
  }
  if (item instanceof paper.Path) return item;
  return null;
}

/**
 * Tags every primitive's clippedPath curves. A straight curve is "shared:n" iff
 * primitive n's clippedPath contains the exact reversed straight curve (same
 * snapped endpoints, opposite direction) — which is guaranteed for genuine
 * bisector segments by construction of region_i. Straight curves without a
 * mirror are "outer" (sole-coverage tails / straight capsule edges); non-linear
 * curves are "bezier".
 */
function tagAllBoundaries(
  fitted: FittedMedialAxisGraph,
  snapTol: number,
): void {
  const snap = (v: number) => Math.round(v / snapTol);
  const segKey = (x1: number, y1: number, x2: number, y2: number) =>
    `${snap(x1)},${snap(y1)}|${snap(x2)},${snap(y2)}`;

  // Map every directed straight curve (by snapped endpoints) → owning primitive.
  const owner = new Map<string, number>();
  for (let i = 0; i < fitted.primitives.length; i++) {
    const cp = fitted.primitives[i].clippedPath as paper.Path | undefined;
    if (!cp) continue;
    for (const c of cp.curves) {
      if (!c.isStraight()) continue;
      owner.set(segKey(c.point1.x, c.point1.y, c.point2.x, c.point2.y), i);
    }
  }

  for (let i = 0; i < fitted.primitives.length; i++) {
    const prim = fitted.primitives[i];
    const cp = prim.clippedPath as paper.Path | undefined;
    if (!cp) continue;
    const tags: BoundaryTag[] = [];
    for (const c of cp.curves) {
      if (!c.isStraight()) {
        tags.push({ kind: "bezier" });
        continue;
      }
      const revKey = segKey(c.point2.x, c.point2.y, c.point1.x, c.point1.y);
      const j = owner.get(revKey);
      if (j !== undefined && j !== i) {
        tags.push({ kind: "shared", neighbour: j });
      } else {
        tags.push({ kind: "outer" });
      }
    }
    prim.boundaryTags = tags;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function samplePrimitive(
  fitted: FittedMedialAxisGraph,
  pi: number,
  opts: VoronoiClipOptions,
  out: Sample[],
): void {
  const prim = fitted.primitives[pi];
  if (prim.type === "point") {
    const v = fitted.points[prim.elementIdx];
    out.push({ x: v.x, y: v.y, primIdx: pi });
    return;
  }
  // Edge primitive.
  const edgeIdx = prim.elementIdx;
  const [u, v] = fitted.segments[edgeIdx];
  const pA = fitted.points[u];
  const pB = fitted.points[v];
  const cp = fitted.controlPoints?.[edgeIdx];
  const cp1 = cp?.[0];
  const cp2 = cp?.[1];

  // Estimate arc length with a coarse polyline.
  const arcSamples = 32;
  let len = 0;
  let prev = evalBezier(pA, cp1, cp2, pB, 0);
  for (let k = 1; k <= arcSamples; k++) {
    const pt = evalBezier(pA, cp1, cp2, pB, k / arcSamples);
    len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    prev = pt;
  }
  const N = Math.max(
    opts.minSamplesPerEdge,
    Math.ceil(len * opts.samplesPerEmUnit),
  );
  // Sample at interior parameter values, avoiding endpoints (which are
  // shared between adjacent edges and would create co-located samples
  // with ambiguous tagging).
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const pt = evalBezier(pA, cp1, cp2, pB, t);
    out.push({ x: pt.x, y: pt.y, primIdx: pi });
  }
}

function buildPerPrimitiveCellPaths(
  samples: Sample[],
  cellPolys: ([number, number][] | null)[],
  nPrimitives: number,
): Map<number, paper.PathItem> {
  // Group sample indices by their owning primitive.
  const byPrim: number[][] = Array.from({ length: nPrimitives }, () => []);
  for (let i = 0; i < samples.length; i++) {
    byPrim[samples[i].primIdx].push(i);
  }

  const result = new Map<number, paper.PathItem>();
  for (let pi = 0; pi < nPrimitives; pi++) {
    const indices = byPrim[pi];
    let merged: paper.PathItem | null = null;
    for (const si of indices) {
      const poly = cellPolys[si];
      if (!poly || poly.length < 3) continue;
      // d3-delaunay closes the polygon by repeating the first vertex; drop it.
      const segs: paper.Point[] = [];
      const last = poly.length - 1;
      const closesItself =
        poly[0][0] === poly[last][0] && poly[0][1] === poly[last][1];
      const stop = closesItself ? last : poly.length;
      for (let k = 0; k < stop; k++) {
        segs.push(new paper.Point(poly[k][0], poly[k][1]));
      }
      const cellP = new paper.Path({
        segments: segs,
        closed: true,
        insert: false,
      });
      if (merged === null) {
        merged = cellP;
      } else {
        const united: paper.PathItem = merged.unite(cellP, { insert: false });
        merged.remove();
        cellP.remove();
        merged = united;
      }
    }
    if (merged) result.set(pi, merged);
  }
  return result;
}
