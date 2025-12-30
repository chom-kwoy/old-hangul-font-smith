import { TComplexPathData } from "fabric";
import seedrandom from "seedrandom";

import { HANGUL_DATA, composeHangul, getName } from "@/app/hangulData";
import { ConsonantSets, JamoVarsets, VarsetType, VowelSets } from "@/app/types";

export function getVarset(
  varsets: ConsonantSets | VowelSets,
  varsetName: string,
) {
  if (varsets.type === "consonant") {
    // prettier-ignore
    switch (varsetName) {
      case "canon": return varsets.canonical;
      case "l1": return varsets.leadingSet1;
      case "l2": return varsets.leadingSet2;
      case "l3": return varsets.leadingSet3;
      case "l4": return varsets.leadingSet4;
      case "l5": return varsets.leadingSet5;
      case "l6": return varsets.leadingSet6;
      case "l7": return varsets.leadingSet7;
      case "l8": return varsets.leadingSet8;
      case "t1": return varsets.trailingSet1;
      case "t2": return varsets.trailingSet2;
      case "t3": return varsets.trailingSet3;
      case "t4": return varsets.trailingSet4;
    }
  } else {
    // prettier-ignore
    switch (varsetName) {
      case "canon": return varsets.canonical;
      case "v1": return varsets.set1;
      case "v2": return varsets.set2;
      case "v3": return varsets.set3;
      case "v4": return varsets.set4;
    }
  }
  return null;
}

const KIYEOK_LIKE = ["KIYEOK", "KIYEOK-KIYEOK", "KHIEUKH"];

function getJamoForm(
  type: "l" | "v" | "t",
  leading: string,
  vowel: string,
  trailing: string = "",
): VarsetType {
  if (type === "l" || type === "t") {
    const vowelInfo = HANGUL_DATA.vowelMap.get(vowel)!;
    const vowelPos = vowelInfo.position;
    if (type === "l") {
      if (vowelPos === "right") {
        return trailing === "" ? "l1" : "l6";
      } else if (vowelPos === "under") {
        if (trailing !== "") return "l7";
        if (vowelInfo.pokingDown) return "l3";
        return "l2";
      } else {
        // mixed
        if (trailing !== "") return "l8";
        if (vowelInfo.pokingDown) return "l5";
        return "l4";
      }
    } else {
      // trailing
      if (vowelInfo.doubleVertical) return "t3";
      else if (vowelPos === "under") return "t4";
      else if (vowelInfo.pokingRight) return "t1";
      else return "t2";
    }
  } else {
    // vowel
    if (KIYEOK_LIKE.includes(leading)) {
      if (trailing === "") return "v1";
      else return "v3";
    } else {
      if (trailing === "") return "v2";
      else return "v4";
    }
  }
}

