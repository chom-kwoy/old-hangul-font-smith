import * as clipperLib from "js-angusj-clipper/web";
import { ClipType, PolyFillType } from "js-angusj-clipper/web";
import paper from "paper";

import {
  fabricPathDataToPaper,
  paperToFabricPathData,
} from "@/app/pathUtils/convert";
import {
  Primitive,
  localPrimitiveFitting,
} from "@/app/pathUtils/localPrimitiveFitting";
import { extractMedialAxis } from "@/app/pathUtils/medialAxis";
import { constructMedialSkeleton } from "@/app/pathUtils/medialSkeleton";
import { computeMedialSkeletonPoints } from "@/app/pathUtils/medialSkeletonPoints";
import {
  MessageFromPathWorker,
  MessageToPathWorker,
} from "@/app/processors/pathWorker/pathWorkerTypes";
import { initDrawContexts } from "@/app/utils/init";

// initialize the paper.js context
initDrawContexts();

// initialize the clipper library
const clipper = await clipperLib.loadNativeClipperLibInstanceAsync(
  // let it autodetect which one to use, but also available WasmOnly and AsmJsOnly
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
);

// listen for messages from the main thread
addEventListener(
  "message",
  async (event: MessageEvent<MessageToPathWorker>) => {
    // console.log("Path worker received message:", event.data);
    const result = await handleEvent(event);
    // console.log("Path worker sending message:", result);
    postMessage(result);
  },
);

console.log("Path worker loaded");

async function handleEvent(
  event: MessageEvent<MessageToPathWorker>,
): Promise<MessageFromPathWorker> {
  if (event.data.type === "skeletonizePath") {
    const subpath = event.data.path;
    const paperPath = fabricPathDataToPaper(subpath);
    const medialAxis = extractMedialAxis(paperPath);
    const medialSkeletonPoints = computeMedialSkeletonPoints(
      paperPath,
      medialAxis,
    );
    const medialSkeleton = constructMedialSkeleton(
      medialSkeletonPoints,
      medialAxis,
      paperPath,
    );
    const result = localPrimitiveFitting(paperPath, medialSkeleton);
    return {
      type: "skeletonizePath",
      reqId: event.data.reqId,
      skeleton: result,
    };
  } else if (event.data.type === "scalePath") {
    const path = event.data.path;
    const skeleton = event.data.skeleton;
    const options = event.data.options;
    const bbox = fabricPathDataToPaper(path).bounds;

    const newPrimitives = getPrimitivePoints(skeleton.primitives).map(
      (regPrimitive) => {
        return scalePathImpl(
          regPrimitive,
          options.scaleX,
          options.scaleY,
          bbox.center.x,
          bbox.center.y,
          options.scaleStroke,
          options.strokeWidth,
          options.verbose,
        );
      },
    );

    const union = unionPaths(newPrimitives);
    const newPath = new paper.CompoundPath(
      union.map(
        (path) =>
          new paper.Path({
            segments: path,
            closed: true,
          }),
      ),
    );
    if (options.doSimplify) {
      // newPath.smooth({ type: "catmull-rom", factor: 0.5 });
      newPath.simplify(0.1);
    }

    return {
      type: "scalePath",
      reqId: event.data.reqId,
      path: paperToFabricPathData(newPath),
    };
  } else {
    throw new Error("Invalid event type");
  }
}

