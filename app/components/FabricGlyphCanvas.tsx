import { amber, teal } from "@mui/material/colors";
import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import paper from "paper";
import React, { useEffect, useRef } from "react";

import PathData from "@/app/pathUtils/PathData";
import { fabricPathDataToPaper } from "@/app/pathUtils/convert";
import {
  createPathControls,
  deselectPathControls,
} from "@/app/utils/pathControl";

type PathObjects = {
  main: fabric.Path;
  display: fabric.Path;
  baseScaleX: number;
  baseScaleY: number;
  boundOffsetX: number;
  boundOffsetY: number;
  origCenter: { x: number; y: number };
  editing: boolean;
};

function getTransform(obj: fabric.FabricObject) {
  const mat = obj.calcTransformMatrix();
  return fabric.util.qrDecompose(mat);
}

function handleMove(state: PathObjects) {
  const mainTransform = getTransform(state.main);
  state.display.left = mainTransform.translateX + state.boundOffsetX;
  state.display.top = mainTransform.translateY + state.boundOffsetY;
  state.main.canvas?.requestRenderAll();
}

function handleScale(
  state: PathObjects,
  pathData: PathData,
  subPathIndex: number,
  enableRescaling: boolean,
) {
  const mainTransform = getTransform(state.main);
  state.display.scaleX = mainTransform.scaleX / state.baseScaleX;
  state.display.scaleY = mainTransform.scaleY / state.baseScaleY;
  state.display.left = mainTransform.translateX + state.boundOffsetX;
  state.display.top = mainTransform.translateY + state.boundOffsetY;
  adjustStroke(state.display);
  state.main.canvas?.requestRenderAll();

  if (enableRescaling) {
    const scaleX = mainTransform.scaleX;
    const scaleY = mainTransform.scaleY;
    pathData
      .scalePath(subPathIndex, scaleX, scaleY, {
        strokeWidth: 40.0,
        doSimplify: false,
        verbose: false,
      })
      .then((scaled) => {
        if (scaled) {
          state.baseScaleX = scaleX;
          state.baseScaleY = scaleY;

          const bounds = fabricPathDataToPaper(scaled).bounds;
          state.boundOffsetX = bounds.center.x - state.origCenter.x;
          state.boundOffsetY = bounds.center.y - state.origCenter.y;

          const mainTransform = getTransform(state.main);
          state.display.scaleX = mainTransform.scaleX / state.baseScaleX;
          state.display.scaleY = mainTransform.scaleY / state.baseScaleY;
          state.display.left = mainTransform.translateX + state.boundOffsetX;
          state.display.top = mainTransform.translateY + state.boundOffsetY;

          state.display.set({ path: scaled });
          state.display.setBoundingBox();
          state.display.setDimensions();
          state.display.setCoords();

          adjustStroke(state.display);
          state.main.canvas?.requestRenderAll();
        }
      });
  }
}

function adjustStroke(obj_: fabric.FabricObject) {
  const obj = obj_ as typeof obj_ & {
    originalScale: number | undefined;
    originalStrokeWidth: number | undefined;
  };
  if (obj.originalStrokeWidth === undefined) {
    obj.originalStrokeWidth = obj.strokeWidth;
  }
  const objScale = (obj.scaleX + obj.scaleY) / 2;
  const multiplier = 1 / obj.canvas!.getZoom() / objScale;
  obj.set("strokeWidth", obj.originalStrokeWidth * multiplier);
}

function adjustStrokes(canvas: fabric.Canvas) {
  canvas.forEachObject(adjustStroke);
}

