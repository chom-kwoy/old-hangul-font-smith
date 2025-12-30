import { ConsonantInfo, VowelInfo } from "@/app/types";

function getHangulData(): {
  consonantInfo: Map<string, ConsonantInfo>;
  vowelInfo: Map<string, VowelInfo>;
  consonantMap: Map<string, ConsonantInfo>;
  vowelMap: Map<string, VowelInfo>;
} {
  type consDatum = [
    string,
    string,
    string | null,
    string | null,
    string | null,
  ];
  type vowelDatum = [
    string,
    string,
    string | null,
    string | null,
    "right" | "under" | "mixed",
  ];
  const CONS_DATA: consDatum[] = [
    ["KIYEOK", "ㄱ", "ㄱ", "ᄀ", "ᆨ"],
    ["KIYEOK-KIYEOK", "ㄲ", "ㄲ", "ᄁ", "ᆩ"],
    ["KIYEOK-SIOS", "ㄳ", "ㄳ", null, "ᆪ"],
    ["NIEUN", "ㄴ", "ㄴ", "ᄂ", "ᆫ"],
    ["NIEUN-CIEUC", "ㄵ", "ㄵ", "ᅜ", "ᆬ"],
    ["NIEUN-HIEUH", "ㄶ", "ㄶ", "ᅝ", "ᆭ"],
    ["TIKEUT", "ㄷ", "ㄷ", "ᄃ", "ᆮ"],
    ["TIKEUT-TIKEUT", "ㄸ", "ㄸ", "ᄄ", "ퟍ"],
    ["RIEUL", "ㄹ", "ㄹ", "ᄅ", "ᆯ"],
    ["RIEUL-KIYEOK", "ㄺ", "ㄺ", "ꥤ", "ᆰ"],
    ["RIEUL-MIEUM", "ㄻ", "ㄻ", "ꥨ", "ᆱ"],
    ["RIEUL-PIEUP", "ㄼ", "ㄼ", "ꥩ", "ᆲ"],
    ["RIEUL-SIOS", "ㄽ", "ㄽ", "ꥬ", "ᆳ"],
    ["RIEUL-THIEUTH", "ㄾ", "ㄾ", null, "ᆴ"],
    ["RIEUL-PHIEUPH", "ㄿ", "ㄿ", null, "ᆵ"],
    ["RIEUL-HIEUH", "ㅀ", "ㅀ", "ᄚ", "ᆶ"],
    ["MIEUM", "ㅁ", "ㅁ", "ᄆ", "ᆷ"],
    ["PIEUP", "ㅂ", "ㅂ", "ᄇ", "ᆸ"],
    ["PIEUP-PIEUP", "ㅃ", "ㅃ", "ᄈ", "ퟦ"],
    ["PIEUP-SIOS", "ㅄ", "ㅄ", "ᄡ", "ᆹ"],
    ["SIOS", "ㅅ", "ㅅ", "ᄉ", "ᆺ"],
    ["SIOS-SIOS", "ㅆ", "ㅆ", "ᄊ", "ᆻ"],
    ["IEUNG", "ㅇ", "ㅇ", "ᄋ", "ᆼ"],
    ["CIEUC", "ㅈ", "ㅈ", "ᄌ", "ᆽ"],
    ["CIEUC-CIEUC", "ㅉ", "ㅉ", "ᄍ", "ퟹ"],
    ["CHIEUCH", "ㅊ", "ㅊ", "ᄎ", "ᆾ"],
    ["KHIEUKH", "ㅋ", "ㅋ", "ᄏ", "ᆿ"],
    ["THIEUTH", "ㅌ", "ㅌ", "ᄐ", "ᇀ"],
    ["PHIEUPH", "ㅍ", "ㅍ", "ᄑ", "ᇁ"],
    ["HIEUH", "ㅎ", "ㅎ", "ᄒ", "ᇂ"],
    ["NIEUN-NIEUN", "ㅥ", "ㅥ", "ᄔ", null],
    ["NIEUN-TIKEUT", "ㅦ", "ㅦ", "ᄕ", "ᇆ"],
    ["NIEUN-SIOS", "ㅧ", "ㅧ", "ᅛ", "ᇇ"],
    ["NIEUN-PANSIOS", "ㅨ", "ㅨ", null, "ᇈ"],
    ["RIEUL-KIYEOK-SIOS", "ㅩ", "ㅩ", null, "ᇌ"],
    ["RIEUL-TIKEUT", "ㅪ", "ㅪ", "ꥦ", "ᇎ"],
    ["RIEUL-PIEUP-SIOS", "ㅫ", "ㅫ", null, "ᇓ"],
    ["RIEUL-PANSIOS", "ㅬ", "ㅬ", null, "ᇗ"],
    ["RIEUL-YEORINHIEUH", "ㅭ", "ㅭ", null, "ᇙ"],
    ["MIEUM-PIEUP", "ㅮ", "ㅮ", "ᄜ", "ᇜ"],
    ["MIEUM-SIOS", "ㅯ", "ㅯ", "ꥱ", "ᇝ"],
    ["MIEUM-PANSIOS", "ㅰ", "ㅰ", null, "ᇟ"],
    ["MIEUM-IEUNG", "ㅱ", "ㅱ", "ᄝ", "ᇢ"],
    ["PIEUP-KIYEOK", "ㅲ", "ㅲ", "ᄞ", null],
    ["PIEUP-TIKEUT", "ㅳ", "ㅳ", "ᄠ", "ퟣ"],
    ["PIEUP-SIOS-KIYEOK", "ㅴ", "ㅴ", "ᄢ", null],
    ["PIEUP-SIOS-TIKEUT", "ㅵ", "ㅵ", "ᄣ", "ퟧ"],
    ["PIEUP-CIEUC", "ㅶ", "ㅶ", "ᄧ", "ퟨ"],
    ["PIEUP-THIEUTH", "ㅷ", "ㅷ", "ᄩ", null],
    ["PIEUP-IEUNG", "ㅸ", "ㅸ", "ᄫ", "ᇦ"],
    ["PIEUP-PIEUP-IEUNG", "ㅹ", "ㅹ", "ᄬ", null],
    ["SIOS-KIYEOK", "ㅺ", "ㅺ", "ᄭ", "ᇧ"],
    ["SIOS-NIEUN", "ㅻ", "ㅻ", "ᄮ", null],
    ["SIOS-TIKEUT", "ㅼ", "ㅼ", "ᄯ", "ᇨ"],
    ["SIOS-PIEUP", "ㅽ", "ㅽ", "ᄲ", "ᇪ"],
    ["SIOS-CIEUC", "ㅾ", "ㅾ", "ᄶ", "ퟯ"],
    ["PANSIOS", "ㅿ", "ㅿ", "ᅀ", "ᇫ"],
    ["IEUNG-IEUNG", "ㆀ", "ㆀ", "ᅇ", null],
    ["YESIEUNG", "ㆁ", "ㆁ", "ᅌ", "ᇰ"],
    ["YESIEUNG-SIOS", "ㆂ", "ㆂ", null, "ᇱ"],
    ["YESIEUNG-PANSIOS", "ㆃ", "ㆃ", null, "ᇲ"],
    ["PHIEUPH-IEUNG", "ㆄ", "ㆄ", "ᅗ", "ᇴ"],
    ["HIEUH-HIEUH", "ㆅ", "ㆅ", "ᅘ", null],
    ["YEORINHIEUH", "ㆆ", "ㆆ", "ᅙ", "ᇹ"],
    ["NIEUN-KIYEOK", "ᄓ", null, "ᄓ", "ᇅ"],
    ["NIEUN-PIEUP", "ᄖ", null, "ᄖ", null],
    ["TIKEUT-KIYEOK", "ᄗ", null, "ᄗ", "ᇊ"],
    ["RIEUL-NIEUN", "ᄘ", null, "ᄘ", "ᇍ"],
    ["RIEUL-RIEUL", "ᄙ", null, "ᄙ", "ᇐ"],
    ["RIEUL-IEUNG", "ᄛ", null, "ᄛ", "ퟝ"],
    ["PIEUP-NIEUN", "ᄟ", null, "ᄟ", null],
    ["PIEUP-SIOS-PIEUP", "ᄤ", null, "ᄤ", null],
    ["PIEUP-SIOS-SIOS", "ᄥ", null, "ᄥ", null],
    ["PIEUP-SIOS-CIEUC", "ᄦ", null, "ᄦ", null],
    ["PIEUP-CHIEUCH", "ᄨ", null, "ᄨ", "ퟩ"],
    ["PIEUP-PHIEUPH", "ᄪ", null, "ᄪ", "ᇤ"],
    ["SIOS-RIEUL", "ᄰ", null, "ᄰ", "ᇩ"],
    ["SIOS-MIEUM", "ᄱ", null, "ᄱ", "ퟪ"],
    ["SIOS-PIEUP-KIYEOK", "ᄳ", null, "ᄳ", null],
    ["SIOS-SIOS-SIOS", "ᄴ", null, "ᄴ", null],
    ["SIOS-IEUNG", "ᄵ", null, "ᄵ", null],
    ["SIOS-CHIEUCH", "ᄷ", null, "ᄷ", "ퟰ"],
    ["SIOS-KHIEUKH", "ᄸ", null, "ᄸ", null],
    ["SIOS-THIEUTH", "ᄹ", null, "ᄹ", "ퟱ"],
    ["SIOS-PHIEUPH", "ᄺ", null, "ᄺ", null],
    ["SIOS-HIEUH", "ᄻ", null, "ᄻ", "ퟲ"],
    ["CHITUEUMSIOS", "ᄼ", null, "ᄼ", null],
    ["CHITUEUMSIOS-CHITUEUMSIOS", "ᄽ", null, "ᄽ", null],
    ["CEONGCHIEUMSIOS", "ᄾ", null, "ᄾ", null],
    ["CEONGCHIEUMSIOS-CEONGCHIEUMSIOS", "ᄿ", null, "ᄿ", null],
    ["IEUNG-KIYEOK", "ᅁ", null, "ᅁ", null],
    ["IEUNG-TIKEUT", "ᅂ", null, "ᅂ", null],
    ["IEUNG-MIEUM", "ᅃ", null, "ᅃ", null],
    ["IEUNG-PIEUP", "ᅄ", null, "ᅄ", null],
    ["IEUNG-SIOS", "ᅅ", null, "ᅅ", null],
    ["IEUNG-PANSIOS", "ᅆ", null, "ᅆ", null],
    ["IEUNG-CIEUC", "ᅈ", null, "ᅈ", null],
    ["IEUNG-CHIEUCH", "ᅉ", null, "ᅉ", null],
    ["IEUNG-THIEUTH", "ᅊ", null, "ᅊ", null],
    ["IEUNG-PHIEUPH", "ᅋ", null, "ᅋ", null],
    ["CIEUC-IEUNG", "ᅍ", null, "ᅍ", null],
    ["CHITUEUMCIEUC", "ᅎ", null, "ᅎ", null],
    ["CHITUEUMCIEUC-CHITUEUMCIEUC", "ᅏ", null, "ᅏ", null],
    ["CEONGCHIEUMCIEUC", "ᅐ", null, "ᅐ", null],
    ["CEONGCHIEUMSSANGCIEUC", "ᅑ", null, "ᅑ", null],
    ["CHIEUCH-KHIEUKH", "ᅒ", null, "ᅒ", null],
    ["CHIEUCH-HIEUH", "ᅓ", null, "ᅓ", null],
    ["CHITUEUMCHIEUCH", "ᅔ", null, "ᅔ", null],
    ["CEONGCHIEUMCHIEUCH", "ᅕ", null, "ᅕ", null],
    ["PHIEUPH-PIEUP", "ᅖ", null, "ᅖ", "ᇳ"],
    ["KIYEOK-TIKEUT", "ᅚ", null, "ᅚ", null],
    ["TIKEUT-RIEUL", "ᅞ", null, "ᅞ", "ᇋ"],
    ["FILLER", "ᅟ", null, "ᅟ", null],
    ["KIYEOK-RIEUL", "ᇃ", null, null, "ᇃ"],
    ["KIYEOK-SIOS-KIYEOK", "ᇄ", null, null, "ᇄ"],
    ["NIEUN-THIEUTH", "ᇉ", null, null, "ᇉ"],
    ["RIEUL-TIKEUT-HIEUH", "ᇏ", null, null, "ᇏ"],
    ["RIEUL-MIEUM-KIYEOK", "ᇑ", null, null, "ᇑ"],
    ["RIEUL-MIEUM-SIOS", "ᇒ", null, null, "ᇒ"],
    ["RIEUL-PIEUP-HIEUH", "ᇔ", null, null, "ᇔ"],
    ["RIEUL-PIEUP-IEUNG", "ꥫ", null, "ꥫ", "ᇕ"],
    ["RIEUL-SIOS-SIOS", "ᇖ", null, null, "ᇖ"],
    ["RIEUL-KHIEUKH", "ꥮ", null, "ꥮ", "ᇘ"],
    ["MIEUM-KIYEOK", "ꥯ", null, "ꥯ", "ᇚ"],
    ["MIEUM-RIEUL", "ᇛ", null, null, "ᇛ"],
    ["MIEUM-SIOS-SIOS", "ᇞ", null, null, "ᇞ"],
    ["MIEUM-CHIEUCH", "ᇠ", null, null, "ᇠ"],
    ["MIEUM-HIEUH", "ᇡ", null, null, "ᇡ"],
    ["PIEUP-RIEUL", "ᇣ", null, null, "ᇣ"],
    ["PIEUP-HIEUH", "ꥴ", null, "ꥴ", "ᇥ"],
    ["YESIEUNG-KIYEOK", "ᇬ", null, null, "ᇬ"],
    ["YESIEUNG-KIYEOK-KIYEOK", "ᇭ", null, null, "ᇭ"],
    ["YESIEUNG-YESIEUNG", "ᇮ", null, null, "ᇮ"],
    ["YESIEUNG-KHIEUKH", "ᇯ", null, null, "ᇯ"],
    ["HIEUH-NIEUN", "ᇵ", null, null, "ᇵ"],
    ["HIEUH-RIEUL", "ᇶ", null, null, "ᇶ"],
    ["HIEUH-MIEUM", "ᇷ", null, null, "ᇷ"],
    ["HIEUH-PIEUP", "ᇸ", null, null, "ᇸ"],
    ["KIYEOK-NIEUN", "ᇺ", null, null, "ᇺ"],
    ["KIYEOK-PIEUP", "ᇻ", null, null, "ᇻ"],
    ["KIYEOK-CHIEUCH", "ᇼ", null, null, "ᇼ"],
    ["KIYEOK-KHIEUKH", "ᇽ", null, null, "ᇽ"],
    ["KIYEOK-HIEUH", "ᇾ", null, null, "ᇾ"],
    ["TIKEUT-MIEUM", "ꥠ", null, "ꥠ", null],
    ["TIKEUT-PIEUP", "ꥡ", null, "ꥡ", "ퟏ"],
    ["TIKEUT-SIOS", "ꥢ", null, "ꥢ", "ퟐ"],
    ["TIKEUT-CIEUC", "ꥣ", null, "ꥣ", "ퟒ"],
    ["RIEUL-KIYEOK-KIYEOK", "ꥥ", null, "ꥥ", "ퟕ"],
    ["RIEUL-TIKEUT-TIKEUT", "ꥧ", null, "ꥧ", null],
    ["RIEUL-PIEUP-PIEUP", "ꥪ", null, "ꥪ", null],
    ["RIEUL-CIEUC", "ꥭ", null, "ꥭ", null],
    ["MIEUM-TIKEUT", "ꥰ", null, "ꥰ", null],
    ["PIEUP-SIOS-THIEUTH", "ꥲ", null, "ꥲ", null],
    ["PIEUP-KHIEUKH", "ꥳ", null, "ꥳ", null],
    ["SIOS-SIOS-PIEUP", "ꥵ", null, "ꥵ", null],
    ["IEUNG-RIEUL", "ꥶ", null, "ꥶ", null],
    ["IEUNG-HIEUH", "ꥷ", null, "ꥷ", null],
    ["CIEUC-CIEUC-HIEUH", "ꥸ", null, "ꥸ", null],
    ["THIEUTH-THIEUTH", "ꥹ", null, "ꥹ", null],
    ["PHIEUPH-HIEUH", "ꥺ", null, "ꥺ", null],
    ["HIEUH-SIOS", "ꥻ", null, "ꥻ", null],
    ["YEORINHIEUH-YEORINHIEUH", "ꥼ", null, "ꥼ", null],
    ["NIEUN-RIEUL", "ퟋ", null, null, "ퟋ"],
    ["NIEUN-CHIEUCH", "ퟌ", null, null, "ퟌ"],
    ["TIKEUT-TIKEUT-PIEUP", "ퟎ", null, null, "ퟎ"],
    ["TIKEUT-SIOS-KIYEOK", "ퟑ", null, null, "ퟑ"],
    ["TIKEUT-CHIEUCH", "ퟓ", null, null, "ퟓ"],
    ["TIKEUT-THIEUTH", "ퟔ", null, null, "ퟔ"],
    ["RIEUL-KIYEOK-HIEUH", "ퟖ", null, null, "ퟖ"],
    ["RIEUL-RIEUL-KHIEUKH", "ퟗ", null, null, "ퟗ"],
    ["RIEUL-MIEUM-HIEUH", "ퟘ", null, null, "ퟘ"],
    ["RIEUL-PIEUP-TIKEUT", "ퟙ", null, null, "ퟙ"],
    ["RIEUL-PIEUP-PHIEUPH", "ퟚ", null, null, "ퟚ"],
    ["RIEUL-YESIEUNG", "ퟛ", null, null, "ퟛ"],
    ["RIEUL-YEORINHIEUH-HIEUH", "ퟜ", null, null, "ퟜ"],
    ["MIEUM-NIEUN", "ퟞ", null, null, "ퟞ"],
    ["MIEUM-NIEUN-NIEUN", "ퟟ", null, null, "ퟟ"],
    ["MIEUM-MIEUM", "ퟠ", null, null, "ퟠ"],
    ["MIEUM-PIEUP-SIOS", "ퟡ", null, null, "ퟡ"],
    ["MIEUM-CIEUC", "ퟢ", null, null, "ퟢ"],
    ["PIEUP-RIEUL-PHIEUPH", "ퟤ", null, null, "ퟤ"],
    ["PIEUP-MIEUM", "ퟥ", null, null, "ퟥ"],
    ["SIOS-PIEUP-IEUNG", "ퟫ", null, null, "ퟫ"],
    ["SIOS-SIOS-KIYEOK", "ퟬ", null, null, "ퟬ"],
    ["SIOS-SIOS-TIKEUT", "ퟭ", null, null, "ퟭ"],
    ["SIOS-PANSIOS", "ퟮ", null, null, "ퟮ"],
    ["PANSIOS-PIEUP", "ퟳ", null, null, "ퟳ"],
    ["PANSIOS-PIEUP-IEUNG", "ퟴ", null, null, "ퟴ"],
    ["YESIEUNG-MIEUM", "ퟵ", null, null, "ퟵ"],
    ["YESIEUNG-HIEUH", "ퟶ", null, null, "ퟶ"],
    ["CIEUC-PIEUP", "ퟷ", null, null, "ퟷ"],
    ["CIEUC-PIEUP-PIEUP", "ퟸ", null, null, "ퟸ"],
    ["PHIEUPH-SIOS", "ퟺ", null, null, "ퟺ"],
    ["PHIEUPH-THIEUTH", "ퟻ", null, null, "ퟻ"],
  ];
  const VOWEL_DATA: vowelDatum[] = [
    ["A", "ㅏ", "ㅏ", "ᅡ", "right"],
    ["AE", "ㅐ", "ㅐ", "ᅢ", "right"],
    ["YA", "ㅑ", "ㅑ", "ᅣ", "right"],
    ["YAE", "ㅒ", "ㅒ", "ᅤ", "right"],
    ["EO", "ㅓ", "ㅓ", "ᅥ", "right"],
    ["E", "ㅔ", "ㅔ", "ᅦ", "right"],
    ["YEO", "ㅕ", "ㅕ", "ᅧ", "right"],
    ["YE", "ㅖ", "ㅖ", "ᅨ", "right"],
    ["O", "ㅗ", "ㅗ", "ᅩ", "under"],
    ["O-A", "ㅘ", "ㅘ", "ᅪ", "mixed"],
    ["O-AE", "ㅙ", "ㅙ", "ᅫ", "mixed"],
    ["O-I", "ㅚ", "ㅚ", "ᅬ", "mixed"],
    ["YO", "ㅛ", "ㅛ", "ᅭ", "under"],
    ["U", "ㅜ", "ㅜ", "ᅮ", "under"],
    ["U-EO", "ㅝ", "ㅝ", "ᅯ", "mixed"],
    ["U-E", "ㅞ", "ㅞ", "ᅰ", "mixed"],
    ["U-I", "ㅟ", "ㅟ", "ᅱ", "mixed"],
    ["YU", "ㅠ", "ㅠ", "ᅲ", "under"],
    ["EU", "ㅡ", "ㅡ", "ᅳ", "under"],
    ["EU-I", "ㅢ", "ㅢ", "ᅴ", "mixed"],
    ["I", "ㅣ", "ㅣ", "ᅵ", "right"],
    ["YO-YA", "ㆇ", "ㆇ", "ᆄ", "mixed"],
    ["YO-YAE", "ㆈ", "ㆈ", "ᆅ", "mixed"],
    ["YO-I", "ㆉ", "ㆉ", "ᆈ", "mixed"],
    ["YU-YEO", "ㆊ", "ㆊ", "ᆑ", "mixed"],
    ["YU-YE", "ㆋ", "ㆋ", "ᆒ", "mixed"],
    ["YU-I", "ㆌ", "ㆌ", "ᆔ", "mixed"],
    ["ARAEA", "ㆍ", "ㆍ", "ᆞ", "under"],
    ["ARAEA-I", "ㆎ", "ㆎ", "ᆡ", "mixed"],
    ["A-O", "ᅶ", null, "ᅶ", "mixed"],
    ["A-U", "ᅷ", null, "ᅷ", "mixed"],
    ["YA-O", "ᅸ", null, "ᅸ", "mixed"],
    ["YA-YO", "ᅹ", null, "ᅹ", "mixed"],
    ["EO-O", "ᅺ", null, "ᅺ", "mixed"],
    ["EO-U", "ᅻ", null, "ᅻ", "mixed"],
    ["EO-EU", "ᅼ", null, "ᅼ", "mixed"],
    ["YEO-O", "ᅽ", null, "ᅽ", "mixed"],
    ["YEO-U", "ᅾ", null, "ᅾ", "mixed"],
    ["O-EO", "ᅿ", null, "ᅿ", "mixed"],
    ["O-E", "ᆀ", null, "ᆀ", "mixed"],
    ["O-YE", "ᆁ", null, "ᆁ", "mixed"],
    ["O-O", "ᆂ", null, "ᆂ", "under"],
    ["O-U", "ᆃ", null, "ᆃ", "under"],
    ["YO-YEO", "ᆆ", null, "ᆆ", "mixed"],
    ["YO-O", "ᆇ", null, "ᆇ", "under"],
    ["U-A", "ᆉ", null, "ᆉ", "mixed"],
    ["U-AE", "ᆊ", null, "ᆊ", "mixed"],
    ["U-EO-EU", "ᆋ", null, "ᆋ", "mixed"],
    ["U-YE", "ᆌ", null, "ᆌ", "mixed"],
    ["U-U", "ᆍ", null, "ᆍ", "under"],
    ["YU-A", "ᆎ", null, "ᆎ", "mixed"],
    ["YU-EO", "ᆏ", null, "ᆏ", "mixed"],
    ["YU-E", "ᆐ", null, "ᆐ", "mixed"],
    ["YU-U", "ᆓ", null, "ᆓ", "mixed"],
    ["EU-U", "ᆕ", null, "ᆕ", "under"],
    ["EU-EU", "ᆖ", null, "ᆖ", "under"],
    ["EU-I-U", "ᆗ", null, "ᆗ", "mixed"],
    ["I-A", "ᆘ", null, "ᆘ", "right"],
    ["I-YA", "ᆙ", null, "ᆙ", "right"],
    ["I-O", "ᆚ", null, "ᆚ", "mixed"],
    ["I-U", "ᆛ", null, "ᆛ", "mixed"],
    ["I-EU", "ᆜ", null, "ᆜ", "mixed"],
    ["I-ARAEA", "ᆝ", null, "ᆝ", "right"],
    ["ARAEA-EO", "ᆟ", null, "ᆟ", "mixed"],
    ["ARAEA-U", "ᆠ", null, "ᆠ", "under"],
    ["ARAEA-ARAEA", "ᆢ", null, "ᆢ", "under"],
    ["A-EU", "ᆣ", null, "ᆣ", "mixed"],
    ["YA-U", "ᆤ", null, "ᆤ", "mixed"],
    ["YEO-YA", "ᆥ", null, "ᆥ", "right"],
    ["O-YA", "ᆦ", null, "ᆦ", "mixed"],
    ["O-YAE", "ᆧ", null, "ᆧ", "mixed"],
    ["O-YEO", "ힰ", null, "ힰ", "mixed"],
    ["O-O-I", "ힱ", null, "ힱ", "under"],
    ["YO-A", "ힲ", null, "ힲ", "mixed"],
    ["YO-AE", "ힳ", null, "ힳ", "mixed"],
    ["YO-EO", "ힴ", null, "ힴ", "mixed"],
    ["U-YEO", "ힵ", null, "ힵ", "mixed"],
    ["U-I-I", "ힶ", null, "ힶ", "mixed"],
    ["YU-AE", "ힷ", null, "ힷ", "mixed"],
    ["YU-O", "ힸ", null, "ힸ", "under"],
    ["EU-A", "ힹ", null, "ힹ", "mixed"],
    ["EU-EO", "ힺ", null, "ힺ", "mixed"],
    ["EU-E", "ힻ", null, "ힻ", "mixed"],
    ["EU-O", "ힼ", null, "ힼ", "under"],
    ["I-YA-O", "ힽ", null, "ힽ", "mixed"],
    ["I-YAE", "ힾ", null, "ힾ", "right"],
    ["I-YEO", "ힿ", null, "ힿ", "right"],
    ["I-YE", "ퟀ", null, "ퟀ", "right"],
    ["I-O-I", "ퟁ", null, "ퟁ", "mixed"],
    ["I-YO", "ퟂ", null, "ퟂ", "mixed"],
    ["I-YU", "ퟃ", null, "ퟃ", "mixed"],
    ["I-I", "ퟄ", null, "ퟄ", "right"],
    ["ARAEA-A", "ퟅ", null, "ퟅ", "mixed"],
    ["ARAEA-E", "ퟆ", null, "ퟆ", "mixed"],
  ];
  const consInfo = new Map<string, ConsonantInfo>();
  const consMap = new Map<string, ConsonantInfo>();
  for (const datum of CONS_DATA) {
    const [name, canon, compat, leading, trailing] = datum;
    const info: ConsonantInfo = {
      type: "consonant",
      unicode_name: name,
      canonical: canon,
      compat,
      leading,
      trailing,
    };
    consInfo.set(name, info);
    for (const item of datum) {
      if (item !== null) {
        consMap.set(item, info);
      }
    }
  }
  const vowelInfo = new Map<string, VowelInfo>();
  const vowelMap = new Map<string, VowelInfo>();
  for (const datum of VOWEL_DATA) {
    const [name, canon, compat, vowel, position] = datum;
    const parts = name.split("-");
    const info: VowelInfo = {
      type: "vowel",
      unicode_name: name,
      canonical: canon,
      compat,
      vowel,
      position,
      pokingDown: parts.some((part) => ["U", "YU"].includes(part)),
      pokingRight: parts.some((part) => ["A", "YA"].includes(part)),
      doubleVertical: parts.some((part) =>
        ["E", "AE", "YE", "YAE"].includes(part),
      ),
    };
    vowelInfo.set(name, info);
    for (const item of datum) {
      if (item !== null) {
        vowelMap.set(item, info);
      }
    }
  }
  return {
    consonantInfo: consInfo,
    vowelInfo: vowelInfo,
    consonantMap: consMap,
    vowelMap: vowelMap,
  };
}

