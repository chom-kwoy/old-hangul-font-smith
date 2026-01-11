import paper from "paper";

import { Bounds } from "@/app/utils/types";

// returns shapes that overlap the bounds list
export function intersectCompoundPath(
  compoundPath: paper.CompoundPath,
  boundsList: Bounds[],
  threshold: number = 0.5,
): paper.CompoundPath {
  const newPaths = new paper.CompoundPath("");
  for (const path of compoundPath.children) {
    if (path instanceof paper.Path) {
      const bbox = path.bounds;
      const bboxArea =
        Math.max(0, bbox.right - bbox.left) *
        Math.max(0, bbox.bottom - bbox.top);

      let intersectionArea = 0;
      for (const bounds of boundsList) {
        const intersection = {
          left: Math.max(bounds.left, bbox.left),
          right: Math.min(bounds.right, bbox.right),
          top: Math.max(bounds.top, bbox.top),
          bottom: Math.min(bounds.bottom, bbox.bottom),
        };
        intersectionArea +=
          Math.max(0, intersection.right - intersection.left) *
          Math.max(0, intersection.bottom - intersection.top);
      }

      if (intersectionArea / bboxArea >= threshold) {
        newPaths.addChild(new paper.Path(path.pathData));
      }
    }
  }
  return newPaths;
}
