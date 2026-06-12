import { amber, blue, teal } from "@mui/material/colors";
import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import React, { useEffect, useRef } from "react";

import PathData from "@/app/pathUtils/PathData";
import { pathWorkerPool } from "@/app/pathUtils/PathWorkerPool";
import { fabricPathDataToPaper } from "@/app/pathUtils/convert";
import { DeformedSkeleton } from "@/app/pathUtils/skeleton/deform";
import { FittedMedialAxisGraph } from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { Coalescer } from "@/app/utils/Coalescer";
import {
  createPathControls,
  deselectPathControls,
} from "@/app/utils/pathControl";
import { Vec2D } from "@/app/utils/types";

type PathObjects = {
  main: fabric.Path;
  display: fabric.Path;
  baseScaleX: number;
  baseScaleY: number;
  boundOffsetX: number;
  boundOffsetY: number;
  origCenter: Vec2D;
  editing: boolean;
  scaleCoalescer: Coalescer<{ scaleX: number; scaleY: number }> | null;
  disposed: boolean;
};

// Per-subpath state for an interactive skeleton-editing session.
type SkeletonSub = {
  index: number; // subpath index (parallel to PathData subpaths / skeletons)
  rigKey: string; // worker-pinned deform rig key
  segments: [number, number][]; // skeleton bone connectivity (from original S)
  sPrime: DeformedSkeleton; // live edited points/controlPoints (mutable)
  dirty: boolean; // a vertex has been moved → needs commit on exit
  bones: fabric.Path; // curve-aware centreline overlay (non-evented)
  handles: fabric.Circle[]; // draggable vertex handles, parallel to points
  capsules: fabric.Path[]; // deformed per-primitive preview (non-evented)
  deformCoalescer: Coalescer<DeformedSkeleton>;
};

const HANDLE_RADIUS_PX = 6;

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

function adjustStroke(obj_: fabric.FabricObject) {
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

// Builds curve-aware bone path data for a deformed skeleton: a cubic when the
// segment carries control points, otherwise a straight line.
function bonePathData(graph: DeformedSkeleton, segments: [number, number][]) {
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
function primitiveColors(
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
function cloneDeformedSkeleton(
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
function setFabricPathData(obj: fabric.Path, data: TSimplePathData) {
  const bounds = fabricPathDataToPaper(data).bounds;
  obj.set({ path: data });
  obj.setBoundingBox();
  obj.setDimensions();
  obj.set({ left: bounds.center.x, top: bounds.center.y });
  obj.setCoords();
}

function adjustStrokes(canvas: fabric.Canvas) {
  canvas.forEachObject(adjustStroke);
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
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const viewportRef = useRef<fabric.TMat2D | null>(null);
  const instanceIdRef = useRef<number>(nextCanvasInstanceId++);

  const pathObjectsRef = useRef<PathObjects[]>([]);
  const bgPathObjectsRef = useRef<fabric.Path[]>([]);
  const skeletonSubsRef = useRef<SkeletonSub[]>([]);
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

    if (interactive) {
      canvas.on("object:moving", () => {
        const activeObjects = canvas.getActiveObjects();
        for (const obj of activeObjects) {
          const state = pathObjectsRef.current.find((p) => p.main === obj);
          if (state) handleMove(state);
        }
      });
      canvas.on("object:scaling", () => {
        const activeObjects = canvas.getActiveObjects();
        for (const obj of activeObjects) {
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
      });
    }

    canvas.viewportTransform = viewportRef.current ?? initialVpt;
    adjustStrokes(canvas);

    // Reset content refs so the content effects below repopulate the new canvas.
    // Skeleton fabric objects are owned by the canvas and vanish on dispose; the
    // skeleton effect rebuilds them (its session data is rebuilt on re-enter).
    pathObjectsRef.current = [];
    bgPathObjectsRef.current = [];
    skeletonSubsRef.current = [];
    currentPathRef.current = null;

    fabricCanvasRef.current = canvas;

    return () => {
      canvas?.dispose();
      fabricCanvasRef.current = null;
    };
  }, [interactive, width, height, enableRescaling]);

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
  }, [path, width, height, interactive, enableRescaling]);

  // Tracks which deform rigs (by rigKey) are built in the worker pool for this
  // canvas instance, so resize-driven re-renders reuse them instead of
  // rebuilding, and they can be released on exit/unmount.
  const builtRigsRef = useRef<Set<string>>(new Set());

  // Effect S1: skeleton editing session — renders interactive bones + vertex
  // handles + a deformed-outline preview, and wires per-vertex dragging.
  // Recreated whenever the canvas, path, or mode changes; rig build is lazy.
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
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
          (
            handle as fabric.Circle & { handleBaseRadiusPx?: number }
          ).handleBaseRadiusPx = HANDLE_RADIUS_PX;
          handle.on("moving", () => {
            const c = handle.getCenterPoint();
            const prev = sub.sPrime.points[pointIdx];
            const dx = c.x - prev.x;
            const dy = c.y - prev.y;
            sub.sPrime.points[pointIdx] = { x: c.x, y: c.y };
            // Drag the anchor's adjacent bezier control points along with it so
            // the bone curve translates rigidly near the moved vertex (cp1 of a
            // segment belongs to its start anchor, cp2 to its end anchor).
            const cps = sub.sPrime.controlPoints;
            if (cps) {
              sub.segments.forEach(([a, b], si) => {
                const cp = cps[si];
                if (!cp) return;
                if (a === pointIdx) {
                  cp[0] = { x: cp[0].x + dx, y: cp[0].y + dy };
                }
                if (b === pointIdx) {
                  cp[1] = { x: cp[1].x + dx, y: cp[1].y + dy };
                }
              });
            }
            sub.dirty = true;
            setFabricPathData(
              sub.bones,
              bonePathData(sub.sPrime, sub.segments),
            );
            adjustStroke(sub.bones);
            sub.deformCoalescer.request(sub.sPrime);
            canvas.requestRenderAll();
          });
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
      // Effect 1's cleanup disposes it first (nulling the ref) and drops these
      // objects for us; touching a disposed canvas would throw.
      if (fabricCanvasRef.current !== canvas) return;
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
  }, [path, width, height, interactive, skeletonEditMode]);

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
      const canvas = fabricCanvasRef.current;
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
