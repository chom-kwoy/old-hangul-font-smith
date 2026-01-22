import { TSimplePathData } from "fabric";
import * as fabric from "fabric";
import opentype from "opentype.js";
import paper from "paper";

import {
  fabricPathDataToPaper,
  fabricPathDataToSVG,
  intersectCompoundPath,
  paperToFabricPathData,
} from "@/app/utils/bezier";
import { Bounds } from "@/app/utils/types";

export type SerializedPathData = {
  readonly _paths_serialized: TSimplePathData[];
};

export default class PathData {
  #paths: TSimplePathData[] = [];

  constructor(paths: TSimplePathData[]) {
    this.#paths = paths;
  }

  serialize(): SerializedPathData {
    return { _paths_serialized: this.#paths };
  }

  static deserialize(data: SerializedPathData): PathData {
    return new PathData(data._paths_serialized);
  }

  getPaths(): TSimplePathData[] {
    return this.#paths;
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

  static fromSvg(svg: string): PathData {
    // parse xml string
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(svg, "image/svg+xml");
    const pathElements = xmlDoc.getElementsByTagName("path");

    const result: TSimplePathData[] = [];
    for (const pathElement of pathElements) {
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
          left: offsetX + (bbox.left + bbox.width / 2) * (width / 1000),
          top: offsetY + (bbox.top + bbox.height / 2) * (height / 1000),
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
    }
  }
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
