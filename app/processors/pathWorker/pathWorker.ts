import { paperToFabricPathData } from "@/app/pathUtils/convert";
import {
  DeformRig,
  buildDeformRig,
  deformOutlineFromRig,
} from "@/app/pathUtils/skeleton/deform";
import { scalePath, skeletonize } from "@/app/pathUtils/skeleton/skeleton";
import {
  MessageFromPathWorker,
  MessageToPathWorker,
} from "@/app/processors/pathWorker/pathWorkerTypes";
import { WorkerErrorResponse } from "@/app/utils/WorkerHarness";
import { initDrawContexts } from "@/app/utils/init";

// initialize the paper.js context
initDrawContexts();

// Deform rigs held in this worker's scope, keyed by rigKey. A rig carries
// paper.PathItem references that can't be structured-cloned back to the main
// thread, so it lives here for the duration of a skeleton-edit session. The
// pool pins all requests for a given rigKey to this worker.
const deformRigs = new Map<string, DeformRig>();

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
  } else if (event.data.type === "buildDeformRig") {
    const { rigKey, path, options } = event.data;
    // Re-skeletonize here so the rig is built from a skeleton with live paper
    // clippedPaths (those don't survive crossing the worker boundary).
    const fitted = skeletonize(path);
    deformRigs.set(rigKey, buildDeformRig(fitted, options));
    return {
      type: "buildDeformRig",
      reqId: event.data.reqId,
      rigKey,
    };
  } else if (event.data.type === "deformOutline") {
    const { rigKey, sPrime } = event.data;
    const rig = deformRigs.get(rigKey);
    if (!rig) {
      throw new Error(`No deform rig for key: ${rigKey}`);
    }
    const outline = deformOutlineFromRig(rig, sPrime);
    const path = outline ? paperToFabricPathData(outline) : null;
    // deformOutline fires once per drag frame; free the orphaned paper item so
    // results don't accumulate in the worker's project over a long edit.
    outline?.remove();
    return {
      type: "deformOutline",
      reqId: event.data.reqId,
      path,
    };
  } else if (event.data.type === "releaseDeformRig") {
    const { rigKey } = event.data;
    deformRigs.delete(rigKey);
    return {
      type: "releaseDeformRig",
      reqId: event.data.reqId,
      rigKey,
    };
  } else {
    throw new Error("Invalid event type");
  }
}
