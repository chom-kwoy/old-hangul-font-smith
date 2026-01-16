import opentype from "opentype.js";

import PathData from "@/app/utils/PathData";
import { HANGUL_DATA } from "@/app/utils/hangulData";
import {
  CONSONANT_JAMO_BOUNDS,
  VOWEL_JAMO_BOUNDS,
} from "@/app/utils/jamoBounds";
import {
  CONSONANT_VARSET_NAMES,
  VOWEL_VARSET_NAMES,
  getSyllablesFor,
} from "@/app/utils/jamos";
import schedulerYield from "@/app/utils/schedulerYield";
import {
  ConsonantSets,
  FontMetadata,
  JamoVarsets,
  VowelSets,
} from "@/app/utils/types";

export class FontProcessor {
  font: opentype.Font | null = null;
  worker: Worker | null = null;
  buffer: ArrayBuffer | null = null;

  async loadFont(file: File): Promise<FontMetadata> {
    this.worker = new Worker(new URL("fontWorker.ts", import.meta.url), {
      type: "module",
    });

    const buffer = await file.arrayBuffer();
    this.buffer = buffer;

    return new Promise((resolve, reject) => {
      try {
        this.font = opentype.parse(buffer);
        if (!this.font) {
          reject(new Error("Failed to parse font"));
          return;
        }
        resolve({
          name:
            this.font.names.fullName.en ||
            this.font.names.fullName[Object.keys(this.font.names.fullName)[0]],
          family: this.font.names.fontFamily.en || "Unknown",
          style: this.font.names.fontSubfamily.en || "Regular",
          numGlyphs: this.font.numGlyphs,
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Renders sample text to a canvas and returns base64 image for AI analysis
  getSampleImage(sampleText: string): string {
    if (!this.font) {
      throw new Error("Font not loaded");
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context not available");

    // White background
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Text settings
    const fontSize = 72;
    const x = 20;
    const y = 120;

    // Draw text using opentype.js path rendering to ensure we use the actual font data
    const path = this.font.getPath(sampleText, x, y, fontSize);
    path.fill = "black";
    path.draw(ctx);

    return canvas.toDataURL("image/png");
  }

  async analyzeJamoVarsets(): Promise<JamoVarsets> {
    if (!this.font) {
      throw new Error("Call loadFont() first.");
    }
    const { consonantInfo, vowelInfo } = HANGUL_DATA;

    const result: JamoVarsets = {};

    for (const jamo of consonantInfo.values()) {
      const sets: ConsonantSets = {
        type: "consonant",
        canon: null,
        l1: null,
        l2: null,
        l3: null,
        l4: null,
        l5: null,
        l6: null,
        l7: null,
        l8: null,
        t1: null,
        t2: null,
        t3: null,
        t4: null,
      };
      // canonical form
      if (this.font.hasChar(jamo.canonical)) {
        const glyph = this.font.charToGlyph(jamo.canonical);
        sets.canon = this.toPathData(glyph.path).serialize();
      }
      for (const varsetName of CONSONANT_VARSET_NAMES) {
        if (
          varsetName === "canon" ||
          (varsetName.startsWith("l") && jamo.leading === null) ||
          (varsetName.startsWith("t") && jamo.trailing === null)
        ) {
          continue;
        }
        const [bounds, prefs] = CONSONANT_JAMO_BOUNDS[varsetName];
        const syllables = getSyllablesFor(jamo.name, varsetName, true, prefs);
        for (const syllable of syllables) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            const bezier = this.toPathData(glyph.path);
            sets[varsetName] = bezier.intersectBoundsList(bounds).serialize();
            break;
          }
        }
        await schedulerYield();
      }
      result[jamo.name] = sets;
    }

    for (const jamo of vowelInfo.values()) {
      const sets: VowelSets = {
        type: "vowel",
        canon: null,
        v1: null,
        v2: null,
        v3: null,
        v4: null,
      };
      // canonical form
      if (this.font.hasChar(jamo.canonical)) {
        const glyph = this.font.charToGlyph(jamo.canonical);
        sets.canon = this.toPathData(glyph.path).serialize();
      }
      for (const varsetName of VOWEL_VARSET_NAMES) {
        if (varsetName === "canon" || jamo.vowel === null) {
          continue;
        }
        const prefs = VOWEL_JAMO_BOUNDS[varsetName];
        const syllables = getSyllablesFor(jamo.name, varsetName, true, prefs);
        for (const syllable of syllables) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            const bezier = this.toPathData(glyph.path);
            sets[varsetName] = extractVowel(
              bezier,
              jamo.position,
              ["v3", "v4"].includes(varsetName),
            ).serialize();
            break;
          }
        }
        await schedulerYield();
      }
      result[jamo.name] = sets;
    }

    return result;
  }

  async downloadFont() {
    if (!this.buffer || !this.worker) {
      throw new Error("Call loadFont() first.");
    }

    this.worker.postMessage({
      type: "generateFont",
      buffer: this.buffer,
    });

    const stream = await new Promise<ReadableStream>((resolve) => {
      if (!this.worker) {
        throw new Error("Worker not initialized.");
      }
      this.worker.onmessage = (event: MessageEvent) => {
        if (event.data.type === "fontStream") {
          resolve(event.data.stream);
        }
      };
    });

    const downloadedBlob = await readableStreamToBlob(stream);
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(downloadedBlob);
    link.download = "generated_font.otf";
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
}

async function readableStreamToBlob(
  readableStream: ReadableStream,
  mimeType: string | null = null,
) {
  // Create a Response object from the ReadableStream
  const response = new Response(readableStream, {
    headers: { "Content-Type": mimeType || "application/octet-stream" },
  });

  // Get the Blob from the Response object
  return await response.blob();
}

function extractVowel(
  bezier: PathData,
  position: "right" | "under" | "mixed",
  hasTrailing: boolean,
) {
  let extracted;
  if (position === "right") {
    extracted = bezier.intersectBoundsList([
      {
        left: 500,
        right: 1000,
        top: 0,
        bottom: hasTrailing ? 600 : 1000,
      },
    ]);
  } else if (position === "under") {
    extracted = bezier.intersectBoundsList([
      {
        left: 0,
        right: 1000,
        top: hasTrailing ? 400 : 500,
        bottom: hasTrailing ? 600 : 1000,
      },
    ]);
  } else if (position === "mixed") {
    extracted = bezier.intersectBoundsList([
      {
        left: 500,
        right: 1000,
        top: 0,
        bottom: hasTrailing ? 600 : 1000,
      },
      {
        left: 0,
        right: 1000,
        top: hasTrailing ? 450 : 600,
        bottom: hasTrailing ? 600 : 1000,
      },
    ]);
  }
  return extracted!;
}
