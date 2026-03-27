// import Shape from "@doodle3d/clipper-js";
import { DOMParser } from "@xmldom/xmldom";
import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import * as clipperLib from "js-angusj-clipper/web";
import {
  ClipType,
  EndType,
  JoinType,
  PolyFillType,
} from "js-angusj-clipper/web";
import opentype from "opentype.js";
import paper from "paper";

import {
  fabricPathDataToPaper,
  fabricPathDataToSVG,
  intersectCompoundPath,
  paperToFabricPathData,
} from "@/app/pathUtils/convert";
import {
  FittedMedialAxisGraph,
  Primitive,
  localPrimitiveFitting,
} from "@/app/pathUtils/localPrimitiveFitting";
import { extractMedialAxis } from "@/app/pathUtils/medialAxis";
import { constructMedialSkeleton } from "@/app/pathUtils/medialSkeleton";
import { computeMedialSkeletonPoints } from "@/app/pathUtils/medialSkeletonPoints";
import { Bounds } from "@/app/utils/types";

const clipper = await clipperLib.loadNativeClipperLibInstanceAsync(
  // let it autodetect which one to use, but also available WasmOnly and AsmJsOnly
  clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback,
);

export type SerializedPathData = {
  readonly _paths_serialized: TSimplePathData[];
};

export default class PathData {
  #paths: TSimplePathData[] = [];
  #skeletons: FittedMedialAxisGraph[] | null = null;

  constructor(paths: TSimplePathData[]) {
    this.#paths = paths;
  }

