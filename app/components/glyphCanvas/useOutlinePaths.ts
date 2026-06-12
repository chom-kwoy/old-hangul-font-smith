import { amber } from "@mui/material/colors";
import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import { RefObject, useEffect } from "react";

import {
  adjustStroke,
  adjustStrokes,
  bakeFabricPath,
  getTransform,
} from "@/app/components/glyphCanvas/fabricGeometry";
import { PathObjects } from "@/app/components/glyphCanvas/types";
import PathData from "@/app/pathUtils/PathData";
import { fabricPathDataToPaper } from "@/app/pathUtils/convert";
import { Coalescer } from "@/app/utils/Coalescer";
import {
  createPathControls,
  deselectPathControls,
} from "@/app/utils/pathControl";

// Live preview while dragging the whole glyph: the visible `display` follows the
// interactive `main`.
function handleMove(state: PathObjects) {
  const mainTransform = getTransform(state.main);
  state.display.left = mainTransform.translateX + state.boundOffsetX;
  state.display.top = mainTransform.translateY + state.boundOffsetY;
  state.main.canvas?.requestRenderAll();
}

// Live preview while scaling: the display tracks the handles immediately, while a
// coalesced worker refit (stroke-aware) is swapped in as it resolves.
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
    // Coalesce refits so that at most one is in flight per path: bounds the
    // worker queue regardless of drag speed and avoids stale-result races.
    if (!state.scaleCoalescer) {
      state.scaleCoalescer = new Coalescer(async ({ scaleX, scaleY }) => {
        const scaled = await pathData.scalePath(subPathIndex, scaleX, scaleY, {
          strokeWidth: 40.0,
          doSimplify: false,
          verbose: false,
        });
        if (!scaled || state.disposed) return;
        // baseScale must match the scale we actually sent to the worker.
        state.baseScaleX = scaleX;
        state.baseScaleY = scaleY;

        const bounds = fabricPathDataToPaper(scaled).bounds;
        state.boundOffsetX = bounds.center.x - state.origCenter.x;
        state.boundOffsetY = bounds.center.y - state.origCenter.y;

        const t = getTransform(state.main);
        state.display.scaleX = t.scaleX / state.baseScaleX;
        state.display.scaleY = t.scaleY / state.baseScaleY;
        state.display.left = t.translateX + state.boundOffsetX;
        state.display.top = t.translateY + state.boundOffsetY;

        state.display.set({ path: scaled });
        state.display.setBoundingBox();
        state.display.setDimensions();
        state.display.setCoords();

        adjustStroke(state.display);
        state.main.canvas?.requestRenderAll();
      });
    }
    state.scaleCoalescer.request({
      scaleX: mainTransform.scaleX,
      scaleY: mainTransform.scaleY,
    });
  }
}

// Bakes the just-modified outline objects back into a new PathData so the edit
// lands in Redux (undoable + saved). A move/rotate/point edit is read from the
// interactive `main`; a scale is read from `display`, which already holds the
// stroke-aware refit positioned correctly. Returns null if nothing committable
// was modified (e.g. in skeleton mode, where the outline isn't interactive).
function commitOutlineModified(
  canvas: fabric.Canvas,
  action: string | undefined,
  pathObjects: PathObjects[],
  basePath: PathData,
): PathData | null {
  const isScale =
    action === "scale" || action === "scaleX" || action === "scaleY";
  const replacements = new Map<number, TSimplePathData>();
  for (const obj of canvas.getActiveObjects()) {
    const idx = pathObjects.findIndex((p) => p.main === obj);
    if (idx < 0) continue;
    const src = isScale ? pathObjects[idx].display : pathObjects[idx].main;
    replacements.set(idx, bakeFabricPath(src));
  }
  if (replacements.size === 0) return null;
  return basePath.withReplacedSubPaths(replacements);
}

