import { amber, blue } from "@mui/material/colors";
import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import { RefObject, useEffect, useRef } from "react";

import {
  adjustStroke,
  adjustStrokes,
  bonePathData,
  cloneDeformedSkeleton,
  getTransform,
  primitiveColors,
  setFabricPathData,
} from "@/app/components/glyphCanvas/fabricGeometry";
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

const HANDLE_RADIUS_PX = 6;

let nextCanvasInstanceId = 0;

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

// Interactive skeleton deformation: renders coloured deformed capsules, bones and
// draggable vertex handles; syncs handle drags (single or grouped) into S' and a
// coalesced worker deform; commits the deformed outline on mode exit; and caches
// the per-subpath deform rigs (tied to path identity). Reads/disables the outline
// path objects (owned by useOutlinePaths) while a session is active.
export function useSkeletonEditing({
  canvas,
  canvasRef,
  path,
  width,
  height,
  interactive,
  skeletonEditMode,
  pathObjectsRef,
  currentPathRef,
  onPathChangedRef,
  skeletonSubsRef,
}: {
  canvas: fabric.Canvas | null;
  canvasRef: RefObject<fabric.Canvas | null>;
  path: PathData | null;
  width: number;
  height: number;
  interactive: boolean;
  skeletonEditMode: boolean;
  pathObjectsRef: RefObject<PathObjects[]>;
  currentPathRef: RefObject<PathData | null>;
  onPathChangedRef: RefObject<((path: PathData | null) => void) | undefined>;
  skeletonSubsRef: RefObject<SkeletonSub[]>;
}) {
  const instanceIdRef = useRef<number>(nextCanvasInstanceId++);
  // Which deform rigs (by rigKey) are built in the worker pool for this canvas
  // instance, so resize re-renders reuse them and they can be released later.
  const builtRigsRef = useRef<Set<string>>(new Set());

  // Transform wiring (skeleton slice): keep S' in sync through every canvas-level
  // transform, and rebuild distorted handles once a group scale/rotate finishes.
  useEffect(() => {
    if (!canvas || !interactive) return;

    let skeletonNeedsReset = false;
    const hasHandle = () =>
      canvas.getActiveObjects().some((o) => (o as SkeletonHandle).skeletonHandle);
    const onMoving = () => syncActiveSkeletonHandles(canvas);
    const onScaling = () => {
      if (hasHandle()) skeletonNeedsReset = true;
      syncActiveSkeletonHandles(canvas);
    };
    const onRotating = () => {
      if (hasHandle()) skeletonNeedsReset = true;
      syncActiveSkeletonHandles(canvas);
    };
    const onModified = () => {
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (canvasRef.current !== canvas) return;
      canvas.off("object:moving", onMoving);
      canvas.off("object:scaling", onScaling);
      canvas.off("object:rotating", onRotating);
      canvas.off("object:modified", onModified);
    };
  }, [canvas, canvasRef, interactive, skeletonSubsRef]);

  // Effect S1: editing session — renders bones + handles + capsule preview, and
  // wires per-vertex dragging. Recreated when the canvas, path, or mode changes.
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const po of pathObjectsRef.current) {
        if (po.disposed) continue;
        po.main.selectable = interactive;
        po.main.evented = interactive;
        po.display.visible = true;
      }
      canvas.requestRenderAll();
    };
  }, [
    canvasRef,
    path,
    width,
    height,
    interactive,
    skeletonEditMode,
    pathObjectsRef,
    currentPathRef,
    skeletonSubsRef,
  ]);

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
  }, [skeletonEditMode, currentPathRef, onPathChangedRef, skeletonSubsRef]);

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
}
