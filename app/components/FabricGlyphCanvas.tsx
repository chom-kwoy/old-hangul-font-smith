import { amber, blue } from "@mui/material/colors";
import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import React, { useCallback, useEffect, useRef } from "react";

import {
  adjustStroke,
  adjustStrokes,
  bakeFabricPath,
  bonePathData,
  cloneDeformedSkeleton,
  getTransform,
  primitiveColors,
  setFabricPathData,
} from "@/app/components/glyphCanvas/fabricGeometry";
import { useBackgroundPaths } from "@/app/components/glyphCanvas/useBackgroundPaths";
import { useFabricCanvas } from "@/app/components/glyphCanvas/useFabricCanvas";
import {
  PathObjects,
  SkeletonHandle,
  SkeletonSub,
} from "@/app/components/glyphCanvas/types";
import PathData from "@/app/pathUtils/PathData";
import { pathWorkerPool } from "@/app/pathUtils/PathWorkerPool";
import { fabricPathDataToPaper } from "@/app/pathUtils/convert";
import { DeformedSkeleton } from "@/app/pathUtils/skeleton/deform";
import { Coalescer } from "@/app/utils/Coalescer";
import {
  createPathControls,
  deselectPathControls,
} from "@/app/utils/pathControl";

const HANDLE_RADIUS_PX = 6;

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

// Syncs every currently-selected skeleton handle's absolute position back into
// its sub's S', then redraws bones + requests a deform. Driven by canvas-level
// transform events so it works for single drags AND ActiveSelection (group)
// move/scale/rotate, which don't fire the per-object "moving" event. Absolute
// centres are read from calcTransformMatrix (via getTransform), which composes
// any parent-group transform — left/top would be group-relative mid-drag.
function syncActiveSkeletonHandles(canvas: fabric.Canvas) {
  const affected = new Set<SkeletonSub>();
  for (const obj of canvas.getActiveObjects()) {
    const meta = (obj as SkeletonHandle).skeletonHandle;
    if (!meta) continue;
    const { sub, pointIdx } = meta;
    const t = getTransform(obj);
    const prev = sub.sPrime.points[pointIdx];
    const dx = t.translateX - prev.x;
    const dy = t.translateY - prev.y;
    if (dx === 0 && dy === 0) continue;
    sub.sPrime.points[pointIdx] = { x: t.translateX, y: t.translateY };
    // Drag the anchor's adjacent bezier control points along by the same delta
    // (cp1 belongs to a segment's start anchor, cp2 to its end anchor).
    const cps = sub.sPrime.controlPoints;
    if (cps) {
      sub.segments.forEach(([a, b], si) => {
        const cp = cps[si];
        if (!cp) return;
        if (a === pointIdx) cp[0] = { x: cp[0].x + dx, y: cp[0].y + dy };
        if (b === pointIdx) cp[1] = { x: cp[1].x + dx, y: cp[1].y + dy };
      });
    }
    sub.dirty = true;
    affected.add(sub);
  }
  for (const sub of affected) {
    setFabricPathData(sub.bones, bonePathData(sub.sPrime, sub.segments));
    adjustStroke(sub.bones);
    sub.deformCoalescer.request(sub.sPrime);
  }
  if (affected.size > 0) canvas.requestRenderAll();
}

