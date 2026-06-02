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
import {
  Circle as FabricCircle,
  Line as FabricLine,
  Path as FabricPath,
  Text as FabricText,
  StaticCanvas,
} from "fabric/node";
import * as fs from "node:fs";
import paper from "paper";

import { nearestDistFlatBoundary } from "@/app/pathUtils/flatBoundary";
import { evalBezier } from "@/app/pathUtils/skeleton/bezierFitting";
import {
  FittedMedialAxisGraph,
  primitivePath,
} from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import {
  MedialAxisGraph,
  extractMedialAxis,
} from "@/app/pathUtils/skeleton/medialAxis";
import {
  SkeletonIterCallback,
  coverageAndUncovered,
} from "@/app/pathUtils/skeleton/medialSkeletonPoints";
import { computePrimitiveVoronoiCells } from "@/app/pathUtils/skeleton/voronoiClip";

import {
  TEST_PATHS,
  analyzeSharedBoundaries,
  buildFittedGlyph,
  check,
  coverageFraction,
  finish,
  getBoundarySamples,
  getFlatBoundary,
  suite,
  svgToCompoundPaths,
} from "./testUtils";

fs.mkdirSync("test_outputs", { recursive: true });

// Toggle skeleton simplification via env var: SIMPLIFY=0 (or false/off/no) disables it.
// Default: enabled.
const SIMPLIFY_ENABLED = !/^(0|false|off|no)$/i.test(
  process.env.SIMPLIFY ?? "",
);
console.log(
  `[test5] skeleton simplification: ${SIMPLIFY_ENABLED ? "ENABLED" : "DISABLED"}`,
);

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

  const dpi = 2.5;
  const canvas = new StaticCanvas("null", {
    width: SIZE * dpi,
    height: SIZE * dpi,
    backgroundColor: "white",
  });
  canvas.setZoom(dpi);

  // Color helpers — one hue per skeleton segment
  const nSegs = Math.max(1, fitted.segments.length);
  const hue = (i: number) => Math.round((i * 360) / nSegs);
  const strokeColor = (i: number) => `hsl(${hue(i)}, 70%, 35%)`;
  const fillColor = (i: number) => `hsla(${hue(i)}, 70%, 60%, 0.18)`;

  // --- 1. Original path outline — single compound FabricPath (holes render as holes) ---
  {
    const allCmds: string[] = [];
    for (const child of path.children as paper.Path[]) {
      if (child.segments.length === 0) continue;
      for (let i = 0; i < child.segments.length; i++) {
        const seg = child.segments[i];
        const pt = seg.point;
        if (i === 0) {
          allCmds.push(`M ${tx(pt.x)} ${ty(pt.y)}`);
        } else {
          const prev = child.segments[i - 1];
          const cp1 = prev.point.add(prev.handleOut);
          const cp2 = pt.add(seg.handleIn);
          allCmds.push(
            `C ${tx(cp1.x)} ${ty(cp1.y)} ${tx(cp2.x)} ${ty(cp2.y)} ${tx(pt.x)} ${ty(pt.y)}`,
          );
        }
      }
      if (child.closed) {
        const last = child.segments[child.segments.length - 1];
        const first = child.segments[0];
        const cp1 = last.point.add(last.handleOut);
        const cp2 = first.point.add(first.handleIn);
        allCmds.push(
          `C ${tx(cp1.x)} ${ty(cp1.y)} ${tx(cp2.x)} ${ty(cp2.y)} ${tx(first.point.x)} ${ty(first.point.y)} Z`,
        );
      }
    }
    if (allCmds.length > 0) {
      canvas.add(
        new FabricPath(allCmds.join(" "), {
          fill: "rgba(0,0,0,0.5)",
          fillRule: "evenodd",
          stroke: "rgba(0,0,0,0.75)",
          strokeWidth: 2,
          selectable: false,
        }),
      );
    }
  }

  // --- 2. Fitted primitives (under edges so edges stay visible) ---
  // Render the primitive's bezier path directly (via SVG path data) so curves
  // appear smooth at native quality, not polygon-approximated.
  for (const prim of fitted.primitives) {
    const path = primitivePath(prim);
    // Map path coords into canvas coords: (x,y) → (scl*x + ox, scl*y + oy).
    path.transform(new paper.Matrix(scl, 0, 0, scl, ox, oy));
    const d = path.pathData;
    path.remove();
    if (!d) continue;

    if (prim.type === "edge") {
      canvas.add(
        new FabricPath(d, {
          fill: fillColor(prim.elementIdx),
          stroke: strokeColor(prim.elementIdx),
          strokeWidth: 1,
          selectable: false,
          objectCaching: false,
        }),
      );
    } else {
      // vertex disk (this should only appear for 0-degree vertices)
      canvas.add(
        new FabricPath(d, {
          fill: "rgba(255,100,100,1.0)",
          stroke: "rgba(255,0,0,1.0)",
          strokeWidth: 3,
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
      mx = (pu.x + 3 * c1.x + 3 * c2.x + pv.x) / 8;
      my = (pu.y + 3 * c1.y + 3 * c2.y + pv.y) / 8;
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

  // --- Voronoi cell boundaries overlay (orange) ---
  {
    const computed = computePrimitiveVoronoiCells(fitted, path.bounds);
    if (computed) {
      for (const cell of computed.cellPaths.values()) {
        cell.transform(new paper.Matrix(scl, 0, 0, scl, ox, oy));
        const d = cell.pathData;
        cell.remove();
        if (!d) continue;
        canvas.add(
          new FabricPath(d, {
            fill: "",
            stroke: "rgba(255,140,0,0.9)",
            strokeWidth: 1,
            strokeDashArray: [4, 3],
            selectable: false,
            objectCaching: false,
          }),
        );
      }
    }
  }

  // Skeleton vertices + index labels
  for (let i = 0; i < fitted.points.length; i++) {
    const pt = fitted.points[i];
    canvas.add(
      new FabricCircle({
        left: tx(pt.x),
        top: ty(pt.y),
        radius: 3,
        fill: "rgba(30,30,30,0.85)",
        selectable: false,
      }),
    );
    canvas.add(
      new FabricText(String(i), {
        left: tx(pt.x) + 6,
        top: ty(pt.y) - 6,
        fontSize: 11,
        fontFamily: "monospace",
        fill: "rgba(30,30,30,0.9)",
        stroke: "white",
        strokeWidth: 3,
        paintFirst: "stroke",
        selectable: false,
        originX: "left",
        originY: "bottom",
      }),
    );
  }

  // --- Uncovered boundary samples (red dots) ---
  if (boundarySamples) {
    const { uncovered } = coverageAndUncovered(
      boundarySamples,
      fitted.primitives,
      1.0,
    );
    for (const s of uncovered) {
      canvas.add(
        new FabricCircle({
          left: tx(s.x),
          top: ty(s.y),
          radius: 5,
          fill: "red",
          selectable: false,
        }),
      );
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
    const iterCallback: SkeletonIterCallback = (
      iter,
      V,
      cov,
      covGain,
      adding,
      nmEvals,
    ) => {
      totalNmEvals = nmEvals;
    };

    let fitted: FittedMedialAxisGraph | null = null;
    let error: unknown = null;
    const t0 = Date.now();
    try {
      fitted = buildFittedGlyph(path, {
        simplify: SIMPLIFY_ENABLED,
        onIteration: iterCallback,
      });
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
      check(
        "final coverage ≥ 99.5%",
        cov >= 0.995,
        `${(cov * 100).toFixed(1)}%`,
      );
      check("vertex count ≤ 25", nVerts <= 25, `${nVerts} vertices`);
      check(
        "has primitives",
        fitted.primitives.length > 0,
        `${fitted.primitives.length} prims`,
      );

      // Worst centrality ratio: min over all edges of
      //   (closest boundary distance from any point on the edge bone)
      //   / (mean r of that edge's fitted primitive)
      // Ratio = 1 means perfectly centered; lower = closer to boundary.
      // Uses the actual Bezier bone (if control points present), not the chord.
      // Tip edges (one endpoint has degree 1) are excluded: stroke tips taper to zero
      // by design, so their cap circles expand backward into the stroke body, inflating
      // meanR well above the actual boundary distances along the bezier.
      const vertexDegree = new Int32Array(fitted.points.length);
      for (const [u, v] of fitted.segments) {
        vertexDegree[u]++;
        vertexDegree[v]++;
      }
      // Invariant: every degree-0 vertex must have a point primitive (i.e. it
      // was isolated from the start of localPrimitiveFitting). Any degree-0
      // vertex WITHOUT a point primitive is a leftover orphan from edge removal.
      const hasPointPrim = new Uint8Array(fitted.points.length);
      for (const p of fitted.primitives)
        if (p.type === "point") hasPointPrim[p.elementIdx] = 1;
      let leftoverOrphans = 0;
      for (let i = 0; i < fitted.points.length; i++)
        if (vertexDegree[i] === 0 && !hasPointPrim[i]) leftoverOrphans++;
      check(
        "no leftover orphan vertices (only originally-isolated kept)",
        leftoverOrphans === 0,
        `${leftoverOrphans} orphans`,
      );
      // Invariant: no two segments share the same unordered endpoint pair.
      // Parallel duplicate edges came from simplifier contractions in 3-cycles
      // before the dedup fix.
      const segKeys = new Set<string>();
      let dupEdges = 0;
      for (const [u, v] of fitted.segments) {
        const k = u < v ? `${u}-${v}` : `${v}-${u}`;
        if (segKeys.has(k)) dupEdges++;
        else segKeys.add(k);
      }
      check(
        "no duplicate parallel edges",
        dupEdges === 0,
        `${dupEdges} duplicates`,
      );

      // --- Voronoi-clip invariants ---
      // Build edge-primitive adjacency: two edge primitives are neighbours if
      // their skeleton segments share a vertex.
      const edgePrims = fitted.primitives.filter((p) => p.type === "edge");
      const edgeVerts = (p: (typeof edgePrims)[number]) =>
        fitted.segments[p.elementIdx];
      const shareVertex = (
        a: (typeof edgePrims)[number],
        b: (typeof edgePrims)[number],
      ) => {
        const [a0, a1] = edgeVerts(a);
        const [b0, b1] = edgeVerts(b);
        return a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1;
      };

      // 1. Non-neighbouring primitives must not overlap (positive area).
      let maxNonNbrOverlap = 0;
      for (let a = 0; a < edgePrims.length; a++) {
        for (let b = a + 1; b < edgePrims.length; b++) {
          if (shareVertex(edgePrims[a], edgePrims[b])) continue;
          const pa = primitivePath(edgePrims[a]);
          const pb = primitivePath(edgePrims[b]);
          const inter = pa.intersect(pb, { insert: false });
          maxNonNbrOverlap = Math.max(
            maxNonNbrOverlap,
            Math.abs((inter as paper.Path).area),
          );
          inter.remove();
          pa.remove();
          pb.remove();
        }
      }
      check(
        "non-neighbour primitives don't overlap",
        maxNonNbrOverlap < 1.0,
        `max overlap ${maxNonNbrOverlap.toFixed(3)} em²`,
      );

      // 2. boundaryTags parity: one tag per curve of clippedPath.
      let tagParityOk = true;
      for (const p of fitted.primitives) {
        if (!p.clippedPath || !p.boundaryTags) continue;
        const nCurves = (p.clippedPath as paper.Path).curves.length;
        if (p.boundaryTags.length !== nCurves) tagParityOk = false;
      }
      check("boundaryTags parallel to clippedPath curves", tagParityOk, "");

      // 3. Shared boundary coincidence: every curve tagged shared:n must have a
      // matching reversed-endpoint curve in neighbour n, within 1e-6. Endpoints
      // coincide only to paper.js boolean round-off (~1e-13 short, ~1e-8 long),
      // far below sub-pixel — no hairline is possible at that scale.
      const { unmatchedByEdge } = analyzeSharedBoundaries(fitted.primitives, 1e-6);
      const unmatchedDetail = [...unmatchedByEdge.entries()]
        .map(([edge, n]) => `edge ${edge}: ${n} seg(s)`)
        .join(", ");
      check(
        "shared boundaries coincide between neighbours (≤1e-6)",
        unmatchedByEdge.size === 0,
        unmatchedDetail,
      );

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
        const meanR = prim.radii.reduce((a, b) => a + b, 0) / prim.radii.length;
        if (meanR <= 0) continue;
        let minBoundaryDist = Infinity;
        const N_SAMP = 20;
        for (let k = 0; k <= N_SAMP; k++) {
          const { x, y } = evalBezier(pu, cp?.[0], cp?.[1], pv, k / N_SAMP);
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
            const { x, y } = evalBezier(pu, cp?.[0], cp?.[1], pv, t);
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
          outsideEdge >= 0
            ? `edge ${outsideEdge} exits at t=${outsideT.toFixed(2)}`
            : "",
        );
      }

      // Junction collinearity metric: for every degree-≥3 vertex P, for each
      // arm PA, compute the minimum over all other arms PB of the perpendicular
      // distance from A to the *outward ray* from P through B, divided by |PA|.
      // Using the outward ray (not the full line) means anti-parallel arms — the
      // two bar arms of a valid T-junction — do not register as collinear: when
      // dot(PA, PB) ≤ 0, the foot of the perpendicular falls behind P, so the
      // closest point on the ray is P itself and the ratio is 1.  Only arms that
      // point in the same forward half-plane can yield a small ratio.
      // Low value = some pair of co-directional arms is nearly collinear →
      // potentially redundant junction edge.
      {
        // Build adjacency: vertex → list of neighbour indices
        const nbrs: number[][] = Array.from(
          { length: fitted.points.length },
          () => [],
        );
        for (const [u, v] of fitted.segments) {
          nbrs[u].push(v);
          nbrs[v].push(u);
        }

        let worstJunctionRatio = Infinity;
        let worstJunctionVertex = -1;

        for (let p = 0; p < fitted.points.length; p++) {
          if (nbrs[p].length < 3) continue; // only junctions

          const pp = fitted.points[p];
          let junctionMin = Infinity;

          for (const a of nbrs[p]) {
            const pa = fitted.points[a];
            const ax = pa.x - pp.x,
              ay = pa.y - pp.y;
            const armLen = Math.hypot(ax, ay);
            if (armLen < 1e-6) continue;

            // min ratio over other arms, using outward-ray distance
            let minRatio = Infinity;
            for (const b of nbrs[p]) {
              if (b === a) continue;
              const pb = fitted.points[b];
              const bx = pb.x - pp.x,
                by = pb.y - pp.y;
              const bLen = Math.hypot(bx, by);
              if (bLen < 1e-6) continue;
              const dot = ax * bx + ay * by;
              // If dot ≤ 0, A is in the backward hemisphere of ray PB;
              // closest point on the outward ray is P → distance = armLen → ratio = 1.
              const ratio =
                dot <= 0 ? 1.0 : Math.abs(ax * by - ay * bx) / (bLen * armLen);
              if (ratio < minRatio) minRatio = ratio;
            }

            if (minRatio < junctionMin) junctionMin = minRatio;
          }

          if (junctionMin < worstJunctionRatio) {
            worstJunctionRatio = junctionMin;
            worstJunctionVertex = p;
          }
        }

        if (worstJunctionVertex >= 0) {
          console.log(
            `  junction collinearity: ${worstJunctionRatio.toFixed(3)}  (vertex ${worstJunctionVertex})`,
          );
          if (worstJunctionRatio < 0.3) {
            console.log(
              `  segments: ${fitted.segments.map(([u, v], i) => `${i}:[${u}->${v} (${fitted.points[u].x.toFixed(0)},${fitted.points[u].y.toFixed(0)})→(${fitted.points[v].x.toFixed(0)},${fitted.points[v].y.toFixed(0)})]`).join("  ")}`,
            );
          }
          check(
            "junction collinearity ≥ 0.3",
            worstJunctionRatio >= 0.3,
            `${worstJunctionRatio.toFixed(3)}`,
          );
        }
      }

      renderSkeletonization(path, axis, fitted, label, samples);
    }
  }
}

finish();