function getSyllablesFor(
  jamoName: string,
  varsetName: string,
  precompose: boolean = true,
): string[] {
  switch (varsetName) {
    case "l1": // 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
      return HANGUL_DATA.vowelInfo
        .values()
        .filter((info) => info.position === "right")
        .map((info) =>
          composeHangul(jamoName, info.unicode_name, null, precompose),
        )
        .toArray();
    case "l2": // 받침없는 ㅗ ㅛ ㅡ
      return HANGUL_DATA.vowelInfo
        .values()
        .filter((info) => info.position === "under" && !info.pokingDown)
        .map((info) =>
          composeHangul(jamoName, info.unicode_name, null, precompose),
        )
        .toArray();
    case "l3": // 받침없는 ㅜ ㅠ
      return HANGUL_DATA.vowelInfo
        .values()
        .filter((info) => info.position === "under" && info.pokingDown)
        .map((info) =>
          composeHangul(jamoName, info.unicode_name, null, precompose),
        )
        .toArray();
    case "l4": // 받침없는 ㅘ ㅙ ㅚ ㅢ
      return HANGUL_DATA.vowelInfo
        .values()
        .filter((info) => info.position === "mixed" && !info.pokingDown)
        .map((info) =>
          composeHangul(jamoName, info.unicode_name, null, precompose),
        )
        .toArray();
    case "l5": // 받침없는 ㅝ ㅞ ㅟ
      return HANGUL_DATA.vowelInfo
        .values()
        .filter((info) => info.position === "mixed" && info.pokingDown)
        .map((info) =>
          composeHangul(jamoName, info.unicode_name, null, precompose),
        )
        .toArray();
    case "l6": // 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
      return HANGUL_DATA.vowelInfo
        .values()
        .filter((info) => info.position === "right")
        .flatMap((vinfo) =>
          HANGUL_DATA.consonantInfo
            .values()
            .filter((tinfo) => tinfo.trailing !== null)
            .map((tinfo) =>
              composeHangul(
                jamoName,
                vinfo.unicode_name,
                tinfo.unicode_name,
                precompose,
              ),
            ),
        )
        .toArray();
    case "l7": // 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
      return HANGUL_DATA.vowelInfo
        .values()
        .filter((info) => info.position === "under")
        .flatMap((vinfo) =>
          HANGUL_DATA.consonantInfo
            .values()
            .filter((tinfo) => tinfo.trailing !== null)
            .map((tinfo) =>
              composeHangul(
                jamoName,
                vinfo.unicode_name,
                tinfo.unicode_name,
                precompose,
              ),
            ),
        )
        .toArray();
    case "l8": // 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
      return HANGUL_DATA.vowelInfo
        .values()
        .filter((info) => info.position === "mixed")
        .flatMap((vinfo) =>
          HANGUL_DATA.consonantInfo
            .values()
            .filter((tinfo) => tinfo.trailing !== null)
            .map((tinfo) =>
              composeHangul(
                jamoName,
                vinfo.unicode_name,
                tinfo.unicode_name,
                precompose,
              ),
            ),
        )
        .toArray();
    case "v1": // 받침없는 [ㄱ ㅋ]과 결합
      return HANGUL_DATA.consonantInfo
        .values()
        .filter((info) => KIYEOK_LIKE.includes(info.unicode_name))
        .map((info) =>
          composeHangul(info.unicode_name, jamoName, null, precompose),
        )
        .toArray();
    case "v2": // 받침없는 [ㄱ ㅋ] 제외
      return HANGUL_DATA.consonantInfo
        .values()
        .filter((info) => !KIYEOK_LIKE.includes(info.unicode_name))
        .map((info) =>
          composeHangul(info.unicode_name, jamoName, null, precompose),
        )
        .toArray();
    case "v3": // 받침있는 [ㄱ ㅋ]과 결합
      return HANGUL_DATA.consonantInfo
        .values()
        .filter((info) => KIYEOK_LIKE.includes(info.unicode_name))
        .flatMap((linfo) =>
          HANGUL_DATA.consonantInfo
            .values()
            .filter((tinfo) => tinfo.trailing !== null)
            .map((tinfo) =>
              composeHangul(
                linfo.unicode_name,
                jamoName,
                tinfo.unicode_name,
                precompose,
              ),
            ),
        )
        .toArray();
    case "v4": // 받침있는 [ㄱ ㅋ] 제외
      return HANGUL_DATA.consonantInfo
        .values()
        .filter((info) => !KIYEOK_LIKE.includes(info.unicode_name))
        .flatMap((linfo) =>
          HANGUL_DATA.consonantInfo
            .values()
            .filter((tinfo) => tinfo.trailing !== null)
            .map((tinfo) =>
              composeHangul(
                linfo.unicode_name,
                jamoName,
                tinfo.unicode_name,
                precompose,
              ),
            ),
        )
        .toArray();
    case "t1": // 중성 ㅏ ㅑ ㅘ 와 결합
      return HANGUL_DATA.consonantInfo
        .values()
        .filter((info) => info.leading !== null)
        .flatMap((linfo) =>
          HANGUL_DATA.vowelInfo
            .values()
            .filter(
              (vinfo) =>
                !vinfo.doubleVertical &&
                vinfo.position !== "under" &&
                vinfo.pokingRight,
            )
            .map((vinfo) =>
              composeHangul(
                linfo.unicode_name,
                vinfo.unicode_name,
                jamoName,
                precompose,
              ),
            ),
        )
        .toArray();
    case "t2": // 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
      return HANGUL_DATA.consonantInfo
        .values()
        .filter((info) => info.leading !== null)
        .flatMap((linfo) =>
          HANGUL_DATA.vowelInfo
            .values()
            .filter(
              (vinfo) =>
                !vinfo.doubleVertical &&
                vinfo.position !== "under" &&
                !vinfo.pokingRight,
            )
            .map((vinfo) =>
              composeHangul(
                linfo.unicode_name,
                vinfo.unicode_name,
                jamoName,
                precompose,
              ),
            ),
        )
        .toArray();
    case "t3": // 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
      return HANGUL_DATA.consonantInfo
        .values()
        .filter((info) => info.leading !== null)
        .flatMap((linfo) =>
          HANGUL_DATA.vowelInfo
            .values()
            .filter((vinfo) => vinfo.doubleVertical)
            .map((vinfo) =>
              composeHangul(
                linfo.unicode_name,
                vinfo.unicode_name,
                jamoName,
                precompose,
              ),
            ),
        )
        .toArray();
    case "t4": // 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
      return HANGUL_DATA.consonantInfo
        .values()
        .filter((info) => info.leading !== null)
        .flatMap((linfo) =>
          HANGUL_DATA.vowelInfo
            .values()
            .filter(
              (vinfo) => !vinfo.doubleVertical && vinfo.position === "under",
            )
            .map((vinfo) =>
              composeHangul(
                linfo.unicode_name,
                vinfo.unicode_name,
                jamoName,
                precompose,
              ),
            ),
        )
        .toArray();
  }
  return [];
}

