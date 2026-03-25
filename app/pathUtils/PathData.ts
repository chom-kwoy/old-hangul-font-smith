import Shape from "@doodle3d/clipper-js";
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

  getRegAndBold(strokeWidth: number, boldnessFactor: number) {
    const skeletons = this.getMedialSkeleton();

    function getPrimitivePoints(primitives: Primitive[]) {
      return primitives.map((primitive) => {
        return primitive.origins.map((origin, i) => {
          const dir = primitive.directions[i];
          const rad = primitive.radii[i];
          return origin.add(dir.multiply(rad));
        });
      });
    }

    const offsetAmount = strokeWidth * (boldnessFactor - 1.0);

    const regular: paper.Point[][][] = [];
    const bold: paper.Point[][][] = [];
    for (const skeleton of skeletons) {
      const regPrimitives = getPrimitivePoints(skeleton.primitives);
      const boldPrimitives = regPrimitives.map((primitive, i) => {
        const regPoints = regPrimitives[i];
        const scale = 1000.0; // needs to be scaled for clipper js lib
        const shape = new Shape(
          [primitive.map((p) => ({ X: p.x * scale, Y: p.y * scale }))],
          true,
        );
        const boldShape = shape.offset(offsetAmount * scale, {});
        let boldPoints = boldShape
          .mapToLower()[0]
          .map((p) => new paper.Point(p.x / scale, p.y / scale))
          .toReversed();

        // interpolate points so that they are spaced roughly 1 unit apart
        const interpolated: paper.Point[] = [];
        const tgtDst = 1.0;
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
        boldPoints = interpolated;

        // match first points
        const firstOrigin = skeleton.primitives[i].origins[0];
        const firstDir = skeleton.primitives[i].directions[0];
        const firstRad = skeleton.primitives[i].radii[0];
        const line = new paper.Path.Line(
          firstOrigin,
          firstOrigin.add(firstDir.multiply(firstRad)),
        );
        let minDst = Infinity;
        let minIdx = 0;
        for (let j = 0; j < boldPoints.length; ++j) {
          const nearest = line.getNearestPoint(boldPoints[j]);
          const dst = nearest.getDistance(boldPoints[j]);
          if (dst < minDst) {
            minDst = dst;
            minIdx = j;
          }
        }
        // shuffle list so that minIdx becomes 0th index
        boldPoints = boldPoints
          .slice(minIdx)
          .concat(boldPoints.slice(0, minIdx));

        const mapping = matchTwoShapes(regPoints, boldPoints);

        return mapping.map((j) => boldPoints[j]);
      });

      bold.push(boldPrimitives);
      regular.push(regPrimitives);
    }

    return { regular, bold };
  }

  scalePath(
    index: number,
    scaleX: number,
    scaleY: number,
    {
      scaleStroke,
      strokeWidth,
      boldnessFactor,
      verbose,
    }: {
      // 0 means stroke is fixed, 1 means fully scaled
      scaleStroke?: number;
      // the original font's average stroke width
      strokeWidth?: number;
      boldnessFactor?: number;
      verbose?: boolean;
    } = {},
  ): void {
    scaleStroke = scaleStroke ?? 0.6;
    strokeWidth = strokeWidth ?? 60.0;
    boldnessFactor = boldnessFactor ?? 1.4;
    verbose = verbose ?? false;

    const skeletons = this.getMedialSkeleton();
    const regAndBold = this.getRegAndBold(strokeWidth, boldnessFactor);
    if (index < 0 || index >= skeletons.length) {
      throw new Error(`Invalid subpath index: ${index}`);
    }
    const skeleton = skeletons[index];
    const regPrimitives = regAndBold.regular[index];
    const boldPrimitives = regAndBold.bold[index];

    function pr(pt: { x: number; y: number }, xoffset = 0, yoffset = 0) {
      return `(${(xoffset + pt.x).toFixed(1)},${(yoffset + 1000 - pt.y).toFixed(1)})`;
    }

    if (verbose) {
      console.log("generated bold primitives: ");
      boldPrimitives.map((prim, i) => {
        console.log(
          `bold primitive #${i}: ${prim.length} vertices\n` +
            prim.map((p) => pr(p, 500)).join(",") +
            "\n",
        );
      });
    }

    const alpha = scaleStroke;
    const b = boldnessFactor;
    const rawQx = (Math.pow(scaleX, alpha - 1) - b) / (1 - b);
    const rawQy = (Math.pow(scaleY, alpha - 1) - b) / (1 - b);

    const clip = (x: number) => Math.max(0, Math.min(1, x));
    const qx = clip(rawQx);
    const qy = clip(rawQy);

    if (verbose) {
      console.log("scaleX, scaleY: ", scaleX, scaleY);
      console.log("rawQx, rawQy: ", rawQx, rawQy);
      console.log("qx, qy: ", qx, qy);
    }

    const newPrimitives: paper.Path[] = [];
    for (let i = 0; i < skeleton.primitives.length; ++i) {
      const regPrimitive = regPrimitives[i];
      const boldPrimitive = boldPrimitives[i];
      const newSegments: { x: number; y: number }[] = [];
      for (let j = 0; j < regPrimitive.length; ++j) {
        const pr = regPrimitive[j];
        const pb = boldPrimitive[j];
        const newPoint = new paper.Point({
          x: qx * pr.x + (1 - qx) * pb.x,
          y: qy * pr.y + (1 - qy) * pb.y,
        });
        newSegments.push(newPoint);
      }

      if (verbose) {
        console.log(
          `generated new primitive ${i}:\n` +
            newSegments.map((p) => pr(p, 1000)).join(",") +
            "\n",
        );
      }
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

function matchTwoShapes(
  shapeA: paper.Point[],
  shapeB: paper.Point[],
): number[] {
  const n = shapeA.length;
  const m = shapeB.length;

  if (n === 0 || m === 0) return [];

  const dtw: number[][] = Array.from({ length: n }, () =>
    Array(m).fill(Infinity),
  );

  // Initialize the starting point
  dtw[0][0] = shapeA[0].getDistance(shapeB[0]);

  // Fill the first column
  for (let i = 1; i < n; i++) {
    dtw[i][0] = dtw[i - 1][0] + shapeA[i].getDistance(shapeB[0]);
  }

  // Fill the first row
  for (let j = 1; j < m; j++) {
    dtw[0][j] = dtw[0][j - 1] + shapeA[0].getDistance(shapeB[j]);
  }

  // Populate the rest of the cost matrix
  for (let i = 1; i < n; i++) {
    for (let j = 1; j < m; j++) {
      const cost = shapeA[i].getDistance(shapeB[j]);
      dtw[i][j] =
        cost +
        Math.min(
          dtw[i - 1][j], // insertion
          dtw[i][j - 1], // deletion
          dtw[i - 1][j - 1], // match
        );
    }
  }

  const mapping: number[] = new Array(n);
  let i = n - 1;
  let j = m - 1;

  // Backtrack to find the optimal path
  while (i > 0 || j > 0) {
    mapping[i] = j;

    if (i === 0) {
      j--;
    } else if (j === 0) {
      i--;
    } else {
      const minCost = Math.min(dtw[i - 1][j - 1], dtw[i - 1][j], dtw[i][j - 1]);

      // Determine the direction of the optimal step
      if (minCost === dtw[i - 1][j - 1]) {
        i--;
        j--;
      } else if (minCost === dtw[i - 1][j]) {
        i--;
      } else {
        j--;
      }
    }
  }

  // Map the starting point
  mapping[0] = 0;

  return mapping;
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
