import seedrandom from "seedrandom";

import {
  HANGUL_DATA,
  composeHangul,
  getJamoInfo,
  getLeading,
  getName,
  getTrailing,
  getVowel,
} from "@/app/hangul/hangulData";
import PathData from "@/app/pathUtils/PathData";
import {
  ConsonantSets,
  ConsonantVarsetType,
  JamoPref,
  JamoVarsets,
  VarsetType,
  VowelSets,
  VowelVarsetType,
} from "@/app/utils/types";

// prettier-ignore
export const LEADING_VARSET_NAMES: ConsonantVarsetType[] = [
  "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8",
];
// prettier-ignore
export const VOWELJAMO_VARSET_NAMES: VowelVarsetType[] = [
  "v1", "v2", "v3", "v4",
];
// prettier-ignore
export const TRAILING_VARSET_NAMES: ConsonantVarsetType[] = [
  "t1", "t2", "t3", "t4",
];

export const CONSONANT_VARSET_NAMES: ConsonantVarsetType[] = [
  "canon",
  ...LEADING_VARSET_NAMES,
  ...TRAILING_VARSET_NAMES,
];

export const VOWEL_VARSET_NAMES: VowelVarsetType[] = [
  "canon",
  ...VOWELJAMO_VARSET_NAMES,
];

