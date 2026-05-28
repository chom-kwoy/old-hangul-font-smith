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
  Path as FabricPath,
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
  rawAxis: MedialAxisGraph,
  fitted: FittedMedialAxisGraph,
  label: string,
  boundarySamples?: paper.Point[],
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

  // --- 3. Raw medial axis (white, on top of primitive fills so it's visible) ---
  for (const [i1, i2] of rawAxis.segments) {
    const p1 = rawAxis.points[i1];
    const p2 = rawAxis.points[i2];
    canvas.add(
      new FabricLine([tx(p1.x), ty(p1.y), tx(p2.x), ty(p2.y)], {
        stroke: "rgba(255,255,255,0.85)",
        strokeWidth: 2.5,
        selectable: false,
      }),
    );
  }

  // --- 4. Skeleton edges (on top of raw axis) ---
  // Draw as cubic Bezier curves when control points are available.
  for (let i = 0; i < fitted.segments.length; i++) {
    const [u, v] = fitted.segments[i];
    const pu = fitted.points[u];
    const pv = fitted.points[v];
    const cp = fitted.controlPoints?.[i];
    if (cp) {
      const [c1, c2] = cp;
      const d = `M ${tx(pu.x)} ${ty(pu.y)} C ${tx(c1.x)} ${ty(c1.y)} ${tx(c2.x)} ${ty(c2.y)} ${tx(pv.x)} ${ty(pv.y)}`;
      canvas.add(
        new FabricPath(d, {
          fill: "",
          stroke: strokeColor(i),
          strokeWidth: 2.5,
          selectable: false,
        }),
      );
    } else {
      canvas.add(
        new FabricLine([tx(pu.x), ty(pu.y), tx(pv.x), ty(pv.y)], {
          stroke: strokeColor(i),
          strokeWidth: 2.5,
          selectable: false,
        }),
      );
    }
  }

  // Edge index labels at Bezier midpoint (t=0.5) of each skeleton edge
  for (let i = 0; i < fitted.segments.length; i++) {
    const [u, v] = fitted.segments[i];
    const pu = fitted.points[u];
    const pv = fitted.points[v];
    const cp = fitted.controlPoints?.[i];
    let mx: number, my: number;
    if (cp) {
      const [c1, c2] = cp;
      // cubic Bezier at t=0.5: (pA + 3*cp1 + 3*cp2 + pB) / 8
      mx = (pu.x + 3*c1.x + 3*c2.x + pv.x) / 8;
      my = (pu.y + 3*c1.y + 3*c2.y + pv.y) / 8;
    } else {
      mx = (pu.x + pv.x) / 2;
      my = (pu.y + pv.y) / 2;
    }
    canvas.add(
      new FabricText(String(i), {
        left: tx(mx),
        top: ty(my),
        fontSize: 13,
        fontFamily: "monospace",
        fill: strokeColor(i),
        stroke: "white",
        strokeWidth: 3,
        paintFirst: "stroke",
        selectable: false,
        originX: "center",
        originY: "center",
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

  // --- Uncovered boundary samples (red dots) ---
  if (boundarySamples) {
    for (const s of boundarySamples) {
      const covered = fitted.primitives.some(prim => {
        const pts = prim.origins.map((o, i) => ({
          x: o.x + prim.directions[i].x * prim.radii[i],
          y: o.y + prim.directions[i].y * prim.radii[i],
        }));
        const N = pts.length;
        let inside = false;
        for (let i = 0, j = N - 1; i < N; j = i++) {
          if (pts[i].y > s.y !== pts[j].y > s.y &&
              s.x < ((pts[j].x - pts[i].x) * (s.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x)
            inside = !inside;
        }
        if (inside) return true;
        for (let i = 0, j = N - 1; i < N; j = i++) {
          const ax = pts[j].x, ay = pts[j].y, bx = pts[i].x, by = pts[i].y;
          const ddx = bx - ax, ddy = by - ay;
          const lenSq = ddx * ddx + ddy * ddy;
          let t = lenSq > 1e-10 ? ((s.x - ax) * ddx + (s.y - ay) * ddy) / lenSq : 0;
          t = Math.max(0, Math.min(1, t));
          if (Math.hypot(s.x - (ax + t * ddx), s.y - (ay + t * ddy)) < 5.0) return true;
        }
        return false;
      });
      if (!covered) {
        canvas.add(new FabricCircle({
          left: tx(s.x), top: ty(s.y),
          radius: 5, fill: "red", selectable: false,
        }));
      }
    }
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

    let totalNmEvals = 0;
    const iterCallback: SkeletonIterCallback = (iter, V, cov, covGain, adding, nmEvals) => {
      totalNmEvals = nmEvals;
      renderIteration(path, axis, flatBoundary, V, cov, covGain, adding, iter, label);
    };

    let fitted: FittedMedialAxisGraph | null = null;
    let error: unknown = null;
    const t0 = Date.now();
    try {
      const seeds = computeMedialSkeletonPoints(path, axis, 3.0, false, iterCallback);
      const skeleton = constructMedialSkeleton(seeds, axis, path, true);
      fitted = localPrimitiveFitting(path, skeleton);
    } catch (e) {
      error = e;
    }
    const ms = Date.now() - t0;
    console.log(`  ⏱  full pipeline: ${ms}ms  (NM evals: ${totalNmEvals})`);

    check("no exceptions", error === null, error ? String(error) : "");
    check("completes in < 20000ms", ms < 20000, `${ms}ms`);

    if (fitted) {
      const nVerts = fitted.points.length;
      const nEdges = fitted.segments.length;
      const cov = coverageFraction(samples, fitted.primitives);
      console.log(`  📐 ${nVerts} vertices, ${nEdges} edges`);
      check("final coverage ≥ 99.5%", cov >= 0.995, `${(cov * 100).toFixed(1)}%`);
      check("vertex count ≤ 25", nVerts <= 25, `${nVerts} vertices`);
      check(
        "has primitives",
        fitted.primitives.length > 0,
        `${fitted.primitives.length} prims`,
      );

      // Evaluate a point on a skeleton edge at parameter t ∈ [0,1].
      // Uses the cubic Bezier if control points are present, otherwise linear.
      function evalEdgeCurve(
        pu: { x: number; y: number }, pv: { x: number; y: number },
        cp: [{ x: number; y: number }, { x: number; y: number }] | undefined,
        t: number,
      ): { x: number; y: number } {
        if (!cp) return { x: pu.x + t * (pv.x - pu.x), y: pu.y + t * (pv.y - pu.y) };
        const u = 1 - t;
        return {
          x: u*u*u*pu.x + 3*u*u*t*cp[0].x + 3*u*t*t*cp[1].x + t*t*t*pv.x,
          y: u*u*u*pu.y + 3*u*u*t*cp[0].y + 3*u*t*t*cp[1].y + t*t*t*pv.y,
        };
      }

      // Worst centrality ratio: min over all edges of
      //   (closest boundary distance from any point on the edge bone)
      //   / (mean r of that edge's fitted primitive)
      // Ratio = 1 means perfectly centered; lower = closer to boundary.
      // Uses the actual Bezier bone (if control points present), not the chord.
      // Tip edges (one endpoint has degree 1) are excluded: stroke tips taper to zero
      // by design, so their cap circles expand backward into the stroke body, inflating
      // meanR well above the actual boundary distances along the bezier.
      const vertexDegree = new Int32Array(fitted.points.length);
      for (const [u, v] of fitted.segments) { vertexDegree[u]++; vertexDegree[v]++; }
      let worstRatio = Infinity;
      let worstEdgeIdx = -1;
      for (let i = 0; i < fitted.segments.length; i++) {
        const [u, v] = fitted.segments[i];
        if (vertexDegree[u] === 1 || vertexDegree[v] === 1) continue; // skip tip edges
        const pu = fitted.points[u];
        const pv = fitted.points[v];
        const cp = fitted.controlPoints?.[i];
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
          const { x, y } = evalEdgeCurve(pu, pv, cp, k / N_SAMP);
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
        check(
          "worst centrality ratio ≥ 0.2",
          worstRatio >= 0.2,
          `${worstRatio.toFixed(3)}`,
        );
      }

      // Check that no skeleton edge bone passes outside the shape boundary.
      // Uses the Bezier bone (if control points present), not the chord.
      {
        const N_SAMP = 20;
        let outsideEdge = -1;
        let outsideT = -1;
        for (let i = 0; i < fitted.segments.length; i++) {
          const [u, v] = fitted.segments[i];
          const pu = fitted.points[u];
          const pv = fitted.points[v];
          const cp = fitted.controlPoints?.[i];
          for (let k = 1; k < N_SAMP; k++) {
            const t = k / N_SAMP;
            const { x, y } = evalEdgeCurve(pu, pv, cp, t);
            if (!path.contains(new paper.Point(x, y))) {
              outsideEdge = i;
              outsideT = t;
              break;
            }
          }
          if (outsideEdge >= 0) break;
        }
        if (outsideEdge >= 0) {
          const [u, v] = fitted.segments[outsideEdge];
          const pu = fitted.points[u];
          const pv = fitted.points[v];
          console.log(
            `  ⚠  skeleton edge ${outsideEdge} exits shape at t=${outsideT.toFixed(2)}: ` +
            `(${pu.x.toFixed(1)},${pu.y.toFixed(1)}) → (${pv.x.toFixed(1)},${pv.y.toFixed(1)})`,
          );
        }
        check(
          "all skeleton edges inside shape",
          outsideEdge < 0,
          outsideEdge >= 0 ? `edge ${outsideEdge} exits at t=${outsideT.toFixed(2)}` : "",
        );
      }

      // Junction spread metric: for every degree-≥3 vertex P, for each arm PA,
      // compute the MAX |sin| to any other arm PB (= best perpendicular partner).
      // Take the min over arms of that max — i.e. "every arm has at least one
      // non-collinear partner."
      //
      // Valid T-junction (two collinear arms + one perpendicular): each arm's
      // best partner is the perpendicular arm → score ≈ 1.0.
      // Valid Y-junction (120° apart): score = sin(120°) ≈ 0.866.
      // Degenerate junction (all arms in a narrow cone): every arm's best partner
      // is still nearly collinear → score ≪ 0.3 → fails.
      {
        const nbrs: number[][] = Array.from({ length: fitted.points.length }, () => []);
        for (const [u, v] of fitted.segments) {
          nbrs[u].push(v);
          nbrs[v].push(u);
        }

        let worstSpread = Infinity;
        let worstSpreadVertex = -1;

        for (let p = 0; p < fitted.points.length; p++) {
          if (nbrs[p].length < 3) continue;

          const pp = fitted.points[p];
          let junctionMin = Infinity;

          for (const a of nbrs[p]) {
            const pa = fitted.points[a];
            const ax = pa.x - pp.x, ay = pa.y - pp.y;
            const armLen = Math.hypot(ax, ay);
            if (armLen < 1e-6) continue;

            // max |sin| from arm PA to any other arm PB
            let maxSine = 0;
            for (const b of nbrs[p]) {
              if (b === a) continue;
              const pb = fitted.points[b];
              const bx = pb.x - pp.x, by = pb.y - pp.y;
              const bLen = Math.hypot(bx, by);
              if (bLen < 1e-6) continue;
              const sine = Math.abs(ax * by - ay * bx) / (armLen * bLen);
              if (sine > maxSine) maxSine = sine;
            }

            if (maxSine < junctionMin) junctionMin = maxSine;
          }

          if (junctionMin < worstSpread) {
            worstSpread = junctionMin;
            worstSpreadVertex = p;
          }
        }

        if (worstSpreadVertex >= 0) {
          console.log(`  junction spread: ${worstSpread.toFixed(3)}  (vertex ${worstSpreadVertex})`);
          check(
            "junction spread ≥ 0.3",
            worstSpread >= 0.3,
            `${worstSpread.toFixed(3)}`,
          );
        }
      }

      renderSkeletonization(path, axis, fitted, label, samples);
    }
  }
}

finish();
