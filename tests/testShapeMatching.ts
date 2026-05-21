import { Circle, FabricText, Line, StaticCanvas } from "fabric/node";
import * as fs from "node:fs";

import PathData from "@/app/pathUtils/PathData";
import {
  Keypoint,
  cosineSimilarity,
  curvatureSimilarity,
  matchKeypoints,
} from "@/app/pathUtils/keypoints";
import { initDrawContexts } from "@/app/utils/init";

initDrawContexts();

// prettier-ignore
const PRIORS: { [k: string]: [[number, number], [number, number]] } = {
  1: [[0, 0],   [1000, 1000]],  // entire space — provides no info
  2: [[0, 0],   [500, 500]  ],  // top-left quadrant
  3: [[0, 0],   [1000, 700] ],  // top 70%
  4: [[0, 0],   [1000, 700] ],  // top 70%
  5: [[0, 0],   [500, 500]  ],  // top-left quadrant
  6: [[0, 500], [1000, 1000]],  // bottom half
  7: [[500, 0], [1000, 500] ],  // top-right quadrant
}
// prettier-ignore
const GT: { [k: string]: { [comp: number]: number} } = {
  // each maps gt's component indices to B's component indices
  1:{0:2,1:0}, 2:{0:3,1:1,3:5,4:6}, 3:{0:1,1:0}, 4:{0:3,1:2,2:4},
  5:{0:0,1:3}, 6:{0:0,2:6}, 7:{0:3},
}

const paths = new Map(
  Object.entries(PRIORS).map(([k, bbox]) => {
    const A = PathData.fromSvg(
      fs.readFileSync(`tests/dataset/A${k}.svg`, "utf-8"),
    );
    const B = PathData.fromSvg(
      fs.readFileSync(`tests/dataset/B${k}.svg`, "utf-8"),
    );
    const gt = PathData.fromSvg(
      fs.readFileSync(`tests/dataset/B${k}_gt.svg`, "utf-8"),
    );
    const gtIdx2BIdx = GT[k];
    return [k, { A, B, gt, gtIdx2BIdx, bbox }];
  }),
);

const path1 = paths.get("7")!.A;
const path2 = paths.get("7")!.A.clone();
path2.transform(({ x, y }) => ({ x: x * 1.4, y: y * 0.7 }));
const path3 = paths.get("6")!.gt;
const path4 = paths.get("7")!.gt;

const path_A3 = paths.get("3")!.A;
const path_B3 = paths.get("3")!.B;
const path_B3gt = paths.get("3")!.gt;

const step = 40;
const keypoints1 = path1.getKeypointDescriptors({ step });
console.log("Keypoints1 length:", keypoints1[0].length);
const keypoints2 = path2.getKeypointDescriptors({ step });
console.log("Keypoints2 length:", keypoints2[0].length);
const keypoints3 = path3.getKeypointDescriptors({ step });
console.log("Keypoints3 length:", keypoints3[0].length);
const keypoints4 = path4.getKeypointDescriptors({ step });
console.log("Keypoints4 length:", keypoints4[0].length);

const keypoints_A3 = path_A3.getKeypointDescriptors({ step })[1];
console.log("Keypoints_A3 length:", keypoints_A3.length);
const keypoints_B3 = path_B3.getKeypointDescriptors({ step })[0];
console.log("Keypoints_B3 length:", keypoints_B3.length);
const keypoints_B3gt = path_B3gt.getKeypointDescriptors({ step })[0];
console.log("Keypoints_B3gt length:", keypoints_B3gt.length);

function keypointDistanceSum(a: Keypoint[], b: Keypoint[]) {
  let sumTanSim = 0;
  let sumCurvSim = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const kp1 = a[i];
    const kp2 = b[i];
    const tangentCosineSim = cosineSimilarity(kp1.tangent, kp2.tangent);
    const curvatureSim = curvatureSimilarity(
      kp1.curvatures[0],
      kp2.curvatures[0],
    );
    // console.log(
    //   `${i}: tan=${tangentCosineSim.toFixed(3)} curv=${curvatureSim.toFixed(3)}`,
    // );
    sumTanSim += tangentCosineSim;
    sumCurvSim += curvatureSim;
  }
  console.log(
    `sumTanSim: ${sumTanSim.toFixed(3)}, sumCurvSim: ${sumCurvSim.toFixed(3)}`,
  );
  return sumTanSim + sumCurvSim;
}

console.log("Between path1 & path2");
const posDist = keypointDistanceSum(keypoints1[0], keypoints2[0]);

