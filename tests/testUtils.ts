/**
 * Shared utilities for skeleton pipeline test scripts.
 */
import { DOMParser } from "@xmldom/xmldom";
import paper from "paper";

import {
  buildFlatBoundary,
  sampleBoundary,
} from "@/app/pathUtils/flatBoundary";
import {
  Primitive,
  primitivePolygon,
} from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import * as testPaths from "@/app/testpage/testPaths";
import { initDrawContexts } from "@/app/utils/init";

initDrawContexts();

// ---------------------------------------------------------------------------
// All named test paths (SVG string → array of CompoundPaths, one per <path>)
// ---------------------------------------------------------------------------

export const TEST_PATHS: Record<string, string> = {
  kiyeok: testPaths.svg_kiyeok,
  nieun_hieuh: testPaths.svg_nieun_hieuh,
  hieuh_t4: testPaths.hieuh_t4,
  nieun_chieuch: testPaths.nieun_chieuch,
  yo_ya_canon: testPaths.yo_ya_canon,
  yo_ya_v2: testPaths.yo_ya_v2,
};

/** Parse an SVG string and return one CompoundPath per <path> element. */
export function svgToCompoundPaths(svg: string): paper.CompoundPath[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const elements = doc.getElementsByTagName("path");
  const result: paper.CompoundPath[] = [];
  for (let i = 0; i < elements.length; i++) {
    const d = elements.item(i)!.getAttribute("d");
    if (d) {
      const cp = new paper.CompoundPath(d);
      cp.closePath();
      result.push(cp);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Simple assertion / reporting helpers
// ---------------------------------------------------------------------------

let _passes = 0;
let _failures = 0;

export function suite(name: string) {
  console.log(`\n━━━ ${name} ━━━`);
}

export function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    _passes++;
    console.log(`  ✓ ${label}${detail ? "  (" + detail + ")" : ""}`);
  } else {
    _failures++;
    console.error(`  ✗ ${label}${detail ? "  (" + detail + ")" : ""}`);
  }
}

export function checkApprox(
  label: string,
  actual: number,
  lo: number,
  hi: number,
) {
  check(
    label,
    actual >= lo && actual <= hi,
    `got ${actual.toFixed(3)}, expected [${lo}, ${hi}]`,
  );
}

export function measure<T>(
  label: string,
  fn: () => T,
): { result: T; ms: number } {
  const t0 = Date.now();
  const result = fn();
  const ms = Date.now() - t0;
  console.log(`  ⏱  ${label}: ${ms}ms`);
  return { result, ms };
}

export function finish() {
  const total = _passes + _failures;
  console.log(
    `\n${_failures === 0 ? "✅" : "❌"} ${_passes}/${total} checks passed` +
      (_failures > 0 ? `  (${_failures} failed)` : ""),
  );
  if (_failures > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// Shared path helpers
// ---------------------------------------------------------------------------

export function getBoundarySamples(path: paper.CompoundPath): paper.Point[] {
  return sampleBoundary(path, { step: 10 }).points;
}

export function getFlatBoundary(path: paper.CompoundPath) {
  return buildFlatBoundary(path);
}

/** Count boundary samples covered by any primitive boundary polygon. */
export function coverageFraction(
  samples: paper.Point[],
  primitives: Primitive[],
  delta = 1.0,
): number {
  let covered = 0;
  for (const s of samples) {
    for (const prim of primitives) {
      if (primCovers(s.x, s.y, prim, delta)) {
        covered++;
        break;
      }
    }
  }
  return covered / samples.length;
}

function primCovers(
  px: number,
  py: number,
  prim: Primitive,
  delta: number,
): boolean {
  const pts = primitivePolygon(prim);
  const N = pts.length;
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    vx[i] = pts[i].x;
    vy[i] = pts[i].y;
  }
  let inside = false;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    if (
      vy[i] > py !== vy[j] > py &&
      px < ((vx[j] - vx[i]) * (py - vy[i])) / (vy[j] - vy[i]) + vx[i]
    )
      inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    const ax = vx[j],
      ay = vy[j],
      bx = vx[i],
      by = vy[i];
    const ddx = bx - ax,
      ddy = by - ay;
    const lenSq = ddx * ddx + ddy * ddy;
    let t = lenSq > 1e-10 ? ((px - ax) * ddx + (py - ay) * ddy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(px - (ax + t * ddx), py - (ay + t * ddy)) < delta)
      return true;
  }
  return false;
}
