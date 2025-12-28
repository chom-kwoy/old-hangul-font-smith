import { Bezier } from "bezier-js";
import { TComplexPathData } from "fabric";

import { Bounds } from "@/app/types";

export function toBezier(path: TComplexPathData): Bezier[][] {
  const shapes: Bezier[][] = [];
  let shape: Bezier[] = [];
  let lastX = 0;
  let lastY = 0;
  let firstX = 0;
  let firstY = 0;
  for (const cmd of path) {
    switch (cmd[0]) {
      case "M": {
        // move to
        const [x, y] = cmd.slice(1) as number[];
        firstX = lastX = x;
        firstY = lastY = y;
        break;
      }
      case "L": {
        // line to
        const [x, y] = cmd.slice(1) as number[];
        const midX = (lastX + x) / 2;
        const midY = (lastY + y) / 2;
        shape.push(new Bezier(lastX, lastY, midX, midY, midX, midY, x, y));
        lastX = x;
        lastY = y;
        break;
      }
      case "Q": {
        // quadratic bezier curve
        const [x1, y1, x, y] = cmd.slice(1) as number[];
        shape.push(new Bezier(lastX, lastY, x1, y1, x, y1));
        lastX = x;
        lastY = y;
        break;
      }
      case "C": {
        // cubic bezier curve
        const [x1, y1, x2, y2, x, y] = cmd.slice(1) as number[];
        shape.push(new Bezier(lastX, lastY, x1, y1, x2, y2, x, y));
        lastX = x;
        lastY = y;
        break;
      }
      case "Z": {
        // close path
        if (lastX === firstX && lastY === firstY) {
          // do nothing
        } else {
          const midX = (lastX + firstX) / 2;
          const midY = (lastY + firstY) / 2;
          shape.push(
            new Bezier(lastX, lastY, midX, midY, midX, midY, firstX, firstY),
          );
          lastX = firstX;
          lastY = firstY;
        }
        shapes.push(shape);
        shape = [];
        break;
      }
    }
  }
  return shapes;
}

export function toPathData(shapes: Bezier[][]) {
  const path: TComplexPathData = [];

  for (const shape of shapes) {
    if (shape.length === 0) continue;

    // 1. Move to the start of the first Bezier segment
    const firstSegment = shape[0];
    path.push(["M", firstSegment.points[0].x, firstSegment.points[0].y]);

    // 2. Iterate through segments and convert to Cubic commands
    for (const segment of shape) {
      const p = segment.points;
      if (p.length === 3) {
        // SVG Quadratic command: Q x1 y1, x y
        path.push(["Q", p[1].x, p[1].y, p[2].x, p[2].y]);
      } else if (p.length === 4) {
        // SVG Cubic command: C x1 y1, x2 y2, x y
        path.push(["C", p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y]);
      }
    }

    // 3. Close the path
    path.push(["Z"]);
  }

  return path;
}

export function pathBounds(path: Bezier[] | Bezier[][]): Bounds {
  const bounds = {
    left: Infinity,
    right: -Infinity,
    top: Infinity,
    bottom: -Infinity,
  };
  for (const bezier of path) {
    const shapes = Array.isArray(bezier) ? bezier : [bezier];
    for (const shape of shapes) {
      const bbox = shape.bbox();
      bounds.left = Math.min(bounds.left, bbox.x.min);
      bounds.right = Math.max(bounds.right, bbox.x.max);
      bounds.top = Math.min(bounds.top, bbox.y.min);
      bounds.bottom = Math.max(bounds.bottom, bbox.y.max);
    }
  }
  return bounds;
}

// returns shapes that overlap the bounds list
export function intersectBezier(
  bezier: Bezier[][],
  boundsList: Bounds[],
  threshold: number = 0.5,
): Bezier[][] {
  const newPaths: Bezier[][] = [];
  for (const path of bezier) {
    const bbox = pathBounds(path);
    const bboxArea =
      Math.max(0, bbox.right - bbox.left) * Math.max(0, bbox.bottom - bbox.top);

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
      newPaths.push(path);
    }
  }
  return newPaths;
}