export function getVarset(
  varsets: ConsonantSets | VowelSets,
  varsetName: VarsetType,
): PathData | null {
  if (varsets.type === "consonant") {
    const v = varsetName as ConsonantVarsetType;
    if (CONSONANT_VARSET_NAMES.includes(v)) {
      return varsets[v] ? PathData.deserialize(varsets[v]) : null;
    }
    return null;
  } else {
    const v = varsetName as VowelVarsetType;
    if (VOWEL_VARSET_NAMES.includes(v)) {
      return varsets[v] ? PathData.deserialize(varsets[v]) : null;
    }
    return null;
  }
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

export function getJamoVarsetEnv(varsetName: VarsetType): {
  prevJamoNames: string[][];
  nextJamoNames: string[][];
} {
  const results = {
    prevJamoNames: [] as string[][],
    nextJamoNames: [] as string[][],
  };

  const leadings = HANGUL_DATA.consonantInfo.values().toArray();
  const vowels = HANGUL_DATA.vowelInfo.values().toArray();
  const trailings = HANGUL_DATA.consonantInfo.values().toArray();

  switch (varsetName) {
    case "l1": // 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
      results.nextJamoNames.push(
        vowels
          .filter((info) => info.position === "right")
          .map((info) => info.name),
      );
      results.nextJamoNames.push([""]);
      break;
    case "l2": // 받침없는 ㅗ ㅛ ㅡ
      results.nextJamoNames.push(
        vowels
          .filter((info) => info.position === "under" && !info.pokingDown)
          .map((info) => info.name),
      );
      results.nextJamoNames.push([""]);
      break;
    case "l3": // 받침없는 ㅜ ㅠ
      results.nextJamoNames.push(
        vowels
          .filter((info) => info.position === "under" && info.pokingDown)
          .map((info) => info.name),
      );
      results.nextJamoNames.push([""]);
      break;
    case "l4": // 받침없는 ㅘ ㅙ ㅚ ㅢ
      results.nextJamoNames.push(
        vowels
          .filter((info) => info.position === "mixed" && !info.pokingDown)
          .map((info) => info.name),
      );
      results.nextJamoNames.push([""]);
      break;
    case "l5": // 받침없는 ㅝ ㅞ ㅟ
      results.nextJamoNames.push(
        vowels
          .filter((info) => info.position === "mixed" && info.pokingDown)
          .map((info) => info.name),
      );
      results.nextJamoNames.push([""]);
      break;
    case "l6": // 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
      results.nextJamoNames.push(
        vowels
          .filter((vinfo) => vinfo.position === "right")
          .map((vinfo) => vinfo.name),
      );
      results.nextJamoNames.push(
        trailings
          .filter((tinfo) => tinfo.trailing !== null)
          .map((tinfo) => tinfo.name),
      );
      break;
    case "l7": // 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
      results.nextJamoNames.push(
        vowels
          .filter((vinfo) => vinfo.position === "under")
          .map((vinfo) => vinfo.name),
      );
      results.nextJamoNames.push(
        trailings
          .filter((tinfo) => tinfo.trailing !== null)
          .map((tinfo) => tinfo.name),
      );
      break;
    case "l8": // 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
      results.nextJamoNames.push(
        vowels
          .filter((vinfo) => vinfo.position === "mixed")
          .map((vinfo) => vinfo.name),
      );
      results.nextJamoNames.push(
        trailings
          .filter((tinfo) => tinfo.trailing !== null)
          .map((tinfo) => tinfo.name),
      );
      break;
    case "v1": // 받침없는 [ㄱ ㅋ]과 결합
      results.prevJamoNames.push(
        leadings
          .filter(
            (info) => info.leading !== null && KIYEOK_LIKE.includes(info.name),
          )
          .map((info) => info.name),
      );
      results.nextJamoNames.push([""]);
      break;
    case "v2": // 받침없는 [ㄱ ㅋ] 제외
      results.prevJamoNames.push(
        leadings
          .filter(
            (info) => info.leading !== null && !KIYEOK_LIKE.includes(info.name),
          )
          .map((info) => info.name),
      );
      results.nextJamoNames.push([""]);
      break;
    case "v3": // 받침있는 [ㄱ ㅋ]과 결합
      results.prevJamoNames.push(
        leadings
          .filter(
            (linfo) =>
              linfo.leading !== null && KIYEOK_LIKE.includes(linfo.name),
          )
          .map((linfo) => linfo.name),
      );
      results.nextJamoNames.push(
        trailings
          .filter((tinfo) => tinfo.trailing !== null)
          .map((tinfo) => tinfo.name),
      );
      break;
    case "v4": // 받침있는 [ㄱ ㅋ] 제외
      results.prevJamoNames.push(
        leadings
          .filter(
            (linfo) =>
              linfo.leading !== null && !KIYEOK_LIKE.includes(linfo.name),
          )
          .map((linfo) => linfo.name),
      );
      results.nextJamoNames.push(
        trailings
          .filter((tinfo) => tinfo.trailing !== null)
          .map((tinfo) => tinfo.name),
      );
      break;
    case "t1": // 중성 ㅏ ㅑ ㅘ 와 결합
      results.prevJamoNames.push(
        leadings
          .filter((linfo) => linfo.leading !== null)
          .map((linfo) => linfo.name),
      );
      results.prevJamoNames.push(
        vowels
          .filter(
            (vinfo) =>
              !vinfo.doubleVertical &&
              vinfo.position !== "under" &&
              vinfo.pokingRight,
          )
          .map((vinfo) => vinfo.name),
      );
      break;
    case "t2": // 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
      results.prevJamoNames.push(
        leadings
          .filter((linfo) => linfo.leading !== null)
          .map((linfo) => linfo.name),
      );
      results.prevJamoNames.push(
        vowels
          .filter(
            (vinfo) =>
              !vinfo.doubleVertical &&
              vinfo.position !== "under" &&
              !vinfo.pokingRight,
          )
          .map((vinfo) => vinfo.name),
      );
      break;
    case "t3": // 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
      results.prevJamoNames.push(
        leadings
          .filter((linfo) => linfo.leading !== null)
          .map((linfo) => linfo.name),
      );
      results.prevJamoNames.push(
        vowels
          .filter((vinfo) => vinfo.doubleVertical)
          .map((vinfo) => vinfo.name),
      );
      break;
    case "t4": // 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
      results.prevJamoNames.push(
        leadings
          .filter((linfo) => linfo.leading !== null)
          .map((linfo) => linfo.name),
      );
      results.prevJamoNames.push(
        vowels
          .filter(
            (vinfo) => !vinfo.doubleVertical && vinfo.position === "under",
          )
          .map((vinfo) => vinfo.name),
      );
      break;
  }

  return results;
}

export function* getSyllablesFor(
  jamoName: string,
  varsetName: VarsetType,
  precompose: boolean = true,
  { leadingPref, vowelPref, trailingPref }: JamoPref = {},
): Generator<string> {
  if (varsetName === "canon") {
    yield getJamoInfo(jamoName)!.canonical;
    return;
  }

  const env = getJamoVarsetEnv(varsetName);

  let leadings: string[] = [];
  let vowels: string[] = [];
  let trailings: string[] = [];
  if (varsetName.startsWith("l")) {
    vowels = env.nextJamoNames[0];
    trailings = env.nextJamoNames[1];
  } else if (varsetName.startsWith("v")) {
    leadings = env.prevJamoNames[0];
    trailings = env.nextJamoNames[0];
  } else if (varsetName.startsWith("t")) {
    leadings = env.prevJamoNames[0];
    vowels = env.prevJamoNames[1];
  }

  const getName = (jamo: string) => getJamoInfo(jamo)!.name;
  leadingPref = leadingPref?.map(getName) ?? leadings;
  vowelPref = vowelPref?.map(getName) ?? vowels;
  trailingPref = trailingPref?.map(getName) ?? trailings;

  const leadingRest = leadings.filter((jamo) => !leadingPref.includes(jamo));
  const vowelRest = vowels.filter((jamo) => !vowelPref.includes(jamo));
  const trailingRest = trailings.filter((jamo) => !trailingPref.includes(jamo));

  if (varsetName.startsWith("l")) {
    for (const v of vowelPref) {
      for (const t of trailingPref) {
        yield composeHangul(jamoName, v, t, precompose);
      }
    }
    for (const v of vowelPref) {
      for (const t of trailingRest) {
        yield composeHangul(jamoName, v, t, precompose);
      }
    }
    for (const v of vowelRest) {
      for (const t of [...trailingPref, ...trailingRest]) {
        yield composeHangul(jamoName, v, t, precompose);
      }
    }
  } else if (varsetName.startsWith("v")) {
    for (const l of leadingPref) {
      for (const t of trailingPref) {
        yield composeHangul(l, jamoName, t, precompose);
      }
    }
    for (const l of leadingPref) {
      for (const t of trailingRest) {
        yield composeHangul(l, jamoName, t, precompose);
      }
    }
    for (const l of leadingRest) {
      for (const t of [...trailingPref, ...trailingRest]) {
        yield composeHangul(l, jamoName, t, precompose);
      }
    }
  } else if (varsetName.startsWith("t")) {
    for (const l of leadingPref) {
      for (const v of vowelPref) {
        yield composeHangul(l, v, jamoName, precompose);
      }
    }
    for (const l of leadingPref) {
      for (const v of vowelRest) {
        yield composeHangul(l, v, jamoName, precompose);
      }
    }
    for (const l of leadingRest) {
      for (const v of [...vowelPref, ...vowelRest]) {
        yield composeHangul(l, v, jamoName, precompose);
      }
    }
  }
}

export function getExampleEnvPaths(
  varsets: JamoVarsets,
  jamoName: string,
  varsetName: VarsetType,
  numExamples: number,
): PathData[][] {
  if (varsetName === "canon") {
    return [];
  }
  const varsetType = varsetName[0].slice(0, 1) as "l" | "v" | "t";
  const results: PathData[][] = [];
  const syllables = getSyllablesFor(jamoName, varsetName, false).toArray();
  const rng = seedrandom(`${jamoName}-${varsetName}`);
  for (const syllable of shuffle(syllables, rng)) {
    const leading = getName(syllable.slice(0, 1))!;
    const vowel = getName(syllable.slice(1, 2))!;
    const trailing = getName(syllable.slice(2, 3))!;
    const combination: PathData[] = [];
    if (varsetType !== "l") {
      const varset = getVarset(
        varsets[leading],
        getJamoForm("l", leading, vowel, trailing),
      );
      if (varset === null) {
        continue;
      }
      combination.push(varset);
    }
    if (varsetType !== "v") {
      const varset = getVarset(
        varsets[vowel],
        getJamoForm("v", leading, vowel, trailing),
      );
      if (varset === null) {
        continue;
      }
      combination.push(varset);
    }
    if (varsetType !== "t" && trailing !== "") {
      const varset = getVarset(
        varsets[trailing],
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

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getProgress(varsets: JamoVarsets) {
  let total = 0;
  let progress = 0;
  for (const [jamoName, varset] of Object.entries(varsets)) {
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