export function FabricGlyphCanvas({
  path,
  bgPaths = [],
  width,
  height,
  interactive,
  onPathChanged,
  className,
  enableRescaling,
}: {
  path: PathData | null;
  bgPaths?: PathData[];
  width: number;
  height: number;
  interactive: boolean;
  onPathChanged?: (path: PathData | null) => void;
  className?: string;
  enableRescaling?: boolean;
}) {
  enableRescaling = enableRescaling ?? true;

  const canvasElemRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const viewportRef = useRef<fabric.TMat2D | null>(null);

  const pathObjectsRef = useRef<PathObjects[]>([]);
  const bgPathObjectsRef = useRef<fabric.Path[]>([]);
  const otherObjectsRef = useRef<fabric.FabricObject[]>([]);
  const currentPathRef = useRef<PathData | null>(null);

  // Keep latest callback in a ref so fabric event closures never go stale
  const onPathChangedRef = useRef(onPathChanged);
  onPathChangedRef.current = onPathChanged;

  // Effect 1: canvas lifecycle — runs when interactive or dimensions change.
  // Must be defined FIRST so React runs it before the content effects below.
  useEffect(() => {
    if (!canvasElemRef.current) return;

    const canvas = new fabric.Canvas(canvasElemRef.current, {
      width,
      height,
      backgroundColor: "white",
      selectionFullyContained: true,
    });

    const minZoom = Math.min(width, height) / 1000;
    const tx = width / 2 - 500 * minZoom;
    const ty = height / 2 - 500 * minZoom;
    const initialVpt: fabric.TMat2D = [minZoom, 0, 0, minZoom, tx, ty];

    canvas.selection = interactive;

    // Gridlines
    const horzGrid: fabric.XY[] = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ];
    const vertGrid: fabric.XY[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1000 },
    ];
    const N_MINOR = 10;
    for (let i = 1; i < N_MINOR; ++i) {
      canvas.add(
        new fabric.Polyline(horzGrid, {
          left: 1000 / 2,
          top: (i * 1000) / N_MINOR,
          stroke: "lightgrey",
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }),
      );
      canvas.add(
        new fabric.Polyline(vertGrid, {
          left: (i * 1000) / N_MINOR,
          top: 1000 / 2,
          stroke: "lightgrey",
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }),
      );
    }
    for (const grid of [horzGrid, vertGrid]) {
      canvas.add(
        new fabric.Polyline(grid, {
          left: 1000 / 2,
          top: 1000 / 2,
          stroke: "red",
          strokeWidth: 1,
          selectable: false,
          evented: false,
        }),
      );
    }

    // Pan and zoom
    let isDragging = false;
    let lastPosX: number | null = null;
    let lastPosY: number | null = null;

    function constrainViewport(c: fabric.Canvas) {
      const vpt = c.viewportTransform;
      vpt[4] = Math.min(vpt[4], 0);
      vpt[4] = Math.max(vpt[4], width - 1000 * (vpt[0] + vpt[2]));
      vpt[5] = Math.min(vpt[5], 0);
      vpt[5] = Math.max(vpt[5], height - 1000 * (vpt[1] + vpt[3]));
      c.setViewportTransform(c.viewportTransform);
    }

    canvas.on("mouse:wheel", function (opt) {
      if (opt.e.ctrlKey) {
        const delta = opt.e.deltaY;
        let zoom = canvas.getZoom();
        zoom *= 0.997 ** delta;
        zoom = Math.min(Math.max(zoom, minZoom), 20 * minZoom);
        canvas.zoomToPoint(
          new fabric.Point(opt.e.offsetX, opt.e.offsetY),
          zoom,
        );
        constrainViewport(canvas);
        canvas.setViewportTransform(canvas.viewportTransform);
        viewportRef.current = canvas.viewportTransform;
        adjustStrokes(canvas);
        canvas.requestRenderAll();
        opt.e.preventDefault();
        opt.e.stopPropagation();
      }
    });
    canvas.on("mouse:down:before", function (opt) {
      if ((opt.e as MouseEvent).ctrlKey) canvas.isDrawingMode = false;
    });
    canvas.on("mouse:down", function (opt) {
      const evt = opt.e as MouseEvent;
      if (evt.ctrlKey) {
        isDragging = true;
        canvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        const obj = canvas.getActiveObject();
        if (obj) {
          obj.lockMovementX = true;
          obj.lockMovementY = true;
        }
      }
    });
    canvas.on("mouse:move", function (opt) {
      if (isDragging && lastPosX !== null && lastPosY !== null) {
        const e = opt.e as MouseEvent;
        const vpt = canvas.viewportTransform;
        vpt[4] += e.clientX - lastPosX;
        vpt[5] += e.clientY - lastPosY;
        constrainViewport(canvas);
        viewportRef.current = vpt;
        canvas.requestRenderAll();
        lastPosX = e.clientX;
        lastPosY = e.clientY;
      }
    });
    canvas.on("mouse:up", function () {
      if (isDragging) {
        canvas.setViewportTransform(canvas.viewportTransform);
        isDragging = false;
        canvas.selection = true;
        for (const obj of canvas.getObjects()) {
          obj.lockMovementX = false;
          obj.lockMovementY = false;
        }
      }
    });

    canvas.viewportTransform = viewportRef.current ?? initialVpt;
    adjustStrokes(canvas);

    // Reset content refs so the content effects below repopulate the new canvas
    pathObjectsRef.current = [];
    bgPathObjectsRef.current = [];
    otherObjectsRef.current = [];
    currentPathRef.current = null;

    fabricCanvasRef.current = canvas;

    return () => {
      canvas?.dispose();
      fabricCanvasRef.current = null;
    };
  }, [interactive, width, height]);

  // Effect 2: background paths — runs after canvas init when bgPaths or dimensions change.
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    for (const obj of bgPathObjectsRef.current) {
      canvas.remove(obj);
    }
    bgPathObjectsRef.current = [];

    for (const p of bgPaths) {
      bgPathObjectsRef.current.push(
        ...p.makeFabricPaths({
          selectable: false,
          evented: false,
          strokeWidth: 2,
          stroke: teal[800],
          fill: "transparent",
          opacity: 0.3,
        }),
      );
    }
    canvas.add(...bgPathObjectsRef.current);
    for (const obj of bgPathObjectsRef.current) {
      canvas.sendObjectToBack(obj);
    }
    adjustStrokes(canvas);
  }, [bgPaths, width, height, interactive, enableRescaling]);

  // Effect 3: foreground path — runs after canvas init when path or dimensions change.
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    if (JSON.stringify(currentPathRef.current) === JSON.stringify(path)) return;

    currentPathRef.current = path ? path.clone() : null;

    // asynchronously compute the medial axis skeleton
    currentPathRef.current?.getMedialSkeleton();

    for (const obj of pathObjectsRef.current) {
      canvas.remove(obj.main);
      canvas.remove(obj.display);
    }
    pathObjectsRef.current = [];
    for (const obj of otherObjectsRef.current) {
      canvas.remove(obj);
    }
    otherObjectsRef.current = [];

    const pathSelectable = interactive;
    const mainFabricPaths =
      currentPathRef.current !== null
        ? currentPathRef.current.makeFabricPaths({
            selectable: pathSelectable,
            evented: pathSelectable,
            fill: "#FF000001",
            stroke: "#FF000001",
            strokeWidth: interactive ? 3 : 0,
            perPixelTargetFind: true,
          })
        : [];
    const displayFabricPaths =
      currentPathRef.current !== null
        ? currentPathRef.current.makeFabricPaths({
            selectable: false,
            evented: false,
            fill: "black",
            stroke: amber[600],
            strokeWidth: interactive ? 3 : 0,
            perPixelTargetFind: true,
          })
        : [];
    pathObjectsRef.current.push(
      ...mainFabricPaths.map((mainPath, i) => {
        const origBounds = mainPath.getBoundingRect();
        const origCenter = {
          x: origBounds.left + origBounds.width / 2,
          y: origBounds.top + origBounds.height / 2,
        };
        return {
          main: mainPath,
          display: displayFabricPaths[i],
          baseScaleX: 1.0,
          baseScaleY: 1.0,
          boundOffsetX: 0,
          boundOffsetY: 0,
          origCenter,
          editing: false,
        };
      }),
    );

    if (interactive) {
      canvas.on("object:moving", () => {
        const activeObjects = canvas.getActiveObjects();
        for (const obj of activeObjects) {
          const state = pathObjectsRef.current.find((p) => p.main === obj);
          if (state) {
            handleMove(state);
          }
        }
      });
      canvas.on("object:scaling", () => {
        const activeObjects = canvas.getActiveObjects();
        for (const obj of activeObjects) {
          const idx = pathObjectsRef.current.findIndex((p) => p.main === obj);
          if (idx >= 0 && currentPathRef.current) {
            const state = pathObjectsRef.current[idx];
            handleScale(state, currentPathRef.current, idx, enableRescaling);
          }
        }
      });
      for (let i = 0; i < mainFabricPaths.length; ++i) {
        const state = pathObjectsRef.current[i];
        state.main.on("mousedblclick", () => {
          state.editing = !state.editing;
          if (state.editing) {
            state.main.controls = createPathControls(state.main, {
              pointStyle: {
                controlSize: 10.0,
                controlFill: "white",
                controlStroke: "blue",
                controlStyle: "rect",
              },
              controlPointStyle: {
                controlSize: 10.0,
                controlFill: "transparent",
                controlStroke: "white",
                connectionStroke: "blue",
                strokeCompositeOperation: "difference",
              },
            });
            state.main.hasBorders = false;
          } else {
            state.main.controls =
              fabric.controlsUtils.createObjectDefaultControls();
            state.main.hasBorders = true;
            deselectPathControls();
          }
          state.main.setCoords();
          canvas.requestRenderAll();
        });
        state.main.on("deselected", () => {
          deselectPathControls();
        });
      }
    }

    canvas.add(...mainFabricPaths, ...displayFabricPaths);
    adjustStrokes(canvas);

    let isValid = true;
    currentPathRef.current?.getMedialSkeleton().then((medialSkeletons) => {
      if (!isValid || !medialSkeletons) {
        // Don't update the canvas if the path has changed
        return;
      }
      const medialAxisLines = medialSkeletons.map((skeleton) => {
        const pathData = skeleton.segments.flatMap((seg): TSimplePathData => {
          const p0 = skeleton.points[seg[0]];
          const p1 = skeleton.points[seg[1]];
          return [["M", p0.x, p0.y], ["L", p1.x, p1.y], ["Z"]];
        });
        const bbox = fabricPathDataToPaper(pathData).bounds;
        return new fabric.Path(pathData, {
          left: bbox.center.x,
          top: bbox.center.y,
          stroke: "#FFFFAA",
          strokeWidth: 2,
          selectable: false,
          evented: false,
        });
      });
      const localPrimitives = medialSkeletons.flatMap((skeleton) => {
        return skeleton.primitives.map((prim, primIdx) => {
          const path: TSimplePathData = [];
          for (let i = 0; i < prim.origins.length; ++i) {
            const origin = prim.origins[i];
            const dir = prim.directions[i];
            const r = prim.radii[i];
            const pt = new paper.Point(origin).add(
              new paper.Point(dir).multiply(r),
            );
            if (path.length === 0) {
              path.push(["M", pt.x, pt.y]);
            } else {
              path.push(["L", pt.x, pt.y]);
            }
          }
          path.push(["Z"]);
          const bbox = fabricPathDataToPaper(path).bounds;
          const color = [
            "#AAAAFF",
            "#FFAAAA",
            "#AAFFAA",
            "#ffd1fa",
            "#96f8ff",
            "#ffdac1",
            "#72ffdb",
          ][primIdx % 7];
          return new fabric.Path(path, {
            left: bbox.center.x,
            top: bbox.center.y,
            stroke: color,
            strokeWidth: 2,
            fill: null,
            selectable: false,
            evented: false,
          });
        });
      });
      otherObjectsRef.current.push(...medialAxisLines, ...localPrimitives);
      canvas.add(...medialAxisLines, ...localPrimitives);
      adjustStrokes(canvas);
    });

    return () => {
      isValid = false;
    };
  }, [path, width, height, interactive, enableRescaling]);

  // Effect 4: Delete/Backspace key handling, scoped to this canvas instance.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const canvas = fabricCanvasRef.current;
      if (!canvas || !currentPathRef.current) return;

      const activeObjects = canvas.getActiveObjects();
      if (activeObjects.length === 0) return;

      canvas.discardActiveObject();
      for (const obj of activeObjects) canvas.remove(obj);
      canvas.requestRenderAll();

      currentPathRef.current.filterPaths((_, i) => {
        return !activeObjects.includes(pathObjectsRef.current[i].main);
      });
      pathObjectsRef.current = pathObjectsRef.current.filter(
        (fp) => !activeObjects.includes(fp.main),
      );
      onPathChangedRef.current?.(currentPathRef.current.clone());
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Wrap canvas in a div so React unmounts the outer div rather than the canvas
  // element itself. fabric.js moves the canvas into its own wrapper div on init,
  // so if React owned the canvas directly it would fail to remove it on unmount.
  return (
    <div className={className} style={{ width, height }}>
      <canvas ref={canvasElemRef} />
    </div>
  );
}
