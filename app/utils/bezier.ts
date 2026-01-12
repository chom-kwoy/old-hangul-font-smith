import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import paper from "paper";

import { Bounds } from "@/app/utils/types";

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

export function paperToFabricPathData(path: paper.PathItem): TSimplePathData {
  // TODO: avoid creating an object for performance
  return new fabric.Path(path.pathData).path;
}

type FabicToSvgOptions = {
  scaleX?: number;
  scaleY?: number;
  dontClose?: boolean;
};

export function fabricPathDataToSVG(
  path: TSimplePathData,
  options?: FabicToSvgOptions,
): string {
  const scaleX = options?.scaleX || 1.0;
  const scaleY = options?.scaleY || 1.0;
  const dontClose = options?.dontClose || false;
  const data: string[] = [];
  for (const cmd of path) {
    switch (cmd[0]) {
      case "M": // move to
        data.push(`M ${cmd[1] * scaleX},${cmd[2] * scaleY}`);
        break;
      case "L": // line to
        data.push(`L ${cmd[1] * scaleX},${cmd[2] * scaleY}`);
        break;
      case "Q": // quadratic bezier curve
        data.push(
          `Q ${cmd[1] * scaleX},${cmd[2] * scaleY} ` +
            `${cmd[3] * scaleX},${cmd[4] * scaleY}`,
        );
        break;
      case "C": // cubic bezier curve
        data.push(
          `C ${cmd[1] * scaleX},${cmd[2] * scaleY} ` +
            `${cmd[3] * scaleX},${cmd[4] * scaleY} ` +
            `${cmd[5] * scaleX},${cmd[6] * scaleY}`,
        );
        break;
      case "Z": // close path
        if (!dontClose) {
          data.push("Z");
        }
        break;
    }
  }
  return data.join("\n");
}

export function fabricPathDataToPaper(
  path: TSimplePathData,
  options?: FabicToSvgOptions,
): paper.CompoundPath {
  const svg = fabricPathDataToSVG(path, options);
  const result = new paper.CompoundPath(svg);
  if (options?.dontClose) {
    result.closed = false;
  }
  return result;
}
