/**
 * Test: stateless skeletal-warp deformation (app/pathUtils/skeleton/deform.ts)
 *
 * For each test glyph:
 *   1) run the skeleton pipeline → FittedMedialAxisGraph (S + capsules C)
 *   2) identity warp deform(S, S, C) must reproduce the original primitives
 *      (anchors + handles bit-close)
 *   3) a random edit S' (move one random skeleton vertex in a random direction
 *      by 10–100px, seeded per-glyph) must keep shared boundaries coincident
 *      (no gap/overlap) and produce a closed, non-degenerate bezier outline;
 *      the original vs deformed outline is rendered to test_outputs/deform_*.png
 */
import {
  Circle as FabricCircle,
  Line as FabricLine,
  Path as FabricPath,
  StaticCanvas,
} from "fabric/node";
import * as fs from "node:fs";
import paper from "paper";

import {
  BoneLink,
  DeformedSkeleton,
  applyDeform,
  boneLinks,
  buildDeformRig,
  deformOutline,
  unionDeformedPrimitives,
  warpedCurveSamplePoints,
} from "@/app/pathUtils/skeleton/deform";
import { FittedMedialAxisGraph } from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { skeletonizePath } from "@/app/pathUtils/skeleton/skeleton";

import {
  TEST_PATHS,
  analyzeSharedBoundaries,
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

/** Deterministic PRNG (mulberry32) so the "random" edit is reproducible. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(label: string): number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

type RandomEdit = {
  skeleton: DeformedSkeleton;
  movedIdx: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

/** Move one random skeleton vertex in a random direction by 10–100 px. */
function randomEdit(
  fitted: FittedMedialAxisGraph,
  rng: () => number,
): RandomEdit {
  const points = fitted.points.map((p) => ({ x: p.x, y: p.y }));
  const controlPoints = fitted.controlPoints?.map(
    ([c1, c2]) => [{ x: c1.x, y: c1.y }, { x: c2.x, y: c2.y }] as [typeof c1, typeof c2],
  );
  const movedIdx = Math.floor(rng() * points.length);
  const angle = rng() * 2 * Math.PI;
  const dist = 10 + rng() * 90;
  const from = { ...points[movedIdx] };
  const to = {
    x: from.x + Math.cos(angle) * dist,
    y: from.y + Math.sin(angle) * dist,
  };
  points[movedIdx] = to;
  return { skeleton: { points, controlPoints }, movedIdx, from, to };
}

// --- Visualization --------------------------------------------------------

function svgFromPathItem(
  item: paper.PathItem,
  tx: (x: number) => number,
  ty: (y: number) => number,
): string {
  // Build SVG manually so we can apply the viewport transform per anchor.
  const clone = item.clone({ insert: false });
  const rings =
    clone instanceof paper.CompoundPath
      ? (clone.children as paper.Path[])
      : [clone as paper.Path];
  const cmds: string[] = [];
  for (const ring of rings) {
    const segs = ring.segments;
    if (segs.length === 0) continue;
    cmds.push(`M ${tx(segs[0].point.x)} ${ty(segs[0].point.y)}`);
    for (let i = 1; i <= segs.length; i++) {
      const prev = segs[i - 1];
      const cur = segs[i % segs.length];
      if (i === segs.length && !ring.closed) break;
      const c1 = prev.point.add(prev.handleOut);
      const c2 = cur.point.add(cur.handleIn);
      cmds.push(
        `C ${tx(c1.x)} ${ty(c1.y)} ${tx(c2.x)} ${ty(c2.y)} ${tx(cur.point.x)} ${ty(cur.point.y)}`,
      );
    }
    if (ring.closed) cmds.push("Z");
  }
  clone.remove();
  return cmds.join(" ");
}

function edgePathData(
  pts: { x: number; y: number }[],
  cps: [{ x: number; y: number }, { x: number; y: number }][] | undefined,
  segments: [number, number][],
  tx: (x: number) => number,
  ty: (y: number) => number,
): string {
  const cmds: string[] = [];
  for (let e = 0; e < segments.length; e++) {
    const [u, v] = segments[e];
    const a = pts[u], b = pts[v];
    const cp = cps?.[e];
    cmds.push(`M ${tx(a.x)} ${ty(a.y)}`);
    if (cp) {
      cmds.push(
        `C ${tx(cp[0].x)} ${ty(cp[0].y)} ${tx(cp[1].x)} ${ty(cp[1].y)} ${tx(b.x)} ${ty(b.y)}`,
      );
    } else {
      cmds.push(`L ${tx(b.x)} ${ty(b.y)}`);
    }
  }
  return cmds.join(" ");
}

/** Draw a bone control net: anchor dots at vertices + control-point dots with
 *  dashed handle lines (vertex u → cp1, vertex v → cp2 per edge). */
function drawBoneControlNet(
  canvas: StaticCanvas,
  pts: { x: number; y: number }[],
  cps: [{ x: number; y: number }, { x: number; y: number }][] | undefined,
  segments: [number, number][],
  tx: (x: number) => number,
  ty: (y: number) => number,
  color: string,
): void {
  if (cps) {
    for (let e = 0; e < segments.length; e++) {
      const cp = cps[e];
      if (!cp) continue;
      const [u, v] = segments[e];
      for (const [anchor, c] of [
        [pts[u], cp[0]] as const,
        [pts[v], cp[1]] as const,
      ]) {
        canvas.add(
          new FabricLine([tx(anchor.x), ty(anchor.y), tx(c.x), ty(c.y)], {
            stroke: color,
            strokeWidth: 1,
            strokeDashArray: [3, 2],
            selectable: false,
          }),
        );
        canvas.add(
          new FabricCircle({
            left: tx(c.x), top: ty(c.y), radius: 2,
            fill: color,
            originX: "center", originY: "center", selectable: false,
          }),
        );
      }
    }
  }
  for (const p of pts) {
    canvas.add(
      new FabricCircle({
        left: tx(p.x), top: ty(p.y), radius: 2.5,
        fill: color,
        originX: "center", originY: "center", selectable: false,
      }),
    );
  }
}

/** One filled+stroked deformed shape to overlay (the union'd outline, or one
 *  per warped capsule). */
type DeformLayer = {
  item: paper.PathItem;
  fill: string;
  stroke: string;
  strokeWidth: number;
};

/** Render original (faint) vs deformed shape(s) + skeleton + the move.
 *  `layers` are the deformed shapes to draw (a single union'd outline, or one
 *  per warped capsule). `links` connects each original (non-shared) outline
 *  anchor to its bone foot point — drawn on the grey pre-deformation shape.
 *  `suffix` distinguishes the output filename. */
function renderDeform(
  label: string,
  fitted: FittedMedialAxisGraph,
  edit: RandomEdit,
  original: paper.PathItem,
  layers: DeformLayer[],
  links: BoneLink[],
  suffix: string,
): void {
  const SIZE = 1000;
  const PAD = 60;

  // Viewport fits the original and every deformed shape so nothing is clipped.
  let bb = original.bounds;
  for (const l of layers) bb = bb.unite(l.item.bounds);
  const scl = Math.min((SIZE - 2 * PAD) / bb.width, (SIZE - 2 * PAD) / bb.height);
  const ox = PAD + (SIZE - 2 * PAD - bb.width * scl) / 2 - bb.x * scl;
  const oy = PAD + (SIZE - 2 * PAD - bb.height * scl) / 2 - bb.y * scl;
  const tx = (x: number) => x * scl + ox;
  const ty = (y: number) => y * scl + oy;

  const dpi = 2;
  const canvas = new StaticCanvas("null", {
    width: SIZE * dpi,
    height: SIZE * dpi,
    backgroundColor: "white",
  });
  canvas.setZoom(dpi);

  // Original outline — faint gray fill.
  const od = svgFromPathItem(original, tx, ty);
  if (od)
    canvas.add(
      new FabricPath(od, {
        fill: "rgba(0,0,0,0.08)",
        stroke: "rgba(0,0,0,0.35)",
        strokeWidth: 1,
        fillRule: "evenodd",
        selectable: false,
      }),
    );

  // Anchor → bone foot-point correspondence on the pre-deformation shape
  // (non-shared anchors only). Thin grey spokes from the medial axis outward.
  for (const { anchor, bone } of links) {
    canvas.add(
      new FabricLine([tx(bone.x), ty(bone.y), tx(anchor.x), ty(anchor.y)], {
        stroke: "rgba(0,0,0,0.28)",
        strokeWidth: 0.5,
        selectable: false,
      }),
    );
  }

  // Deformed shape(s): the union'd outline, or one per warped capsule.
  for (const layer of layers) {
    const dd = svgFromPathItem(layer.item, tx, ty);
    if (dd)
      canvas.add(
        new FabricPath(dd, {
          fill: layer.fill,
          stroke: layer.stroke,
          strokeWidth: layer.strokeWidth,
          fillRule: "evenodd",
          selectable: false,
        }),
      );
  }

  // Original skeleton (faint) and deformed skeleton (orange).
  canvas.add(
    new FabricPath(
      edgePathData(fitted.points, fitted.controlPoints, fitted.segments, tx, ty),
      { fill: "", stroke: "rgba(0,0,0,0.25)", strokeWidth: 1, selectable: false },
    ),
  );
  canvas.add(
    new FabricPath(
      edgePathData(
        edit.skeleton.points,
        edit.skeleton.controlPoints,
        fitted.segments,
        tx,
        ty,
      ),
      { fill: "", stroke: "rgba(230,130,0,0.95)", strokeWidth: 1.5, selectable: false },
    ),
  );

  // Bone anchors + handles for the deformed skeleton (orange control net).
  drawBoneControlNet(
    canvas,
    edit.skeleton.points,
    edit.skeleton.controlPoints,
    fitted.segments,
    tx,
    ty,
    "rgba(230,130,0,0.9)",
  );

  // The moved vertex: from (hollow) → to (filled) with a connecting line.
  canvas.add(
    new FabricLine([tx(edit.from.x), ty(edit.from.y), tx(edit.to.x), ty(edit.to.y)], {
      stroke: "rgba(220,30,30,0.9)",
      strokeWidth: 1.5,
      selectable: false,
    }),
  );
  canvas.add(
    new FabricCircle({
      left: tx(edit.from.x), top: ty(edit.from.y), radius: 4,
      fill: "", stroke: "rgba(0,0,0,0.5)", strokeWidth: 1.5,
      originX: "center", originY: "center", selectable: false,
    }),
  );
  canvas.add(
    new FabricCircle({
      left: tx(edit.to.x), top: ty(edit.to.y), radius: 4,
      fill: "rgba(220,30,30,0.95)",
      originX: "center", originY: "center", selectable: false,
    }),
  );

  // Deformed anchors (green) + control points (purple), with a dashed handle
  // line from each anchor to its in/out control point — across every layer.
  for (const layer of layers) {
    const dRings =
      layer.item instanceof paper.CompoundPath
        ? (layer.item.children as paper.Path[])
        : [layer.item as paper.Path];
    for (const ring of dRings) {
      for (const seg of ring.segments) {
        const p = seg.point;
        for (const h of [seg.handleIn, seg.handleOut]) {
          if (Math.hypot(h.x, h.y) < 1e-9) continue; // straight side — no handle
          const cx = p.x + h.x, cy = p.y + h.y;
          canvas.add(
            new FabricLine([tx(p.x), ty(p.y), tx(cx), ty(cy)], {
              stroke: "rgba(150,40,200,0.7)",
              strokeWidth: 1,
              strokeDashArray: [3, 2],
              selectable: false,
            }),
          );
          canvas.add(
            new FabricCircle({
              left: tx(cx), top: ty(cy), radius: 2,
              fill: "rgba(150,40,200,0.95)",
              originX: "center", originY: "center", selectable: false,
            }),
          );
        }
        canvas.add(
          new FabricCircle({
            left: tx(p.x), top: ty(p.y), radius: 2.5,
            fill: "rgba(20,150,60,0.95)",
            originX: "center", originY: "center", selectable: false,
          }),
        );
      }
    }
  }

  canvas.renderAll();
  const safeName = label.replace(/\[/g, "_").replace(/\]/g, "");
  const outPath = `test_outputs/deform_${safeName}${suffix}.png`;
  type NodeCanvas = { toBuffer(type: string): Buffer };
  const buf = (canvas as unknown as { getNodeCanvas(): NodeCanvas })
    .getNodeCanvas()
    .toBuffer("image/png");
  fs.writeFileSync(outPath, buf);
  console.log(`  → saved ${outPath}`);
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
      fitted = skeletonizePath(path);
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

    // --- 2. Random deformation: move one skeleton vertex 10–100px. ---
    // Seeded per-glyph so the "random" move is reproducible across runs.
    const rng = mulberry32(hashSeed(label));
    const edit = randomEdit(fitted, rng);
    const moveDist = Math.hypot(edit.to.x - edit.from.x, edit.to.y - edit.from.y);

    const baseGap = analyzeSharedBoundaries(fitted.primitives).maxGap;
    const warped = applyDeform(rig, edit.skeleton);
    const editGap = analyzeSharedBoundaries(warped).maxGap;
    check(
      "shared boundaries coincident on original (≤1e-6)",
      baseGap <= 1e-6,
      `${baseGap.toExponential(2)}`,
    );
    check(
      "shared boundaries stay coincident after deform (≤1e-6)",
      editGap <= 1e-6,
      `moved v${edit.movedIdx} by ${moveDist.toFixed(0)}px → gap ${editGap.toExponential(2)}`,
    );

    // The deformed outline must track the *true* per-point warp of the original
    // boundary (not a stale 4-control-point cubic): every true warp sample lies
    // within tolerance of the emitted deformed curve.
    const truePts = warpedCurveSamplePoints(rig, edit.skeleton);
    let trackErr = 0;
    for (let i = 0; i < warped.length; i++) {
      const cp = warped[i].clippedPath;
      if (!cp) continue;
      const subPaths =
        cp instanceof paper.CompoundPath
          ? (cp.children as paper.Path[])
          : [cp as paper.Path];
      for (const p of truePts[i]) {
        const q = new paper.Point(p.x, p.y);
        let near = Infinity;
        for (const sp of subPaths) {
          const np = sp.getNearestPoint(q);
          if (np) near = Math.min(near, np.getDistance(q));
        }
        if (near !== Infinity) trackErr = Math.max(trackErr, near);
      }
    }
    check(
      "deformed outline tracks the true warp (≤2px)",
      trackErr <= 2.0,
      `max ${trackErr.toFixed(3)}px`,
    );

    // Latency of the deformation under the random edit: the full stateless
    // deform() (rig rebuilt) vs. the cached apply+union (interactive per-frame
    // cost), averaged over N runs.
    const N = 20;
    const tFull = performance.now();
    for (let it = 0; it < N; it++) deformOutline(fitted, edit.skeleton)?.remove();
    const fullMs = (performance.now() - tFull) / N;
    const tApply = performance.now();
    for (let it = 0; it < N; it++) {
      unionDeformedPrimitives(applyDeform(rig, edit.skeleton))?.remove();
    }
    const applyMs = (performance.now() - tApply) / N;
    console.log(
      `  ⏱  deform() ${fullMs.toFixed(2)}ms (rig+apply+union) | ` +
        `apply+union ${applyMs.toFixed(2)}ms (cached rig), avg of ${N}`,
    );

    // --- 3. Faithful bezier outline + visualization. ---
    const outline = deformOutline(fitted, edit.skeleton);
    check("deformed outline produced", outline !== null, "");
    if (outline) {
      const rings =
        outline instanceof paper.CompoundPath
          ? (outline.children as paper.Path[])
          : [outline as paper.Path];
      const area = Math.abs(rings.reduce((s, c) => s + c.area, 0));
      check("deformed outline has non-trivial area", area > 1, `area ${area.toFixed(0)}`);
      let hasCurve = false;
      for (const r of rings) for (const c of r.curves) if (!c.isStraight()) { hasCurve = true; break; }
      check("deformed outline is bezier (has curves)", hasCurve, "");

      const original = unionDeformedPrimitives(fitted.primitives);
      if (original) {
        const links = boneLinks(rig);
        // Viz 1: the union'd deformed outline (solid blue).
        renderDeform(
          label,
          fitted,
          edit,
          original,
          [{ item: outline, fill: "rgba(40,110,210,0.18)", stroke: "rgba(40,110,210,0.95)", strokeWidth: 2 }],
          links,
          "",
        );
        // Viz 2: each warped capsule pre-union, one hue per edge (test5 scheme;
        // vertex disks in red).
        const nSegs = Math.max(1, fitted.segments.length);
        const hue = (i: number) => Math.round((i * 360) / nSegs);
        const capLayers: DeformLayer[] = [];
        for (const prim of warped) {
          if (!prim.clippedPath) continue;
          capLayers.push(
            prim.type === "edge"
              ? {
                  item: prim.clippedPath,
                  fill: `hsla(${hue(prim.elementIdx)}, 70%, 60%, 0.18)`,
                  stroke: `hsl(${hue(prim.elementIdx)}, 70%, 35%)`,
                  strokeWidth: 1.5,
                }
              : {
                  item: prim.clippedPath,
                  fill: "rgba(255,100,100,0.5)",
                  stroke: "rgba(255,0,0,0.95)",
                  strokeWidth: 2,
                },
          );
        }
        renderDeform(label, fitted, edit, original, capLayers, links, "_capsules");
        original.remove();
      }
      outline.remove();
    }
  }
}

finish();