export const HANGUL_DATA = getHangulData();

export function getLeading(jamoName: string): string | null {
  return HANGUL_DATA.consonantMap.get(jamoName)?.leading ?? null;
}
export function getVowel(jamoName: string): string | null {
  return HANGUL_DATA.vowelMap.get(jamoName)?.vowel ?? null;
}
export function getTrailing(jamoName: string): string | null {
  if (jamoName === "") {
    return "";
  }
  return HANGUL_DATA.consonantMap.get(jamoName)?.trailing ?? null;
}
export function getName(jamo: string): string | null {
  if (jamo === "") {
    return "";
  }
  return (
    HANGUL_DATA.consonantMap.get(jamo)?.unicode_name ??
    HANGUL_DATA.vowelMap.get(jamo)?.unicode_name ??
    null
  );
}

export function composeHangul(
  leading: string,
  vowel: string,
  trailing: string | null = null,
  precompose: boolean = true,
): string {
  const realLeading = getLeading(leading);
  const realVowel = getVowel(vowel);
  const realTrailing = trailing ? getTrailing(trailing) : "";
  if (realLeading === null || realVowel === null || realTrailing === null) {
    throw new Error("Invalid composition.");
  }
  let result = `${realLeading}${realVowel}${realTrailing}`;
  if (precompose) {
    // TODO: convert to PUA
    result = result.normalize("NFC");
  }
  return result;
}
