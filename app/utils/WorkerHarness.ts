export interface WorkerErrorResponse {
  type: "error";
  reqId: number;
  error: string;
}

export class WorkerHarness<
  ReqT extends { type: string; reqId: number },
  RetT extends { type: string; reqId: number },
> {
  readonly #workerLoadedPromise: Promise<Worker> | null = null;
  #worker: Worker | null = null;
  #pendingTasks: Map<number, Promise<RetT>> = new Map();
  readonly #workerId: number;

  constructor(worker: Worker | null, workerId: number = 0) {
    this.#workerId = workerId;
    if (worker !== null) {
      this.#workerLoadedPromise = new Promise((resolve) => {
        // Listen for the first message from the worker
        const initialMessageHandler = (event: MessageEvent) => {
          if (event.data === "workerReady") {
            console.log(`Worker ${this.#workerId} is fully loaded and ready.`);
            // Remove the one-time listener and resolve the promise
            worker.removeEventListener("message", initialMessageHandler);
            this.#worker = worker;
            resolve(worker);
          }
        };
        worker.addEventListener("message", initialMessageHandler);
      });
    }
  }

  async getWorker(): Promise<Worker | null> {
    if (this.#worker === null) {
      return this.#workerLoadedPromise;
    }
    return this.#worker;
  }

  async requestTask<R extends Omit<ReqT, "reqId"> & { type: string }>(
    request: R,
  ): Promise<Extract<RetT, { type: R["type"] }>> {
    type Ret = Extract<RetT, { type: R["type"] }>;
    const reqId = Math.random();
    const promise = this.getWorker().then((worker) => {
      if (worker === null) {
        throw new Error("PathWorker is not initialized");
      }
      const start = performance.now();
      return new Promise<Ret>((resolve, reject) => {
        const listener = (event: MessageEvent<RetT | WorkerErrorResponse>) => {
          const msg = event.data;
          if (msg.reqId === reqId) {
            worker?.removeEventListener("message", listener);
            if (msg.type === "error") {
              reject(new Error((msg as WorkerErrorResponse).error));
            } else if (msg.type === request.type) {
              console.debug(
                `Worker ${this.#workerId}: got response for ${msg.type} in ${(performance.now() - start).toFixed(1)}ms\n` +
                  `Remaining tasks: ${this.#pendingTasks.size - 1}`,
              );
              resolve(msg as Ret);
            } else {
              reject(new Error(`Unexpected message type: ${msg.type}`));
            }
          }
        };
        worker.addEventListener("message", listener);
        worker.postMessage({
          reqId: reqId,
          ...request,
        });
      });
    });
    this.#pendingTasks.set(reqId, promise);
    promise.finally(() => {
      this.#pendingTasks.delete(reqId);
    });
    return promise;
  }

  getNumPending(): number {
    return this.#pendingTasks.size;
  }
}

export class WorkerPool<
  ReqT extends { type: string; reqId: number },
  RetT extends { type: string; reqId: number },
> {
  readonly #workers: WorkerHarness<ReqT, RetT>[];

  constructor(workerFactory: () => Worker | null, poolSize: number) {
    this.#workers = Array.from(
      { length: poolSize },
      (v, i) => new WorkerHarness<ReqT, RetT>(workerFactory(), i),
    );
  }

  async requestTask<R extends Omit<ReqT, "reqId"> & { type: string }>(
    request: R,
  ): Promise<Extract<RetT, { type: R["type"] }>> {
    // find worker with least pending tasks
    const worker = this.#workers.reduce((prev, curr) =>
      prev.getNumPending() <= curr.getNumPending() ? prev : curr,
    );
    return worker.requestTask(request);
  }
}
