/**
 * Test: localPrimitiveFitting
 *
 * Checks that each skeleton vertex and edge gets a fitted primitive with
 * positive radii, and that the union of primitives covers a reasonable
 * fraction of the shape boundary.
 */
import paper from "paper";

import { localPrimitiveFitting } from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { extractMedialAxis } from "@/app/pathUtils/skeleton/medialAxis";
import { constructMedialSkeleton } from "@/app/pathUtils/skeleton/medialSkeleton";
import {
  check,
  coverageFraction,
  finish,
  getBoundarySamples,
  measure,
  suite,
  svgToCompoundPaths,
  TEST_PATHS,
} from "./testUtils";

for (const [name, svg] of Object.entries(TEST_PATHS)) {
  const paths = svgToCompoundPaths(svg);

  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi];
    const label = paths.length > 1 ? `${name}[${pi}]` : name;
    suite(`localPrimitiveFitting — ${label}`);

    const axis = extractMedialAxis(path);

    // Pick uniformly-spaced seeds from medial axis points
    const nSeeds = Math.min(5, Math.max(2, Math.floor(axis.points.length / 5)));
    const seeds = Array.from({ length: nSeeds }, (_, i) => {
      const idx = Math.floor((i * axis.points.length) / nSeeds);
      return new paper.Point(axis.points[idx]);
    });

    const skeleton = constructMedialSkeleton(seeds, axis, path);

    let fitted: ReturnType<typeof localPrimitiveFitting>;
    const { ms } = measure("fitting", () => {
      fitted = localPrimitiveFitting(path, skeleton);
    });

    check("completes in < 10000ms", ms < 10000, `${ms}ms`);

    // One primitive per isolated vertex (degree 0) + one per edge
    const degree = new Int32Array(skeleton.points.length);
    for (const [a, b] of skeleton.segments) { degree[a]++; degree[b]++; }
    const isolatedVerts = Array.from(degree).filter((d) => d === 0).length;
    const expectedCount = isolatedVerts + skeleton.segments.length;
    check(
      "primitive count = isolated vertices + edges",
      fitted!.primitives.length === expectedCount,
      `got ${fitted!.primitives.length}, expected ${expectedCount}`,
    );

    // All radii must be positive (balloon always inflates)
    const badPrims = fitted!.primitives.filter((p) => p.radii.some((r) => r <= 0));
    check(
      "all radii positive",
      badPrims.length === 0,
      `${badPrims.length} primitives with non-positive radii`,
    );

    // Coverage: union of primitives covers ≥ 50% of boundary samples
    const samples = getBoundarySamples(path);
    const cov = coverageFraction(samples, fitted!.primitives);
    check("coverage ≥ 50%", cov >= 0.5, `${(cov * 100).toFixed(1)}%`);
  }
}

finish();
