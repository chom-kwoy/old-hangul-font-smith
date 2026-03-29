export class WorkerHarness<
  MessageToWorkerT extends { type: string; reqId: number },
  MessageFromWorkerT extends { type: string; reqId: number },
> {
  readonly #workerLoadedPromise: Promise<Worker> | null = null;
  #worker: Worker | null = null;

  constructor(worker: Worker | null) {
    if (worker !== null) {
      this.#workerLoadedPromise = new Promise((resolve) => {
        // Listen for the first message from the worker
        const initialMessageHandler = (event: MessageEvent) => {
          if (event.data === "workerReady") {
            console.log("Worker is fully loaded and ready.");
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

  async requestTask<
    R extends Omit<MessageToWorkerT, "reqId"> & { type: string },
  >(request: R): Promise<Extract<MessageFromWorkerT, { type: R["type"] }>> {
    type Ret = Extract<MessageFromWorkerT, { type: R["type"] }>;
    const worker = await this.getWorker();
    if (worker === null) {
      throw new Error("PathWorker is not initialized");
    }
    const start = performance.now();
    return new Promise((resolve, reject) => {
      const reqId = Math.random();
      const listener = (event: MessageEvent<MessageFromWorkerT>) => {
        const msg = event.data;
        if (msg.reqId === reqId) {
          worker?.removeEventListener("message", listener);
          if (msg.type === request.type) {
            console.log(
              `got response for ${msg.type} in`,
              performance.now() - start,
              "ms",
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
  }
}
