import {
  Bounds,
  ConsonantVarsetType,
  JamoPref,
  VowelVarsetType,
} from "@/app/utils/types";

export const CONSONANT_JAMO_BOUNDS: Record<
  ConsonantVarsetType,
  [Bounds[], JamoPref]
> = {
  // 단독꼴
  canon: [
    [
      {
        left: 0,
        right: 1000,
        top: 0,
        bottom: 1000,
      },
    ],
    {},
  ],
  // 받침없는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
  l1: [
    [
      {
        left: 0,
        right: 600,
        top: 0,
        bottom: 1000,
      },
    ],
    { vowelPref: ["ㅒ"] },
  ],
  // 받침없는 ㅗ ㅛ ㅡ
  l2: [
    [
      {
        left: 0,
        right: 1000,
        top: 0,
        bottom: 500,
      },
    ],
    { vowelPref: ["ㅡ"] },
  ],
  // 받침없는 ㅜ ㅠ
  l3: [
    [
      {
        left: 0,
        right: 1000,
        top: 0,
        bottom: 500,
      },
    ],
    { vowelPref: ["ㅜ"] },
  ],
  // 받침없는 ㅘ ㅙ ㅚ ㅢ
  l4: [
    [
      {
        left: 0,
        right: 600,
        top: 0,
        bottom: 500,
      },
    ],
    { vowelPref: ["ㅢ"] },
  ],
  // 받침없는 ㅝ ㅞ ㅟ
  l5: [
    [
      {
        left: 0,
        right: 600,
        top: 0,
        bottom: 500,
      },
    ],
    { vowelPref: ["ㅞ"] },
  ],
  // 받침있는 ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅣ
  l6: [
    [
      {
        left: 0,
        right: 600,
        top: 0,
        bottom: 500,
      },
    ],
    { vowelPref: ["ㅏ"] },
  ],
  // 받침있는 ㅗ ㅛ ㅜ ㅠ ㅡ
  l7: [
    [
      {
        left: 0,
        right: 1000,
        top: 0,
        bottom: 400,
      },
    ],
    { vowelPref: ["ㅡ"] },
  ],
  // 받침있는 ㅘ ㅙ ㅚ ㅢ ㅝ ㅞ ㅟ
  l8: [
    [
      {
        left: 0,
        right: 600,
        top: 0,
        bottom: 400,
      },
    ],
    { vowelPref: ["ㅞ", "ㅢ"] },
  ],
  // 중성 ㅏ ㅑ ㅘ 와 결합
  t1: [
    [
      {
        left: 0,
        right: 1000,
        top: 500,
        bottom: 1000,
      },
    ],
    { vowelPref: ["ㅏ"] },
  ],
  // 중성 ㅓ ㅕ ㅚ ㅝ ㅟ ㅢ ㅣ 와 결합
  t2: [
    [
      {
        left: 0,
        right: 1000,
        top: 500,
        bottom: 1000,
      },
    ],
    { vowelPref: ["ㅓ"] },
  ],
  // 중성 ㅐ ㅒ ㅔ ㅖ ㅙ ㅞ 와 결합
  t3: [
    [
      {
        left: 0,
        right: 1000,
        top: 500,
        bottom: 1000,
      },
    ],
    { vowelPref: ["ㅐ"] },
  ],
  // 중성 ㅗ ㅛ ㅜ ㅠ ㅡ 와 결합
  t4: [
    [
      {
        left: 0,
        right: 1000,
        top: 500,
        bottom: 1000,
      },
    ],
    { vowelPref: ["ㅗ"] },
  ],
};

export const VOWEL_JAMO_BOUNDS: Record<VowelVarsetType, JamoPref> = {
  canon: {},
  v1: { leadingPref: ["ㅋ"] },
  v2: { leadingPref: ["ㅂ"] },
  v3: {
    leadingPref: ["ㅋ"],
    trailingPref: ["ㄱ"],
  },
  v4: {
    leadingPref: ["ㅂ"],
    trailingPref: ["ㄱ"],
  },
};
