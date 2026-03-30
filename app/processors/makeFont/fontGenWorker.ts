import { fontGen } from "@/app/processors/makeFont/fontGen";
import {
  MessageFromFontGenWorker,
  MessageToFontGenWorker,
} from "@/app/processors/makeFont/fontGenWorkerTypes";
import { WorkerErrorResponse } from "@/app/utils/WorkerHarness";

addEventListener(
  "message",
  async (event: MessageEvent<MessageToFontGenWorker>) => {
    console.log("Font worker received message:", event.data);
    try {
      if (event.data.type === "generateFont") {
        console.log("Generating font from buffer...");
        const blob = await fontGen(
          event.data.buffer,
          event.data.jamoVarsets,
          event.data.options,
        );
        console.log("Font generation completed, sending back result...");
        const message: MessageFromFontGenWorker = {
          type: "generateFont",
          reqId: event.data.reqId,
          blob,
        };
        postMessage(message);
        console.log("Font blob sent back to main thread.");
      }
    } catch (err) {
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
