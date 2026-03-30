import { TSimplePathData } from "fabric";

import { FittedMedialAxisGraph } from "@/app/pathUtils/localPrimitiveFitting";
import {
  MessageFromPathWorker,
  MessageToPathWorker,
  PathScaleOptions,
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
}

export const pathWorkerPool = new PathWorkerPool(4);
