import { PUA_CONV_TAB } from "@/app/hangul/puaUniTable";

let UNI_TO_PUA: Map<string, string> | null = null;
let UNI_TO_PUA_3: Map<string, string> | null = null;
let UNI_TO_PUA_2: Map<string, string> | null = null;
let UNI_TO_PUA_1: Map<string, string> | null = null;

export function uniToPua(s: string): string {
  if (
    UNI_TO_PUA === null ||
    UNI_TO_PUA_3 === null ||
    UNI_TO_PUA_2 === null ||
    UNI_TO_PUA_1 === null
  ) {
    UNI_TO_PUA = new Map(PUA_CONV_TAB.entries().map(([a, b]) => [b, a]));
    UNI_TO_PUA_3 = new Map(
      UNI_TO_PUA.entries().filter((a) => a[0].length === 3),
    );
    UNI_TO_PUA_2 = new Map(
      UNI_TO_PUA.entries().filter((a) => a[0].length === 2),
    );
    UNI_TO_PUA_1 = new Map(
      UNI_TO_PUA.entries().filter((a) => a[0].length === 1),
    );
  }
  s = s.normalize("NFKC");
  for (let i = 0; i < s.length - 2; i += 3) {
    if (UNI_TO_PUA_3.has(s.slice(i, i + 3))) {
      s = s.slice(0, i) + UNI_TO_PUA_3.get(s.slice(i, i + 3)) + s.slice(i + 3);
    }
  }
  for (let i = 0; i < s.length - 1; i += 2) {
    if (UNI_TO_PUA_2.has(s.slice(i, i + 2))) {
      s = s.slice(0, i) + UNI_TO_PUA_2.get(s.slice(i, i + 2)) + s.slice(i + 2);
    }
  }
  for (let i = 0; i < s.length; i++) {
    if (UNI_TO_PUA_1.has(s[i])) {
      s = s.slice(0, i) + UNI_TO_PUA_1.get(s[i]) + s.slice(i + 1);
    }
  }
  return s;
}
