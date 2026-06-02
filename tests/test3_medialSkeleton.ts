/**
 * Test: constructMedialSkeleton
 *
 * Verifies BFS single-CC enforcement, multi-interface handling, and
 * pierce-S subdivision: all edge midpoints must lie inside the shape.
 */
import paper from "paper";

import {
  buildFlatBoundary,
  nearestDistFlatBoundary,
} from "@/app/pathUtils/flatBoundary";
import { extractMedialAxis } from "@/app/pathUtils/skeleton/medialAxis";
import { constructMedialSkeleton } from "@/app/pathUtils/skeleton/medialSkeleton";
import {
  check,
  finish,
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
    suite(`constructMedialSkeleton — ${label}`);

    const axis = extractMedialAxis(path);
    const flatBoundary = buildFlatBoundary(path);

    // Pick uniformly-spaced seeds from medial axis points
    const nSeeds = Math.min(5, Math.max(2, Math.floor(axis.points.length / 5)));
    const seeds = Array.from({ length: nSeeds }, (_, i) => {
      const idx = Math.floor((i * axis.points.length) / nSeeds);
      return new paper.Point(axis.points[idx]);
    });

    let skeleton: ReturnType<typeof constructMedialSkeleton>;
    const { ms } = measure("construction", () => {
      skeleton = constructMedialSkeleton(seeds, axis, path);
    });

    check("completes in < 5000ms", ms < 5000, `${ms}ms`);
    check(
      "has at least as many points as seeds",
      skeleton!.points.length >= seeds.length,
      `${skeleton!.points.length} pts`,
    );
    check("has segments", skeleton!.segments.length > 0, `${skeleton!.segments.length} segs`);

    // All skeleton points must lie inside (or very near) the shape
    const outsideCount = skeleton!.points.filter(
      (p) =>
        !path.contains(p) &&
        nearestDistFlatBoundary(p.x, p.y, flatBoundary) > 5,
    ).length;
    check("all points inside shape", outsideCount === 0, `${outsideCount} outside`);

    // Skeleton graph must be connected (single CC)
    const adj: number[][] = Array.from(
      { length: skeleton!.points.length },
      () => [],
    );
    for (const [u, v] of skeleton!.segments) {
      adj[u].push(v);
      adj[v].push(u);
    }
    const visited = new Set<number>();
    const queue = [0];
    visited.add(0);
    while (queue.length) {
      const node = queue.shift()!;
      for (const nb of adj[node])
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
    }
    check(
      "graph is connected",
      visited.size === skeleton!.points.length,
      `${visited.size}/${skeleton!.points.length} reachable`,
    );

    // No duplicate segments
    const segKeys = new Set(
      skeleton!.segments.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`),
    );
    check(
      "no duplicate segments",
      segKeys.size === skeleton!.segments.length,
      `${segKeys.size} unique / ${skeleton!.segments.length} total`,
    );

    // No skeleton edge midpoint pierces the shape boundary
    let piercingCount = 0;
    for (const [u, v] of skeleton!.segments) {
      const pu = new paper.Point(skeleton!.points[u].x, skeleton!.points[u].y);
      const pv = new paper.Point(skeleton!.points[v].x, skeleton!.points[v].y);
      const mid = pu.add(pv).divide(2);
      if (
        !path.contains(mid) &&
        nearestDistFlatBoundary(mid.x, mid.y, flatBoundary) > 5
      )
        piercingCount++;
    }
    check("no edges pierce shape", piercingCount === 0, `${piercingCount} piercing`);
  }
}

finish();
