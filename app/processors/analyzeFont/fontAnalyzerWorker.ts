import opentype from "opentype.js";
import paper from "paper";

import { HANGUL_DATA } from "@/app/hangul/hangulData";
import {
  CONSONANT_JAMO_BOUNDS,
  VOWEL_JAMO_BOUNDS,
  extractVowel,
} from "@/app/hangul/jamoBounds";
import {
  CONSONANT_VARSET_NAMES,
  VOWEL_VARSET_NAMES,
  getSyllablesFor,
} from "@/app/hangul/jamos";
import PathData from "@/app/pathUtils/PathData";
import {
  MessageFromFontAnalyzerWorker,
  MessageToFontAnalyzerWorker,
} from "@/app/processors/analyzeFont/fontAnalyzerWorkerTypes";
import { ConsonantSets, JamoVarsets, VowelSets } from "@/app/utils/types";
import { WorkerErrorResponse } from "@/app/utils/WorkerHarness";

// Initialize paper.js context
paper.setup(new paper.Size(1, 1));
paper.settings.insertItems = false;
paper.view.autoUpdate = false; // disables drawing any shape automatically

let font: opentype.Font;

async function loadFont(buffer: ArrayBuffer) {
  font = opentype.parse(buffer);
  if (!font) {
    throw new Error("Failed to parse font");
  }

  return {
    name:
      font.names.fullName.en ||
      font.names.fullName[Object.keys(font.names.fullName)[0]],
    family: font.names.fontFamily.en || "Unknown",
    style: font.names.fontSubfamily.en || "Regular",
    numGlyphs: font.numGlyphs,
  };
}

async function getSampleImage(sampleText: string): Promise<string> {
  const canvas = new OffscreenCanvas(1400, 200);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas context not available");
  }

  // White background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const fontSize = 72;
  const x = 20;
  const y = 120;

  // Render path via opentype.js
  // Note: opentype.js works in workers as long as you provide the ctx
  const path = font.getPath(sampleText, x, y, fontSize);
  path.fill = "black";

  // path.draw works with OffscreenCanvas context just like regular Canvas
  path.draw(ctx as unknown as CanvasRenderingContext2D);

  // Convert to Blob then DataURL, or just return the Blob/ImageBitmap
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

async function analyzeJamoVarsets() {
  console.log("analyzeJamoVarsets", font);

  const { consonantInfo, vowelInfo } = HANGUL_DATA;

  const unitsPerEm = font.unitsPerEm;
  const sTypoDescender = font.tables.os2.sTypoDescender;

  function toPathData(path: opentype.Path): PathData {
    // Font metric scaling (Em units usually 1000 or 2048)
    return PathData.fromOpentype(path, unitsPerEm, sTypoDescender);
  }

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
    if (font.hasChar(jamo.canonical)) {
      const glyph = font.charToGlyph(jamo.canonical);
      sets.canon = toPathData(glyph.path).serialize();
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
        if (Array.from(syllable).length === 1 && font.hasChar(syllable)) {
          const glyph = font.charToGlyph(syllable);
          const bezier = toPathData(glyph.path);
          sets[varsetName] = bezier.intersectBoundsList(bounds).serialize();
          break;
        }
      }
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
    if (font.hasChar(jamo.canonical)) {
      const glyph = font.charToGlyph(jamo.canonical);
      sets.canon = toPathData(glyph.path).serialize();
    }
    for (const varsetName of VOWEL_VARSET_NAMES) {
      if (varsetName === "canon" || jamo.vowel === null) {
        continue;
      }
      const prefs = VOWEL_JAMO_BOUNDS[varsetName];
      const syllables = getSyllablesFor(jamo.name, varsetName, true, prefs);
      for (const syllable of syllables) {
        if (Array.from(syllable).length === 1 && font.hasChar(syllable)) {
          const glyph = font.charToGlyph(syllable);
          const bezier = toPathData(glyph.path);
          sets[varsetName] = extractVowel(
            bezier,
            jamo.position,
            ["v3", "v4"].includes(varsetName),
          ).serialize();
          break;
        }
      }
    }
    result[jamo.name] = sets;
  }

  return result;
}

async function handleEvent(
  event: MessageEvent<MessageToFontAnalyzerWorker>,
): Promise<MessageFromFontAnalyzerWorker> {
  const { reqId } = event.data;
  if (event.data.type === "loadFont") {
    const metadata = await loadFont(event.data.buffer);
    return { type: "loadFont", reqId, metadata };
  } else if (event.data.type === "getSampleImage") {
    const sampleImage = await getSampleImage(event.data.sampleText);
    return { type: "getSampleImage", reqId, sampleImage };
  } else if (event.data.type === "analyzeFont") {
    const jamoVarsets = await analyzeJamoVarsets();
    return { type: "analyzeFont", reqId, jamoVarsets };
  } else {
    throw new Error("Invalid event type");
  }
}

addEventListener(
  "message",
  async (event: MessageEvent<MessageToFontAnalyzerWorker>) => {
    console.log("AnalyzeFontWorker received message:", event.data);
    try {
      postMessage(await handleEvent(event));
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
