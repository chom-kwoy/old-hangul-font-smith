import {
  HANGUL_DATA,
  composeHangul,
  getJamoInfo,
  getLeading,
  getName,
  getTrailing,
  getVowel,
} from "@/app/hangulData";
import {
  ConsonantInfo,
  ConsonantSets,
  ConsonantVarsetType,
  JamoPref,
  JamoVarsets,
  PathData,
  VarsetType,
  VowelInfo,
  VowelSets,
  VowelVarsetType,
} from "@/app/types";

export const CONSONANT_VARSET_NAMES: ConsonantVarsetType[] = [
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

export const VOWEL_VARSET_NAMES: VowelVarsetType[] = [
  "canon",
  "v1",
  "v2",
  "v3",
  "v4",
];

export function getVarset(
  varsets: ConsonantSets | VowelSets,
  varsetName: VarsetType,
): PathData | null {
  if (varsets.type === "consonant") {
    const v = varsetName as ConsonantVarsetType;
    if (CONSONANT_VARSET_NAMES.includes(v)) {
      return varsets[v] as PathData | null;
    }
    return null;
  } else {
    const v = varsetName as VowelVarsetType;
    if (VOWEL_VARSET_NAMES.includes(v)) {
      return varsets[v] as PathData | null;
    }
    return null;
  }
}

export function setVarset(
  varsets: ConsonantSets | VowelSets,
  varsetName: VarsetType,
  data: PathData | null,
): PathData | null {
  if (varsets.type === "consonant") {
    const v = varsetName as ConsonantVarsetType;
    if (CONSONANT_VARSET_NAMES.includes(v)) {
      varsets[v] = data;
    }
  } else if (varsets.type === "vowel") {
    const v = varsetName as VowelVarsetType;
    if (VOWEL_VARSET_NAMES.includes(v)) {
      varsets[v] = data;
    }
  }
  return null;
}

export function updateVarset(
  varsets: ConsonantSets | VowelSets,
  varsetName: VarsetType,
  data: PathData | null,
): ConsonantSets | VowelSets {
  if (varsets.type === "consonant") {
    const v = varsetName as ConsonantVarsetType;
    if (CONSONANT_VARSET_NAMES.includes(v)) {
      return {
        ...varsets,
        [v]: data,
      };
    }
  } else if (varsets.type === "vowel") {
    const v = varsetName as VowelVarsetType;
    if (VOWEL_VARSET_NAMES.includes(v)) {
      return {
        ...varsets,
        [v]: data,
      };
    }
  }
  return varsets;
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
  varsetName: VarsetType,
  precompose: boolean = true,
  { leadingPref, vowelPref, trailingPref }: JamoPref = {},
): Generator<string> {
  const leadings = new Set([
    ...(leadingPref?.map((jamo) => getJamoInfo(jamo)) ?? []),
    ...HANGUL_DATA.consonantInfo.values(),
  ]) as Set<ConsonantInfo>;
  const vowels = new Set([
    ...(vowelPref?.map((jamo) => getJamoInfo(jamo)) ?? []),
    ...HANGUL_DATA.vowelInfo.values().toArray(),
  ]) as Set<VowelInfo>;
  const trailings = new Set([
    ...(trailingPref?.map((jamo) => getJamoInfo(jamo)) ?? []),
    ...HANGUL_DATA.consonantInfo.values(),
  ]) as Set<ConsonantInfo>;

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
          for (const tinfo of trailings) {
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
          for (const tinfo of trailings) {
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
          for (const tinfo of trailings) {
            if (tinfo.trailing !== null) {
              yield composeHangul(jamoName, vinfo.name, tinfo.name, precompose);
            }
          }
        }
      }
      break;

    case "v1": // 받침없는 [ㄱ ㅋ]과 결합
      for (const info of leadings) {
        if (info.leading !== null && KIYEOK_LIKE.includes(info.name)) {
          yield composeHangul(info.name, jamoName, null, precompose);
        }
      }
      break;

    case "v2": // 받침없는 [ㄱ ㅋ] 제외
      for (const info of leadings) {
        if (info.leading !== null && !KIYEOK_LIKE.includes(info.name)) {
          yield composeHangul(info.name, jamoName, null, precompose);
        }
      }
      break;

    case "v3": // 받침있는 [ㄱ ㅋ]과 결합
      for (const linfo of leadings) {
        if (linfo.leading !== null && KIYEOK_LIKE.includes(linfo.name)) {
          for (const tinfo of trailings) {
            if (tinfo.trailing !== null) {
              yield composeHangul(linfo.name, jamoName, tinfo.name, precompose);
            }
          }
        }
      }
      break;

    case "v4": // 받침있는 [ㄱ ㅋ] 제외
      for (const linfo of leadings) {
        if (linfo.leading !== null && !KIYEOK_LIKE.includes(linfo.name)) {
          for (const tinfo of trailings) {
            if (tinfo.trailing !== null) {
              yield composeHangul(linfo.name, jamoName, tinfo.name, precompose);
            }
          }
        }
      }
      break;

    case "t1": // 중성 ㅏ ㅑ ㅘ 와 결합
      for (const linfo of leadings) {
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
      for (const linfo of leadings) {
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
      for (const linfo of leadings) {
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
      for (const linfo of leadings) {
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
  varsetName: VarsetType,
  numExamples: number,
): PathData[][] {
  const varsetType = varsetName[0].slice(0, 1) as "l" | "v" | "t";
  const results: PathData[][] = [];
  const syllables = getSyllablesFor(jamoName, varsetName, false).toArray();
  for (const syllable of shuffle(syllables)) {
    const leading = getName(syllable.slice(0, 1))!;
    const vowel = getName(syllable.slice(1, 2))!;
    const trailing = getName(syllable.slice(2, 3))!;
    const combination: PathData[] = [];
    if (varsetType !== "l") {
      const varset = getVarset(
        varsets.jamos.get(leading)!,
        getJamoForm("l", leading, vowel, trailing),
      );
      if (varset === null) {
        continue;
      }
      combination.push(varset);
    }
    if (varsetType !== "v") {
      const varset = getVarset(
        varsets.jamos.get(vowel)!,
        getJamoForm("v", leading, vowel, trailing),
      );
      if (varset === null) {
        continue;
      }
      combination.push(varset);
    }
    if (varsetType !== "t" && trailing !== "") {
      const varset = getVarset(
        varsets.jamos.get(trailing)!,
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

export function getProgress(varsets: JamoVarsets) {
  let total = 0;
  let progress = 0;
  for (const [jamoName, varset] of varsets.jamos.entries()) {
    for (const varsetName of varset.type === "consonant"
      ? CONSONANT_VARSET_NAMES
      : VOWEL_VARSET_NAMES) {
      if (
        (varsetName.startsWith("l") && getLeading(jamoName) === null) ||
        (varsetName.startsWith("v") && getVowel(jamoName) === null) ||
        (varsetName.startsWith("t") && getTrailing(jamoName) === null)
      ) {
        continue;
      }
      total++;
      if (getVarset(varset, varsetName) !== null) {
        progress++;
      }
    }
  }
  return progress / total;
}
