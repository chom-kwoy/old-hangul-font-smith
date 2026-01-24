import { SerializedPathData } from "@/app/pathUtils/PathData";

export type FontMetadata = {
  name: string;
  family: string;
  style: string;
  numGlyphs: number;
};

export type ConsonantInfo = {
  type: "consonant";
  name: string;
  canonical: string;
  compat: string | null;
  leading: string | null;
  trailing: string | null;
};

export type VowelInfo = {
  type: "vowel";
  name: string;
  canonical: string;
  compat: string | null;
  vowel: string | null;
  position: "right" | "under" | "mixed";
  pokingDown: boolean; // e.g. ㅜ ㅠ ㅝ ㅞ ㅟ
  pokingRight: boolean; // e.g. ㅏ ㅑ ㅘ
  doubleVertical: boolean; // e.g. ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ
};

export type JamoVarsets = Record<string, ConsonantSets | VowelSets>;

export type ConsonantSets = {
  type: "consonant";
} & Record<ConsonantVarsetType, SerializedPathData | null>;

export type VowelSets = {
  type: "vowel";
} & Record<VowelVarsetType, SerializedPathData | null>;

export type Bounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ConsonantVarsetType =
  | "canon" // 단독꼴
  | "l1" // 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
  | "l2" // 받침없는 ㅗ ㅛ ㅡ
  | "l3" // 받침없는 ㅜ ㅠ
  | "l4" // 받침없는 ㅘ ㅙ ㅚ ㅢ
  | "l5" // 받침없는 ㅝ ㅞ ㅟ
  | "l6" // 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
  | "l7" // 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
  | "l8" // 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
  | "t1" // 중성 ㅏ ㅑ ㅘ 와 결합
  | "t2" // 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
  | "t3" // 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
  | "t4"; // 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
export type VowelVarsetType =
  | "canon" // 단독꼴
  | "v1" // 받침없는 [ㄱ ㅋ]과 결합
  | "v2" // 받침없는 [ㄱ ㅋ] 제외
  | "v3" // 받침있는 [ㄱ ㅋ]과 결합
  | "v4"; // 받침있는 [ㄱ ㅋ] 제외
export type VarsetType = ConsonantVarsetType | VowelVarsetType;

export type SavedState = {
  metadata: FontMetadata;
  previewImage: string;
  jamoVarsets: JamoVarsets;
  progress: number;
  date: number;
};

export type JamoPref = {
  leadingPref?: string[];
  vowelPref?: string[];
  trailingPref?: string[];
};

export type GenerateOptions = {
  includePrecomposed: boolean;
  isVerticalFont: boolean;
};
