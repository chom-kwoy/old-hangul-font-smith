import { TSimplePathData } from "fabric";
import { ClipType, EndType, JoinType, PolyFillType } from "js-angusj-clipper/web";
import * as clipperLib from "js-angusj-clipper/web";
import paper from "paper";

import {
  fabricPathDataToPaper,
  paperToFabricPathData,
} from "@/app/pathUtils/convert";
import {
  FittedMedialAxisGraph,
  Primitive,
  localPrimitiveFitting,
  primitivePts,
} from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { extractMedialAxis } from "@/app/pathUtils/skeleton/medialAxis";
import { constructMedialSkeleton } from "@/app/pathUtils/skeleton/medialSkeleton";
import { computeMedialSkeletonPoints } from "@/app/pathUtils/skeleton/medialSkeletonPoints";
import { Vec2D } from "@/app/utils/types";

// initialize the clipper library
const clipper = await clipperLib.loadNativeClipperLibInstanceAsync(
  // let it autodetect which one to use, but also available WasmOnly and AsmJsOnly
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
);

export function skeletonize(
  path: TSimplePathData,
  verbose: boolean = false,
): FittedMedialAxisGraph {
  const paperPath = fabricPathDataToPaper(path);

  // Use delaunay triangulation to find the medial axis
  const medialAxis = extractMedialAxis(paperPath);
  if (verbose) {
    console.debug(
      "Medial axis:",
      medialAxis.segments
        .map(([a, b]) => {
          const p1 = medialAxis.points[a];
          const p2 = medialAxis.points[b];
          return (
            `polygon((${p1.x.toFixed(1)},${(1000 - p1.y).toFixed(1)}),` +
            `(${p2.x.toFixed(1)},${(1000 - p2.y).toFixed(1)}))`
          );
        })
        .join(","),
      "\n",
    );
  }

  // Compute the optimal sparse set of points on the medial axis
  const medialSkeletonPoints = computeMedialSkeletonPoints(
    paperPath,
    medialAxis,
    undefined,
    verbose,
  );

  // Connect the medial skeleton points to each other to form a connected graph
  const medialSkeleton = constructMedialSkeleton(
    medialSkeletonPoints,
    medialAxis,
    paperPath,
    true,
  );

  // Fit primitives (expandable circles) to each skeleton component
  const fitted = localPrimitiveFitting(paperPath, medialSkeleton);

  // Post-process: offset → smooth → clip to shape boundary
  clipPrimitivesToShape(fitted, paperPath);

  return fitted;
}

export type PathScaleOptions = {
  scaleX: number;
  scaleY: number;
  scaleStroke: number;
  strokeWidth: number;
  doSimplify: boolean;
  verbose: boolean;
};
export function scalePath(
  path: TSimplePathData,
  skeleton: FittedMedialAxisGraph,
  options: PathScaleOptions,
): TSimplePathData {
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
  return paperToFabricPathData(newPath);
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
  function pr(pt: Vec2D, xoffset = 0, yoffset = 0) {
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
  return primitives.map((primitive) =>
    primitivePts(primitive).map(p => new paper.Point(p.x, p.y)),
  );
}

/**
 * Post-processing step: for each fitted primitive, expand outward (Clipper offset),
 * smooth (Catmull-Rom), then clip back to the original shape boundary (paper.js intersect).
 * Stores the result in prim.clippedPts, which all downstream consumers respect via primitivePts().
 */
export function clipPrimitivesToShape(
  fitted: FittedMedialAxisGraph,
  path: paper.CompoundPath,
  offsetDelta: number = 5,
): void {
  const clipperScale = 10000;

  for (const prim of fitted.primitives) {
    const n = prim.origins.length;
    const pts = prim.origins.map((o, i) => ({
      x: o.x + prim.directions[i].x * prim.radii[i],
      y: o.y + prim.directions[i].y * prim.radii[i],
    }));

    // Step 1: outward offset with round joins so no sharp protruding corners
    const inputPath = pts.map(p => ({
      x: Math.round(p.x * clipperScale),
      y: Math.round(p.y * clipperScale),
    }));
    const offsetPaths = clipper.offsetToPaths({
      delta: offsetDelta * clipperScale,
      arcTolerance: 0.25 * clipperScale,
      offsetInputs: [{ data: inputPath, joinType: JoinType.Round, endType: EndType.ClosedPolygon }],
    });

    if (!offsetPaths || offsetPaths.length === 0) continue;
    const offsetPts = offsetPaths
      .reduce((best, p) =>
        Math.abs(clipper.area(p)) > Math.abs(clipper.area(best)) ? p : best)
      .map(p => ({ x: p.x / clipperScale, y: p.y / clipperScale }));

    // Step 2: Catmull-Rom smooth — curves edges outward toward shape boundary
    const offsetPath = new paper.Path({
      segments: offsetPts.map(p => new paper.Point(p.x, p.y)),
      closed: true,
      insert: false,
    });
    offsetPath.smooth({ type: "catmull-rom", factor: 0.5 });

    // Step 3: clip to original shape — overshoot is replaced by exact original bezier arcs
    const clipped = offsetPath.intersect(path, { insert: false });

    const resultPath = clipped instanceof paper.CompoundPath
      ? (clipped.children as paper.Path[]).reduce((best, c) =>
          Math.abs((c as paper.Path).area) > Math.abs(best.area)
            ? (c as paper.Path)
            : best)
      : (clipped as paper.Path);

    if (resultPath.segments.length >= 3) {
      const M = 2 * n;
      const len = resultPath.length;
      prim.clippedPts = Array.from({ length: M }, (_, k) => {
        const pt = resultPath.getPointAt((k / M) * len)
          ?? resultPath.firstSegment.point;
        return { x: pt.x, y: pt.y };
      });
    }

    offsetPath.remove();
    clipped.remove();
  }
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
  const cleanedPoints = clipper.simplifyPolygons(
    scaledPoints,
    PolyFillType.EvenOdd,
  );
  const result = clipper.minkowskiSumPaths(scaledPattern, cleanedPoints, true);
  if (result === undefined) {
    throw new Error("clipper.minkowskiSumPath failed");
  }
  if (type === "expand") {
    return result[0]
      .map((p) => new paper.Point(p.x / clipperScale, p.y / clipperScale))
      .toReversed();
  } else {
    if (result.length < 2) {
      throw new Error(
        "minkowskiSum shrink should return 2 paths, instead got: " +
          result.length +
          " path(s)",
      );
    }
    return result[result.length - 1].map(
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
