import { TSimplePathData } from "fabric";

import { FittedMedialAxisGraph } from "@/app/pathUtils/localPrimitiveFitting";

export type MessageToPathWorker = SkeletonizePathRequest | ScalePathRequest;

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
export type PathScaleOptions = {
  scaleX: number;
  scaleY: number;
  scaleStroke: number;
  strokeWidth: number;
  doSimplify: boolean;
  verbose: boolean;
};

export type MessageFromPathWorker = SkeletonizePathResult | ScalePathResult;

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
