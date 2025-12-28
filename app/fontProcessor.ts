import opentype from "opentype.js";

import { HANGUL_DATA, composeHangul } from "@/app/hangulData";
import {
  ConsonantSets,
  FontMetadata,
  HangulJamoSets,
  VowelSets,
} from "@/app/types";

export class FontProcessor {
  font: opentype.Font | null = null;
  jamoSets: HangulJamoSets | null = null;

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
    if (!this.font) throw new Error("Font not loaded");

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

  analyzeJamoSets(): HangulJamoSets {
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
        console.log(jamo.canonical, glyph.name);
        sets.canonical = glyph.path;
      }
      if (jamo.leading !== null) {
        // set 1: 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
        let syllable = composeHangul(jamo.leading, "ㅏ", null)!;
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          console.log(syllable, glyph.name);
          sets.leadingSet1 = glyph.path; // TODO: extract only the leading part
        }
        // set 2: 받침없는 ㅗ ㅛ ㅡ
        syllable = composeHangul(jamo.leading, "ㅡ", null)!;
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          console.log(syllable, glyph.name);
          sets.leadingSet1 = glyph.path; // TODO: extract only the leading part
        }
        // set 3: 받침없는 ㅜ ㅠ
        syllable = composeHangul(jamo.leading, "ㅜ", null)!;
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          console.log(syllable, glyph.name);
          sets.leadingSet1 = glyph.path; // TODO: extract only the leading part
        }
        // set 4: 받침없는 ㅘ ㅙ ㅚ ㅢ
        syllable = composeHangul(jamo.leading, "ㅘ", null)!;
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          console.log(syllable, glyph.name);
          sets.leadingSet1 = glyph.path; // TODO: extract only the leading part
        }
        // set 5: 받침없는 ㅝ ㅞ ㅟ
        syllable = composeHangul(jamo.leading, "ㅝ", null)!;
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          console.log(syllable, glyph.name);
          sets.leadingSet1 = glyph.path; // TODO: extract only the leading part
        }
        // set 6: 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
        syllable = composeHangul(jamo.leading, "ㅏ", "ㄱ")!;
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          console.log(syllable, glyph.name);
          sets.leadingSet1 = glyph.path; // TODO: extract only the leading part
        }
        // set 7: 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
        syllable = composeHangul(jamo.leading, "ㅡ", "ㄱ")!;
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          console.log(syllable, glyph.name);
          sets.leadingSet1 = glyph.path; // TODO: extract only the leading part
        }
        // set 8: 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
        syllable = composeHangul(jamo.leading, "ㅘ", "ㄱ")!;
        if (Array.from(syllable).length === 1 && this.font.hasChar(syllable)) {
          const glyph = this.font.charToGlyph(syllable);
          console.log(syllable, glyph.name);
          sets.leadingSet1 = glyph.path; // TODO: extract only the leading part
        }
      }
      if (jamo.trailing !== null) {
        // TODO
      }
      result.consonants.set(jamo.unicode_name, sets);
    }

    return result;
  }
}
