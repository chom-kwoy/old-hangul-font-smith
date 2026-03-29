import { fontGen } from "@/app/processors/makeFont/fontGen";
import {
  MessageFromFontGenWorker,
  MessageToFontGenWorker,
} from "@/app/processors/makeFont/fontGenWorkerTypes";

addEventListener(
  "message",
  async (event: MessageEvent<MessageToFontGenWorker>) => {
    console.log("Font worker received message:", event.data);
    if (event.data.type === "generateFont") {
      console.log("Generating font from buffer...");
      const result = await fontGen(
        event.data.buffer,
        event.data.jamoVarsets,
        event.data.options,
      );
      console.log("Font generation completed, sending back result...");
      const message: MessageFromFontGenWorker = {
        type: "fontBlob",
        blob: result,
      };
      postMessage(message);
      console.log("Font blob sent back to main thread.");
    }
  },
);