function scalePathImpl(
  points: paper.Point[],
  scaleX: number,
  scaleY: number,
  centerX: number,
  centerY: number,
  scaleStroke: number,
  strokeWidth: number,
  verbose: boolean = false,
): paper.Point[] {
  function pr(pt: { x: number; y: number }, xoffset = 0, yoffset = 0) {
    return `(${(xoffset + pt.x).toFixed(1)},${(yoffset + 1000 - pt.y).toFixed(1)})`;
  }

  const revScaleX = Math.pow(1 / scaleX, scaleStroke);
  const revScaleY = Math.pow(1 / scaleY, scaleStroke);
  const tgtStrokeX = strokeWidth * revScaleX;
  const tgtStrokeY = strokeWidth * revScaleY;
  const offsetX = (tgtStrokeX - strokeWidth) / 2;
  const offsetY = (tgtStrokeY - strokeWidth) / 2;

  if (verbose) {
    console.log(
      `scaleX: ${scaleX}, scaleY: ${scaleY}\n` +
        `revScaleX: ${revScaleX}, revScaleY: ${revScaleY}\n` +
        `offsetX: ${offsetX}, offsetY: ${offsetY}`,
    );
  }

  const clipperScale = 10000.0;
  const tinyStep = 1 / clipperScale;
  if (offsetX !== 0) {
    // expand or shrink the pattern in the X direction
    // by doing a Minkowski sum with a thin rectangle.
    points = minkowskiSum(
      points,
      [
        new paper.Point(Math.abs(offsetX), -tinyStep),
        new paper.Point(-Math.abs(offsetX), -tinyStep),
        new paper.Point(-Math.abs(offsetX), tinyStep),
        new paper.Point(Math.abs(offsetX), tinyStep),
      ],
      offsetX > 0 ? "expand" : "shrink",
      clipperScale,
    );
  }
  if (offsetY !== 0) {
    // expand or shrink the pattern in the Y direction
    points = minkowskiSum(
      points,
      [
        new paper.Point(-tinyStep, Math.abs(offsetY)),
        new paper.Point(-tinyStep, -Math.abs(offsetY)),
        new paper.Point(tinyStep, -Math.abs(offsetY)),
        new paper.Point(tinyStep, Math.abs(offsetY)),
      ],
      offsetY > 0 ? "expand" : "shrink",
      clipperScale,
    );
  }

  // scale the points so that the shape expands/contracts from the center
  points = points.map(
    (pt) =>
      new paper.Point(
        (pt.x - centerX) * scaleX + centerX,
        (pt.y - centerY) * scaleY + centerY,
      ),
  );

  if (verbose) {
    console.log(points.map((p) => pr(p)).join(",") + "\n");
  }

  return points;
}

function getPrimitivePoints(primitives: Primitive[]) {
  return primitives.map((primitive) => {
    return primitive.origins.map((origin, i) => {
      const dir = new paper.Point(primitive.directions[i]);
      const rad = primitive.radii[i];
      return new paper.Point(origin).add(dir.multiply(rad));
    });
  });
}

function minkowskiSum(
  points: paper.Point[],
  pattern: paper.Point[],
  type: "expand" | "shrink",
  clipperScale = 10000.0,
) {
  let scaledPoints = [
    points
      .map((p) => ({
        x: p.x * clipperScale,
        y: p.y * clipperScale,
      }))
      .toReversed(),
  ];
  // make the shape into a 'hole'
  if (type === "shrink") {
    const amin = -10000 * clipperScale;
    const amax = 10000 * clipperScale;
    scaledPoints = [
      [
        { x: amin, y: amax },
        { x: amin, y: amin },
        { x: amax, y: amin },
        { x: amax, y: amax },
      ],
      scaledPoints[0].toReversed(),
    ];
  }
  const scaledPattern = pattern
    .map((p) => ({
      x: p.x * clipperScale,
      y: p.y * clipperScale,
    }))
    .toReversed();
  const result = clipper.minkowskiSumPaths(scaledPattern, scaledPoints, true);
  if (result === undefined) {
    throw new Error("clipper.minkowskiSumPath failed");
  }
  if (type === "expand") {
    return result[0]
      .map((p) => new paper.Point(p.x / clipperScale, p.y / clipperScale))
      .toReversed();
  } else {
    return result[1].map(
      (p) => new paper.Point(p.x / clipperScale, p.y / clipperScale),
    );
  }
}

function unionPaths(primitives: paper.Point[][]): paper.Point[][] {
  const clipperScale = 10000.0;
  const inputs = primitives.map((primitive) => ({
    data: primitive
      .map((p) => ({
        x: p.x * clipperScale,
        y: p.y * clipperScale,
      }))
      .toReversed(),
    closed: true,
  }));
  const result = clipper.clipToPaths({
    clipType: ClipType.Union,
    subjectFillType: PolyFillType.NonZero,
    subjectInputs: inputs,
  });
  if (result === undefined) {
    throw new Error("clipper.clipToPolyTree failed");
  }
  return result.map((path) =>
    path
      .map((p) => new paper.Point(p.x / clipperScale, p.y / clipperScale))
      .toReversed(),
  );
}
