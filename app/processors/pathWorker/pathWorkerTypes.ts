import { TSimplePathData } from "fabric";

import {
  DeformedSkeleton,
  WarpOptions,
} from "@/app/pathUtils/skeleton/deform";
import { FittedMedialAxisGraph } from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { PathScaleOptions } from "@/app/pathUtils/skeleton/skeleton";

export type MessageToPathWorker =
  | SkeletonizePathRequest
  | ScalePathRequest
  | BuildDeformRigRequest
  | DeformOutlineRequest
  | ReleaseDeformRigRequest;

export interface SkeletonizePathRequest {
  type: "skeletonizePath";
  reqId: number;
  path: TSimplePathData;
}

export interface ScalePathRequest {
  type: "scalePath";
  reqId: number;
  path: TSimplePathData;
  skeleton: FittedMedialAxisGraph;
  options: PathScaleOptions;
}

// Builds a DeformRig for `path` and stores it in the worker keyed by `rigKey`.
// The worker re-skeletonizes the subpath itself rather than receiving a fitted
// skeleton: the rig (and the skeletonize result it derives from) hold live
// paper.PathItem references — `clippedPath`, etc. — that don't survive
// structured cloning, so they must be regenerated inside the worker. skeletonize
// is deterministic, so the resulting points/segments match the main-thread
// skeleton used to render the handles. The rig never crosses back out; only the
// key does, so deformOutline requests for it must be routed to the same worker
// (see PathWorkerPool.requestPinned).
export interface BuildDeformRigRequest {
  type: "buildDeformRig";
  reqId: number;
  rigKey: string;
  path: TSimplePathData;
  options?: WarpOptions;
}

// Applies a previously built rig to a deformed skeleton S' and returns the
// reconstructed outline. Must be routed to the worker that holds `rigKey`.
export interface DeformOutlineRequest {
  type: "deformOutline";
  reqId: number;
  rigKey: string;
  sPrime: DeformedSkeleton;
}

// Drops a stored rig to free memory once a skeleton-edit session ends.
export interface ReleaseDeformRigRequest {
  type: "releaseDeformRig";
  reqId: number;
  rigKey: string;
}

export type MessageFromPathWorker =
  | SkeletonizePathResult
  | ScalePathResult
  | BuildDeformRigResult
  | DeformOutlineResult
  | ReleaseDeformRigResult;

export interface SkeletonizePathResult {
  type: "skeletonizePath";
  reqId: number;
  skeleton: FittedMedialAxisGraph;
}

export interface ScalePathResult {
  type: "scalePath";
  reqId: number;
  path: TSimplePathData;
}

export interface BuildDeformRigResult {
  type: "buildDeformRig";
  reqId: number;
  rigKey: string;
}

export interface DeformOutlineResult {
  type: "deformOutline";
  reqId: number;
  // null when the deform produced an empty outline.
  path: TSimplePathData | null;
}

export interface ReleaseDeformRigResult {
  type: "releaseDeformRig";
  reqId: number;
  rigKey: string;
}