// After an ActiveSelection scale/rotate, fabric bakes the group's scale/angle
// into each child, leaving handles the wrong size/orientation. Disband the
// selection and rebuild every handle from S' (the synced source of truth) at
// unit scale/angle, so position and on-screen size are both correct.
function resetSkeletonHandles(canvas: fabric.Canvas, subs: SkeletonSub[]) {
  canvas.discardActiveObject();
  for (const sub of subs) {
    sub.handles.forEach((handle, i) => {
      const pt = sub.sPrime.points[i];
      handle.set({ left: pt.x, top: pt.y, scaleX: 1, scaleY: 1, angle: 0 });
      adjustStroke(handle);
      handle.setCoords();
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
  const isScale = action === "scale" || action === "scaleX" || action === "scaleY";
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

let nextCanvasInstanceId = 0;

export function FabricGlyphCanvas({
  path,
  bgPaths = [],
  width,
  height,
  interactive,
  onPathChanged,
  className,
  enableRescaling,
  skeletonEditMode,
}: {
  path: PathData | null;
  bgPaths?: PathData[];
  width: number;
  height: number;
  interactive: boolean;
  onPathChanged?: (path: PathData | null) => void;
  className?: string;
  enableRescaling?: boolean;
  skeletonEditMode?: boolean;
}) {
  enableRescaling = enableRescaling ?? true;
  skeletonEditMode = skeletonEditMode ?? false;

  const canvasElemRef = useRef<HTMLCanvasElement | null>(null);
  const instanceIdRef = useRef<number>(nextCanvasInstanceId++);

  const pathObjectsRef = useRef<PathObjects[]>([]);
  const skeletonSubsRef = useRef<SkeletonSub[]>([]);
  const currentPathRef = useRef<PathData | null>(null);

  // Keep latest callback in a ref so fabric event closures never go stale
  const onPathChangedRef = useRef(onPathChanged);
  onPathChangedRef.current = onPathChanged;

  // Reset content refs whenever a fresh canvas is created, so the content
  // effects rebuild onto it. Runs (from useFabricCanvas) before those effects.
  // Skeleton fabric objects are owned by the canvas and vanish on dispose; the
  // skeleton effect rebuilds them (its session data is rebuilt on re-enter).
  const resetContent = useCallback(() => {
    pathObjectsRef.current = [];
    skeletonSubsRef.current = [];
    currentPathRef.current = null;
  }, []);

  // Effect 1: canvas lifecycle (creation, grid, pan/zoom).
  const { canvas, canvasRef } = useFabricCanvas(
    canvasElemRef,
    width,
    height,
    interactive,
    resetContent,
  );

  // Interaction wiring: drag/scale/rotate of outline paths and skeleton handles.
  // Lives here (not in useFabricCanvas) because it spans both concerns; attaches
  // to the live canvas and re-attaches when it's recreated.
  useEffect(() => {
    if (!canvas || !interactive) return;

    // Set when a group scale/rotate has distorted handle size/angle, so the
    // gesture-end handler knows to rebuild them from S' (see resetSkeletonHandles).
    let skeletonNeedsReset = false;
    const onMoving = () => {
      for (const obj of canvas.getActiveObjects()) {
        const state = pathObjectsRef.current.find((p) => p.main === obj);
        if (state) handleMove(state);
      }
      syncActiveSkeletonHandles(canvas);
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
        if ((obj as SkeletonHandle).skeletonHandle) skeletonNeedsReset = true;
      }
      syncActiveSkeletonHandles(canvas);
    };
    // Group scale/rotate moves handle centres; the per-object events don't fire
    // for an ActiveSelection, so sync at the canvas level for every transform
    // and rebuild distorted handles once the gesture finishes.
    const onRotating = () => {
      if (
        canvas
          .getActiveObjects()
          .some((o) => (o as SkeletonHandle).skeletonHandle)
      )
        skeletonNeedsReset = true;
      syncActiveSkeletonHandles(canvas);
    };
    const onModified = (opt: { transform?: { action?: string } }) => {
      // Commit outline move/scale/rotate/point edits back to the PathData so
      // they're undoable and saved (no-op in skeleton mode — outline isn't
      // interactive there, so nothing committable is in the active set).
      if (currentPathRef.current) {
        const committed = commitOutlineModified(
          canvas,
          opt.transform?.action,
          pathObjectsRef.current,
          currentPathRef.current,
        );
        if (committed) onPathChangedRef.current?.(committed);
      }
      syncActiveSkeletonHandles(canvas);
      if (skeletonNeedsReset) {
        skeletonNeedsReset = false;
        resetSkeletonHandles(canvas, skeletonSubsRef.current);
      }
      canvas.requestRenderAll();
    };

    canvas.on("object:moving", onMoving);
    canvas.on("object:scaling", onScaling);
    canvas.on("object:rotating", onRotating);
    canvas.on("object:modified", onModified);
    return () => {
      // Skip if the canvas was already disposed (recreation nulls the ref first).
      // Intentionally reads the live ref at cleanup time to detect that.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (canvasRef.current !== canvas) return;
      canvas.off("object:moving", onMoving);
      canvas.off("object:scaling", onScaling);
      canvas.off("object:rotating", onRotating);
      canvas.off("object:modified", onModified);
    };
  }, [canvas, canvasRef, interactive, enableRescaling]);

  // Effect 2: background reference glyphs.
  useBackgroundPaths(
    canvasRef,
    bgPaths,
    width,
    height,
    interactive,
    enableRescaling,
  );

  // Effect 3: foreground path — runs after canvas init when path or dimensions change.
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
  }, [canvasRef, path, width, height, interactive, enableRescaling]);

  // Tracks which deform rigs (by rigKey) are built in the worker pool for this
  // canvas instance, so resize-driven re-renders reuse them instead of
  // rebuilding, and they can be released on exit/unmount.
  const builtRigsRef = useRef<Set<string>>(new Set());

  // Effect S1: skeleton editing session — renders interactive bones + vertex
  // handles + a deformed-outline preview, and wires per-vertex dragging.
  // Recreated whenever the canvas, path, or mode changes; rig build is lazy.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive || !skeletonEditMode) return;
    const basePath = currentPathRef.current;
    if (!basePath) return;

    const instanceId = instanceIdRef.current;
    let valid = true;

    // Disable the static outline and hide its filled display while editing.
    for (const po of pathObjectsRef.current) {
      po.main.selectable = false;
      po.main.evented = false;
      po.display.visible = false;
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();

    const subs: SkeletonSub[] = [];
    skeletonSubsRef.current = subs;

    (async () => {
      const skeletons = await basePath.getMedialSkeleton();
      if (!valid || !skeletons) return;

      for (let i = 0; i < skeletons.length; i++) {
        const fitted = skeletons[i];
        const rigKey = `${instanceId}:${i}`;
        const sPrime = cloneDeformedSkeleton(fitted);

        // Build the rig once per (instance, subpath); reused across resizes.
        // Pass the subpath so the worker re-skeletonizes it for live geometry.
        if (!builtRigsRef.current.has(rigKey)) {
          builtRigsRef.current.add(rigKey);
          pathWorkerPool.buildDeformRig(rigKey, basePath.getSubPath(i));
        }

        // One translucent, coloured fabric.Path per primitive (parallel to
        // fitted.primitives / the worker's rig primitives). Seeded empty and
        // populated by an identity deformCapsules request below.
        const nSegs = fitted.segments.length;
        const capsules = fitted.primitives.map((prim) => {
          const { fill, stroke } = primitiveColors(prim, nSegs);
          return new fabric.Path([["M", 0, 0]], {
            fill,
            stroke,
            strokeWidth: 1.5,
            visible: false,
            selectable: false,
            evented: false,
          });
        });

        const boneData = bonePathData(sPrime, fitted.segments);
        const bbounds = fabricPathDataToPaper(boneData).bounds;
        const bones = new fabric.Path(boneData, {
          left: bbounds.center.x,
          top: bbounds.center.y,
          stroke: amber[400],
          strokeWidth: 2,
          fill: null,
          selectable: false,
          evented: false,
        });

        const sub: SkeletonSub = {
          index: i,
          rigKey,
          segments: fitted.segments,
          sPrime,
          dirty: false,
          bones,
          handles: [],
          capsules,
          deformCoalescer: new Coalescer<DeformedSkeleton>(async (sp) => {
            const result = await pathWorkerPool.deformCapsules(rigKey, sp);
            if (!valid) return;
            for (let j = 0; j < capsules.length; j++) {
              const data = result[j];
              if (!data || data.length === 0) {
                capsules[j].set({ visible: false });
                continue;
              }
              setFabricPathData(capsules[j], data);
              capsules[j].set({ visible: true });
              adjustStroke(capsules[j]);
            }
            canvas.requestRenderAll();
          }),
        };

        for (let p = 0; p < sPrime.points.length; p++) {
          const pointIdx = p;
          const pt = sPrime.points[p];
          const handle = new fabric.Circle({
            left: pt.x,
            top: pt.y,
            originX: "center",
            originY: "center",
            radius: HANDLE_RADIUS_PX / canvas.getZoom(),
            fill: "white",
            stroke: blue[700],
            strokeWidth: 1.5,
            hasControls: false,
            hasBorders: false,
            selectable: true,
            evented: true,
          });
          const h = handle as SkeletonHandle;
          h.handleBaseRadiusPx = HANDLE_RADIUS_PX;
          h.skeletonHandle = { sub, pointIdx };
          // Movement (single or grouped) is synced at the canvas level — see
          // syncActiveSkeletonHandles wired to object:moving/scaling/rotating.
          sub.handles.push(handle);
        }

        subs.push(sub);
        canvas.add(...sub.capsules, bones, ...sub.handles);
        // Populate the capsules with the identity deform.
        sub.deformCoalescer.request(sub.sPrime);
      }
      adjustStrokes(canvas);
      canvas.requestRenderAll();
    })();

    return () => {
      valid = false;
      for (const sub of subs) sub.deformCoalescer.cancel();
      // Only touch the canvas if it's still the live one. On width/height change
      // useFabricCanvas's cleanup disposes it first (nulling the ref) and drops
      // these objects for us; touching a disposed canvas would throw.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (canvasRef.current !== canvas) return;
      for (const sub of subs) {
        canvas.remove(...sub.capsules, sub.bones, ...sub.handles);
      }
      // Restore the outline (commit + rig release happen in Effect S2/S3).
      for (const po of pathObjectsRef.current) {
        if (po.disposed) continue;
        po.main.selectable = interactive;
        po.main.evented = interactive;
        po.display.visible = true;
      }
      canvas.requestRenderAll();
    };
  }, [canvasRef, path, width, height, interactive, skeletonEditMode]);

  // Effect S2: commit on leaving skeleton-edit mode (true → false). Fires a
  // final deform for each edited subpath and writes the result back through
  // onPathChanged (undoable). Rigs are NOT released here — they're kept cached
  // so toggling the mode off and on reuses them (rig lifetime is tied to the
  // path; see Effect S3). The final deformOutline is awaited before onPathChanged
  // fires, so the path-change release in S3 runs only after the rig is done.
  const prevSkeletonModeRef = useRef(false);
  useEffect(() => {
    const exiting = prevSkeletonModeRef.current && !skeletonEditMode;
    prevSkeletonModeRef.current = skeletonEditMode;
    if (!exiting) return;

    const subs = skeletonSubsRef.current;
    const basePath = currentPathRef.current;
    skeletonSubsRef.current = [];

    (async () => {
      const replacements = new Map<number, TSimplePathData>();
      for (const sub of subs) {
        if (!sub.dirty) continue;
        const outline = await pathWorkerPool.deformOutline(
          sub.rigKey,
          sub.sPrime,
        );
        if (outline) replacements.set(sub.index, outline);
      }
      if (replacements.size > 0 && basePath) {
        onPathChangedRef.current?.(basePath.withReplacedSubPaths(replacements));
      }
    })();
  }, [skeletonEditMode]);

  // Effect S3: rig lifetime tied to path identity. Rebuilding a rig means
  // re-skeletonizing, so we cache rigs and release them only when the path they
  // were built from changes (they're then stale) or on unmount. Toggling
  // skeleton mode off/on with the same path reuses the cached rigs.
  useEffect(() => {
    // builtRigsRef.current is a stable Set instance (mutated, never reassigned),
    // so this reference sees every key added during this path's lifetime.
    const builtRigs = builtRigsRef.current;
    return () => {
      for (const key of builtRigs) {
        pathWorkerPool.releaseDeformRig(key);
      }
      builtRigs.clear();
    };
  }, [path]);

  // Effect 4: Delete/Backspace key handling, scoped to this canvas instance.
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
  }, [canvasRef]);

  // Wrap canvas in a div so React unmounts the outer div rather than the canvas
  // element itself. fabric.js moves the canvas into its own wrapper div on init,
  // so if React owned the canvas directly it would fail to remove it on unmount.
  return (
    <div className={className} style={{ width, height }}>
      <canvas ref={canvasElemRef} />
    </div>
  );
}
