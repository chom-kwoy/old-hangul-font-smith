import { scalePath, skeletonize } from "@/app/pathUtils/skeleton/skeleton";
import {
  MessageFromPathWorker,
  MessageToPathWorker,
} from "@/app/processors/pathWorker/pathWorkerTypes";
import { WorkerErrorResponse } from "@/app/utils/WorkerHarness";
import { initDrawContexts } from "@/app/utils/init";

// initialize the paper.js context
initDrawContexts();

// listen for messages from the main thread
addEventListener(
  "message",
  async (event: MessageEvent<MessageToPathWorker>) => {
    // console.log("Path worker received message:", event.data);
    try {
      postMessage(await handleEvent(event));
    } catch (err) {
      console.error("Error in path worker:", err);
      const response: WorkerErrorResponse = {
        type: "error",
        reqId: event.data.reqId,
        error: err instanceof Error ? err.message : "Unknown error",
      };
      postMessage(response);
    }
  },
);
postMessage("workerReady");

async function handleEvent(
  event: MessageEvent<MessageToPathWorker>,
): Promise<MessageFromPathWorker> {
  if (event.data.type === "skeletonizePath") {
    const subpath = event.data.path;
    return {
      type: "skeletonizePath",
      reqId: event.data.reqId,
      skeleton: skeletonize(subpath),
    };
  } else if (event.data.type === "scalePath") {
    const path = event.data.path;
    const skeleton = event.data.skeleton;
    const options = event.data.options;
    return {
      type: "scalePath",
      reqId: event.data.reqId,
      path: scalePath(path, skeleton, options),
    };
  } else {
    throw new Error("Invalid event type");
  }
}
