import paper from "paper";

import PathData from "@/app/pathUtils/PathData";

// @ts-expect-error no argument is also allowed
paper.setup();
paper.settings.insertItems = false;

const svg_kiyeok = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
<path d="M 703,263
L 676,285
L 505,295
C 457,298 394,300 340,300
C 285,300 245,298 207,292
C 192,290 185,303 195,312
C 221,333 275,360 304,360
C 314,360 326,357 336,354
C 348,350 362,344 376,343
C 480,337 577,332 691,328
C 688,423 677,551 657,654
C 649,693 680,700 694,669
C 737,574 759,446 765,337
C 775,321 783,311 783,297
C 783,284 771,280 746,274
Z" />
</svg>`;

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

const path = PathData.fromSvg(svg_kiyeok);

const startTime = Date.now();
const medialSkeletons = path.getMedialSkeleton();
const elapsedTime = Date.now() - startTime;
console.log(`Medial skeletons: ${medialSkeletons.length} in ${elapsedTime}ms`);
for (const skeleton of medialSkeletons) {
  console.log(
    skeleton.segments
      .map(
        ([a, b]) =>
          `polygon((${skeleton.points[a].x.toFixed(1)},${(1000 - skeleton.points[a].y).toFixed(1)}), (${skeleton.points[b].x.toFixed(1)},${(1000 - skeleton.points[b].y).toFixed(1)}))`,
      )
      .join(", "),
  );
  for (const primitive of skeleton.primitives) {
    console.log(
      primitive.origins
        .map((origin, i) => {
          const p = origin.add(
            primitive.directions[i].multiply(primitive.radii[i]),
          );
          return `(${p.x.toFixed(1)}, ${(1000 - p.y).toFixed(1)})`;
        })
        .join(", "),
    );
  }
}

path.scalePath(0, 1.0, 0.5);
