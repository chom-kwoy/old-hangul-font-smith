import { TSimplePathData } from "fabric";
import * as fabric from "fabric";
import opentype from "opentype.js";
import paper from "paper";

import { intersectCompoundPath } from "@/app/utils/bezier";
import {
  fabricToCompoundPath,
  fabricToSVG,
  paperToFabricPath,
} from "@/app/utils/fabricUtils";
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
        result.push(paperToFabricPath(compoundPath));
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
      const bbox = new paper.CompoundPath(fabricToSVG(comp)).bounds;
      const bboxWidth = bbox.right - bbox.left;
      const bboxHeight = bbox.bottom - bbox.top;
      result.push(
        new fabric.Path(comp, {
          ...options,
          left: offsetX + (bbox.left + bboxWidth / 2) * (width / 1000),
          top: offsetY + (bbox.top + bboxHeight / 2) * (height / 1000),
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
      svgData += `<path d="${fabricToSVG(comp)}" />\n`;
    }
    return `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  ${svgData}
</svg>`;
  }

  intersectBoundsList(boundsList: Bounds[], threshold: number = 0.5) {
    const result: TSimplePathData[] = [];
    for (const compoundPath of this.#paths) {
      result.push(
        paperToFabricPath(
          intersectCompoundPath(
            fabricToCompoundPath(compoundPath),
            boundsList,
            threshold,
          ),
        ),
      );
    }
    return new PathData(result);
  }

  filterPaths(pred: (path: TSimplePathData, index: number) => boolean): void {
    this.#paths = this.#paths.filter((path, index) => pred(path, index));
  }

  updatePath(index: number, newPath: TSimplePathData): void {
    if (index >= 0 && index < this.#paths.length) {
      this.#paths[index] = newPath;
    }
  }
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
  const paperSubpaths = subpaths.map((sp) => fabricToCompoundPath(sp));
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
      result.push(compoundPath);
    }
  }
  return result;
}
