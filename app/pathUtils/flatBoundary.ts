import paper from "paper";

export interface FlatBoundary {
  x0: Float64Array;
  y0: Float64Array;
  x1: Float64Array;
  y1: Float64Array;
  count: number;
  gridMinX: number;
  gridMinY: number;
  cellW: number;
  cellH: number;
  gridCols: number;
  gridRows: number;
  cells: Int32Array[];
}

const GRID_DIM = 20;

export function buildFlatBoundary(path: paper.CompoundPath): FlatBoundary {
  const flatPath = path.clone() as paper.CompoundPath;
  flatPath.flatten(0.5);

  const x0List: number[] = [],
    y0List: number[] = [];
  const x1List: number[] = [],
    y1List: number[] = [];

  for (const child of flatPath.children as paper.Path[]) {
    const segs = child.segments;
    const n = segs.length;
    for (let i = 0; i < n; i++) {
      const p0 = segs[i].point;
      const p1 = segs[(i + 1) % n].point;
      x0List.push(p0.x);
      y0List.push(p0.y);
      x1List.push(p1.x);
      y1List.push(p1.y);
    }
  }
  flatPath.remove();

  const count = x0List.length;
  const x0 = new Float64Array(x0List);
  const y0 = new Float64Array(y0List);
  const x1 = new Float64Array(x1List);
  const y1 = new Float64Array(y1List);

  const bounds = path.bounds;
  const margin = Math.max(bounds.width, bounds.height) * 0.1 + 10;
  const gridMinX = bounds.x - margin;
  const gridMinY = bounds.y - margin;
  const cellW = (bounds.width + 2 * margin) / GRID_DIM;
  const cellH = (bounds.height + 2 * margin) / GRID_DIM;

  const cellLists: number[][] = Array.from(
    { length: GRID_DIM * GRID_DIM },
    () => [],
  );

  for (let i = 0; i < count; i++) {
    const minX = Math.min(x0[i], x1[i]);
    const maxX = Math.max(x0[i], x1[i]);
    const minY = Math.min(y0[i], y1[i]);
    const maxY = Math.max(y0[i], y1[i]);

    const colMin = Math.max(0, Math.floor((minX - gridMinX) / cellW));
    const colMax = Math.min(GRID_DIM - 1, Math.floor((maxX - gridMinX) / cellW));
    const rowMin = Math.max(0, Math.floor((minY - gridMinY) / cellH));
    const rowMax = Math.min(GRID_DIM - 1, Math.floor((maxY - gridMinY) / cellH));

    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        cellLists[r * GRID_DIM + c].push(i);
      }
    }
  }

  const cells = cellLists.map((list) => new Int32Array(list));

  return {
    x0,
    y0,
    x1,
    y1,
    count,
    gridMinX,
    gridMinY,
    cellW,
    cellH,
    gridCols: GRID_DIM,
    gridRows: GRID_DIM,
    cells,
  };
}

/**
 * Cast a ray from (ox, oy) in unit direction (dx, dy) against the flat boundary.
 * Uses DDA grid traversal for acceleration. Returns distance to nearest
 * intersection, or 1e-4 if none found.
 * `tested` must be a zeroed Uint8Array of length fb.count — caller resets it.
 */
export function rayIntersectFlatBoundary(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  fb: FlatBoundary,
  tested: Uint8Array,
): number {
  const {
    gridMinX,
    gridMinY,
    cellW,
    cellH,
    gridCols,
    gridRows,
    cells,
    x0,
    y0,
    x1,
    y1,
  } = fb;

  let col = Math.floor((ox - gridMinX) / cellW);
  let row = Math.floor((oy - gridMinY) / cellH);
  col = Math.max(0, Math.min(gridCols - 1, col));
  row = Math.max(0, Math.min(gridRows - 1, row));

  const stepCol = dx >= 0 ? 1 : -1;
  const stepRow = dy >= 0 ? 1 : -1;

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const tDeltaX = absDx > 1e-10 ? cellW / absDx : Infinity;
  const tDeltaY = absDy > 1e-10 ? cellH / absDy : Infinity;

  let tMaxX: number;
  if (absDx < 1e-10) {
    tMaxX = Infinity;
  } else if (dx > 0) {
    tMaxX = (gridMinX + (col + 1) * cellW - ox) / dx;
  } else {
    tMaxX = (gridMinX + col * cellW - ox) / dx;
  }

  let tMaxY: number;
  if (absDy < 1e-10) {
    tMaxY = Infinity;
  } else if (dy > 0) {
    tMaxY = (gridMinY + (row + 1) * cellH - oy) / dy;
  } else {
    tMaxY = (gridMinY + row * cellH - oy) / dy;
  }

  let minDist = Infinity;

  while (col >= 0 && col < gridCols && row >= 0 && row < gridRows) {
    const cellSegs = cells[row * gridCols + col];
    for (let k = 0; k < cellSegs.length; k++) {
      const si = cellSegs[k];
      if (tested[si]) continue;
      tested[si] = 1;

      // Ray-segment intersection:
      //   ray:     P = (ox + t*dx, oy + t*dy),  t >= 0
      //   segment: Q = (ax + s*ex, ay + s*ey),  0 <= s <= 1
      const ax = x0[si],
        ay = y0[si];
      const ex = x1[si] - ax,
        ey = y1[si] - ay;
      const wx = ax - ox,
        wy = ay - oy;
      const det = ex * dy - ey * dx;
      if (Math.abs(det) < 1e-10) continue; // parallel
      const t = (ex * wy - ey * wx) / det;
      const s = (dx * wy - dy * wx) / det;
      if (t >= -1e-6 && s >= -1e-6 && s <= 1 + 1e-6 && t < minDist) {
        minDist = t;
      }
    }

    // tExit is the t at which we leave the current cell (= entry t of the next).
    // If the next cell starts beyond our best hit, no closer intersection exists.
    const tExit = tMaxX < tMaxY ? tMaxX : tMaxY;
    if (tExit > minDist) break;

    if (tMaxX < tMaxY) {
      col += stepCol;
      tMaxX += tDeltaX;
    } else {
      row += stepRow;
      tMaxY += tDeltaY;
    }
  }

  return minDist < Infinity ? minDist : 1e-4;
}

/**
 * Returns the distance from (px, py) to the nearest point on any segment
 * in the flat boundary. O(n_segments) — no grid used.
 */
export function nearestDistFlatBoundary(
  px: number,
  py: number,
  fb: FlatBoundary,
): number {
  const { x0, y0, x1, y1, count } = fb;
  let minDist = Infinity;
  for (let i = 0; i < count; i++) {
    const ax = x0[i],
      ay = y0[i];
    const dx = x1[i] - ax,
      dy = y1[i] - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 1e-10 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + t * dx,
      cy = ay + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}
