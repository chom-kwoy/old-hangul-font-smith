import * as fabric from "fabric";

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
    const bbox = comp.bounds;
    const bboxWidth = bbox.right - bbox.left;
    const bboxHeight = bbox.bottom - bbox.top;
    result.push(
      new fabric.Path(comp.pathData, {
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
