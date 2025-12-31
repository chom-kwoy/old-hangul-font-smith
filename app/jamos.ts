import { TComplexPathData } from "fabric";
import seedrandom from "seedrandom";

import { HANGUL_DATA, composeHangul, getName } from "@/app/hangulData";
import { ConsonantSets, JamoVarsets, VarsetType, VowelSets } from "@/app/types";

export const CONSONANT_VARSET_NAMES: VarsetType[] = [
  "canon",
  "l1",
  "l2",
  "l3",
  "l4",
  "l5",
  "l6",
  "l7",
  "l8",
  "t1",
  "t2",
  "t3",
  "t4",
];

export const VOWEL_VARSET_NAMES: VarsetType[] = [
  "canon",
  "v1",
  "v2",
  "v3",
  "v4",
];

export function getVarset(
  varsets: ConsonantSets | VowelSets,
  varsetName: VarsetType,
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

export function* getSyllablesFor(
  jamoName: string,
  varsetName: string,
  precompose: boolean = true,
): Generator<string> {
  const vowels = HANGUL_DATA.vowelInfo.values().toArray();
  const consonants = HANGUL_DATA.consonantInfo.values().toArray();

  switch (varsetName) {
    case "l1": // 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
      for (const info of vowels) {
        if (info.position === "right") {
          yield composeHangul(jamoName, info.name, null, precompose);
        }
      }
      break;

    case "l2": // 받침없는 ㅗ ㅛ ㅡ
      for (const info of vowels) {
        if (info.position === "under" && !info.pokingDown) {
          yield composeHangul(jamoName, info.name, null, precompose);
        }
      }
      break;

    case "l3": // 받침없는 ㅜ ㅠ
      for (const info of vowels) {
        if (info.position === "under" && info.pokingDown) {
          yield composeHangul(jamoName, info.name, null, precompose);
        }
      }
      break;

    case "l4": // 받침없는 ㅘ ㅙ ㅚ ㅢ
      for (const info of vowels) {
        if (info.position === "mixed" && !info.pokingDown) {
          yield composeHangul(jamoName, info.name, null, precompose);
        }
      }
      break;

    case "l5": // 받침없는 ㅝ ㅞ ㅟ
      for (const info of vowels) {
        if (info.position === "mixed" && info.pokingDown) {
          yield composeHangul(jamoName, info.name, null, precompose);
        }
      }
      break;

    case "l6": // 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
      for (const vinfo of vowels) {
        if (vinfo.position === "right") {
          for (const tinfo of consonants) {
            if (tinfo.trailing !== null) {
              yield composeHangul(jamoName, vinfo.name, tinfo.name, precompose);
            }
          }
        }
      }
      break;

    case "l7": // 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
      for (const vinfo of vowels) {
        if (vinfo.position === "under") {
          for (const tinfo of consonants) {
            if (tinfo.trailing !== null) {
              yield composeHangul(jamoName, vinfo.name, tinfo.name, precompose);
            }
          }
        }
      }
      break;

    case "l8": // 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
      for (const vinfo of vowels) {
        if (vinfo.position === "mixed") {
          for (const tinfo of consonants) {
            if (tinfo.trailing !== null) {
              yield composeHangul(jamoName, vinfo.name, tinfo.name, precompose);
            }
          }
        }
      }
      break;

    case "v1": // 받침없는 [ㄱ ㅋ]과 결합
      for (const info of consonants) {
        if (info.leading !== null && KIYEOK_LIKE.includes(info.name)) {
          yield composeHangul(info.name, jamoName, null, precompose);
        }
      }
      break;

    case "v2": // 받침없는 [ㄱ ㅋ] 제외
      for (const info of consonants) {
        if (info.leading !== null && !KIYEOK_LIKE.includes(info.name)) {
          yield composeHangul(info.name, jamoName, null, precompose);
        }
      }
      break;

    case "v3": // 받침있는 [ㄱ ㅋ]과 결합
      for (const linfo of consonants) {
        if (linfo.leading !== null && KIYEOK_LIKE.includes(linfo.name)) {
          for (const tinfo of consonants) {
            if (tinfo.trailing !== null) {
              yield composeHangul(linfo.name, jamoName, tinfo.name, precompose);
            }
          }
        }
      }
      break;

    case "v4": // 받침있는 [ㄱ ㅋ] 제외
      for (const linfo of consonants) {
        if (linfo.leading !== null && !KIYEOK_LIKE.includes(linfo.name)) {
          for (const tinfo of consonants) {
            if (tinfo.trailing !== null) {
              yield composeHangul(linfo.name, jamoName, tinfo.name, precompose);
            }
          }
        }
      }
      break;

    case "t1": // 중성 ㅏ ㅑ ㅘ 와 결합
      for (const linfo of consonants) {
        if (linfo.leading !== null) {
          for (const vinfo of vowels) {
            if (
              !vinfo.doubleVertical &&
              vinfo.position !== "under" &&
              vinfo.pokingRight
            ) {
              yield composeHangul(linfo.name, vinfo.name, jamoName, precompose);
            }
          }
        }
      }
      break;

    case "t2": // 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
      for (const linfo of consonants) {
        if (linfo.leading !== null) {
          for (const vinfo of vowels) {
            if (
              !vinfo.doubleVertical &&
              vinfo.position !== "under" &&
              !vinfo.pokingRight
            ) {
              yield composeHangul(linfo.name, vinfo.name, jamoName, precompose);
            }
          }
        }
      }
      break;

    case "t3": // 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
      for (const linfo of consonants) {
        if (linfo.leading !== null) {
          for (const vinfo of vowels) {
            if (vinfo.doubleVertical) {
              yield composeHangul(linfo.name, vinfo.name, jamoName, precompose);
            }
          }
        }
      }
      break;

    case "t4": // 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
      for (const linfo of consonants) {
        if (linfo.leading !== null) {
          for (const vinfo of vowels) {
            if (!vinfo.doubleVertical && vinfo.position === "under") {
              yield composeHangul(linfo.name, vinfo.name, jamoName, precompose);
            }
          }
        }
      }
      break;
  }
}

export function getExampleEnvPaths(
  varsets: JamoVarsets,
  jamoName: string,
  varsetName: string,
  numExamples: number,
): TComplexPathData[][] {
  const varsetType = varsetName[0].slice(0, 1) as "l" | "v" | "t";
  const results: TComplexPathData[][] = [];
  const syllables = getSyllablesFor(jamoName, varsetName, false).toArray();
  for (const syllable of shuffle(syllables)) {
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
        continue;
      }
      combination.push(varset);
    }
    if (varsetType !== "v") {
      const varset = getVarset(
        varsets.vowel.get(vowel)!,
        getJamoForm("v", leading, vowel, trailing),
      );
      if (varset === null) {
        continue;
      }
      combination.push(varset);
    }
    if (varsetType !== "t" && trailing !== "") {
      const varset = getVarset(
        varsets.consonants.get(trailing)!,
        getJamoForm("t", leading, vowel, trailing),
      );
      if (varset === null) {
        continue;
      }
      combination.push(varset);
    }
    results.push(combination);
    if (results.length >= numExamples) {
      break;
    }
  }
  return results;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
