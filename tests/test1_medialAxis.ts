/**
 * Test: extractMedialAxis
 *
 * Checks that the raw medial axis graph is non-empty, connected, and that
 * all its points lie inside the shape.
 */
import paper from "paper";

import { extractMedialAxis } from "@/app/pathUtils/skeleton/medialAxis";
import { check, finish, measure, suite, svgToCompoundPaths, TEST_PATHS } from "./testUtils";

for (const [name, svg] of Object.entries(TEST_PATHS)) {
  const paths = svgToCompoundPaths(svg);

  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi];
    const label = paths.length > 1 ? `${name}[${pi}]` : name;
    suite(`extractMedialAxis — ${label}`);

    let axis: ReturnType<typeof extractMedialAxis>;
    const { ms } = measure("extraction", () => {
      axis = extractMedialAxis(path);
    });

    check("completes in < 2000ms", ms < 2000);
    check("has points", axis!.points.length > 0, `${axis!.points.length} pts`);
    check("has segments", axis!.segments.length > 0, `${axis!.segments.length} segs`);

    // All medial axis points should lie inside the shape
    const outsideCount = axis!.points.filter((p) => !path.contains(new paper.Point(p))).length;
    check(
      "all points inside shape",
      outsideCount === 0,
      `${outsideCount} outside`,
    );

    // Graph should be connected (single CC)
    const adj: number[][] = Array.from({ length: axis!.points.length }, () => []);
    for (const [u, v] of axis!.segments) { adj[u].push(v); adj[v].push(u); }
    const visited = new Set<number>();
    const queue = [0];
    visited.add(0);
    while (queue.length) {
      const node = queue.shift()!;
      for (const nb of adj[node]) if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
    }
    check(
      "graph is connected",
      visited.size === axis!.points.length,
      `${visited.size}/${axis!.points.length} reachable`,
    );

    // No duplicate segments
    const segKeys = new Set(axis!.segments.map(([a, b]) => `${Math.min(a,b)}-${Math.max(a,b)}`));
    check(
      "no duplicate segments",
      segKeys.size === axis!.segments.length,
      `${segKeys.size} unique / ${axis!.segments.length} total`,
    );
  }
}

finish();
