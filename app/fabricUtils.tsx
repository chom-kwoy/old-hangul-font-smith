import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import paper from "paper";

import { PathData } from "@/app/types";

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
  compoundPath: paper.CompoundPath,
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

export function fabricToSVG(path: TSimplePathData): string {
  const data: string[] = [];
  for (const cmd of path) {
    switch (cmd[0]) {
      case "M": // move to
        data.push(`M ${cmd[1]},${cmd[2]}`);
        break;
      case "L": // line to
        data.push(`L ${cmd[1]},${cmd[2]}`);
        break;
      case "Q": // quadratic bezier curve
        data.push(`Q ${cmd[1]},${cmd[2]}, ${cmd[3]},${cmd[4]}`);
        break;
      case "C": // cubic bezier curve
        data.push(
          `C ${cmd[1]},${cmd[2]} ${cmd[3]},${cmd[4]} ${cmd[5]},${cmd[6]}`,
        );
        break;
      case "Z": // close path
        data.push("Z");
        break;
    }
  }
  return data.join("\n");
}

export function fabricToCompoundPath(
  path: TSimplePathData,
): paper.CompoundPath {
  return new paper.CompoundPath(fabricToSVG(path));
}
