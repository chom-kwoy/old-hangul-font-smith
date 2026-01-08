import { TSimplePathData } from "fabric";
import opentype from "opentype.js";
import paper from "paper";

import {
  fabricToCompoundPath,
  fabricToSVG,
  paperToFabricPath,
} from "@/app/utils/fabricUtils";
import { Bounds, PathData } from "@/app/utils/types";

export function opentypeToPathData(
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
  return splitPaths(data);
}

export function svgToPathData(svg: string): PathData {
  // parse xml string
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(svg, "image/svg+xml");
  const pathElements = xmlDoc.getElementsByTagName("path");

  const result: PathData = { paths: [] };
  for (const pathElement of pathElements) {
    const d = pathElement.getAttribute("d");
    if (d) {
      const compoundPath = new paper.CompoundPath(d);
      compoundPath.closePath();
      result.paths.push(paperToFabricPath(compoundPath));
    }
  }

  return result;
}

// returns shapes that overlap the bounds list
export function intersectCompoundPath(
  compoundPath: paper.CompoundPath,
  boundsList: Bounds[],
  threshold: number = 0.5,
): paper.CompoundPath {
  const newPaths = new paper.CompoundPath("");
  for (const path of compoundPath.children) {
    if (path instanceof paper.Path) {
      const bbox = path.bounds;
      const bboxArea =
        Math.max(0, bbox.right - bbox.left) *
        Math.max(0, bbox.bottom - bbox.top);

      let intersectionArea = 0;
      for (const bounds of boundsList) {
        const intersection = {
          left: Math.max(bounds.left, bbox.left),
          right: Math.min(bounds.right, bbox.right),
          top: Math.max(bounds.top, bbox.top),
          bottom: Math.min(bounds.bottom, bbox.bottom),
        };
        intersectionArea +=
          Math.max(0, intersection.right - intersection.left) *
          Math.max(0, intersection.bottom - intersection.top);
      }

      if (intersectionArea / bboxArea >= threshold) {
        newPaths.addChild(new paper.Path(path.pathData));
      }
    }
  }
  return newPaths;
}

export function intersectPathData(
  bezier: PathData,
  boundsList: Bounds[],
  threshold: number = 0.5,
): PathData {
  const result: PathData = {
    paths: [],
  };
  for (const compoundPath of bezier.paths) {
    result.paths.push(
      paperToFabricPath(
        intersectCompoundPath(
          fabricToCompoundPath(compoundPath),
          boundsList,
          threshold,
        ),
      ),
    );
  }
  return result;
}

// splits a single compound path into multiple paths, preserving holes
// assumes there is no overlap between subpaths
export function splitPaths(path: TSimplePathData): PathData {
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
  const result: PathData = { paths: [] };
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
      result.paths.push(compoundPath);
    }
  }
  return result;
}

export function pathDataToSVG(path: PathData): string {
  let svgData = "";
  for (const comp of path.paths) {
    svgData += `<path d="${fabricToSVG(comp)}" />\n`;
  }
  return `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  ${svgData}
</svg>`;
}