console.log("Between path1 & path3");
const negDist = keypointDistanceSum(keypoints1[0], keypoints3[0]);

console.log(`posSim: ${posDist.toFixed(3)}, negSim: ${negDist.toFixed(3)}`);

function visualizeAlignment(
  keypoints1: Keypoint[],
  keypoints2: Keypoint[],
  alignment: Map<number, number[]>,
  filename: string,
) {
  // Initialize a canvas
  const dpi = 2.5;
  const canvas = new StaticCanvas("null", {
    width: 1000 * dpi,
    height: 1000 * dpi,
    backgroundColor: "white",
  });
  canvas.setZoom(dpi);

  const scale = 0.5;

  function addKeypoints(kps: Keypoint[], xOffset: number, color: string) {
    for (let idx = 0; idx < kps.length; idx++) {
      const kp = kps[idx];
      const x = kp.pos.x * scale + xOffset;
      const y = kp.pos.y * scale;
      const r = 2;
      canvas.add(
        new Circle({
          left: x,
          top: y,
          radius: r,
          fill: color,
          selectable: false,
        }),
      );
      canvas.add(
        new FabricText(String(idx), {
          left: x + 4,
          top: y - 5,
          fontSize: 5,
          fill: color,
          selectable: false,
        }),
      );
    }
  }

  addKeypoints(keypoints1, 0, "blue");
  addKeypoints(keypoints2, 500, "red");

  for (const [ni, hjs] of alignment) {
    const from = keypoints1[ni];
    const color = `hsla(${(ni * 360) / keypoints1.length}, 100%, 50%, 0.2)`;
    for (const hj of hjs) {
      const to = keypoints2[hj];
      canvas.add(
        new Line(
          [
            from.pos.x * scale,
            from.pos.y * scale,
            to.pos.x * scale + 500,
            to.pos.y * scale,
          ],
          { stroke: color, strokeWidth: 1, selectable: false },
        ),
      );
    }
  }

  canvas.renderAll();
  const out = fs.createWriteStream(filename);
  const stream = canvas.createPNGStream();
  stream.on("data", (chunk) => out.write(chunk));
  stream.on("end", () => console.log("Image saved!"));
}

const { score, alignment } = matchKeypoints(keypoints1[0], keypoints2[0]);
console.log(`score (synthesized): ${score.toFixed(3)}`);
visualizeAlignment(
  keypoints1[0],
  keypoints2[0],
  alignment,
  "test_outputs/output.png",
);

const { score: score2, alignment: alignment2 } = matchKeypoints(
  keypoints1[0],
  keypoints3[0],
);
console.log(`score (negative example): ${score2.toFixed(3)}`);
visualizeAlignment(
  keypoints1[0],
  keypoints3[0],
  alignment2,
  "test_outputs/output_neg.png",
);

const beginTime = performance.now();
const { score: score3, alignment: alignment3 } = matchKeypoints(
  keypoints1[0],
  keypoints4[0],
);
const endTime = performance.now();
console.log(`time: ${(endTime - beginTime).toFixed(3)}ms`);
console.log(`score (gt example): ${score3.toFixed(3)}`);
visualizeAlignment(
  keypoints1[0],
  keypoints4[0],
  alignment3,
  "test_outputs/output_gt.png",
);

const { score: score_A3, alignment: alignment_A3 } = matchKeypoints(
  keypoints_A3,
  keypoints_B3,
);
console.log(`score (A3 vs B3): ${score_A3.toFixed(3)}`);
visualizeAlignment(
  keypoints_A3,
  keypoints_B3,
  alignment_A3,
  "test_outputs/output_A3_B3.png",
);

const keypoints_B3_sliced = [
  ...keypoints_B3.slice(0, 49),
  ...keypoints_B3.slice(112),
];
const { score: score_A3_2, alignment: alignment_A3_2 } = matchKeypoints(
  keypoints_A3,
  keypoints_B3_sliced,
);
console.log(`score (A3 vs B3_sliced): ${score_A3_2.toFixed(3)}`);
visualizeAlignment(
  keypoints_A3,
  keypoints_B3_sliced,
  alignment_A3_2,
  "test_outputs/output_A3_B3_2.png",
);

// const t = JSON.parse(JSON.stringify(keypoints1[0]));
// for (let i = 0; i < t.length; i++) {
//   // rotate t by 1 element
//   t.push(t.shift()!);
//   const d = keypointDistanceSum(t, keypoints2[0]);
//   console.log(i, d);
// }
