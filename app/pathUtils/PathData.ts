import { DOMParser } from "@xmldom/xmldom";
import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import opentype from "opentype.js";
import paper from "paper";

import { pathWorkerPool } from "@/app/pathUtils/PathWorkerPool";
import {
  fabricPathDataToPaper,
  fabricPathDataToSVG,
  intersectCompoundPath,
  paperToFabricPathData,
} from "@/app/pathUtils/convert";
import { FittedMedialAxisGraph } from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import {
  PathScaleOptions,
  scalePath,
  skeletonize,
} from "@/app/pathUtils/skeleton/skeleton";
import { Bounds } from "@/app/utils/types";

export type SerializedPathData = {
  readonly _paths_serialized: TSimplePathData[];
};

export default class PathData {
  #originalPaths: TSimplePathData[] = [];
  #skeletonPromise: Promise<FittedMedialAxisGraph[]> | null = null;
  #skeletons: FittedMedialAxisGraph[] | null = null;

  constructor(paths: TSimplePathData[]) {
    this.#originalPaths = paths;
  }

  serialize(): SerializedPathData {
    return { _paths_serialized: this.#originalPaths };
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
    for (const subpath of this.#originalPaths) {
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

  makeFabricPaths({
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    ...options
  }: {
    scaleX?: number;
    scaleY?: number;
    offsetX?: number;
    offsetY?: number;
  } & Partial<fabric.PathProps> = {}): fabric.Path[] {
    scaleX = scaleX ?? 1.0;
    scaleY = scaleY ?? 1.0;
    offsetX = offsetX ?? 0;
    offsetY = offsetY ?? 0;
    const result: fabric.Path[] = [];
    for (const comp of this.#originalPaths) {
      const bbox = fabricPathDataToPaper(comp).bounds;
      result.push(
        new fabric.Path(comp, {
          ...options,
          scaleX: scaleX,
          scaleY: scaleY,
          left: offsetX + bbox.center.x * scaleX,
          top: offsetY + bbox.center.y * scaleY,
        }),
      );
    }
    return result;
  }

  exportSvg(): string {
    let svgData = "";
    for (const comp of this.#originalPaths) {
      svgData += `<path d="${fabricPathDataToSVG(comp)}" />\n`;
    }
    return `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  ${svgData}
</svg>`;
  }

  intersectBoundsList(boundsList: Bounds[], threshold: number = 0.5) {
    const result: TSimplePathData[] = [];
    for (const compoundPath of this.#originalPaths) {
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
    this.#originalPaths = this.#originalPaths.filter((path, index) =>
      pred(path, index),
    );
    this.#skeletons = null;
  }

  async getMedialSkeleton(): Promise<FittedMedialAxisGraph[]> {
    if (this.#skeletons === null) {
      if (this.#skeletonPromise === null) {
        this.#skeletonPromise = Promise.all(
          this.#originalPaths.map((subpath) =>
            pathWorkerPool.skeletonizePath(subpath),
          ),
        );
      }
      this.#skeletons = await this.#skeletonPromise;
    }
    return this.#skeletons;
  }

  // used for testing
  getMedialSkeletonSync(verbose: boolean = false): FittedMedialAxisGraph[] {
    if (this.#skeletons !== null) return this.#skeletons;
    this.#skeletons = this.#originalPaths.map((path) =>
      skeletonize(path, verbose),
    );
    return this.#skeletons;
  }

  async scalePath(
    index: number,
    scaleX: number,
    scaleY: number,
    {
      scaleStroke,
      strokeWidth,
      doSimplify,
      threaded,
      verbose,
    }: {
      // 0 means stroke is fixed, 1 means fully scaled
      scaleStroke?: number;
      // the original font's average stroke width
      strokeWidth?: number;
      doSimplify?: boolean;
      threaded?: boolean;
      verbose?: boolean;
    } = {},
  ): Promise<TSimplePathData> {
    scaleStroke = scaleStroke ?? 0.6;
    strokeWidth = strokeWidth ?? 60.0;
    doSimplify = doSimplify ?? true;
    threaded = threaded ?? true;
    verbose = verbose ?? false;

    if (index < 0 || index >= this.#originalPaths.length) {
      throw new Error(`Invalid subpath index: ${index}`);
    }

    const path = this.#originalPaths[index];
    const options: PathScaleOptions = {
      scaleX,
      scaleY,
      scaleStroke,
      strokeWidth,
      doSimplify,
      verbose,
    };

    if (!threaded) {
      const skeleton = this.getMedialSkeletonSync()[index];
      return scalePath(path, skeleton, options);
    } else {
      const skeleton = (await this.getMedialSkeleton())[index];
      return pathWorkerPool.scalePath(path, skeleton, options);
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