export function getExampleEnvPaths(
  varsets: JamoVarsets,
  jamoName: string,
  varsetName: string,
  numExamples: number,
): TComplexPathData[][] {
  const varsetType = varsetName[0].slice(0, 1) as "l" | "v" | "t";
  const syllables = getSyllablesFor(jamoName, varsetName, false)
    .map((syllable) => {
      const leading = getName(syllable.slice(0, 1))!;
      const vowel = getName(syllable.slice(1, 2))!;
      const trailing = getName(syllable.slice(2, 3))!;
      const combination: TComplexPathData[] = [];
      if (varsetType !== "l") {
        const varset = getVarset(
          varsets.consonants.get(leading)!,
          getJamoForm("l", leading, vowel, trailing),
        );
        if (varset === null) {
          return null;
        }
        combination.push(varset);
      }
      if (varsetType !== "v") {
        const varset = getVarset(
          varsets.vowel.get(vowel)!,
          getJamoForm("v", leading, vowel, trailing),
        );
        if (varset === null) {
          return null;
        }
        combination.push(varset);
      }
      if (varsetType !== "t" && trailing !== "") {
        const varset = getVarset(
          varsets.consonants.get(trailing)!,
          getJamoForm("t", leading, vowel, trailing),
        );
        if (varset === null) {
          return null;
        }
        combination.push(varset);
      }
      return combination;
    })
    .filter((syllable) => syllable !== null);
  const rng = seedrandom(`${jamoName}/${varsetName}`);
  return partialSample(syllables, numExamples, rng);
}

function partialSample<T>(array: T[], n: number, rng: () => number): T[] {
  const result: T[] = [...array];
  const length = result.length;
  const count = Math.min(n, length);
  for (let i = 0; i < count; i++) {
    const j = Math.floor(rng() * (length - i)) + i;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, count);
}