  serialize(): SerializedPathData {
    return { _paths_serialized: this.#paths };
  }

  static deserialize(data: SerializedPathData): PathData {
    return new PathData(data._paths_serialized);
  }

  toJSON(): SerializedPathData {
    return this.serialize();
  }

  clone(): PathData {
    return PathData.deserialize(structuredClone(this.serialize()));
  }

  static fromOpentype(
    path: opentype.Path,
    unitsPerEm: number,
    sTypoDescender: number,
  ): PathData {
    const scale = 1000 / unitsPerEm;
    function trX(x: number) {
      return x * scale;
    }
    function trY(y: number) {
      return 1000 - (y - sTypoDescender) * scale;
    }
    const data: TSimplePathData = [];
    for (const cmd of path.commands) {
      switch (cmd.type) {
        case "M": // move to
          data.push(["M", trX(cmd.x), trY(cmd.y)]);
          break;
        case "L": // line to
          data.push(["L", trX(cmd.x), trY(cmd.y)]);
          break;
        case "Q": // quadratic bezier curve
          data.push(["Q", trX(cmd.x1), trY(cmd.y1), trX(cmd.x), trY(cmd.y)]);
          break;
        case "C": // cubic bezier curve
          data.push([
            "C",
            trX(cmd.x1),
            trY(cmd.y1),
            trX(cmd.x2),
            trY(cmd.y2),
            trX(cmd.x),
            trY(cmd.y),
          ]);
          break;
        case "Z": // close path
          data.push(["Z"]);
          break;
      }
    }
    return new PathData(splitPaths(data));
  }

  toOpenType(
    unitsPerEm: number,
    sTypoDescender: number,
    offsetX: number = 0,
    offsetY: number = 0,
  ): TSimplePathData {
    const scale = unitsPerEm / 1000;
    function trX(x: number) {
      return x * scale + offsetX;
    }
    function trY(y: number) {
      return (1000 - y) * scale + sTypoDescender + offsetY;
    }
    const result: TSimplePathData = [];
    for (const subpath of this.#paths) {
      for (const cmd of subpath) {
        switch (cmd[0]) {
          case "M": // move to
            result.push(["M", trX(cmd[1]), trY(cmd[2])]);
            break;
          case "L": // line to
            result.push(["L", trX(cmd[1]), trY(cmd[2])]);
            break;
          case "Q": // quadratic bezier curve
            result.push([
              "Q",
              trX(cmd[1]),
              trY(cmd[2]),
              trX(cmd[3]),
              trY(cmd[4]),
            ]);
            break;
          case "C": // cubic bezier curve
            result.push([
              "C",
              trX(cmd[1]),
              trY(cmd[2]),
              trX(cmd[3]),
              trY(cmd[4]),
              trX(cmd[5]),
              trY(cmd[6]),
            ]);
            break;
          case "Z": // close path
            result.push(["Z"]);
            break;
        }
      }
    }
    return result;
  }

  static fromSvg(svg: string): PathData {
    // parse xml string
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(svg, "image/svg+xml");
    const pathElements = xmlDoc.getElementsByTagName("path");

    const result: TSimplePathData[] = [];
    for (let i = 0; i < pathElements.length; i++) {
      const pathElement = pathElements.item(i)!;
      const d = pathElement.getAttribute("d");
      if (d) {
        const compoundPath = new paper.CompoundPath(d);
        compoundPath.closePath();
        result.push(paperToFabricPathData(compoundPath));
      }
    }

    return new PathData(result);
  }

  makeFabricPaths(
    width: number,
    height: number,
    {
      offsetX,
      offsetY,
      ...options
    }: { offsetX?: number; offsetY?: number } & Partial<fabric.PathProps> = {},
  ): fabric.Path[] {
    offsetX = offsetX || 0;
    offsetY = offsetY || 0;
    const result: fabric.Path[] = [];
    for (const comp of this.#paths) {
      const bbox = fabricPathDataToPaper(comp).bounds;
      result.push(
        new fabric.Path(comp, {
          ...options,
          left: offsetX + bbox.center.x * (width / 1000),
          top: offsetY + bbox.center.y * (height / 1000),
          scaleX: width / 1000,
          scaleY: height / 1000,
        }),
      );
    }
    return result;
  }

  exportSvg(): string {
    let svgData = "";
    for (const comp of this.#paths) {
      svgData += `<path d="${fabricPathDataToSVG(comp)}" />\n`;
    }
    return `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  ${svgData}
</svg>`;
  }

  intersectBoundsList(boundsList: Bounds[], threshold: number = 0.5) {
    const result: TSimplePathData[] = [];
    for (const compoundPath of this.#paths) {
      const newPath = paperToFabricPathData(
        intersectCompoundPath(
          fabricPathDataToPaper(compoundPath),
          boundsList,
          threshold,
        ),
      );
      if (newPath.length > 0) {
        result.push(newPath);
      }
    }
    return new PathData(result);
  }

  filterPaths(pred: (path: TSimplePathData, index: number) => boolean): void {
    this.#paths = this.#paths.filter((path, index) => pred(path, index));
    this.#skeletons = null;
  }

  scalePath(
    index: number,
    scaleX: number,
    scaleY: number,
    {
      scaleStroke,
      strokeWidth,
      verbose,
    }: {
      // 0 means stroke is fixed, 1 means fully scaled
      scaleStroke?: number;
      // the original font's average stroke width
      strokeWidth?: number;
      verbose?: boolean;
    } = {},
  ) {
    scaleStroke = scaleStroke ?? 0.6;
    strokeWidth = strokeWidth ?? 60.0;
    verbose = verbose ?? false;

    if (index < 0 || index >= this.#paths.length) {
      throw new Error(`Invalid subpath index: ${index}`);
    }

    const skeleton = this.getMedialSkeleton()[index];
    const bbox = fabricPathDataToPaper(this.#paths[index]).bounds;

    const newPrimitives = getPrimitivePoints(skeleton.primitives).map(
      (regPrimitive) => {
        return scalePathImpl(
          regPrimitive,
          scaleX,
          scaleY,
          bbox.center.x,
          bbox.center.y,
          scaleStroke,
          strokeWidth,
          verbose,
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
    // newPath.smooth({ type: "catmull-rom", factor: 0.5 });
    newPath.simplify(0.1);

    // this.updatePath(index, newPath);
    return paperToFabricPathData(newPath);
  }

  getMedialSkeleton(): FittedMedialAxisGraph[] {
    if (this.#skeletons === null) {
      this.#skeletons = this.#paths.map((subpath) => {
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
        return localPrimitiveFitting(paperPath, medialSkeleton);
      });
    }
    return this.#skeletons;
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

  const finalScale = Math.min(Math.min(revScaleX, revScaleY) * 0.999, 1.0);
  const offsetX = (tgtStrokeX / finalScale - strokeWidth) / 2;
  const offsetY = (tgtStrokeY / finalScale - strokeWidth) / 2;

  const offsetAmount = 10.0;
  const preScaleX = offsetAmount / offsetX;
  const preScaleY = offsetAmount / offsetY;

  if (verbose) {
    console.log(
      `scaleX: ${scaleX}, scaleY: ${scaleY}\n` +
        `revScaleX: ${revScaleX}, revScaleY: ${revScaleY}\n` +
        `offsetX: ${offsetX}, offsetY: ${offsetY}, finalScale: ${finalScale}\n` +
        `preScaleX: ${preScaleX}, preScaleY: ${preScaleY}, offsetAmount: ${offsetAmount}`,
    );
  }

  points = points.map((p) => new paper.Point(p.x - centerX, p.y - centerY));
  const preScaledPts = scalePoints(points, preScaleX, preScaleY);
  const offsetPts = offsetPoints(preScaledPts, offsetAmount);
  const scaledPts = scalePoints(
    offsetPts,
    (finalScale / preScaleX) * scaleX,
    (finalScale / preScaleY) * scaleY,
  );
  const result = scaledPts.map(
    (p) => new paper.Point(p.x + centerX, p.y + centerY),
  );

  if (verbose) {
    console.log(result.map((p) => pr(p)).join(",") + "\n");
  }

  return result;
}

function getPrimitivePoints(primitives: Primitive[]) {
  return primitives.map((primitive) => {
    return primitive.origins.map((origin, i) => {
      const dir = primitive.directions[i];
      const rad = primitive.radii[i];
      return origin.add(dir.multiply(rad));
    });
  });
}

function scalePoints(points: paper.Point[], scaleX: number, scaleY: number) {
  const result: paper.Point[] = [];
  for (const p of points) {
    result.push(new paper.Point(p.x * scaleX, p.y * scaleY));
  }
  return result;
}

function offsetPoints(primitive: paper.Point[], offsetAmount: number) {
  // needs to be scaled for clipper js lib
  const clipperScale = 10000.0;
  const result = clipper.offsetToPaths({
    delta: offsetAmount * clipperScale,
    offsetInputs: [
      {
        data: primitive
          .map((p) => ({
            x: p.x * clipperScale,
            y: p.y * clipperScale,
          }))
          .toReversed(),
        joinType: JoinType.Miter,
        endType: EndType.ClosedPolygon,
      },
    ],
  });
  if (result === undefined) {
    throw new Error("clipper.offsetToPaths failed");
  }
  return result[0]
    .map((p) => new paper.Point(p.x / clipperScale, p.y / clipperScale))
    .toReversed();
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

// Returns a unit tangent for each point using a central-difference window of
// ±halfWindow steps (treats the array as a closed loop).
function computePolygonTangents(
  points: paper.Point[],
  halfWindow = 1,
): paper.Point[] {
  const n = points.length;
  return points.map((_, i) => {
    const prev = points[(i - halfWindow + n) % n];
    const next = points[(i + halfWindow) % n];
    const t = next.subtract(prev);
    return t.length > 1e-10 ? t.normalize() : new paper.Point(1, 0);
  });
}

function transformFabricPathData(
  path: TSimplePathData,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
): TSimplePathData {
  const result: TSimplePathData = [];
  function trX(x: number): number {
    return (x - cx) * sx + cx + dx;
  }
  function trY(y: number): number {
    return (y - cy) * sy + cy + dy;
  }
  for (const cmd of path) {
    switch (cmd[0]) {
      case "M": // move to
        result.push(["M", trX(cmd[1]), trY(cmd[2])]);
        break;
      case "L": // line to
        result.push(["L", trX(cmd[1]), trY(cmd[2])]);
        break;
      case "Q": // quadratic bezier curve
        result.push(["Q", trX(cmd[1]), trY(cmd[2]), trX(cmd[3]), trY(cmd[4])]);
        break;
      case "C": // cubic bezier curve
        result.push([
          "C",
          trX(cmd[1]),
          trY(cmd[2]),
          trX(cmd[3]),
          trY(cmd[4]),
          trX(cmd[5]),
          trY(cmd[6]),
        ]);
        break;
      case "Z": // close path
        result.push(["Z"]);
        break;
    }
  }
  return result;
}

// splits a single compound path into multiple paths, preserving holes
// assumes there is no overlap between subpaths
export function splitPaths(path: TSimplePathData): TSimplePathData[] {
  // 0. Split path into each subpath
  const subpaths: TSimplePathData[] = [];
  let currentSubpath: TSimplePathData = [];
  for (const cmd of path) {
    if (cmd[0] === "M" && currentSubpath.length > 0) {
      subpaths.push(currentSubpath);
      currentSubpath = [];
    }
    currentSubpath.push(cmd);
  }
  if (currentSubpath.length > 0) {
    subpaths.push(currentSubpath);
  }

  // 1. Build adjacency list of subpaths based on containment
  const paperSubpaths = subpaths.map((sp) => fabricPathDataToPaper(sp));
  const tree = new Map<number, number[]>();
  tree.set(-1, []); // root
  for (let i = 0; i < subpaths.length; i++) {
    const pathI = paperSubpaths[i];
    let parentIndex = -1;
    for (let j = 0; j < subpaths.length; j++) {
      if (i === j) continue;
      const pathJ = paperSubpaths[j];
      if (pathJ.contains(pathI.firstSegment.point)) {
        // found a parent
        if (
          parentIndex === -1 ||
          paperSubpaths[parentIndex].contains(pathJ.firstSegment.point)
        ) {
          parentIndex = j;
        }
      }
    }
    if (!tree.has(parentIndex)) {
      tree.set(parentIndex, []);
    }
    tree.get(parentIndex)!.push(i);
  }

  // 2. Traverse tree to build compound paths
  const result: TSimplePathData[] = [];
  function traverse(nodeIndex: number, compoundPath: TSimplePathData) {
    compoundPath.push(...subpaths[nodeIndex]);
    const children = tree.get(nodeIndex);
    if (!children) return;
    for (const childIndex of children) {
      // recurse to add grandchildren
      traverse(childIndex, compoundPath);
    }
  }
  const rootChildren = tree.get(-1);
  if (rootChildren) {
    for (const childIndex of rootChildren) {
      const compoundPath: TSimplePathData = [];
      traverse(childIndex, compoundPath);
      if (compoundPath.length > 0) {
        result.push(compoundPath);
      }
    }
  }
  return result;
}

function interpolatePoints(boldPoints: paper.Point[], tgtDst: number) {
  const interpolated: paper.Point[] = [];
  for (let j = 0; j < boldPoints.length; ++j) {
    const p0 = boldPoints[j];
    const p1 = boldPoints[(j + 1) % boldPoints.length];
    const dst = p0.getDistance(p1);
    const n = Math.ceil(dst / tgtDst);
    for (let k = 0; k < n; ++k) {
      const t = (k + 1) / (n + 1);
      interpolated.push(p0.add(p1.subtract(p0).multiply(t)));
    }
  }
  return interpolated;
}
