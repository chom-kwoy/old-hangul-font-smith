import opentype from "opentype.js";

import PathData from "@/app/pathUtils/PathData";
import {
  GenerateFontMessage,
  MessageToMainThread,
} from "@/app/processors/makeFont/makeFontWorkerTypes";
import { FontMetadata, GenerateOptions, JamoVarsets } from "@/app/utils/types";

export class FontProcessor {
  analyzeFontWorker!: Worker;
  makeFontWorker!: Worker;
  font: opentype.Font | null = null;
  fontFile: File | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      this.analyzeFontWorker = new Worker(
        new URL("analyzeFont/analyzeFontWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.makeFontWorker = new Worker(
        new URL("makeFont/makeFontWorker.ts", import.meta.url),
        { type: "module" },
      );
    }
  }

  async loadFont(file: File): Promise<FontMetadata> {
    const buffer = await file.arrayBuffer();
    this.font = opentype.parse(buffer);
    this.fontFile = file;
    return new Promise((resolve, reject) => {
      this.analyzeFontWorker.onmessage = (event: MessageEvent) => {
        if (event.data.type === "fontParsed") {
          resolve(event.data.metadata);
        } else if (event.data.type === "error") {
          reject(event.data.error);
        }
      };
      this.analyzeFontWorker?.postMessage({
        type: "loadFont",
        buffer: buffer,
      });
    });
  }

  async getSampleImage(sampleText: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.analyzeFontWorker.onmessage = (event: MessageEvent) => {
        if (event.data.type === "sampleImage") {
          resolve(event.data.sampleImage);
        } else if (event.data.type === "error") {
          reject(event.data.error);
        }
      };
      this.analyzeFontWorker?.postMessage({
        type: "getSampleImage",
        sampleText: sampleText,
      });
    });
  }

  async analyzeJamoVarsets(): Promise<JamoVarsets> {
    return new Promise((resolve, reject) => {
      this.analyzeFontWorker.onmessage = (event: MessageEvent) => {
        if (event.data.type === "jamoVarsets") {
          resolve(event.data.jamoVarsets);
        } else if (event.data.type === "error") {
          reject(event.data.error);
        }
      };
      this.analyzeFontWorker?.postMessage({
        type: "analyzeFont",
      });
    });
  }

  async downloadFont(
    jamoVarsets: JamoVarsets,
    options: GenerateOptions,
  ): Promise<void> {
    if (!this.fontFile) {
      throw new Error("Call loadFont() first.");
    }

    this.makeFontWorker.postMessage({
      type: "generateFont",
      buffer: await this.fontFile.arrayBuffer(),
      jamoVarsets: jamoVarsets,
      options: options,
    } as GenerateFontMessage);

    const blob = await new Promise<Blob>((resolve) => {
      if (!this.makeFontWorker) {
        throw new Error("Worker not initialized.");
      }
      this.makeFontWorker.onmessage = (event: MessageEvent) => {
        const msg: MessageToMainThread = event.data;
        if (msg.type === "fontBlob") {
          resolve(msg.blob);
        }
      };
    });

    const newFileName = this.fontFile.name.replace(
      /\.([a-zA-Z]*?)$/i,
      "_modified.$1",
    );

    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
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
    // Font metric scaling (Em units usually 1000 or 2048)
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
