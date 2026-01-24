import { uniToPua } from "@/app/hangul/puaUniConv";
import { PUA_CONV_TAB } from "@/app/hangul/puaUniTable";
import { ConsonantInfo, VowelInfo } from "@/app/utils/types";

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
    ["KIYEOK-NIEUN", "ᇺ", null, null, "ᇺ"],
    ["KIYEOK-TIKEUT", "ᅚ", null, "ᅚ", null],
    ["KIYEOK-RIEUL", "ᇃ", null, null, "ᇃ"],
    ["KIYEOK-PIEUP", "ᇻ", null, null, "ᇻ"],
    ["KIYEOK-SIOS-KIYEOK", "ᇄ", null, null, "ᇄ"],
    ["KIYEOK-CHIEUCH", "ᇼ", null, null, "ᇼ"],
    ["KIYEOK-KHIEUKH", "ᇽ", null, null, "ᇽ"],
    ["KIYEOK-HIEUH", "ᇾ", null, null, "ᇾ"],
    ["NIEUN-KIYEOK", "ᄓ", null, "ᄓ", "ᇅ"],
    ["NIEUN-NIEUN", "ㅥ", "ㅥ", "ᄔ", null],
    ["NIEUN-TIKEUT", "ㅦ", "ㅦ", "ᄕ", "ᇆ"],
    ["NIEUN-RIEUL", "ퟋ", null, null, "ퟋ"],
    ["NIEUN-PIEUP", "ᄖ", null, "ᄖ", null],
    ["NIEUN-SIOS", "ㅧ", "ㅧ", "ᅛ", "ᇇ"],
    ["NIEUN-PANSIOS", "ㅨ", "ㅨ", null, "ᇈ"],
    ["NIEUN-CHIEUCH", "ퟌ", null, null, "ퟌ"],
    ["NIEUN-THIEUTH", "ᇉ", null, null, "ᇉ"],
    ["TIKEUT-KIYEOK", "ᄗ", null, "ᄗ", "ᇊ"],
    ["TIKEUT-TIKEUT-PIEUP", "ퟎ", null, null, "ퟎ"],
    ["TIKEUT-RIEUL", "ᅞ", null, "ᅞ", "ᇋ"],
    ["TIKEUT-MIEUM", "ꥠ", null, "ꥠ", null],
    ["TIKEUT-PIEUP", "ꥡ", null, "ꥡ", "ퟏ"],
    ["TIKEUT-SIOS", "ꥢ", null, "ꥢ", "ퟐ"],
    ["TIKEUT-SIOS-KIYEOK", "ퟑ", null, null, "ퟑ"],
    ["TIKEUT-CIEUC", "ꥣ", null, "ꥣ", "ퟒ"],
    ["TIKEUT-CHIEUCH", "ퟓ", null, null, "ퟓ"],
    ["TIKEUT-THIEUTH", "ퟔ", null, null, "ퟔ"],
    ["RIEUL-KIYEOK-KIYEOK", "ꥥ", null, "ꥥ", "ퟕ"],
    ["RIEUL-KIYEOK-SIOS", "ㅩ", "ㅩ", null, "ᇌ"],
    ["RIEUL-KIYEOK-HIEUH", "ퟖ", null, null, "ퟖ"],
    ["RIEUL-NIEUN", "ᄘ", null, "ᄘ", "ᇍ"],
    ["RIEUL-TIKEUT", "ㅪ", "ㅪ", "ꥦ", "ᇎ"],
    ["RIEUL-TIKEUT-TIKEUT", "ꥧ", null, "ꥧ", null],
    ["RIEUL-TIKEUT-HIEUH", "ᇏ", null, null, "ᇏ"],
    ["RIEUL-RIEUL", "ᄙ", null, "ᄙ", "ᇐ"],
    ["RIEUL-RIEUL-KHIEUKH", "ퟗ", null, null, "ퟗ"],
    ["RIEUL-MIEUM-KIYEOK", "ᇑ", null, null, "ᇑ"],
    ["RIEUL-MIEUM-SIOS", "ᇒ", null, null, "ᇒ"],
    ["RIEUL-MIEUM-HIEUH", "ퟘ", null, null, "ퟘ"],
    ["RIEUL-PIEUP-TIKEUT", "ퟙ", null, null, "ퟙ"],
    ["RIEUL-PIEUP-PIEUP", "ꥪ", null, "ꥪ", null],
    ["RIEUL-PIEUP-SIOS", "ㅫ", "ㅫ", null, "ᇓ"],
    ["RIEUL-PIEUP-IEUNG", "ꥫ", null, "ꥫ", "ᇕ"],
    ["RIEUL-PIEUP-PHIEUPH", "ퟚ", null, null, "ퟚ"],
    ["RIEUL-PIEUP-HIEUH", "ᇔ", null, null, "ᇔ"],
    ["RIEUL-SIOS-SIOS", "ᇖ", null, null, "ᇖ"],
    ["RIEUL-PANSIOS", "ㅬ", "ㅬ", null, "ᇗ"],
    ["RIEUL-IEUNG", "ᄛ", null, "ᄛ", "ퟝ"],
    ["RIEUL-YESIEUNG", "ퟛ", null, null, "ퟛ"],
    ["RIEUL-CIEUC", "ꥭ", null, "ꥭ", null],
    ["RIEUL-KHIEUKH", "ꥮ", null, "ꥮ", "ᇘ"],
    ["RIEUL-YEORINHIEUH", "ㅭ", "ㅭ", null, "ᇙ"],
    ["RIEUL-YEORINHIEUH-HIEUH", "ퟜ", null, null, "ퟜ"],
    ["MIEUM-KIYEOK", "ꥯ", null, "ꥯ", "ᇚ"],
    ["MIEUM-NIEUN", "ퟞ", null, null, "ퟞ"],
    ["MIEUM-NIEUN-NIEUN", "ퟟ", null, null, "ퟟ"],
    ["MIEUM-TIKEUT", "ꥰ", null, "ꥰ", null],
    ["MIEUM-RIEUL", "ᇛ", null, null, "ᇛ"],
    ["MIEUM-MIEUM", "ퟠ", null, null, "ퟠ"],
    ["MIEUM-PIEUP", "ㅮ", "ㅮ", "ᄜ", "ᇜ"],
    ["MIEUM-PIEUP-SIOS", "ퟡ", null, null, "ퟡ"],
    ["MIEUM-SIOS", "ㅯ", "ㅯ", "ꥱ", "ᇝ"],
    ["MIEUM-SIOS-SIOS", "ᇞ", null, null, "ᇞ"],
    ["MIEUM-PANSIOS", "ㅰ", "ㅰ", null, "ᇟ"],
    ["MIEUM-IEUNG", "ㅱ", "ㅱ", "ᄝ", "ᇢ"],
    ["MIEUM-CIEUC", "ퟢ", null, null, "ퟢ"],
    ["MIEUM-CHIEUCH", "ᇠ", null, null, "ᇠ"],
    ["MIEUM-HIEUH", "ᇡ", null, null, "ᇡ"],
    ["PIEUP-KIYEOK", "ㅲ", "ㅲ", "ᄞ", null],
    ["PIEUP-NIEUN", "ᄟ", null, "ᄟ", null],
    ["PIEUP-TIKEUT", "ㅳ", "ㅳ", "ᄠ", "ퟣ"],
    ["PIEUP-RIEUL", "ᇣ", null, null, "ᇣ"],
    ["PIEUP-RIEUL-PHIEUPH", "ퟤ", null, null, "ퟤ"],
    ["PIEUP-MIEUM", "ퟥ", null, null, "ퟥ"],
    ["PIEUP-PIEUP-IEUNG", "ㅹ", "ㅹ", "ᄬ", null],
    ["PIEUP-SIOS-KIYEOK", "ㅴ", "ㅴ", "ᄢ", null],
    ["PIEUP-SIOS-TIKEUT", "ㅵ", "ㅵ", "ᄣ", "ퟧ"],
    ["PIEUP-SIOS-PIEUP", "ᄤ", null, "ᄤ", null],
    ["PIEUP-SIOS-SIOS", "ᄥ", null, "ᄥ", null],
    ["PIEUP-SIOS-CIEUC", "ᄦ", null, "ᄦ", null],
    ["PIEUP-SIOS-THIEUTH", "ꥲ", null, "ꥲ", null],
    ["PIEUP-IEUNG", "ㅸ", "ㅸ", "ᄫ", "ᇦ"],
    ["PIEUP-CIEUC", "ㅶ", "ㅶ", "ᄧ", "ퟨ"],
    ["PIEUP-CHIEUCH", "ᄨ", null, "ᄨ", "ퟩ"],
    ["PIEUP-KHIEUKH", "ꥳ", null, "ꥳ", null],
    ["PIEUP-THIEUTH", "ㅷ", "ㅷ", "ᄩ", null],
    ["PIEUP-PHIEUPH", "ᄪ", null, "ᄪ", "ᇤ"],
    ["PIEUP-HIEUH", "ꥴ", null, "ꥴ", "ᇥ"],
    ["SIOS-KIYEOK", "ㅺ", "ㅺ", "ᄭ", "ᇧ"],
    ["SIOS-NIEUN", "ㅻ", "ㅻ", "ᄮ", null],
    ["SIOS-TIKEUT", "ㅼ", "ㅼ", "ᄯ", "ᇨ"],
    ["SIOS-RIEUL", "ᄰ", null, "ᄰ", "ᇩ"],
    ["SIOS-MIEUM", "ᄱ", null, "ᄱ", "ퟪ"],
    ["SIOS-PIEUP", "ㅽ", "ㅽ", "ᄲ", "ᇪ"],
    ["SIOS-PIEUP-KIYEOK", "ᄳ", null, "ᄳ", null],
    ["SIOS-PIEUP-IEUNG", "ퟫ", null, null, "ퟫ"],
    ["SIOS-SIOS-KIYEOK", "ퟬ", null, null, "ퟬ"],
    ["SIOS-SIOS-TIKEUT", "ퟭ", null, null, "ퟭ"],
    ["SIOS-SIOS-PIEUP", "ꥵ", null, "ꥵ", null],
    ["SIOS-SIOS-SIOS", "ᄴ", null, "ᄴ", null],
    ["SIOS-PANSIOS", "ퟮ", null, null, "ퟮ"],
    ["SIOS-IEUNG", "ᄵ", null, "ᄵ", null],
    ["SIOS-CIEUC", "ㅾ", "ㅾ", "ᄶ", "ퟯ"],
    ["SIOS-CHIEUCH", "ᄷ", null, "ᄷ", "ퟰ"],
    ["SIOS-KHIEUKH", "ᄸ", null, "ᄸ", null],
    ["SIOS-THIEUTH", "ᄹ", null, "ᄹ", "ퟱ"],
    ["SIOS-PHIEUPH", "ᄺ", null, "ᄺ", null],
    ["SIOS-HIEUH", "ᄻ", null, "ᄻ", "ퟲ"],
    ["CHITUEUMSIOS", "ᄼ", null, "ᄼ", null],
    ["CHITUEUMSIOS-CHITUEUMSIOS", "ᄽ", null, "ᄽ", null],
    ["CEONGCHIEUMSIOS", "ᄾ", null, "ᄾ", null],
    ["CEONGCHIEUMSIOS-CEONGCHIEUMSIOS", "ᄿ", null, "ᄿ", null],
    ["PANSIOS", "ㅿ", "ㅿ", "ᅀ", "ᇫ"],
    ["PANSIOS-PIEUP", "ퟳ", null, null, "ퟳ"],
    ["PANSIOS-PIEUP-IEUNG", "ퟴ", null, null, "ퟴ"],
    ["IEUNG-KIYEOK", "ᅁ", null, "ᅁ", null],
    ["IEUNG-TIKEUT", "ᅂ", null, "ᅂ", null],
    ["IEUNG-RIEUL", "ꥶ", null, "ꥶ", null],
    ["IEUNG-MIEUM", "ᅃ", null, "ᅃ", null],
    ["IEUNG-PIEUP", "ᅄ", null, "ᅄ", null],
    ["IEUNG-SIOS", "ᅅ", null, "ᅅ", null],
    ["IEUNG-PANSIOS", "ᅆ", null, "ᅆ", null],
    ["IEUNG-IEUNG", "ㆀ", "ㆀ", "ᅇ", null],
    ["IEUNG-CIEUC", "ᅈ", null, "ᅈ", null],
    ["IEUNG-CHIEUCH", "ᅉ", null, "ᅉ", null],
    ["IEUNG-THIEUTH", "ᅊ", null, "ᅊ", null],
    ["IEUNG-PHIEUPH", "ᅋ", null, "ᅋ", null],
    ["IEUNG-HIEUH", "ꥷ", null, "ꥷ", null],
    ["YESIEUNG", "ㆁ", "ㆁ", "ᅌ", "ᇰ"],
    ["YESIEUNG-KIYEOK", "ᇬ", null, null, "ᇬ"],
    ["YESIEUNG-KIYEOK-KIYEOK", "ᇭ", null, null, "ᇭ"],
    ["YESIEUNG-MIEUM", "ퟵ", null, null, "ퟵ"],
    ["YESIEUNG-SIOS", "ㆂ", "ㆂ", null, "ᇱ"],
    ["YESIEUNG-PANSIOS", "ㆃ", "ㆃ", null, "ᇲ"],
    ["YESIEUNG-YESIEUNG", "ᇮ", null, null, "ᇮ"],
    ["YESIEUNG-KHIEUKH", "ᇯ", null, null, "ᇯ"],
    ["YESIEUNG-HIEUH", "ퟶ", null, null, "ퟶ"],
    ["CIEUC-PIEUP", "ퟷ", null, null, "ퟷ"],
    ["CIEUC-PIEUP-PIEUP", "ퟸ", null, null, "ퟸ"],
    ["CIEUC-IEUNG", "ᅍ", null, "ᅍ", null],
    ["CIEUC-CIEUC-HIEUH", "ꥸ", null, "ꥸ", null],
    ["CHITUEUMCIEUC", "ᅎ", null, "ᅎ", null],
    ["CHITUEUMCIEUC-CHITUEUMCIEUC", "ᅏ", null, "ᅏ", null],
    ["CEONGCHIEUMCIEUC", "ᅐ", null, "ᅐ", null],
    ["CEONGCHIEUMCIEUC-CEONGCHIEUMCIEUC", "ᅑ", null, "ᅑ", null],
    ["CHIEUCH-KHIEUKH", "ᅒ", null, "ᅒ", null],
    ["CHIEUCH-HIEUH", "ᅓ", null, "ᅓ", null],
    ["CHITUEUMCHIEUCH", "ᅔ", null, "ᅔ", null],
    ["CEONGCHIEUMCHIEUCH", "ᅕ", null, "ᅕ", null],
    ["THIEUTH-THIEUTH", "ꥹ", null, "ꥹ", null],
    ["PHIEUPH-PIEUP", "ᅖ", null, "ᅖ", "ᇳ"],
    ["PHIEUPH-SIOS", "ퟺ", null, null, "ퟺ"],
    ["PHIEUPH-IEUNG", "ㆄ", "ㆄ", "ᅗ", "ᇴ"],
    ["PHIEUPH-THIEUTH", "ퟻ", null, null, "ퟻ"],
    ["PHIEUPH-HIEUH", "ꥺ", null, "ꥺ", null],
    ["HIEUH-NIEUN", "ᇵ", null, null, "ᇵ"],
    ["HIEUH-RIEUL", "ᇶ", null, null, "ᇶ"],
    ["HIEUH-MIEUM", "ᇷ", null, null, "ᇷ"],
    ["HIEUH-PIEUP", "ᇸ", null, null, "ᇸ"],
    ["HIEUH-SIOS", "ꥻ", null, "ꥻ", null],
    ["HIEUH-HIEUH", "ㆅ", "ㆅ", "ᅘ", null],
    ["YEORINHIEUH", "ㆆ", "ㆆ", "ᅙ", "ᇹ"],
    ["YEORINHIEUH-YEORINHIEUH", "ꥼ", null, "ꥼ", null],
    ["FILLER", "ᅟ", null, "ᅟ", null],
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
    ["A-O", "ᅶ", null, "ᅶ", "mixed"],
    ["A-U", "ᅷ", null, "ᅷ", "mixed"],
    ["A-EU", "ᆣ", null, "ᆣ", "mixed"],
    ["YA-O", "ᅸ", null, "ᅸ", "mixed"],
    ["YA-YO", "ᅹ", null, "ᅹ", "mixed"],
    ["YA-U", "ᆤ", null, "ᆤ", "mixed"],
    ["EO-O", "ᅺ", null, "ᅺ", "mixed"],
    ["EO-U", "ᅻ", null, "ᅻ", "mixed"],
    ["EO-EU", "ᅼ", null, "ᅼ", "mixed"],
    ["YEO-YA", "ᆥ", null, "ᆥ", "right"],
    ["YEO-O", "ᅽ", null, "ᅽ", "mixed"],
    ["YEO-U", "ᅾ", null, "ᅾ", "mixed"],
    ["O-YA", "ᆦ", null, "ᆦ", "mixed"],
    ["O-YAE", "ᆧ", null, "ᆧ", "mixed"],
    ["O-EO", "ᅿ", null, "ᅿ", "mixed"],
    ["O-E", "ᆀ", null, "ᆀ", "mixed"],
    ["O-YEO", "ힰ", null, "ힰ", "mixed"],
    ["O-YE", "ᆁ", null, "ᆁ", "mixed"],
    ["O-O", "ᆂ", null, "ᆂ", "under"],
    ["O-O-I", "ힱ", null, "ힱ", "under"],
    ["O-U", "ᆃ", null, "ᆃ", "under"],
    ["YO-A", "ힲ", null, "ힲ", "mixed"],
    ["YO-AE", "ힳ", null, "ힳ", "mixed"],
    ["YO-YA", "ㆇ", "ㆇ", "ᆄ", "mixed"],
    ["YO-YAE", "ㆈ", "ㆈ", "ᆅ", "mixed"],
    ["YO-EO", "ힴ", null, "ힴ", "mixed"],
    ["YO-YEO", "ᆆ", null, "ᆆ", "mixed"],
    ["YO-O", "ᆇ", null, "ᆇ", "under"],
    ["YO-I", "ㆉ", "ㆉ", "ᆈ", "mixed"],
    ["U-A", "ᆉ", null, "ᆉ", "mixed"],
    ["U-AE", "ᆊ", null, "ᆊ", "mixed"],
    ["U-EO-EU", "ᆋ", null, "ᆋ", "mixed"],
    ["U-YEO", "ힵ", null, "ힵ", "mixed"],
    ["U-YE", "ᆌ", null, "ᆌ", "mixed"],
    ["U-U", "ᆍ", null, "ᆍ", "under"],
    ["U-I-I", "ힶ", null, "ힶ", "mixed"],
    ["YU-A", "ᆎ", null, "ᆎ", "mixed"],
    ["YU-AE", "ힷ", null, "ힷ", "mixed"],
    ["YU-EO", "ᆏ", null, "ᆏ", "mixed"],
    ["YU-E", "ᆐ", null, "ᆐ", "mixed"],
    ["YU-YEO", "ㆊ", "ㆊ", "ᆑ", "mixed"],
    ["YU-YE", "ㆋ", "ㆋ", "ᆒ", "mixed"],
    ["YU-O", "ힸ", null, "ힸ", "under"],
    ["YU-U", "ᆓ", null, "ᆓ", "under"],
    ["YU-I", "ㆌ", "ㆌ", "ᆔ", "mixed"],
    ["EU-A", "ힹ", null, "ힹ", "mixed"],
    ["EU-EO", "ힺ", null, "ힺ", "mixed"],
    ["EU-E", "ힻ", null, "ힻ", "mixed"],
    ["EU-O", "ힼ", null, "ힼ", "under"],
    ["EU-U", "ᆕ", null, "ᆕ", "under"],
    ["EU-EU", "ᆖ", null, "ᆖ", "under"],
    ["EU-I-U", "ᆗ", null, "ᆗ", "mixed"],
    ["I-A", "ᆘ", null, "ᆘ", "right"],
    ["I-YA", "ᆙ", null, "ᆙ", "right"],
    ["I-YA-O", "ힽ", null, "ힽ", "mixed"],
    ["I-YAE", "ힾ", null, "ힾ", "right"],
    ["I-YEO", "ힿ", null, "ힿ", "right"],
    ["I-YE", "ퟀ", null, "ퟀ", "right"],
    ["I-O", "ᆚ", null, "ᆚ", "mixed"],
    ["I-O-I", "ퟁ", null, "ퟁ", "mixed"],
    ["I-YO", "ퟂ", null, "ퟂ", "mixed"],
    ["I-U", "ᆛ", null, "ᆛ", "mixed"],
    ["I-YU", "ퟃ", null, "ퟃ", "mixed"],
    ["I-EU", "ᆜ", null, "ᆜ", "mixed"],
    ["I-I", "ퟄ", null, "ퟄ", "right"],
    ["I-ARAEA", "ᆝ", null, "ᆝ", "right"],
    ["ARAEA", "ㆍ", "ㆍ", "ᆞ", "under"],
    ["ARAEA-A", "ퟅ", null, "ퟅ", "mixed"],
    ["ARAEA-EO", "ᆟ", null, "ᆟ", "mixed"],
    ["ARAEA-E", "ퟆ", null, "ퟆ", "mixed"],
    ["ARAEA-U", "ᆠ", null, "ᆠ", "under"],
    ["ARAEA-I", "ㆎ", "ㆎ", "ᆡ", "mixed"],
    ["ARAEA-ARAEA", "ᆢ", null, "ᆢ", "under"],
  ];
  const consInfo = new Map<string, ConsonantInfo>();
  const consMap = new Map<string, ConsonantInfo>();
  for (const datum of CONS_DATA) {
    const [name, canon, compat, leading, trailing] = datum;
    const info: ConsonantInfo = {
      type: "consonant",
      name: name,
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
      name: name,
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

export function getJamoInfo(
  jamo: string,
): ConsonantInfo | VowelInfo | undefined {
  return HANGUL_DATA.consonantMap.get(jamo) ?? HANGUL_DATA.vowelMap.get(jamo);
}
export function getLeading(jamo: string): string | null {
  return HANGUL_DATA.consonantMap.get(jamo)?.leading ?? null;
}
export function getVowel(jamo: string): string | null {
  return HANGUL_DATA.vowelMap.get(jamo)?.vowel ?? null;
}
export function getTrailing(jamo: string): string | null {
  if (jamo === "") {
    return "";
  }
  return HANGUL_DATA.consonantMap.get(jamo)?.trailing ?? null;
}
export function getName(jamo: string): string | null {
  if (jamo === "") {
    return "";
  }
  return getJamoInfo(jamo)?.name ?? null;
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
    throw new Error(
      `Invalid composition: (${leading}, ${vowel}, ${trailing}) ` +
        `=> (${realLeading}, ${realVowel}, ${realTrailing})`,
    );
  }
  let result = `${realLeading}${realVowel}${realTrailing}`;
  if (precompose) {
    result = uniToPua(result);
  }
  return result;
}

export function unicodeNameToHangul(unicodeName: string): string {
  const nameMap = new Map<string, string>([
    ["KIYEOK", "기역"],
    ["NIEUN", "니은"],
    ["TIKEUT", "디귿"],
    ["RIEUL", "리을"],
    ["MIEUM", "미음"],
    ["PIEUP", "비읍"],
    ["SIOS", "시옷"],
    ["CHITUEUMSIOS", "치두음시옷"],
    ["CEONGCHIEUMSIOS", "정치음시옷"],
    ["PANSIOS", "반시옷"],
    ["IEUNG", "이응"],
    ["YESIEUNG", "옛이응"],
    ["CIEUC", "지읒"],
    ["CHITUEUMCIEUC", "치두음지읒"],
    ["CEONGCHIEUMCIEUC", "정치음지읒"],
    ["CHIEUCH", "치읒"],
    ["CHITUEUMCHIEUCH", "치두음치읒"],
    ["CEONGCHIEUMCHIEUCH", "정치음치읒"],
    ["KHIEUKH", "키읔"],
    ["THIEUTH", "티읕"],
    ["PHIEUPH", "피읖"],
    ["HIEUH", "히읗"],
    ["YEORINHIEUH", "여린히읗"],
    ["A", "아"],
    ["AE", "애"],
    ["YA", "야"],
    ["YAE", "얘"],
    ["EO", "어"],
    ["E", "에"],
    ["YEO", "여"],
    ["YE", "예"],
    ["O", "오"],
    ["YO", "요"],
    ["U", "우"],
    ["YU", "유"],
    ["EU", "으"],
    ["I", "이"],
    ["ARAEA", "아래아"],
    ["FILLER", "채움"],
  ]);

  return unicodeName
    .split("-")
    .map((part) => nameMap.get(part) ?? part)
    .join("-");
}

export function* modernSyllables(): Generator<{
  jamos: string;
  comp: string;
}> {
  // prettier-ignore
  const STANDARD_LEADINGS = [
    'ᄀ', 'ᄂ', 'ᄃ', 'ᄅ', 'ᄆ', 'ᄇ', 'ᄉ', 'ᄋ',
    'ᄌ', 'ᄎ', 'ᄏ', 'ᄐ', 'ᄑ', 'ᄒ', 'ᄁ', 'ᄄ',
    'ᄈ', 'ᄊ', 'ᄍ',
  ];
  // prettier-ignore
  const STANDARD_VOWELS = [
    'ᅡ', 'ᅣ', 'ᅥ', 'ᅧ', 'ᅵ', 'ᅢ', 'ᅤ', 'ᅦ',
    'ᅨ', 'ᅩ', 'ᅭ', 'ᅮ', 'ᅲ', 'ᅳ', 'ᅪ', 'ᅬ',
    'ᅯ', 'ᅱ', 'ᅴ', 'ᅫ', 'ᅰ',
  ];
  // prettier-ignore
  const STANDARD_TRAILINGS = [
    '', 'ᆨ', 'ᆫ', 'ᆮ', 'ᆯ', 'ᆷ', 'ᆸ', 'ᆺ', 'ᆼ',
    'ᆽ', 'ᆾ', 'ᆿ', 'ᇀ', 'ᇁ', 'ᇂ', 'ᆩ', 'ᆪ',
    'ᆬ', 'ᆭ', 'ᆰ', 'ᆱ', 'ᆲ', 'ᆳ', 'ᆴ', 'ᆵ',
    'ᆶ', 'ᆹ', 'ᆻ',
  ];
  for (const leading of STANDARD_LEADINGS) {
    for (const vowel of STANDARD_VOWELS) {
      for (const trailing of STANDARD_TRAILINGS) {
        let jamos = leading + vowel;
        const lIdx = leading.codePointAt(0)! - "ᄀ".codePointAt(0)!;
        const vIdx = vowel.codePointAt(0)! - "ᅡ".codePointAt(0)!;
        let tIdx = 0;
        if (trailing !== "") {
          jamos = jamos + trailing;
          tIdx = 1 + trailing.codePointAt(0)! - "ᆨ".codePointAt(0)!;
        }
        let codePoint = lIdx;
        codePoint = codePoint * STANDARD_VOWELS.length + vIdx;
        codePoint = codePoint * STANDARD_TRAILINGS.length + tIdx;
        codePoint += 0xac00;
        yield {
          jamos: jamos,
          comp: String.fromCodePoint(codePoint),
        };
      }
    }
  }
}

export function precomposedLigatures(
  length: number,
): Map<string, Array<{ rest: Array<string>; composed: string }>> {
  const PUA_LIGATURES = new Map<
    string,
    Array<{ rest: Array<string>; composed: string }>
  >();

  function addToMapEntry(uni: string, pua: string) {
    const key = uni[0];
    const rest = Array.from(uni).slice(1);
    if (!PUA_LIGATURES.has(key)) {
      PUA_LIGATURES.set(key, []);
    }
    PUA_LIGATURES.get(key)!.push({
      rest: rest,
      composed: pua,
    });
  }

  // Convert longer sequences first
  for (const [pua, uni] of PUA_CONV_TAB.entries()) {
    if (uni.length === length) {
      addToMapEntry(uni, pua);
    }
  }

  // FIXME: is this needed?
  // for (const {jamos, comp} of standardSyllables()) {
  //     if (jamos.length === length) {
  //         addToMapEntry(jamos, comp);
  //     }
  // }

  return PUA_LIGATURES;
}

export function getJamoForm(jamoName: string, pos: string): string {
  const jamoInfo = getJamoInfo(jamoName)!;
  // @ts-expect-error this is a hack
  const char = jamoInfo[pos];
  if (char === null || char === undefined) {
    // this should never happen
    throw new Error(`Jamo '${jamoName}' has no '${pos}'`);
  }
  return char;
}
