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

export type SampleBoundaryOptions = {
  step?: number;
  samplesPerCurve?: number;
};

export function sampleBoundary(
  path: paper.CompoundPath,
  options: SampleBoundaryOptions,
): {
  points: paper.Point[];
  subPathRanges: Array<{ start: number; end: number }>;
  origCurveIdx: Array<{ subPathIdx: number; curveIdx: number }>;
} {
  const points: paper.Point[] = [];
  const subPathRanges: Array<{ start: number; end: number }> = [];
  const origCurveIdx: Array<{ subPathIdx: number; curveIdx: number }> = [];

  for (const child of path.children as paper.Path[]) {
    const rangeStart = points.length;

    for (const curve of child.curves) {
      // Always include the anchor point at the start of this curve segment.
      points.push(curve.point1.clone());
      origCurveIdx.push({ subPathIdx: child.index, curveIdx: curve.index });
      // Then add evenly-spaced interior samples along the curve.
      const step = options.step ?? curve.length / options.samplesPerCurve!;
      const numInterior =
        options.samplesPerCurve ?? Math.floor(curve.length / step);
      for (let i = 1; i <= numInterior; i++) {
        const pt = curve.getPointAt(i * step);
        points.push(pt);
        origCurveIdx.push({ subPathIdx: child.index, curveIdx: curve.index });
      }
    }

    subPathRanges.push({ start: rangeStart, end: points.length });
  }

  return { points, subPathRanges, origCurveIdx };
}

export function buildFlatBoundary(
  path: paper.CompoundPath,
  sampleSpacing: number = 5,
): FlatBoundary {
  const { points, subPathRanges } = sampleBoundary(path, {
    step: sampleSpacing,
  });

  const x0List: number[] = [],
    y0List: number[] = [];
  const x1List: number[] = [],
    y1List: number[] = [];

  for (const { start, end } of subPathRanges) {
    const len = end - start;
    for (let i = 0; i < len; i++) {
      const p0 = points[start + i];
      const p1 = points[start + ((i + 1) % len)];
      x0List.push(p0.x);
      y0List.push(p0.y);
      x1List.push(p1.x);
      y1List.push(p1.y);
    }
  }

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
    const colMax = Math.min(
      GRID_DIM - 1,
      Math.floor((maxX - gridMinX) / cellW),
    );
    const rowMin = Math.max(0, Math.floor((minY - gridMinY) / cellH));
    const rowMax = Math.min(
      GRID_DIM - 1,
      Math.floor((maxY - gridMinY) / cellH),
    );

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
 * `tested` is a Uint32Array of length fb.count shared across calls; `gen` is the
 * current generation — tested[si] === gen means already checked this ray cast.
 * Callers increment gen between calls instead of filling the array with zeros.
 */
export function rayIntersectFlatBoundary(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  fb: FlatBoundary,
  tested: Uint32Array,
  gen: number,
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
      if (tested[si] === gen) continue;
      tested[si] = gen;

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
 * in the flat boundary. Uses the spatial grid for O(k) average-case performance
 * by expanding in Chebyshev rings until the ring's minimum possible distance
 * exceeds the current best.
 */
export function nearestDistFlatBoundary(
  px: number,
  py: number,
  fb: FlatBoundary,
): number {
  const { x0, y0, x1, y1, gridMinX, gridMinY, cellW, cellH, gridCols, gridRows, cells } = fb;

  const col0 = Math.max(0, Math.min(gridCols - 1, Math.floor((px - gridMinX) / cellW)));
  const row0 = Math.max(0, Math.min(gridRows - 1, Math.floor((py - gridMinY) / cellH)));

  let minDist = Infinity;

  for (let r = 0; ; r++) {
    // Minimum possible distance from (px,py) to any segment in ring r:
    // ring r cells are at Chebyshev distance r, so the nearest cell boundary
    // is at grid distance (r-1) cells away.
    const ringMinDist = r <= 1 ? 0 : (r - 1) * Math.min(cellW, cellH);
    if (ringMinDist > minDist) break;

    const rMin = Math.max(0, row0 - r);
    const rMax = Math.min(gridRows - 1, row0 + r);
    const cMin = Math.max(0, col0 - r);
    const cMax = Math.min(gridCols - 1, col0 + r);

    for (let row = rMin; row <= rMax; row++) {
      for (let col = cMin; col <= cMax; col++) {
        // Only process cells on the outer ring (Chebyshev distance exactly r)
        if (r > 0 && row > rMin && row < rMax && col > cMin && col < cMax) continue;

        const cellSegs = cells[row * gridCols + col];
        for (let k = 0; k < cellSegs.length; k++) {
          const i = cellSegs[k];
          const ax = x0[i], ay = y0[i];
          const dx = x1[i] - ax, dy = y1[i] - ay;
          const lenSq = dx * dx + dy * dy;
          let t = lenSq > 1e-10 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const cx = ax + t * dx, cy = ay + t * dy;
          const dist = Math.hypot(px - cx, py - cy);
          if (dist < minDist) minDist = dist;
        }
      }
    }

    // Stop if we've covered the entire grid
    if (rMin === 0 && rMax === gridRows - 1 && cMin === 0 && cMax === gridCols - 1) break;
  }

  return minDist;
}
