import { DOMParser } from "@xmldom/xmldom";
import { TSimplePathData } from "fabric";
import * as fabric from "fabric";
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

  updatePath(index: number, newPath: TSimplePathData | fabric.Path): void {
    if (index >= 0 && index < this.#paths.length) {
      if (newPath instanceof fabric.Path) {
        if (!newPath.canvas) {
          throw new Error("fabric.Path must be added to a canvas");
        }
        const [canvasWidth, canvasHeight] = [
          newPath.canvas.width,
          newPath.canvas.height,
        ];
        const bbox = fabricPathDataToPaper(newPath.path).bounds;
        const [offsetX, offsetY] = [
          newPath.left * (1000 / canvasWidth) - bbox.width / 2 - bbox.left,
          newPath.top * (1000 / canvasHeight) - bbox.height / 2 - bbox.top,
        ];
        const [scaleX, scaleY] = [
          newPath.scaleX / (canvasWidth / 1000),
          newPath.scaleY / (canvasHeight / 1000),
        ];
        newPath = transformFabricPathData(
          newPath.path,
          offsetX,
          offsetY,
          bbox.center.x,
          bbox.center.y,
          scaleX,
          scaleY,
        );
      }
      this.#paths[index] = newPath;
      this.#skeletons = null; // invalidate cache
    } else {
      throw new Error(`Invalid subpath index: ${index}`);
    }
  }

  scalePath(index: number, scaleX: number, scaleY: number): void {
    const skeletons = this.getMedialSkeleton();
    if (index < 0 || index >= skeletons.length) {
      throw new Error(`Invalid subpath index: ${index}`);
    }
    const skeleton = skeletons[index];

    function getPrimitivePoints(
      primitives: Primitive[],
      radiusExpansion: number,
    ) {
      return primitives.map((primitive) =>
        primitive.origins.map((origin, i) => {
          const dir = primitive.directions[i];
          const rad = primitive.radii[i] + radiusExpansion;
          return origin.add(dir.multiply(rad));
        }),
      );
    }

    const b = 1.5; // boldness factor
    const regPrimitives = getPrimitivePoints(skeleton.primitives, 0);
    const boldPrimitives = getPrimitivePoints(skeleton.primitives, 10);
    console.log(
      "boldPrimitives: ",
      boldPrimitives.map((prim) =>
        prim
          .map((p) => `(${p.x.toFixed(1)}, ${(1000 - p.y).toFixed(1)})`)
          .join(","),
      ),
    );

    const alpha = 0.0; // 0 means stroke weight is fixed, 1 means scaled
    const clip = (x: number) => Math.max(0, Math.min(1, x));
    const qx = clip((Math.pow(scaleX, alpha - 1) - b) / (1 - b));
    const qy = clip((Math.pow(scaleY, alpha - 1) - b) / (1 - b));

    console.log("scaleX, scaleY: ", scaleX, scaleY);
    console.log("qx, qy: ", qx, qy);

    function minDistanceToSkeleton(pt: { x: number; y: number }) {
      let minDst = Infinity;
      for (const segment of skeleton.segments) {
        const a = skeleton.points[segment[0]];
        const b = skeleton.points[segment[1]];
        const line = new paper.Path.Line(a, b);
        const proj = line.getNearestPoint(pt);
        const dst = proj.getDistance(pt);
        if (dst < minDst) {
          minDst = dst;
        }
      }
      return minDst;
    }

    const newPrimitives: paper.Path[] = [];
    for (let i = 0; i < skeleton.primitives.length; ++i) {
      const regPrimitive = regPrimitives[i];
      const boldPrimitive = boldPrimitives[i];
      const newSegments: { x: number; y: number }[] = [];
      for (let j = 0; j < regPrimitive.length; ++j) {
        const origin = skeleton.primitives[i].origins[j];
        const pr = regPrimitive[j];
        const pb = boldPrimitive[j];
        const newPoint = new paper.Point({
          x: qx * pr.x + (1 - qx) * pb.x,
          y: qy * pr.y + (1 - qy) * pb.y,
        });
        const r = origin.getDistance(newPoint);
        const minDst = minDistanceToSkeleton(newPoint);
        const dir = newPoint.subtract(origin).normalize();
        const shrinkFactor = smoothstep(0.0, 1.0, (r - minDst) / r) * 0.3;
        const finalPoint = origin.add(dir.multiply(r - r * shrinkFactor));
        newSegments.push(finalPoint);
      }

      console.log(
        "newPrimitives: ",
        newSegments
          .map((p, i) => {
            const p2 = newSegments[(i + 1) % newSegments.length];
            return `polygon((${(2000 + p.x).toFixed(1)}, ${(1000 - p.y).toFixed(1)}),(${(2000 + p2.x).toFixed(1)}, ${(1000 - p2.y).toFixed(1)}))`;
          })
          .join(","),
      );
      const path = new paper.Path({
        segments: newSegments,
        closed: true,
      });
      path.smooth({ type: "catmull-rom", factor: 0.5 });
      newPrimitives.push(path);
    }

    let reconstructedShape: paper.PathItem = newPrimitives[0];
    for (let i = 1; i < newPrimitives.length; i++) {
      const nextShape = newPrimitives[i];
      reconstructedShape = reconstructedShape.unite(nextShape);
    }
    reconstructedShape.simplify();

    const newPath = paperToFabricPathData(reconstructedShape);
    // console.log("New path: ", newPath);

    this.updatePath(index, newPath);
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

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
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
