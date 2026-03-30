import opentype from "opentype.js";

import PathData from "@/app/pathUtils/PathData";
import {
  MessageFromFontAnalyzerWorker,
  MessageToFontAnalyzerWorker,
} from "@/app/processors/analyzeFont/fontAnalyzerWorkerTypes";
import {
  MessageFromFontGenWorker,
  MessageToFontGenWorker,
} from "@/app/processors/makeFont/fontGenWorkerTypes";
import { FontMetadata, GenerateOptions, JamoVarsets } from "@/app/utils/types";
import { WorkerHarness } from "@/app/utils/WorkerHarness";

export class FontProcessor {
  #analyzeWorker: WorkerHarness<
    MessageToFontAnalyzerWorker,
    MessageFromFontAnalyzerWorker
  >;
  #genWorker: WorkerHarness<MessageToFontGenWorker, MessageFromFontGenWorker>;
  font: opentype.Font | null = null;
  fontFile: File | null = null;

  constructor() {
    this.#analyzeWorker = new WorkerHarness(
      typeof window !== "undefined"
        ? new Worker(
            new URL("analyzeFont/fontAnalyzerWorker.ts", import.meta.url),
            { type: "module" },
          )
        : null,
    );
    this.#genWorker = new WorkerHarness(
      typeof window !== "undefined"
        ? new Worker(new URL("makeFont/fontGenWorker.ts", import.meta.url), {
            type: "module",
          })
        : null,
    );
  }

  async loadFont(file: File): Promise<FontMetadata> {
    const buffer = await file.arrayBuffer();
    this.font = opentype.parse(buffer);
    this.fontFile = file;
    const result = await this.#analyzeWorker.requestTask({
      type: "loadFont",
      buffer,
    });
    return result.metadata;
  }

  async getSampleImage(sampleText: string): Promise<string> {
    const result = await this.#analyzeWorker.requestTask({
      type: "getSampleImage",
      sampleText,
    });
    return result.sampleImage;
  }

  async analyzeJamoVarsets(): Promise<JamoVarsets> {
    const result = await this.#analyzeWorker.requestTask({
      type: "analyzeFont",
    });
    return result.jamoVarsets;
  }

  async downloadFont(
    jamoVarsets: JamoVarsets,
    options: GenerateOptions,
  ): Promise<void> {
    if (!this.fontFile) {
      throw new Error("Call loadFont() first.");
    }
    const result = await this.#genWorker.requestTask({
      type: "generateFont",
      buffer: await this.fontFile.arrayBuffer(),
      jamoVarsets,
      options,
    });

    const newFileName = this.fontFile.name.replace(
      /\.([a-zA-Z]*?)$/i,
      "_modified.$1",
    );
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(result.blob);
    link.download = newFileName;
    link.click();
    link.remove();
  }

  getPath(c: string): PathData {
    if (!this.font) {
      throw new Error("Call loadFont() first.");
    }
    const glyph = this.font.charToGlyph(c);
    return this.toPathData(glyph.path);
  }

  toPathData(path: opentype.Path): PathData {
    if (!this.font) {
      throw new Error("Call loadFont() first.");
    }
    const unitsPerEm = this.font.unitsPerEm;
    const sTypoDescender = this.font.tables.os2.sTypoDescender;
    return PathData.fromOpentype(path, unitsPerEm, sTypoDescender);
  }

  hasChar(c: string): boolean {
    if (!this.font) {
      throw new Error("Call loadFont() first.");
    }
    return this.font.hasChar(c);
  }
}