// Renders the editable outline (an invisible interactive `main` per subpath plus
// a visible `display`), wires move/scale/rotate/point-edit commits back through
// onPathChanged, and handles Delete/Backspace. Owns the path objects (held in the
// passed ref so the skeleton hook can disable them while editing the skeleton).
export function useOutlinePaths({
  canvas,
  canvasRef,
  path,
  width,
  height,
  interactive,
  enableRescaling,
  pathObjectsRef,
  currentPathRef,
  onPathChangedRef,
}: {
  canvas: fabric.Canvas | null;
  canvasRef: RefObject<fabric.Canvas | null>;
  path: PathData | null;
  width: number;
  height: number;
  interactive: boolean;
  enableRescaling: boolean;
  pathObjectsRef: RefObject<PathObjects[]>;
  currentPathRef: RefObject<PathData | null>;
  onPathChangedRef: RefObject<((path: PathData | null) => void) | undefined>;
}) {
  // Foreground render: rebuild the main/display objects when the path changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (JSON.stringify(currentPathRef.current) === JSON.stringify(path)) return;

    currentPathRef.current = path ? path.clone() : null;

    // asynchronously compute the medial axis skeleton
    currentPathRef.current?.getMedialSkeleton();

    for (const obj of pathObjectsRef.current) {
      obj.disposed = true;
      canvas.remove(obj.main);
      canvas.remove(obj.display);
    }
    pathObjectsRef.current = [];

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
          scaleCoalescer: null,
          disposed: false,
        };
      }),
    );

    if (interactive) {
      for (let i = 0; i < mainFabricPaths.length; ++i) {
        const state = pathObjectsRef.current[i];
        state.main.on("mousedblclick", () => {
          state.editing = !state.editing;
          if (state.editing) {
            state.main.controls = createPathControls(state.main, {
              pointStyle: {
                controlSize: 8.0,
                controlFill: "white",
                controlStroke: "black",
                controlStyle: "diamond",
                controlStrokeWidth: 1.5,
                controlDropShadowColor: "rgba(255,255,255,1.0)",
                controlDropShadowSize: 4,
                controlSelectedFill: "#2a7fff",
                controlSelectedSize: 11.0,
              },
              controlPointStyle: {
                controlSize: 8.0,
                controlFill: "white",
                controlStroke: "black",
                controlStyle: "circle",
                controlStrokeWidth: 1.5,
                controlDropShadowColor: "rgba(255,255,255,1.0)",
                controlDropShadowSize: 4,
                controlSelectedFill: "#2a7fff",
                controlSelectedSize: 11.0,
                connectionStroke: "blue",
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
  }, [
    canvasRef,
    path,
    width,
    height,
    interactive,
    enableRescaling,
    pathObjectsRef,
    currentPathRef,
  ]);

  // Transform wiring (outline slice): live preview on move/scale, and commit on
  // gesture end. Skeleton handle syncing is wired separately by useSkeletonEditing.
  useEffect(() => {
    if (!canvas || !interactive) return;

    const onMoving = () => {
      for (const obj of canvas.getActiveObjects()) {
        const state = pathObjectsRef.current.find((p) => p.main === obj);
        if (state) handleMove(state);
      }
    };
    const onScaling = () => {
      for (const obj of canvas.getActiveObjects()) {
        const idx = pathObjectsRef.current.findIndex((p) => p.main === obj);
        if (idx >= 0 && currentPathRef.current) {
          handleScale(
            pathObjectsRef.current[idx],
            currentPathRef.current,
            idx,
            enableRescaling,
          );
        }
      }
    };
    const onModified = (opt: { transform?: { action?: string } }) => {
      if (!currentPathRef.current) return;
      const committed = commitOutlineModified(
        canvas,
        opt.transform?.action,
        pathObjectsRef.current,
        currentPathRef.current,
      );
      if (committed) onPathChangedRef.current?.(committed);
    };

    canvas.on("object:moving", onMoving);
    canvas.on("object:scaling", onScaling);
    canvas.on("object:modified", onModified);
    return () => {
      // Skip if the canvas was already disposed (recreation nulls the ref first).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (canvasRef.current !== canvas) return;
      canvas.off("object:moving", onMoving);
      canvas.off("object:scaling", onScaling);
      canvas.off("object:modified", onModified);
    };
  }, [
    canvas,
    canvasRef,
    interactive,
    enableRescaling,
    pathObjectsRef,
    currentPathRef,
    onPathChangedRef,
  ]);

  // Delete/Backspace removes the selected subpath(s) and commits.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const canvas = canvasRef.current;
      if (!canvas || !currentPathRef.current) return;

      const activeObjects = new Set(canvas.getActiveObjects());
      if (activeObjects.size === 0) return;

      const toDelete = pathObjectsRef.current.filter((p) =>
        activeObjects.has(p.main),
      );
      if (toDelete.length === 0) return;

      canvas.discardActiveObject();
      for (const p of toDelete) {
        p.disposed = true;
        canvas.remove(p.main);
        canvas.remove(p.display);
      }
      canvas.requestRenderAll();

      const deleteSet = new Set(toDelete);
      currentPathRef.current.filterPaths(
        (_, i) => !deleteSet.has(pathObjectsRef.current[i]),
      );
      pathObjectsRef.current = pathObjectsRef.current.filter(
        (p) => !deleteSet.has(p),
      );
      onPathChangedRef.current?.(currentPathRef.current.clone());
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canvasRef, pathObjectsRef, currentPathRef, onPathChangedRef]);
}
