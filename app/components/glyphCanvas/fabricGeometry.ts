import * as fabric from "fabric";
import { TSimplePathData } from "fabric";

import { fabricPathDataToPaper } from "@/app/pathUtils/convert";
import { DeformedSkeleton } from "@/app/pathUtils/skeleton/deform";
import { FittedMedialAxisGraph } from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { Vec2D } from "@/app/utils/types";

// Decomposes an object's absolute transform (translate / scale / rotation).
// Uses calcTransformMatrix so it composes any parent ActiveSelection transform.
export function getTransform(obj: fabric.FabricObject) {
  const mat = obj.calcTransformMatrix();
  return fabric.util.qrDecompose(mat);
}

// Keeps a path's outline stroke (and a skeleton handle's radius) a constant
// on-screen size regardless of zoom / object scale.
export function adjustStroke(obj_: fabric.FabricObject) {
  const obj = obj_ as typeof obj_ & {
    originalScale: number | undefined;
    originalStrokeWidth: number | undefined;
    handleBaseRadiusPx?: number;
  };
  if (obj.originalStrokeWidth === undefined) {
    obj.originalStrokeWidth = obj.strokeWidth;
  }
  const zoom = obj.canvas!.getZoom();
  const objScale = (obj.scaleX + obj.scaleY) / 2;
  const multiplier = 1 / zoom / objScale;
  obj.set("strokeWidth", obj.originalStrokeWidth * multiplier);
  // Keep skeleton handles a constant on-screen size regardless of zoom.
  if (obj.handleBaseRadiusPx !== undefined) {
    obj.set("radius", obj.handleBaseRadiusPx / zoom);
    obj.setCoords();
  }
}

export function adjustStrokes(canvas: fabric.Canvas) {
  canvas.forEachObject(adjustStroke);
}

// Builds curve-aware bone path data for a deformed skeleton: a cubic when the
// segment carries control points, otherwise a straight line.
export function bonePathData(
  graph: DeformedSkeleton,
  segments: [number, number][],
) {
  const data: TSimplePathData = [];
  segments.forEach(([a, b], i) => {
    const p0 = graph.points[a];
    const p1 = graph.points[b];
    const cp = graph.controlPoints?.[i];
    data.push(["M", p0.x, p0.y]);
    if (cp) {
      data.push(["C", cp[0].x, cp[0].y, cp[1].x, cp[1].y, p1.x, p1.y]);
    } else {
      data.push(["L", p1.x, p1.y]);
    }
  });
  return data;
}

// Per-primitive preview colours (test6_deform scheme): one hue per edge spread
// over the segment count, vertex disks red. Fill is translucent so overlapping
// capsules read as the composed glyph.
export function primitiveColors(
  prim: { type: "point" | "edge"; elementIdx: number },
  nSegs: number,
): { fill: string; stroke: string } {
  if (prim.type === "edge") {
    const hue = Math.round((prim.elementIdx * 360) / Math.max(1, nSegs));
    return {
      fill: `hsla(${hue}, 70%, 60%, 0.22)`,
      stroke: `hsl(${hue}, 70%, 35%)`,
    };
  }
  return { fill: "rgba(255,100,100,0.22)", stroke: "rgb(255,0,0)" };
}

// Deep-copies a fitted skeleton's editable fields into a fresh S' for editing.
export function cloneDeformedSkeleton(
  fitted: FittedMedialAxisGraph,
): DeformedSkeleton {
  return {
    points: fitted.points.map((p) => ({ x: p.x, y: p.y })),
    controlPoints: fitted.controlPoints?.map(
      ([c1, c2]) =>
        [
          { x: c1.x, y: c1.y },
          { x: c2.x, y: c2.y },
        ] as [Vec2D, Vec2D],
    ),
  };
}

// Replaces a fabric.Path's geometry with new absolute-coordinate path data,
// re-centring its origin so it renders in place (mirrors how display/skeleton
// overlay paths are positioned at their bbox centre).
export function setFabricPathData(obj: fabric.Path, data: TSimplePathData) {
  const bounds = fabricPathDataToPaper(data).bounds;
  obj.set({ path: data });
  obj.setBoundingBox();
  obj.setDimensions();
  obj.set({ left: bounds.center.x, top: bounds.center.y });
  obj.setCoords();
}
