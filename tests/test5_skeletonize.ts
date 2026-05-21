/**
 * Test: Full skeleton pipeline (integration)
 *
 * Runs the complete chain:
 *   extractMedialAxis → computeMedialSkeletonPoints
 *     → constructMedialSkeleton → localPrimitiveFitting
 *
 * Verifies that the pipeline completes without errors and that the
 * fitted primitives achieve reasonable boundary coverage.
 */
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
      // Final primitive union must cover ≥ 50% of boundary samples
      const cov = coverageFraction(samples, fitted.primitives);
      check("final coverage ≥ 50%", cov >= 0.5, `${(cov * 100).toFixed(1)}%`);

      // Sanity: must have produced at least one primitive
      check(
        "has primitives",
        fitted.primitives.length > 0,
        `${fitted.primitives.length} prims`,
      );
    }
  }
}

finish();
