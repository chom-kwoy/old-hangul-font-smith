import * as fabric from "fabric";
import { TSimplePathData } from "fabric";
import paper from "paper";

export function paperToFabricPath(
  compoundPath: paper.PathItem,
): TSimplePathData {
  // TODO: avoid creating an object for performance
  return new fabric.Path(compoundPath.pathData).path;
}

type FabicToSvgOptions = {
  scaleX?: number;
  scaleY?: number;
  dontClose?: boolean;
};

export function fabricToSVG(
  path: TSimplePathData,
  options?: FabicToSvgOptions,
): string {
  const scaleX = options?.scaleX || 1.0;
  const scaleY = options?.scaleY || 1.0;
  const dontClose = options?.dontClose || false;
  const data: string[] = [];
  for (const cmd of path) {
    switch (cmd[0]) {
      case "M": // move to
        data.push(`M ${cmd[1] * scaleX},${cmd[2] * scaleY}`);
        break;
      case "L": // line to
        data.push(`L ${cmd[1] * scaleX},${cmd[2] * scaleY}`);
        break;
      case "Q": // quadratic bezier curve
        data.push(
          `Q ${cmd[1] * scaleX},${cmd[2] * scaleY} ` +
            `${cmd[3] * scaleX},${cmd[4] * scaleY}`,
        );
        break;
      case "C": // cubic bezier curve
        data.push(
          `C ${cmd[1] * scaleX},${cmd[2] * scaleY} ` +
            `${cmd[3] * scaleX},${cmd[4] * scaleY} ` +
            `${cmd[5] * scaleX},${cmd[6] * scaleY}`,
        );
        break;
      case "Z": // close path
        if (!dontClose) {
          data.push("Z");
        }
        break;
    }
  }
  return data.join("\n");
}

export function fabricToCompoundPath(
  path: TSimplePathData,
  options?: FabicToSvgOptions,
): paper.CompoundPath {
  const svg = fabricToSVG(path, options);
  const result = new paper.CompoundPath(svg);
  if (options?.dontClose) {
    result.closed = false;
  }
  return result;
}
