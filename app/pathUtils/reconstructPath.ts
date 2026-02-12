import paper from "paper";

import { FittedMedialAxisGraph, Primitive } from "./localPrimitiveFitting";

/**
 * Reconstructs the 2D shape boundary from the Medial Skeletal Diagram.
 *
 * Process:
 * 1. Convert each Primitive (radius function) into a closed Polygon.
 * 2. smooth() the polygon to create rough Bezier approximations.
 * 3. Union all primitives together to form the final envelope.
 */
export function reconstructShapeFromMSD(
  skeleton: FittedMedialAxisGraph,
  simplifyTolerance: number = 0.5,
): paper.PathItem {
  if (!skeleton.primitives || skeleton.primitives.length === 0) {
    throw new Error(
      "Skeleton has no fitted primitives. Run localPrimitiveFitting first.",
    );
  }

  // 1. Reify all primitives into Paper.js Paths
  const primitiveShapes: paper.PathItem[] = skeleton.primitives.map(
    createPathFromPrimitive,
  );

  // 2. Efficiently Union All Shapes
  // A linear loop of .unite() can be slow. A divide-and-conquer approach is faster,
  // but for <500 primitives, reduce() is acceptable.
  let reconstructedShape = primitiveShapes[0];

  for (let i = 1; i < primitiveShapes.length; i++) {
    const nextShape = primitiveShapes[i];

    // Boolean Union: Merge the new primitive into the accumulating shape
    const united = reconstructedShape.unite(nextShape);

    // Clean up old memory (Paper.js creates new items on unite)
    reconstructedShape.remove();
    nextShape.remove();

    reconstructedShape = united;
  }

  // 3. Post-Processing: Smoothing & Simplification
  // The union of many overlapping curves can create tiny artifacts.
  if (reconstructedShape instanceof paper.Path) {
    reconstructedShape.simplify(simplifyTolerance);
  } else if (reconstructedShape instanceof paper.CompoundPath) {
    // Apply to all children if it became a CompoundPath (holes, etc.)
    reconstructedShape.children.forEach((c) =>
      (c as paper.Path).simplify(simplifyTolerance),
    );
  }
  reconstructedShape.simplify();

  return reconstructedShape;
}

/**
 * Converts a mathematical Primitive (origins, dirs, radii) into a Paper.js Path.
 */
function createPathFromPrimitive(prim: Primitive): paper.Path {
  const segments: paper.Point[] = [];

  // Calculate boundary points: P = Origin + Radius * Direction
  for (let i = 0; i < prim.radii.length; i++) {
    const r = prim.radii[i];
    const dir = prim.directions[i];
    const origin = prim.origins[i]; // Array of origins for edges, or repeated center for points

    // P = O + r*d
    const point = origin.add(dir.multiply(r));
    segments.push(point);
  }

  const path = new paper.Path({
    segments: segments,
    closed: true,
    insert: false, // Keep it in memory, don't add to scene yet
  });

  // Convert the discrete polygon into smooth Bezier curves locally
  // This uses Catmull-Rom style smoothing suitable for the dense 128-point polygon
  path.smooth({ type: "catmull-rom", factor: 0.5 });

  return path;
}
