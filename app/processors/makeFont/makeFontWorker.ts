import { makeFont } from "@/app/processors/makeFont/makeFont";
import {
  MessageToFontWorker,
  MessageToMainThread,
} from "@/app/processors/makeFont/makeFontWorkerTypes";

addEventListener(
  "message",
  async (event: MessageEvent<MessageToFontWorker>) => {
    console.log("Font worker received message:", event.data);
    if (event.data.type === "generateFont") {
      console.log("Generating font from buffer...");
      const result = await makeFont(
        event.data.buffer,
        event.data.jamoVarsets,
        event.data.options,
      );
      console.log("Font generation completed, sending back result...");
      postMessage({
        type: "fontBlob",
        blob: result,
      } as MessageToMainThread);
      console.log("Font blob sent back to main thread.");
    }
  },
);
