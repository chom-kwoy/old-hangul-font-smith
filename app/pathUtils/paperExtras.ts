import paper from "paper";

/**
 * Thin typed accessors for paper.js 0.12 behaviour that its bundled `.d.ts`
 * mistypes or omits:
 *  - `area` is declared on `Path`/`CompoundPath` but not the base `PathItem`
 *    (which boolean ops return);
 *  - `getCrossings()` supports a no-arg self-crossings form at runtime, but the
 *    types require a `path` argument;
 *  - `resolveCrossings()` is absent from the types entirely.
 */
type PathItemRuntime = {
  area: number;
  getCrossings(): paper.CurveLocation[];
  resolveCrossings(): paper.PathItem;
};

/** Signed area of any path item (the base `PathItem` lacks `area` in the types). */
export function pathArea(item: paper.PathItem): number {
  return (item as unknown as PathItemRuntime).area;
}

/** Number of self-intersections (no-arg `getCrossings`, untyped in 0.12). */
export function selfCrossingCount(item: paper.PathItem): number {
  return (item as unknown as PathItemRuntime).getCrossings().length;
}

/**
 * Split a path at its self-intersections and retrace by winding (untyped in
 * 0.12). Mutates and returns `item`.
 */
export function resolveCrossings(item: paper.PathItem): paper.PathItem {
  return (item as unknown as PathItemRuntime).resolveCrossings();
}

/**
 * Connected components of a (possibly compound) path as `Path`s paired with
 * their absolute area, sorted largest-first. Non-consuming; returns references
 * to the input's children — clone before mutating the input.
 */
export function componentsByArea(
  item: paper.PathItem,
): { path: paper.Path; area: number }[] {
  const children =
    item instanceof paper.CompoundPath
      ? (item.children as paper.Path[])
      : [item as paper.Path];
  return children
    .map((path) => ({ path, area: Math.abs(path.area) }))
    .sort((a, b) => b.area - a.area);
}
