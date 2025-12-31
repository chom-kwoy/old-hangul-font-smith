import * as fabric from "fabric";
import { TComplexPathData } from "fabric";

import { pathBounds, toBezier } from "@/app/bezier";

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

export function toFabricPath(
  path: TComplexPathData,
  width: number,
  height: number,
  {
    offsetX,
    offsetY,
    ...options
  }: { offsetX?: number; offsetY?: number } & Partial<fabric.PathProps> = {},
): fabric.Path {
  offsetX = offsetX || 0;
  offsetY = offsetY || 0;
  const bbox = pathBounds(toBezier(path));
  const bboxWidth = bbox.right - bbox.left;
  const bboxHeight = bbox.bottom - bbox.top;
  return new fabric.Path(path, {
    ...options,
    left: offsetX + (bbox.left + bboxWidth / 2) * (width / 1000),
    top: offsetY + (bbox.top + bboxHeight / 2) * (height / 1000),
    scaleX: width / 1000,
    scaleY: height / 1000,
  });
}
