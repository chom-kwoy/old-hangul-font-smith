/**
 * Test: computeMedialSkeletonPoints
 *
 * Checks that the global optimization produces a sparse set of points on M,
 * all lying inside the shape, with reasonable count and timing.
 */
import paper from "paper";

import { nearestDistFlatBoundary } from "@/app/pathUtils/flatBoundary";
import { extractMedialAxis } from "@/app/pathUtils/skeleton/medialAxis";
import { computeMedialSkeletonPoints } from "@/app/pathUtils/skeleton/medialSkeletonPoints";
import {
  check,
  checkApprox,
  finish,
  getFlatBoundary,
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
    suite(`computeMedialSkeletonPoints — ${label}`);

    const axis = extractMedialAxis(path);
    const flatBoundary = getFlatBoundary(path);

    let seeds: paper.Point[] = [];
    const { ms } = measure("optimization", () => {
      seeds = computeMedialSkeletonPoints(path, axis);
    });

    check("completes in < 20000ms", ms < 20000, `${ms}ms`);
    check("returns at least 1 seed", seeds.length >= 1, `${seeds.length} seeds`);

    // All seeds must lie (approximately) inside the shape
    const outsideCount = seeds.filter(
      (p) => !path.contains(p) && nearestDistFlatBoundary(p.x, p.y, flatBoundary) > 5,
    ).length;
    check("all seeds inside shape", outsideCount === 0, `${outsideCount} outside`);

    // Seeds should be spread out — no two closer than 5 units
    let tooClose = 0;
    for (let i = 0; i < seeds.length; i++)
      for (let j = i + 1; j < seeds.length; j++)
        if (seeds[i].getDistance(seeds[j]) < 5) tooClose++;
    check("no duplicate seeds", tooClose === 0, `${tooClose} pairs too close`);

    // Seed count should be reasonable (not degenerate, not exploding)
    checkApprox("seed count is reasonable", seeds.length, 1, 50);

    // Coverage: fraction of boundary samples that are within 3× inscribed radius of nearest seed
    const samples = getBoundarySamples(path);
    let covered = 0;
    for (const s of samples) {
      let minDist = Infinity, bestSeed = seeds[0];
      for (const seed of seeds) {
        const d = s.getDistance(seed);
        if (d < minDist) { minDist = d; bestSeed = seed; }
      }
      const r = nearestDistFlatBoundary(bestSeed.x, bestSeed.y, flatBoundary);
      if (minDist <= r * 3.0) covered++;
    }
    const cov = covered / samples.length;
    check("coverage ≥ 70%", cov >= 0.7, `${(cov * 100).toFixed(1)}%`);
  }
}

finish();
