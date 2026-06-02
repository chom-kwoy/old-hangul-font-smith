import paper from "paper";

import PathData from "@/app/pathUtils/PathData";
import * as testPaths from "@/app/testpage/testPaths";
import { initDrawContexts } from "@/app/utils/init";

initDrawContexts();

const path = PathData.fromSvg(testPaths.yo_ya_v2);

let startTime = Date.now();
const medialSkeletons = path.getMedialSkeletonSync(true);
let elapsedTime = Date.now() - startTime;
console.log(`Medial skeletons: ${medialSkeletons.length} in ${elapsedTime}ms`);
for (const skeleton of medialSkeletons) {
  console.log(
    skeleton.segments
      .map(([a, b]) => {
        const p1 = skeleton.points[a];
        const p2 = skeleton.points[b];
        return (
          `polygon((${p1.x.toFixed(1)},${(1000 - p1.y).toFixed(1)}),` +
          `(${p2.x.toFixed(1)},${(1000 - p2.y).toFixed(1)}))`
        );
      })
      .join(","),
  );
  skeleton.primitives.forEach((primitive, i) => {
    console.log(`primitive #${i}:`);
    console.log(
      primitive.origins
        .map((origin, i) => {
          const dir = primitive.directions[i];
          const r = primitive.radii[i];
          const p = new paper.Point(origin).add(
            new paper.Point(dir).multiply(r),
          );
          return `(${p.x.toFixed(2)},${(1000 - p.y).toFixed(2)})`;
        })
        .join(",") + "\n",
    );
  });
}

for (let i = 0; i < 10; i++) {
  startTime = Date.now();
  await path.scalePath(0, 0.6, 1.5, {
    doSimplify: false,
    threaded: false,
    verbose: false,
  });
  elapsedTime = Date.now() - startTime;

  console.log(`Scaled path in ${elapsedTime}ms`);
}
