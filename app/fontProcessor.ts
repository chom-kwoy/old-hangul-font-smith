import { Bezier } from "bezier-js";
import { TComplexPathData } from "fabric";
// @ts-expect-error types package for opentype.js is outdated
import opentype from "opentype.js";

import { intersectBezier, toBezier, toPathData } from "@/app/bezier";
import { HANGUL_DATA, composeHangul } from "@/app/hangulData";
import {
  ConsonantSets,
  FontMetadata,
  JamoVarsets,
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

  analyzeJamoVarsets(): JamoVarsets {
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
        sets.canonical = this.toFabricPath(glyph.path);
      }
      if (jamo.leading !== null) {
        // set 1: 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
        let syllable = composeHangul(jamo.leading, "ㅒ", null);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 600,
              top: 0,
              bottom: 1000,
            },
          ]);
          sets.leadingSet1 = toPathData(jamo);
        }
        // set 2: 받침없는 ㅗ ㅛ ㅡ
        syllable = composeHangul(jamo.leading, "ㅡ", null);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 1000,
              top: 0,
              bottom: 500,
            },
          ]);
          sets.leadingSet2 = toPathData(jamo);
        }
        // set 3: 받침없는 ㅜ ㅠ
        syllable = composeHangul(jamo.leading, "ㅜ", null);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 1000,
              top: 0,
              bottom: 500,
            },
          ]);
          sets.leadingSet3 = toPathData(jamo);
        }
        // set 4: 받침없는 ㅘ ㅙ ㅚ ㅢ
        syllable = composeHangul(jamo.leading, "ㅢ", null);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 600,
              top: 0,
              bottom: 500,
            },
          ]);
          sets.leadingSet4 = toPathData(jamo);
        }
        // set 5: 받침없는 ㅝ ㅞ ㅟ
        syllable = composeHangul(jamo.leading, "ㅝ", null);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 600,
              top: 0,
              bottom: 500,
            },
          ]);
          sets.leadingSet5 = toPathData(jamo);
        }
        // set 6: 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
        syllable = composeHangul(jamo.leading, "ㅏ", "ㄱ");
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 600,
              top: 0,
              bottom: 500,
            },
          ]);
          sets.leadingSet6 = toPathData(jamo);
        }
        // set 7: 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
        syllable = composeHangul(jamo.leading, "ㅡ", "ㄱ");
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 1000,
              top: 0,
              bottom: 400,
            },
          ]);
          sets.leadingSet7 = toPathData(jamo);
        }
        // set 8: 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
        syllable = composeHangul(jamo.leading, "ㅢ", "ㄱ");
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 600,
              top: 0,
              bottom: 400,
            },
          ]);
          sets.leadingSet8 = toPathData(jamo);
        }
      }
      if (jamo.trailing !== null) {
        // set 1: 중성 ㅏ ㅑ ㅘ 와 결합
        let syllable = composeHangul("ㅇ", "ㅏ", jamo.trailing);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 1000,
              top: 500,
              bottom: 1000,
            },
          ]);
          sets.trailingSet1 = toPathData(jamo);
        }
        // set 2: 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
        syllable = composeHangul("ㅇ", "ㅓ", jamo.trailing);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 1000,
              top: 500,
              bottom: 1000,
            },
          ]);
          sets.trailingSet2 = toPathData(jamo);
        }
        // set 3: 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
        syllable = composeHangul("ㅇ", "ㅐ", jamo.trailing);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 1000,
              top: 500,
              bottom: 1000,
            },
          ]);
          sets.trailingSet3 = toPathData(jamo);
        }
        // set 4: 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
        syllable = composeHangul("ㄱ", "ㅗ", jamo.trailing);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          const jamo = intersectBezier(bezier, [
            {
              left: 0,
              right: 1000,
              top: 500,
              bottom: 1000,
            },
          ]);
          sets.trailingSet4 = toPathData(jamo);
        }
      }
      result.consonants.set(jamo.unicode_name, sets);
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
        sets.canonical = this.toFabricPath(glyph.path);
      }
      if (jamo.vowel !== null) {
        // set 1: 받침없는 [ㄱ ㅋ]과 결합
        let syllable = composeHangul("ㅋ", jamo.vowel, null);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          sets.set1 = toPathData(extractVowel(bezier, jamo.position, false));
        }
        // set 2: 받침없는 [ㄱ ㅋ] 제외
        syllable = composeHangul("ㅂ", jamo.vowel, null);
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          sets.set2 = toPathData(extractVowel(bezier, jamo.position, false));
        }
        // set 3: 받침있는 [ㄱ ㅋ]과 결합
        syllable = composeHangul("ㅋ", jamo.vowel, "ㄱ");
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          sets.set3 = toPathData(extractVowel(bezier, jamo.position, true));
        }
        // set 4: 받침있는 [ㄱ ㅋ] 제외
        syllable = composeHangul("ㅂ", jamo.vowel, "ㄱ");
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          // console.log(syllable, glyph.name);
          const bezier = toBezier(this.toFabricPath(glyph.path));
          sets.set4 = toPathData(extractVowel(bezier, jamo.position, true));
        }
      }
      result.vowel.set(jamo.unicode_name, sets);
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

    if (this.font.tables.gsub === undefined) {
      // make gsub table if not exists
      this.font.tables.gsub = {
        version: 1,
        scripts: {
          tag: "DFLT",
          script: {
            defaultLangSys: {
              reserved: 0,
              reqFeatureIndex: 65535,
              featureIndexes: [],
            },
            langSysRecords: [],
          },
        },
        features: [],
        lookups: [],
      };
    }

    return this.font.toArrayBuffer();
  }

  toFabricPath(path: opentype.Path) {
    if (!this.font) {
      throw new Error("Call loadFont() first.");
    }
    // Font metric scaling (Em units usually 1000 or 2048)
    const unitsPerEm = this.font.unitsPerEm;
    const descender = this.font.tables.os2.sTypoDescender;
    const scale = 1000 / unitsPerEm;
    const data: TComplexPathData = [];
    function tr_x(x: number) {
      return x * scale;
    }
    function tr_y(y: number) {
      return 1000 - (y - descender) * scale;
    }
    for (const cmd of path.commands) {
      switch (cmd.type) {
        case "M": // move to
          data.push(["M", tr_x(cmd.x), tr_y(cmd.y)]);
          break;
        case "L": // line to
          data.push(["L", tr_x(cmd.x), tr_y(cmd.y)]);
          break;
        case "Q": // quadratic bezier curve
          data.push([
            "Q",
            tr_x(cmd.x1),
            tr_y(cmd.y1),
            tr_x(cmd.x),
            tr_y(cmd.y),
          ]);
          break;
        case "C": // cubic bezier curve
          data.push([
            "C",
            tr_x(cmd.x1),
            tr_y(cmd.y1),
            tr_x(cmd.x2),
            tr_y(cmd.y2),
            tr_x(cmd.x),
            tr_y(cmd.y),
          ]);
          break;
        case "Z": // close path
          data.push(["Z"]);
          break;
      }
    }
    return data;
  }
}

function extractVowel(
  bezier: Bezier[][],
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
