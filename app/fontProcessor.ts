import opentype from "opentype.js";

import { intersectBezier, opentypeToPathData } from "@/app/bezier";
import { HANGUL_DATA } from "@/app/hangulData";
import { getSyllablesFor } from "@/app/jamos";
import schedulerYield from "@/app/schedulerYield";
import {
  ConsonantSets,
  FontMetadata,
  JamoVarsets,
  PathData,
  VowelSets,
} from "@/app/types";

export class FontProcessor {
  font: opentype.Font | null = null;

  async loadFont(file: File): Promise<FontMetadata> {
    const buffer = await file.arrayBuffer();

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

    const result = {
      consonants: new Map<string, ConsonantSets>(),
      vowel: new Map<string, VowelSets>(),
    };

    for (const jamo of consonantInfo.values()) {
      const sets: ConsonantSets = {
        type: "consonant",
        canonical: null, // 단독꼴
        // leading
        leadingSet1: null, // 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
        leadingSet2: null, // 받침없는 ㅗ ㅛ ㅡ
        leadingSet3: null, // 받침없는 ㅜ ㅠ
        leadingSet4: null, // 받침없는 ㅘ ㅙ ㅚ ㅢ
        leadingSet5: null, // 받침없는 ㅝ ㅞ ㅟ
        leadingSet6: null, // 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
        leadingSet7: null, // 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
        leadingSet8: null, // 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
        // trailing
        trailingSet1: null, // 중성 ㅏ ㅑ ㅘ 와 결합
        trailingSet2: null, // 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
        trailingSet3: null, // 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
        trailingSet4: null, // 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
      };
      // canonical form
      if (this.font.hasChar(jamo.canonical)) {
        const glyph = this.font.charToGlyph(jamo.canonical);
        // console.log(jamo.canonical, glyph.name);
        sets.canonical = this.toPathData(glyph.path);
      }
      if (jamo.leading !== null) {
        // set 1: 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
        for (const syllable of getSyllablesFor(jamo.leading, "l1", true, {
          vowelPref: ["ㅒ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.leadingSet1 = intersectBezier(bezier, [
              {
                left: 0,
                right: 600,
                top: 0,
                bottom: 1000,
              },
            ]);
            break;
          }
        }
        // set 2: 받침없는 ㅗ ㅛ ㅡ
        for (const syllable of getSyllablesFor(jamo.leading, "l2", true, {
          vowelPref: ["ㅡ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.leadingSet2 = intersectBezier(bezier, [
              {
                left: 0,
                right: 1000,
                top: 0,
                bottom: 500,
              },
            ]);
            break;
          }
        }
        // set 3: 받침없는 ㅜ ㅠ
        for (const syllable of getSyllablesFor(jamo.leading, "l3", true, {
          vowelPref: ["ㅜ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.leadingSet3 = intersectBezier(bezier, [
              {
                left: 0,
                right: 1000,
                top: 0,
                bottom: 500,
              },
            ]);
            break;
          }
        }
        // set 4: 받침없는 ㅘ ㅙ ㅚ ㅢ
        for (const syllable of getSyllablesFor(jamo.leading, "l4", true, {
          vowelPref: ["ㅢ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.leadingSet4 = intersectBezier(bezier, [
              {
                left: 0,
                right: 600,
                top: 0,
                bottom: 500,
              },
            ]);
            break;
          }
        }
        // set 5: 받침없는 ㅝ ㅞ ㅟ
        for (const syllable of getSyllablesFor(jamo.leading, "l5", true, {
          vowelPref: ["ㅝ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.leadingSet5 = intersectBezier(bezier, [
              {
                left: 0,
                right: 600,
                top: 0,
                bottom: 500,
              },
            ]);
            break;
          }
        }
        // set 6: 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
        for (const syllable of getSyllablesFor(jamo.leading, "l6", true, {
          vowelPref: ["ㅏ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.leadingSet6 = intersectBezier(bezier, [
              {
                left: 0,
                right: 600,
                top: 0,
                bottom: 500,
              },
            ]);
            break;
          }
        }
        // set 7: 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
        for (const syllable of getSyllablesFor(jamo.leading, "l7", true, {
          vowelPref: ["ㅡ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.leadingSet7 = intersectBezier(bezier, [
              {
                left: 0,
                right: 1000,
                top: 0,
                bottom: 400,
              },
            ]);
            break;
          }
        }
        // set 8: 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
        for (const syllable of getSyllablesFor(jamo.leading, "l8", true, {
          vowelPref: ["ㅢ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.leadingSet8 = intersectBezier(bezier, [
              {
                left: 0,
                right: 600,
                top: 0,
                bottom: 400,
              },
            ]);
            break;
          }
        }
      }
      if (jamo.trailing !== null) {
        // set 1: 중성 ㅏ ㅑ ㅘ 와 결합
        for (const syllable of getSyllablesFor(jamo.trailing, "t1", true, {
          vowelPref: ["ㅏ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.trailingSet1 = intersectBezier(bezier, [
              {
                left: 0,
                right: 1000,
                top: 500,
                bottom: 1000,
              },
            ]);
            break;
          }
        }
        // set 2: 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
        for (const syllable of getSyllablesFor(jamo.trailing, "t2", true, {
          vowelPref: ["ㅓ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.trailingSet2 = intersectBezier(bezier, [
              {
                left: 0,
                right: 1000,
                top: 500,
                bottom: 1000,
              },
            ]);
            break;
          }
        }
        // set 3: 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
        for (const syllable of getSyllablesFor(jamo.trailing, "t3", true, {
          vowelPref: ["ㅐ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.trailingSet3 = intersectBezier(bezier, [
              {
                left: 0,
                right: 1000,
                top: 500,
                bottom: 1000,
              },
            ]);
            break;
          }
        }
        // set 4: 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
        for (const syllable of getSyllablesFor(jamo.trailing, "t4", true, {
          vowelPref: ["ㅗ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.trailingSet4 = intersectBezier(bezier, [
              {
                left: 0,
                right: 1000,
                top: 500,
                bottom: 1000,
              },
            ]);
            break;
          }
        }
      }
      result.consonants.set(jamo.name, sets);

      await schedulerYield();
    }
    for (const jamo of vowelInfo.values()) {
      const sets: VowelSets = {
        type: "vowel",
        canonical: null, // 단독꼴
        set1: null, // 받침없는 [ㄱ ㅋ]과 결합
        set2: null, // 받침없는 [ㄱ ㅋ] 제외
        set3: null, // 받침있는 [ㄱ ㅋ]과 결합
        set4: null, // 받침있는 [ㄱ ㅋ] 제외
      };
      // canonical form
      if (this.font.hasChar(jamo.canonical)) {
        const glyph = this.font.charToGlyph(jamo.canonical);
        // console.log(jamo.canonical, glyph.name);
        sets.canonical = this.toPathData(glyph.path);
      }
      if (jamo.vowel !== null) {
        // set 1: 받침없는 [ㄱ ㅋ]과 결합
        for (const syllable of getSyllablesFor(jamo.vowel, "v1", true, {
          leadingPref: ["ㅋ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.set1 = extractVowel(bezier, jamo.position, false);
            break;
          }
        }
        // set 2: 받침없는 [ㄱ ㅋ] 제외
        for (const syllable of getSyllablesFor(jamo.vowel, "v2", true, {
          leadingPref: ["ㅂ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.set2 = extractVowel(bezier, jamo.position, false);
            break;
          }
        }
        // set 3: 받침있는 [ㄱ ㅋ]과 결합
        for (const syllable of getSyllablesFor(jamo.vowel, "v3", true, {
          leadingPref: ["ㅋ"],
          trailingPref: ["ㄱ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.set3 = extractVowel(bezier, jamo.position, true);
            break;
          }
        }
        // set 4: 받침있는 [ㄱ ㅋ] 제외
        for (const syllable of getSyllablesFor(jamo.vowel, "v4", true, {
          leadingPref: ["ㅂ"],
          trailingPref: ["ㄱ"],
        })) {
          if (
            Array.from(syllable).length === 1 &&
            this.font.hasChar(syllable)
          ) {
            const glyph = this.font.charToGlyph(syllable);
            // console.log(syllable, glyph.name);
            const bezier = this.toPathData(glyph.path);
            sets.set4 = extractVowel(bezier, jamo.position, true);
            break;
          }
        }
      }
      result.vowel.set(jamo.name, sets);

      await schedulerYield();
    }

    return result;
  }

  addOldHangulSupport() {
    if (!this.font) {
      throw new Error("Call loadFont() first.");
    }

    // Set bit for Hangul Jamo support
    this.font.tables.os2.ulUnicodeRange1 =
      (this.font.tables.os2.ulUnicodeRange1 | (1 << 28)) >>> 0;

    // TODO

    return this.font.toArrayBuffer();
  }

  toPathData(path: opentype.Path): PathData {
    if (!this.font) {
      throw new Error("Call loadFont() first.");
    }
    // Font metric scaling (Em units usually 1000 or 2048)
    const unitsPerEm = this.font.unitsPerEm;
    const sTypoDescender = this.font.tables.os2.sTypoDescender;
    return opentypeToPathData(path, unitsPerEm, sTypoDescender);
  }
}

function extractVowel(
  bezier: PathData,
  position: "right" | "under" | "mixed",
  hasTrailing: boolean,
) {
  let extracted;
  if (position === "right") {
    extracted = intersectBezier(bezier, [
      {
        left: 500,
        right: 1000,
        top: 0,
        bottom: hasTrailing ? 600 : 1000,
      },
    ]);
  } else if (position === "under") {
    extracted = intersectBezier(bezier, [
      {
        left: 0,
        right: 1000,
        top: hasTrailing ? 400 : 500,
        bottom: hasTrailing ? 600 : 1000,
      },
    ]);
  } else if (position === "mixed") {
    extracted = intersectBezier(bezier, [
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
