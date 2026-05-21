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
  Text as FabricText,
} from "fabric/node";
import paper from "paper";

import {
  FlatBoundary,
  nearestDistFlatBoundary,
} from "@/app/pathUtils/flatBoundary";
import {
  FittedMedialAxisGraph,
  localPrimitiveFitting,
} from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import {
  MedialAxisGraph,
  extractMedialAxis,
} from "@/app/pathUtils/skeleton/medialAxis";
import { constructMedialSkeleton } from "@/app/pathUtils/skeleton/medialSkeleton";
import {
  SkeletonIterCallback,
  computeMedialSkeletonPoints,
} from "@/app/pathUtils/skeleton/medialSkeletonPoints";
import {
  check,
  coverageFraction,
  finish,
  getFlatBoundary,
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
        left: tx(pt.x),
        top: ty(pt.y),
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
// Per-iteration visualiser
// ---------------------------------------------------------------------------

function renderIteration(
  path: paper.CompoundPath,
  medialAxis: MedialAxisGraph,
  flatBoundary: FlatBoundary,
  V: paper.Point[],
  cov: number,
  covGain: number,
  adding: number,
  iter: number,
  label: string,
): void {
  const SIZE = 1000;
  const PAD = 55; // extra top padding for text

  const bb = path.bounds;
  const scl = Math.min(
    (SIZE - PAD - 20) / bb.width,
    (SIZE - PAD - 20) / bb.height,
  );
  const ox = 10 + (SIZE - 20 - bb.width * scl) / 2 - bb.x * scl;
  const oy = PAD + (SIZE - PAD - 20 - bb.height * scl) / 2 - bb.y * scl;
  const tx = (x: number) => x * scl + ox;
  const ty = (y: number) => y * scl + oy;
  const ts = (s: number) => s * scl;

  const canvas = new StaticCanvas("null", {
    width: SIZE,
    height: SIZE,
    backgroundColor: "white",
  });

  // --- Text banner ---
  const iterLabel = iter === 12 /* MAX_OUTER */ ? "final" : `iter ${iter}`;
  const gainStr = iter === 0 ? "" : `  gain ${covGain >= 0 ? "+" : ""}${(covGain * 100).toFixed(1)}%`;
  const actionStr = adding > 0 ? `  → adding ${adding} seed(s)` : `  → stopping`;
  const banner = `${iterLabel}  |  seeds=${V.length}  |  cov=${(cov * 100).toFixed(1)}%${gainStr}${actionStr}`;
  canvas.add(
    new FabricText(banner, {
      left: 8,
      top: 8,
      fontSize: 14,
      fontFamily: "monospace",
      fill: "rgba(20,20,20,0.92)",
      selectable: false,
    }),
  );

  // --- Path outline ---
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
          stroke: "rgba(0,0,0,0.55)",
          strokeWidth: 1.5,
          selectable: false,
        }),
      );
    }
  }

  // --- Medial axis (thin grey) ---
  for (const [i1, i2] of medialAxis.segments) {
    const p1 = medialAxis.points[i1];
    const p2 = medialAxis.points[i2];
    canvas.add(
      new FabricLine([tx(p1.x), ty(p1.y), tx(p2.x), ty(p2.y)], {
        stroke: "rgba(160,160,160,0.35)",
        strokeWidth: 0.5,
        selectable: false,
      }),
    );
  }

  // --- Inscribed-radius balls for each seed ---
  const nSeeds = Math.max(1, V.length);
  for (let i = 0; i < V.length; i++) {
    const p = V[i];
    const r = nearestDistFlatBoundary(p.x, p.y, flatBoundary);
    const hue = Math.round((i * 360) / nSeeds);
    const sr = ts(r);
    canvas.add(
      new FabricCircle({
        left: tx(p.x),
        top: ty(p.y),
        radius: sr,
        fill: `hsla(${hue},70%,60%,0.12)`,
        stroke: `hsl(${hue},70%,40%)`,
        strokeWidth: 0.8,
        selectable: false,
      }),
    );
  }

  // --- Seed centre dots ---
  for (let i = 0; i < V.length; i++) {
    const p = V[i];
    const hue = Math.round((i * 360) / nSeeds);
    canvas.add(
      new FabricCircle({
        left: tx(p.x),
        top: ty(p.y),
        radius: 4,
        fill: `hsl(${hue},70%,28%)`,
        selectable: false,
      }),
    );
  }

  canvas.renderAll();

  const safeName = label.replace(/\[/g, "_").replace(/\]/g, "");
  const iterStr = String(iter).padStart(2, "0");
  const outPath = `test_outputs/skeletonize_${safeName}_iter${iterStr}.png`;
  type NodeCanvas = { toBuffer(type: string): Buffer };
  const buf = (canvas as unknown as { getNodeCanvas(): NodeCanvas })
    .getNodeCanvas()
    .toBuffer("image/png");
  fs.writeFileSync(outPath, buf);
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
    const flatBoundary = getFlatBoundary(path);
    const samples = getBoundarySamples(path);

    const iterCallback: SkeletonIterCallback = (iter, V, cov, covGain, adding) => {
      renderIteration(path, axis, flatBoundary, V, cov, covGain, adding, iter, label);
    };

    let fitted: FittedMedialAxisGraph | null = null;
    let error: unknown = null;
    const t0 = Date.now();
    try {
      const seeds = computeMedialSkeletonPoints(path, axis, 3.0, false, iterCallback);
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
      const nVerts = fitted.points.length;
      const nEdges = fitted.segments.length;
      const cov = coverageFraction(samples, fitted.primitives);
      console.log(`  📐 ${nVerts} vertices, ${nEdges} edges`);
      check("final coverage ≥ 98%", cov >= 0.98, `${(cov * 100).toFixed(1)}%`);
      check("vertex count ≤ 25", nVerts <= 25, `${nVerts} vertices`);
      check(
        "has primitives",
        fitted.primitives.length > 0,
        `${fitted.primitives.length} prims`,
      );

      // Worst centrality ratio: min over all edges of
      //   (closest boundary distance from any point on the edge segment)
      //   / (mean r of that edge's fitted primitive)
      // Ratio = 1 means perfectly centered; lower = closer to boundary.
      let worstRatio = Infinity;
      let worstEdgeIdx = -1;
      for (let i = 0; i < fitted.segments.length; i++) {
        const [u, v] = fitted.segments[i];
        const pu = fitted.points[u];
        const pv = fitted.points[v];
        const prim = fitted.primitives.find(
          (p) => p.type === "edge" && p.elementIdx === i,
        );
        if (!prim || prim.radii.length === 0) continue;
        const meanR =
          prim.radii.reduce((a, b) => a + b, 0) / prim.radii.length;
        if (meanR <= 0) continue;
        let minBoundaryDist = Infinity;
        const N_SAMP = 20;
        for (let k = 0; k <= N_SAMP; k++) {
          const t = k / N_SAMP;
          const x = pu.x + t * (pv.x - pu.x);
          const y = pu.y + t * (pv.y - pu.y);
          minBoundaryDist = Math.min(
            minBoundaryDist,
            nearestDistFlatBoundary(x, y, flatBoundary),
          );
        }
        const ratio = minBoundaryDist / meanR;
        if (ratio < worstRatio) {
          worstRatio = ratio;
          worstEdgeIdx = i;
        }
      }
      if (worstEdgeIdx >= 0) {
        console.log(
          `  🎯 worst centrality ratio: ${worstRatio.toFixed(3)} (edge ${worstEdgeIdx})`,
        );
        check(
          "worst centrality ratio ≥ 0.2",
          worstRatio >= 0.2,
          `${worstRatio.toFixed(3)}`,
        );
      }

      renderSkeletonization(path, fitted, label);
    }
  }
}

finish();
