import * as fabric from "fabric";

import { DeformedSkeleton } from "@/app/pathUtils/skeleton/deform";
import { Coalescer } from "@/app/utils/Coalescer";
import { Vec2D } from "@/app/utils/types";

// Paired fabric objects for one editable outline subpath: an invisible,
// interactive `main` that carries the transform handles, and a visible
// `display` that follows it (and is swapped for the refit result on rescale).
export type PathObjects = {
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
export type SkeletonSub = {
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

// A vertex handle tagged with its owning sub + point index, so canvas-level
// transform events (which fire for group/ActiveSelection drags that bypass the
// per-object events) can map it back to the skeleton it edits.
export type SkeletonHandle = fabric.Circle & {
  handleBaseRadiusPx?: number;
  skeletonHandle?: { sub: SkeletonSub; pointIdx: number };
};
