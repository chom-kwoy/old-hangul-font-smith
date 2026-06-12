import { TSimplePathData } from "fabric";

import {
  DeformedSkeleton,
  WarpOptions,
} from "@/app/pathUtils/skeleton/deform";
import { FittedMedialAxisGraph } from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { PathScaleOptions } from "@/app/pathUtils/skeleton/skeleton";
import {
  MessageFromPathWorker,
  MessageToPathWorker,
} from "@/app/processors/pathWorker/pathWorkerTypes";
import { WorkerPool } from "@/app/utils/WorkerHarness";

class PathWorkerPool extends WorkerPool<
  MessageToPathWorker,
  MessageFromPathWorker
> {
  constructor(numWorkers: number) {
    const workerFactory = () => {
      if (typeof window !== "undefined") {
        return new Worker(
          new URL("../processors/pathWorker/pathWorker.ts", import.meta.url),
          { type: "module" },
        );
      } else {
        return null;
      }
    };
    super(workerFactory, numWorkers);
  }

  async skeletonizePath(path: TSimplePathData): Promise<FittedMedialAxisGraph> {
    const result = await this.requestTask({ type: "skeletonizePath", path });
    return result.skeleton;
  }

  async scalePath(
    path: TSimplePathData,
    skeleton: FittedMedialAxisGraph,
    options: PathScaleOptions,
  ): Promise<TSimplePathData> {
    const result = await this.requestTask({
      type: "scalePath",
      path,
      skeleton,
      options,
    });
    return result.path;
  }

  // Builds and stores a deform rig in the pinned worker for `rigKey`. The worker
  // re-skeletonizes `path` to obtain live paper geometry for the rig.
  async buildDeformRig(
    rigKey: string,
    path: TSimplePathData,
    options?: WarpOptions,
  ): Promise<void> {
    await this.requestPinned(rigKey, {
      type: "buildDeformRig",
      rigKey,
      path,
      options,
    });
  }

  // Applies the stored rig for `rigKey` to a deformed skeleton S'.
  async deformOutline(
    rigKey: string,
    sPrime: DeformedSkeleton,
  ): Promise<TSimplePathData | null> {
    const result = await this.requestPinned(rigKey, {
      type: "deformOutline",
      rigKey,
      sPrime,
    });
    return result.path;
  }

  // Applies the stored rig for `rigKey` and returns the per-primitive capsules
  // (pre-union), parallel to the rig's primitives, for live preview.
  async deformCapsules(
    rigKey: string,
    sPrime: DeformedSkeleton,
  ): Promise<(TSimplePathData | null)[]> {
    const result = await this.requestPinned(rigKey, {
      type: "deformCapsules",
      rigKey,
      sPrime,
    });
    return result.capsules;
  }

  // Frees the stored rig and its worker pin.
  async releaseDeformRig(rigKey: string): Promise<void> {
    await this.requestPinned(rigKey, {
      type: "releaseDeformRig",
      rigKey,
    });
    this.releasePin(rigKey);
  }
}

export const pathWorkerPool = new PathWorkerPool(4);
