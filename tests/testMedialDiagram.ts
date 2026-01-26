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

const path = PathData.fromSvg(svg_kiyeok);
console.log(path.serialize());

const medialAxis = path.getMedialAxis();
console.log(medialAxis);

const medialSkeleton = path.getMedialSkeleton();
console.log(medialSkeleton);
