"use client";

import { TSimplePathData } from "fabric";
import opentype from "opentype.js";
import paper from "paper";

import { fabricToCompoundPath, paperToFabricPath } from "@/app/fabricUtils";
import { Bounds, PathData } from "@/app/types";

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
  return { paths: [data] };
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
