/**
 * Test: Full skeleton pipeline (integration) + PNG visualisation
 *
 * Runs the complete chain:
 *   extractMedialAxis → computeMedialSkeletonPoints
 *     → constructMedialSkeleton → localPrimitiveFitting
 *
 * For each path writes test_outputs/skeletonize_<name>.png showing:
 *   1) original path outline (black)
 *   2) skeleton edges (each a distinct hue)
 *   3) fitted primitives (same hue as their edge; vertex disks in grey)
 */
import * as fs from "node:fs";

import {
  Circle as FabricCircle,
  Line as FabricLine,
  Polygon as FabricPolygon,
  Polyline as FabricPolyline,
  StaticCanvas,
} from "fabric/node";
import paper from "paper";

import {
  FittedMedialAxisGraph,
  localPrimitiveFitting,
} from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { extractMedialAxis } from "@/app/pathUtils/skeleton/medialAxis";
import { constructMedialSkeleton } from "@/app/pathUtils/skeleton/medialSkeleton";
import { computeMedialSkeletonPoints } from "@/app/pathUtils/skeleton/medialSkeletonPoints";
import {
  check,
  coverageFraction,
  finish,
  getBoundarySamples,
  suite,
  svgToCompoundPaths,
  TEST_PATHS,
} from "./testUtils";

fs.mkdirSync("test_outputs", { recursive: true });

// ---------------------------------------------------------------------------
// Rendering helper
// ---------------------------------------------------------------------------

function renderSkeletonization(
  path: paper.CompoundPath,
  fitted: FittedMedialAxisGraph,
  label: string,
): void {
  const SIZE = 1000;
  const PAD = 40;

  // Viewport: fit path bounding box into [PAD, SIZE-PAD]² with uniform scale
  const bb = path.bounds;
  const scl = Math.min(
    (SIZE - 2 * PAD) / bb.width,
    (SIZE - 2 * PAD) / bb.height,
  );
  const ox = PAD + (SIZE - 2 * PAD - bb.width * scl) / 2 - bb.x * scl;
  const oy = PAD + (SIZE - 2 * PAD - bb.height * scl) / 2 - bb.y * scl;
  const tx = (x: number) => x * scl + ox;
  const ty = (y: number) => y * scl + oy;

  const canvas = new StaticCanvas("null", {
    width: SIZE,
    height: SIZE,
    backgroundColor: "white",
  });

  // Color helpers — one hue per skeleton segment
  const nSegs = Math.max(1, fitted.segments.length);
  const hue = (i: number) => Math.round((i * 360) / nSegs);
  const strokeColor = (i: number) => `hsl(${hue(i)}, 70%, 35%)`;
  const fillColor = (i: number) => `hsla(${hue(i)}, 70%, 60%, 0.18)`;

  // --- 1. Original path outline (one Polyline per sub-path) ---
  for (const child of path.children as paper.Path[]) {
    const step = Math.max(2, child.length / 300);
    const pts: { x: number; y: number }[] = [];
    for (let d = 0; d <= child.length; d += step) {
      const pt = child.getPointAt(Math.min(d, child.length));
      if (pt) pts.push({ x: tx(pt.x), y: ty(pt.y) });
    }
    if (pts.length > 1) {
      canvas.add(
        new FabricPolyline(pts, {
          fill: "none",
          stroke: "rgba(0,0,0,0.75)",
          strokeWidth: 2,
          selectable: false,
        }),
      );
    }
  }

  // --- 2. Fitted primitives (under edges so edges stay visible) ---
  for (const prim of fitted.primitives) {
    const pts = prim.origins.map((o, i) => ({
      x: tx(o.x + prim.directions[i].x * prim.radii[i]),
      y: ty(o.y + prim.directions[i].y * prim.radii[i]),
    }));

    if (prim.type === "edge") {
      canvas.add(
        new FabricPolygon(pts, {
          fill: fillColor(prim.elementIdx),
          stroke: strokeColor(prim.elementIdx),
          strokeWidth: 1,
          selectable: false,
          objectCaching: false,
        }),
      );
    } else {
      // vertex disk — subtle grey
      canvas.add(
        new FabricPolygon(pts, {
          fill: "rgba(160,160,210,0.10)",
          stroke: "rgba(120,120,180,0.30)",
          strokeWidth: 0.5,
          selectable: false,
          objectCaching: false,
        }),
      );
    }
  }

  // --- 3. Skeleton edges (on top of primitives) ---
  for (let i = 0; i < fitted.segments.length; i++) {
    const [u, v] = fitted.segments[i];
    const pu = fitted.points[u];
    const pv = fitted.points[v];
    canvas.add(
      new FabricLine([tx(pu.x), ty(pu.y), tx(pv.x), ty(pv.y)], {
        stroke: strokeColor(i),
        strokeWidth: 2.5,
        selectable: false,
      }),
    );
  }

  // Skeleton vertices
  for (const pt of fitted.points) {
    canvas.add(
      new FabricCircle({
        left: tx(pt.x) - 3,
        top: ty(pt.y) - 3,
        radius: 3,
        fill: "rgba(30,30,30,0.85)",
        selectable: false,
      }),
    );
  }

  canvas.renderAll();

  const safeName = label.replace(/\[/g, "_").replace(/\]/g, "");
  const outPath = `test_outputs/skeletonize_${safeName}.png`;
  type NodeCanvas = { toBuffer(type: string): Buffer };
  const buf = (canvas as unknown as { getNodeCanvas(): NodeCanvas })
    .getNodeCanvas()
    .toBuffer("image/png");
  fs.writeFileSync(outPath, buf);
  console.log(`  → saved ${outPath}`);
}

// ---------------------------------------------------------------------------
// Test loop
// ---------------------------------------------------------------------------

for (const [name, svg] of Object.entries(TEST_PATHS)) {
  const paths = svgToCompoundPaths(svg);

  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi];
    const label = paths.length > 1 ? `${name}[${pi}]` : name;
    suite(`full pipeline — ${label}`);

    const axis = extractMedialAxis(path);
    const samples = getBoundarySamples(path);

    let fitted: FittedMedialAxisGraph | null = null;
    let error: unknown = null;
    const t0 = Date.now();
    try {
      const seeds = computeMedialSkeletonPoints(path, axis);
      const skeleton = constructMedialSkeleton(seeds, axis, path);
      fitted = localPrimitiveFitting(path, skeleton);
    } catch (e) {
      error = e;
    }
    const ms = Date.now() - t0;
    console.log(`  ⏱  full pipeline: ${ms}ms`);

    check("no exceptions", error === null, error ? String(error) : "");
    check("completes in < 20000ms", ms < 20000, `${ms}ms`);

    if (fitted) {
      const cov = coverageFraction(samples, fitted.primitives);
      check("final coverage ≥ 50%", cov >= 0.5, `${(cov * 100).toFixed(1)}%`);
      check(
        "has primitives",
        fitted.primitives.length > 0,
        `${fitted.primitives.length} prims`,
      );
      renderSkeletonization(path, fitted, label);
    }
  }
}

finish();
