import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import paper from "paper";

import { PathData } from "@/app/utils/types";

// Set global fabric.js defaults
fabric.InteractiveFabricObject.ownDefaults = {
  ...fabric.InteractiveFabricObject.ownDefaults,
  cornerStrokeColor: "white",
  cornerColor: "lightblue",
  cornerStyle: "circle",
  cornerSize: 12,
  padding: 0,
  transparentCorners: false,
  borderColor: "grey",
  borderScaleFactor: 1.2,
};

export function paperToFabricPath(
  compoundPath: paper.PathItem,
): TSimplePathData {
  // TODO: performance
  return new fabric.Path(compoundPath.pathData).path;
}

export function toFabricPaths(
  path: PathData,
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
  for (const comp of path.paths) {
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

type FabicToSvgOptions = {
  scaleX?: number;
  scaleY?: number;
  dontClose?: boolean;
};

export function fabricToSVG(
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

export function fabricToCompoundPath(
  path: TSimplePathData,
  options?: FabicToSvgOptions,
): paper.CompoundPath {
  const svg = fabricToSVG(path, options);
  const result = new paper.CompoundPath(svg);
  if (options?.dontClose) {
    result.closed = false;
  }
  return result;
}
