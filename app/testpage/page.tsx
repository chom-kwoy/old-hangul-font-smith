"use client";

import { Box } from "@mui/system";
import { useState } from "react";

import { GlyphView } from "@/app/components/GlyphView";
import PathData from "@/app/pathUtils/PathData";
import { initDrawContexts } from "@/app/utils/init";

const svg_nieun_hieuh = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <path d="M 529,290
C 455,290 409,333 409,401
C 409,468 455,516 529,516
C 603,516 649,468 649,401
C 649,333 603,290 529,290
Z
M 529,473
C 491,473 471,447 471,401
C 471,355 491,329 529,329
C 567,329 587,355 587,401
C 587,447 567,473 529,473
Z" />
<path d="M 141,474
C 141,491 187,541 200,541
C 223,541 352,478 388,456
C 414,440 403,411 374,423
C 323,444 243,470 224,470
C 209,470 206,465 206,446
L 208,264
C 208,254 209,241 209,230
C 209,216 203,207 174,200
C 150,194 127,191 100,191
C 62,191 56,200 56,209
C 56,214 62,220 74,223
C 103,230 114,235 139,247
Z" />
<path d="M 656,258
C 675,259 686,247 686,234
C 686,214 662,205 620,205
C 609,205 590,210 581,215
C 573,219 557,223 538,225
C 510,228 503,231 458,231
C 420,231 395,228 361,222
C 349,220 341,231 350,238
C 369,254 399,279 421,279
C 436,279 448,278 458,274
C 464,272 475,271 488,268
C 537,256 561,255 656,258
Z" />
<path d="M 540,188
C 580,188 590,182 590,165
C 590,148 578,143 536,143
L 503,143
C 475,137 455,128 431,120
C 412,114 401,127 413,140
C 429,158 453,175 479,188
Z" />

</svg>`;

export default function TestPage() {
  useState(() => initDrawContexts());

  const [path, setPath] = useState(() => PathData.fromSvg(svg_nieun_hieuh));

  return (
    <Box
      sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}
      className="h-screen w-screen bg-stone-100 flex-col"
    >
      <div>GlyphView Test</div>
      <GlyphView
        className="outline outline-stone-500 rounded-lg overflow-hidden"
        width={700}
        height={700}
        interactive={true}
        path={path}
        onPathChanged={(newPath: PathData | null) => {
          if (newPath) {
            setPath(newPath);
          }
        }}
      />
    </Box>
  );
}
