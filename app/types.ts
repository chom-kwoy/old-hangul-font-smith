import { TComplexPathData } from "fabric";

export type FontMetadata = {
  name: string;
  family: string;
  style: string;
  numGlyphs: number;
};

export type ConsonantInfo = {
  unicode_name: string;
  canonical: string;
  compat: string | null;
  leading: string | null;
  trailing: string | null;
};

export type VowelInfo = {
  unicode_name: string;
  canonical: string;
  compat: string | null;
  vowel: string | null;
  position: "right" | "under" | "mixed";
  pokingDown: boolean; // e.g. ㅜ ㅠ ㅝ ㅞ ㅟ
  pokingRight: boolean; // e.g. ㅏ ㅑ ㅘ
  doubleVertical: boolean; // e.g. ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ
};

export type JamoVarsets = {
  consonants: Map<string, ConsonantSets>;
  vowel: Map<string, VowelSets>;
};

export type ConsonantSets = {
  type: "consonant";
  canonical: TComplexPathData | null; // 단독꼴
  // leading
  leadingSet1: TComplexPathData | null; // 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
  leadingSet2: TComplexPathData | null; // 받침없는 ㅗ ㅛ ㅡ
  leadingSet3: TComplexPathData | null; // 받침없는 ㅜ ㅠ
  leadingSet4: TComplexPathData | null; // 받침없는 ㅘ ㅙ ㅚ ㅢ
  leadingSet5: TComplexPathData | null; // 받침없는 ㅝ ㅞ ㅟ
  leadingSet6: TComplexPathData | null; // 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
  leadingSet7: TComplexPathData | null; // 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
  leadingSet8: TComplexPathData | null; // 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
  // trailing
  trailingSet1: TComplexPathData | null; // 중성 ㅏ ㅑ ㅘ 와 결합
  trailingSet2: TComplexPathData | null; // 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
  trailingSet3: TComplexPathData | null; // 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
  trailingSet4: TComplexPathData | null; // 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
};

export type VowelSets = {
  type: "vowel";
  canonical: TComplexPathData | null; // 단독꼴
  set1: TComplexPathData | null; // 받침없는 [ㄱ ㅋ]과 결합
  set2: TComplexPathData | null; // 받침없는 [ㄱ ㅋ] 제외
  set3: TComplexPathData | null; // 받침있는 [ㄱ ㅋ]과 결합
  set4: TComplexPathData | null; // 받침있는 [ㄱ ㅋ] 제외
};

export type Bounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type VarsetType =
  | "l1"
  | "l2"
  | "l3"
  | "l4"
  | "l5"
  | "l6"
  | "l7"
  | "l8"
  | "v1"
  | "v2"
  | "v3"
  | "v4"
  | "t1"
  | "t2"
  | "t3"
  | "t4";
