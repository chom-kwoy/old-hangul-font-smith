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
 * Replaces each primitive's `clippedPath` with `clippedPath ∩ V_i`, where
 * V_i is the primitive's Voronoi cell on the plane partitioned by samples
 * drawn from every primitive's geometry.
 *
 * After this runs, adjacent primitives' shared boundary segments are
 * bit-exact identical (paper.js preserves linear-segment endpoint anchors
 * during boolean intersect; the polygon V_i edges feed those endpoints
 * unchanged into both sides' results). Each primitive's `boundaryTags`
 * field is populated with one tag per curve indicating whether that
 * curve is unique bezier, an outer (no-neighbour) polygon edge, or a
 * polygon edge shared with a specific neighbour primitive.
 *
 * Must run after `clipPrimitivesToShape` has populated `clippedPath`.
 */
export function clipPrimitivesToVoronoiCells(
  fitted: FittedMedialAxisGraph,
  bounds: paper.Rectangle,
  options: Partial<VoronoiClipOptions> = {},
): void {
  const opts: VoronoiClipOptions = { ...DEFAULTS, ...options };

  // 1. Sample features.
  const samples: Sample[] = [];
  for (let pi = 0; pi < fitted.primitives.length; pi++) {
    samplePrimitive(fitted, pi, opts, samples);
  }
  if (samples.length < 2) return;

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

  // 3. Collect cell polygons and build a canonical vertex → primitive-set map.
  const cellPolys: ([number, number][] | null)[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    cellPolys[i] = voronoi.cellPolygon(i) as [number, number][] | null;
  }

  const snapKey = (x: number, y: number) =>
    `${Math.round(x / opts.vertexSnapTolerance)},${Math.round(y / opts.vertexSnapTolerance)}`;

  const vertexToPrims = new Map<string, Set<number>>();
  for (let i = 0; i < samples.length; i++) {
    const poly = cellPolys[i];
    if (!poly) continue;
    const primIdx = samples[i].primIdx;
    for (const [x, y] of poly) {
      const key = snapKey(x, y);
      let set = vertexToPrims.get(key);
      if (!set) {
        set = new Set();
        vertexToPrims.set(key, set);
      }
      set.add(primIdx);
    }
  }

  // 4. Build a merged Voronoi-cell paper.Path per primitive.
  const cellPaths = buildPerPrimitiveCellPaths(
    samples,
    cellPolys,
    fitted.primitives.length,
  );

  // 5. Intersect each primitive's clippedPath with its cell path, then tag.
  for (let pi = 0; pi < fitted.primitives.length; pi++) {
    const prim = fitted.primitives[pi];
    if (!prim.clippedPath) continue;
    const cellPath = cellPaths.get(pi);
    if (!cellPath) continue;

    const intersected = prim.clippedPath.intersect(cellPath, {
      insert: false,
    });

    let resultPath: paper.Path | null = null;
    if (intersected instanceof paper.CompoundPath) {
      // Pick the largest connected component.
      const children = intersected.children as paper.Path[];
      let best: paper.Path | null = null;
      let bestArea = 0;
      for (const c of children) {
        const a = Math.abs((c as paper.Path).area);
        if (a > bestArea) {
          bestArea = a;
          best = c as paper.Path;
        }
      }
      if (best) resultPath = best.clone({ insert: false }) as paper.Path;
      intersected.remove();
    } else if (intersected instanceof paper.Path) {
      resultPath = intersected;
    }

    if (!resultPath || resultPath.segments.length < 3) {
      resultPath?.remove();
      continue;
    }

    const tags = classifyCurves(resultPath, vertexToPrims, snapKey, pi);

    prim.clippedPath.remove();
    prim.clippedPath = resultPath;
    prim.boundaryTags = tags;
  }

  // Clean up.
  for (const p of cellPaths.values()) p.remove();
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

function classifyCurves(
  path: paper.Path,
  vertexToPrims: Map<string, Set<number>>,
  snapKey: (x: number, y: number) => string,
  selfPrim: number,
): BoundaryTag[] {
  const tags: BoundaryTag[] = [];
  for (const curve of path.curves) {
    if (!curve.isStraight()) {
      tags.push({ kind: "bezier" });
      continue;
    }
    const k1 = snapKey(curve.point1.x, curve.point1.y);
    const k2 = snapKey(curve.point2.x, curve.point2.y);
    const p1 = vertexToPrims.get(k1);
    const p2 = vertexToPrims.get(k2);
    if (!p1 || !p2) {
      // Linear segment but at least one endpoint isn't a canonical Voronoi
      // vertex — must be a paper.js-introduced linear curve (e.g. very low
      // curvature segment treated as straight). Fall back to "bezier".
      tags.push({ kind: "bezier" });
      continue;
    }
    // Both endpoints are canonical Voronoi vertices. Look for a primitive
    // that touches both vertices and isn't this primitive — that's the
    // neighbour sharing this edge.
    let neighbour = -1;
    for (const a of p1) {
      if (a !== selfPrim && p2.has(a)) {
        neighbour = a;
        break;
      }
    }
    if (neighbour < 0) {
      tags.push({ kind: "outer" });
    } else {
      tags.push({ kind: "shared", neighbour });
    }
  }
  return tags;
}
