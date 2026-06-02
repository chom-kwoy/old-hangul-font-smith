/**
 * Test: stateless skeletal-warp deformation (app/pathUtils/skeleton/deform.ts)
 *
 * For each test glyph:
 *   1) run the skeleton pipeline → FittedMedialAxisGraph (S + capsules C)
 *   2) identity warp deform(S, S, C) must reproduce the original primitives
 *      (anchors + handles bit-close) and outline area
 *   3) a sample edit S' (translate an interior vertex, bend an edge's control
 *      points) must keep shared boundaries coincident (no gap/overlap) and
 *      produce a closed, non-degenerate bezier outline
 */
import * as fs from "node:fs";
import paper from "paper";

import {
  DeformedSkeleton,
  applyDeform,
  buildDeformRig,
  deformOutline,
} from "@/app/pathUtils/skeleton/deform";
import { FittedMedialAxisGraph } from "@/app/pathUtils/skeleton/localPrimitiveFitting";

import {
  TEST_PATHS,
  analyzeSharedBoundaries,
  buildFittedGlyph,
  check,
  finish,
  suite,
  svgToCompoundPaths,
} from "./testUtils";

fs.mkdirSync("test_outputs", { recursive: true });

/** Max anchor+handle deviation between two primitives' clippedPaths. */
function maxPathDeviation(a: paper.PathItem, b: paper.PathItem): number {
  const ra = a instanceof paper.CompoundPath ? (a.children as paper.Path[]) : [a as paper.Path];
  const rb = b instanceof paper.CompoundPath ? (b.children as paper.Path[]) : [b as paper.Path];
  if (ra.length !== rb.length) return Infinity;
  let max = 0;
  for (let r = 0; r < ra.length; r++) {
    const sa = ra[r].segments, sb = rb[r].segments;
    if (sa.length !== sb.length) return Infinity;
    for (let i = 0; i < sa.length; i++) {
      max = Math.max(
        max,
        Math.abs(sa[i].point.x - sb[i].point.x),
        Math.abs(sa[i].point.y - sb[i].point.y),
        Math.abs(sa[i].handleIn.x - sb[i].handleIn.x),
        Math.abs(sa[i].handleIn.y - sb[i].handleIn.y),
        Math.abs(sa[i].handleOut.x - sb[i].handleOut.x),
        Math.abs(sa[i].handleOut.y - sb[i].handleOut.y),
      );
    }
  }
  return max;
}

/** Edit the skeleton: translate one interior (degree ≥ 2) vertex by (dx,dy),
 *  and bend the first edge by nudging its control points. Topology unchanged. */
function makeEdit(fitted: FittedMedialAxisGraph): DeformedSkeleton {
  const points = fitted.points.map((p) => ({ x: p.x, y: p.y }));
  const controlPoints = fitted.controlPoints?.map(
    ([c1, c2]) => [{ x: c1.x, y: c1.y }, { x: c2.x, y: c2.y }] as [typeof c1, typeof c2],
  );
  const deg = new Int32Array(fitted.points.length);
  for (const [u, v] of fitted.segments) { deg[u]++; deg[v]++; }
  // Translate the first degree-≥2 vertex (fall back to vertex 0).
  let target = 0;
  for (let i = 0; i < deg.length; i++) if (deg[i] >= 2) { target = i; break; }
  points[target] = { x: points[target].x + 18, y: points[target].y - 12 };
  // Bend edge 0's control points if present.
  if (controlPoints && controlPoints.length > 0) {
    controlPoints[0] = [
      { x: controlPoints[0][0].x + 10, y: controlPoints[0][0].y + 6 },
      { x: controlPoints[0][1].x - 6, y: controlPoints[0][1].y + 10 },
    ];
  }
  return { points, controlPoints };
}

for (const [name, svg] of Object.entries(TEST_PATHS)) {
  const paths = svgToCompoundPaths(svg);
  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi];
    const label = paths.length > 1 ? `${name}[${pi}]` : name;
    suite(`deform — ${label}`);

    let fitted: FittedMedialAxisGraph | null = null;
    let error: unknown = null;
    try {
      fitted = buildFittedGlyph(path);
    } catch (e) {
      error = e;
    }
    check("pipeline builds fitted glyph", error === null, error ? String(error) : "");
    if (!fitted) continue;

    const S: DeformedSkeleton = {
      points: fitted.points,
      controlPoints: fitted.controlPoints,
    };

    // --- 1. Identity warp reproduces the original primitives. ---
    const rig = buildDeformRig(fitted);
    const identity = applyDeform(rig, S);
    let maxDev = 0;
    for (let i = 0; i < identity.length; i++) {
      const orig = fitted.primitives[i].clippedPath;
      const warped = identity[i].clippedPath;
      if (orig && warped) maxDev = Math.max(maxDev, maxPathDeviation(orig, warped));
    }
    check(
      "identity warp reproduces primitives (≤1e-9)",
      maxDev <= 1e-9,
      `max deviation ${maxDev.toExponential(2)}`,
    );

    // --- 2. Shared boundaries coincide before and after a deformation. ---
    const baseGap = analyzeSharedBoundaries(fitted.primitives).maxGap;
    const edit = makeEdit(fitted);
    const warped = applyDeform(rig, edit);
    const editGap = analyzeSharedBoundaries(warped).maxGap;
    check(
      "shared boundaries coincident on original (≤1e-6)",
      baseGap <= 1e-6,
      `${baseGap.toExponential(2)}`,
    );
    check(
      "shared boundaries stay coincident after deform (≤1e-6)",
      editGap <= 1e-6,
      `${editGap.toExponential(2)}`,
    );

    // --- 3. Faithful bezier outline. ---
    const outline = deformOutline(fitted, edit);
    check("deformed outline produced", outline !== null, "");
    if (outline) {
      const area = Math.abs(
        (outline instanceof paper.CompoundPath
          ? (outline.children as paper.Path[]).reduce((s, c) => s + (c as paper.Path).area, 0)
          : (outline as paper.Path).area),
      );
      check("deformed outline has non-trivial area", area > 1, `area ${area.toFixed(0)}`);
      let hasCurve = false;
      const rings = outline instanceof paper.CompoundPath ? (outline.children as paper.Path[]) : [outline as paper.Path];
      for (const r of rings) for (const c of r.curves) if (!c.isStraight()) { hasCurve = true; break; }
      check("deformed outline is bezier (has curves)", hasCurve, "");
    }
  }
}

finish();
