import { TSimplePathData } from "fabric";

import { fabricPathDataToPaper } from "@/app/pathUtils/convert";
import {
  SampleBoundaryOptions,
  sampleBoundary,
} from "@/app/pathUtils/flatBoundary";
import { Vec2D } from "@/app/utils/types";

// Neighbor offsets (in sampled-point indices) at which Menger curvature is computed.
// Small scales capture sharp local corners; large scales capture context farther away,
// giving featureless straight-line points a non-degenerate descriptor.
const CURVATURE_SCALES = [1, 3, 10];

export type Keypoint = {
  pos: Vec2D;
  origIdx: { subPathIdx: number; curveIdx: number };
  tangent: Vec2D;
  curvatures: number[]; // one entry per scale in CURVATURE_SCALES
};

function mengerCurvature(
  px: number,
  py: number,
  cx: number,
  cy: number,
  nx: number,
  ny: number,
): number {
  const ax = px - cx,
    ay = py - cy;
  const bx = nx - cx,
    by = ny - cy;
  const cross = ax * by - ay * bx;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const lab = Math.hypot(nx - px, ny - py);
  const denom = la * lb * lab;
  return (denom > 1e-10 ? (2 * cross) / denom : 0) * 1000;
}

export function extractKeypointDescriptors(
  path: TSimplePathData,
  options: SampleBoundaryOptions,
): Keypoint[] {
  const { points, origCurveIdx } = sampleBoundary(
    fabricPathDataToPaper(path),
    options,
  );

  const n = points.length;
  const keypoints: Keypoint[] = [];

  for (let i = 0; i < n; ++i) {
    const cur = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    const tangent: Vec2D =
      len > 1e-10 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };

    const curvatures = CURVATURE_SCALES.map((r) => {
      const p = points[(i - r + n) % n];
      const q = points[(i + r) % n];
      return mengerCurvature(p.x, p.y, cur.x, cur.y, q.x, q.y);
    });

    keypoints.push({
      pos: { x: cur.x, y: cur.y },
      origIdx: origCurveIdx[i],
      tangent,
      curvatures,
    });
  }

  return keypoints;
}

export function cosineSimilarity(a: Vec2D, b: Vec2D) {
  const value =
    1 + (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  if (value < 0) {
    throw new Error("cosineSimilarity: value < 0");
  }
  return value;
}

export function curvatureSimilarity(a: number, b: number) {
  const maxDiff = 10.0;
  const value = Math.max(maxDiff - Math.abs(a - b), 0.0) / maxDiff;
  if (value < 0) {
    throw new Error("curvatureSimilarity: value < 0");
  }
  return value;
}

export function keypointSimilarity(kp1: Keypoint, kp2: Keypoint) {
  let sim = cosineSimilarity(kp1.tangent, kp2.tangent);
  for (let s = 0; s < kp1.curvatures.length; s++) {
    sim += curvatureSimilarity(kp1.curvatures[s], kp2.curvatures[s]);
  }
  return sim;
}

// Pre-allocated DP workspace — reused across rotation candidates to avoid GC pressure.
// Column (Mn) stacks are persistent across rows; column j's k-th block lives at
// j*maxColH+k in the flat col* arrays.  The row (Mh) stack is a transient buffer
// reset at the start of each row.
type Workspace = {
  dp: Float64Array[];
  bkState: Int32Array[];
  bkI: Int32Array[];
  bkJ: Int32Array[];
  colV: Float64Array; // min-sim value of block
  colG: Float64Array; // max M(m,j) in block
  colHatB: Float64Array; // prefix-max of (G+v) up to this block
  colArgG: Int32Array; // row m achieving G
  colArgBest: Int32Array; // row m achieving hatB (backtrack anchor)
  colTop: Int32Array; // stack height per column, length = maxH
  rowV: Float64Array; // row (Mh) stack buffer, length = maxH
  rowG: Float64Array;
  rowHatB: Float64Array;
  rowArgG: Int32Array; // column m achieving G
  rowArgBest: Int32Array; // column m achieving hatB
  maxColH: number; // max blocks per column = maxN passed to makeWorkspace
};

function makeWorkspace(maxN: number, maxH: number): Workspace {
  const dpSize = maxN * maxH;
  const colSize = maxH * maxN;
  return {
    dp: Array.from({ length: 5 }, () => new Float64Array(dpSize)),
    bkState: Array.from({ length: 5 }, () => new Int32Array(dpSize)),
    bkI: Array.from({ length: 5 }, () => new Int32Array(dpSize)),
    bkJ: Array.from({ length: 5 }, () => new Int32Array(dpSize)),
    colV: new Float64Array(colSize),
    colG: new Float64Array(colSize),
    colHatB: new Float64Array(colSize),
    colArgG: new Int32Array(colSize),
    colArgBest: new Int32Array(colSize),
    colTop: new Int32Array(maxH),
    rowV: new Float64Array(maxH),
    rowG: new Float64Array(maxH),
    rowHatB: new Float64Array(maxH),
    rowArgG: new Int32Array(maxH),
    rowArgBest: new Int32Array(maxH),
    maxColH: maxN,
  };
}

export function matchKeypointsImpl(
  N: Keypoint[],
  H: Keypoint[],
  ws?: Workspace,
  // Normalized Sakoe-Chiba half-band: only fill cells within `band` of the diagonal.
  // Infinity = full DP.
  band: number = Infinity,
): { score: number; alignment: Map<number, number[]> } {
  // States: 0=M, 1=Mh, 2=Mn, 3=X, 4=Y
  //
  // M(i,j)  = Sim(N[i],H[j]) + max(M,Mh,Mn,X,Y)(i-1,j-1)
  //
  // Mh(i,j) = max_{m=0}^{j-1} [ M(i,m) + min_{p=m}^{j-1} Sim(N[i], H[p]) ]
  //           H advances m→j while N is held at i; score bottlenecked by worst sim.
  //           Implemented via a per-row monotone stack (O(1) amortised per cell).
  //
  // Mn(i,j) = max_{m=0}^{i-1} [ M(m,j) + min_{r=m}^{i-1} Sim(N[r], H[j]) ]
  //           N advances m→i while H is held at j; symmetric to Mh.
  //           Implemented via per-column monotone stacks persistent across rows.
  //
  // X(i,j)  = max(M,Mh,Mn,X)(i,j-1) - ghopen/ghext   [H-gap]
  // Y(i,j)  = max(M,Mh,Mn,Y)(i-1,j) - gnopen/gnext   [N-gap]
  //
  // Boundary: M(0,0)=0, X(0,j)=0 for j in [0,band].
  // Final:    max_j max(M,Mh,Mn,Y)(M_N, j).
  //
  // Backtrack for Mh(i,j) with stored M-start m: expand H[m..j-1] → N[i-1],
  // then jump to M(i,m).  Mn is symmetric.
  const ghopen = 1.0;
  const ghext = 0.0;
  const gnopen = 10.0;
  const gnext = 5.0;

  const M_N = N.length;
  const M_H = H.length;
  const NEG_INF = -1e18;
  const W = M_H + 1;
  const dpSize = (M_N + 1) * W;

  let dp: Float64Array[];
  let bkState: Int32Array[];
  let bkI: Int32Array[];
  let bkJ: Int32Array[];
  let colV: Float64Array, colG: Float64Array, colHatB: Float64Array;
  let colArgG: Int32Array, colArgBest: Int32Array, colTop: Int32Array;
  let rowV: Float64Array, rowG: Float64Array, rowHatB: Float64Array;
  let rowArgG: Int32Array, rowArgBest: Int32Array;
  let maxColH: number;

  const wsOk =
    ws !== undefined &&
    ws.dp[0].length >= dpSize &&
    ws.colTop.length >= W &&
    ws.maxColH >= M_N + 1;

  if (wsOk) {
    ({
      dp,
      bkState,
      bkI,
      bkJ,
      colV,
      colG,
      colHatB,
      colArgG,
      colArgBest,
      colTop,
      rowV,
      rowG,
      rowHatB,
      rowArgG,
      rowArgBest,
      maxColH,
    } = ws!);
    for (let s = 0; s < 5; s++) {
      dp[s].fill(NEG_INF, 0, dpSize);
      bkState[s].fill(-1, 0, dpSize);
      bkI[s].fill(-1, 0, dpSize);
      bkJ[s].fill(-1, 0, dpSize);
    }
    colTop.fill(0, 0, W);
  } else {
    dp = Array.from({ length: 5 }, () =>
      new Float64Array(dpSize).fill(NEG_INF),
    );
    bkState = Array.from({ length: 5 }, () => new Int32Array(dpSize).fill(-1));
    bkI = Array.from({ length: 5 }, () => new Int32Array(dpSize).fill(-1));
    bkJ = Array.from({ length: 5 }, () => new Int32Array(dpSize).fill(-1));
    const colSize = W * (M_N + 1);
    colV = new Float64Array(colSize);
    colG = new Float64Array(colSize);
    colHatB = new Float64Array(colSize);
    colArgG = new Int32Array(colSize);
    colArgBest = new Int32Array(colSize);
    colTop = new Int32Array(W);
    rowV = new Float64Array(W);
    rowG = new Float64Array(W);
    rowHatB = new Float64Array(W);
    rowArgG = new Int32Array(W);
    rowArgBest = new Int32Array(W);
    maxColH = M_N + 1;
  }

  const at = (i: number, j: number) => i * W + j;

  // Boundary: M(0,0)=0, X(0,j)=0 for j in [0, min(M_H, band)]
  dp[0][at(0, 0)] = 0;
  const initJMax = band === Infinity ? M_H : Math.min(M_H, band);
  for (let j = 0; j <= initJMax; j++) dp[3][at(0, j)] = 0;

  for (let i = 1; i <= M_N; i++) {
    const jExp = Math.round((i * M_H) / M_N);
    const jLo = band === Infinity ? 0 : Math.max(0, jExp - band);
    const jHi = band === Infinity ? M_H : Math.min(M_H, jExp + band);

    let rowTop = 0; // Mh stack top, reset each row

    for (let j = jLo; j <= jHi; j++) {
      const c = at(i, j);

      // --- M(i,j) ---
      if (j >= 1) {
        const sc = keypointSimilarity(N[i - 1], H[j - 1]);
        const p = at(i - 1, j - 1);
        let best = NEG_INF,
          bs = -1,
          v: number;
        if ((v = dp[0][p]) > best) {
          best = v;
          bs = 0;
        }
        if ((v = dp[1][p]) > best) {
          best = v;
          bs = 1;
        }
        if ((v = dp[2][p]) > best) {
          best = v;
          bs = 2;
        }
        if ((v = dp[3][p]) > best) {
          best = v;
          bs = 3;
        }
        if ((v = dp[4][p]) > best) {
          best = v;
          bs = 4;
        }
        if (best > NEG_INF) {
          dp[0][c] = sc + best;
          bkState[0][c] = bs;
          bkI[0][c] = i - 1;
          bkJ[0][c] = j - 1;
        }
      }

      // --- Mh(i,j) via horizontal monotone stack ---
      // Push M(i, j-1) with sim=Sim(N[i-1], H[j-2]) — this is position p=j-1 in the
      // 1-indexed formula, entering the min window for all existing starts.
      if (j >= 2) {
        const g = dp[0][at(i, j - 1)];
        if (g > NEG_INF) {
          const s = keypointSimilarity(N[i - 1], H[j - 2]);
          let mG = g,
            mArgG = j - 1;
          while (rowTop > 0 && rowV[rowTop - 1] > s) {
            --rowTop;
            if (rowG[rowTop] > mG) {
              mG = rowG[rowTop];
              mArgG = rowArgG[rowTop];
            }
          }
          const bHatB = rowTop > 0 ? rowHatB[rowTop - 1] : NEG_INF;
          const bArgBest = rowTop > 0 ? rowArgBest[rowTop - 1] : -1;
          const gv = mG + s;
          rowV[rowTop] = s;
          rowG[rowTop] = mG;
          rowArgG[rowTop] = mArgG;
          rowHatB[rowTop] = gv > bHatB ? gv : bHatB;
          rowArgBest[rowTop] = gv >= bHatB ? mArgG : bArgBest;
          rowTop++;
        }
      }
      if (rowTop > 0 && rowHatB[rowTop - 1] > NEG_INF) {
        dp[1][c] = rowHatB[rowTop - 1];
        bkState[1][c] = 0; // predecessor always M
        bkI[1][c] = i;
        bkJ[1][c] = rowArgBest[rowTop - 1]; // M-start column (1-indexed)
      }

      // --- Mn(i,j) via column monotone stack ---
      // Push M(i-1, j) with sim=Sim(N[i-2], H[j-1]) — position r=i-1 entering the
      // min window for all existing starts in this column's stack.
      if (j >= 1 && i >= 2) {
        const g = dp[0][at(i - 1, j)];
        if (g > NEG_INF) {
          const s = keypointSimilarity(N[i - 2], H[j - 1]);
          const base = j * maxColH;
          let top = colTop[j];
          let mG = g,
            mArgG = i - 1;
          while (top > 0 && colV[base + top - 1] > s) {
            --top;
            if (colG[base + top] > mG) {
              mG = colG[base + top];
              mArgG = colArgG[base + top];
            }
          }
          const bHatB = top > 0 ? colHatB[base + top - 1] : NEG_INF;
          const bArgBest = top > 0 ? colArgBest[base + top - 1] : -1;
          const gv = mG + s;
          colV[base + top] = s;
          colG[base + top] = mG;
          colArgG[base + top] = mArgG;
          colHatB[base + top] = gv > bHatB ? gv : bHatB;
          colArgBest[base + top] = gv >= bHatB ? mArgG : bArgBest;
          colTop[j] = top + 1;
        }
      }
      if (j >= 1 && colTop[j] > 0) {
        const base = j * maxColH;
        const mnVal = colHatB[base + colTop[j] - 1];
        if (mnVal > NEG_INF) {
          dp[2][c] = mnVal;
          bkState[2][c] = 0; // predecessor always M
          bkI[2][c] = colArgBest[base + colTop[j] - 1]; // M-start row (1-indexed)
          bkJ[2][c] = j;
        }
      }

      // --- X(i,j) — H-gap ---
      if (j >= 1) {
        const p = at(i, j - 1);
        let best = NEG_INF,
          bs = -1,
          v: number;
        if ((v = dp[0][p] - ghopen) > best) {
          best = v;
          bs = 0;
        }
        if ((v = dp[1][p] - ghopen) > best) {
          best = v;
          bs = 1;
        }
        if ((v = dp[2][p] - ghopen) > best) {
          best = v;
          bs = 2;
        }
        if ((v = dp[3][p] - ghext) > best) {
          best = v;
          bs = 3;
        }
        if (best > NEG_INF && best > dp[3][c]) {
          dp[3][c] = best;
          bkState[3][c] = bs;
          bkI[3][c] = i;
          bkJ[3][c] = j - 1;
        }
      }

      // --- Y(i,j) — N-gap ---
      {
        const p = at(i - 1, j);
        let best = NEG_INF,
          bs = -1,
          v: number;
        if ((v = dp[0][p] - gnopen) > best) {
          best = v;
          bs = 0;
        }
        if ((v = dp[1][p] - gnopen) > best) {
          best = v;
          bs = 1;
        }
        if ((v = dp[2][p] - gnopen) > best) {
          best = v;
          bs = 2;
        }
        if ((v = dp[4][p] - gnext) > best) {
          best = v;
          bs = 4;
        }
        if (best > NEG_INF) {
          dp[4][c] = best;
          bkState[4][c] = bs;
          bkI[4][c] = i - 1;
          bkJ[4][c] = j;
        }
      }
    }
  }

  // Final: max over j of max(M, Mh, Mn, Y) at row M_N.
  let bestScore = NEG_INF,
    bestJ = -1,
    bestS = -1;
  const finalLo = band === Infinity ? 0 : Math.max(0, M_H - band);
  const finalHi = M_H;
  for (let j = finalLo; j <= finalHi; j++) {
    let v: number;
    if ((v = dp[0][at(M_N, j)]) > bestScore) {
      bestScore = v;
      bestJ = j;
      bestS = 0;
    }
    if ((v = dp[1][at(M_N, j)]) > bestScore) {
      bestScore = v;
      bestJ = j;
      bestS = 1;
    }
    if ((v = dp[2][at(M_N, j)]) > bestScore) {
      bestScore = v;
      bestJ = j;
      bestS = 2;
    }
    if ((v = dp[4][at(M_N, j)]) > bestScore) {
      bestScore = v;
      bestJ = j;
      bestS = 4;
    }
  }

  // Backtrack.
  // Mh(i,j) with stored M-start m: expand alignment H[m..j-1]→N[i-1], jump to M(i,m).
  // Mn(i,j) with stored M-start m: expand alignment N[m..i-1]→H[j-1], jump to M(m,j).
  const alignment = new Map<number, number[]>();
  let ci = M_N,
    cj = bestJ,
    cs = bestS;
  while (ci > 0 || cj > 0) {
    if (cs === 1) {
      const m = bkJ[1][at(ci, cj)]; // M-start column (1-indexed)
      if (ci > 0 && m >= 0) {
        if (!alignment.has(ci - 1)) alignment.set(ci - 1, []);
        const row = alignment.get(ci - 1)!;
        for (let jp = m; jp < cj; jp++) row.push(jp); // H[m..cj-1] (0-indexed)
      }
      cj = m;
      cs = 0;
      continue;
    }
    if (cs === 2) {
      const m = bkI[2][at(ci, cj)]; // M-start row (1-indexed)
      if (cj > 0 && m >= 0) {
        for (let ip = m; ip < ci; ip++) {
          // N[m..ci-1] (0-indexed) all map to H[cj-1]
          if (!alignment.has(ip)) alignment.set(ip, []);
          alignment.get(ip)!.push(cj - 1);
        }
      }
      ci = m;
      cs = 0;
      continue;
    }
    if (cs === 0 && ci > 0 && cj > 0) {
      if (!alignment.has(ci - 1)) alignment.set(ci - 1, []);
      alignment.get(ci - 1)!.push(cj - 1);
    }
    const pi = bkI[cs][at(ci, cj)];
    const pj = bkJ[cs][at(ci, cj)];
    const ps = bkState[cs][at(ci, cj)];
    if (pi < 0 || pj < 0 || ps < 0) break;
    ci = pi;
    cj = pj;
    cs = ps;
  }

  bestScore = bestScore / M_N;
  return { score: bestScore, alignment };
}

export function matchKeypoints(
  N: Keypoint[],
  H: Keypoint[],
  beamSize: number = 3,
  band: number = Infinity,
): { score: number; alignment: Map<number, number[]> } {
  const n = N.length;

  // Pre-allocate workspace once; reused for every rotation candidate to avoid GC.
  const ws = makeWorkspace(n + 2, H.length + 1);

  // NN.slice(k, k+n+1) = N rotated left by k, with N[k] appended for wrap-around
  const NN = [...N, ...N, N[0]];

  type Result = { score: number; alignment: Map<number, number[]> };
  const cache = new Map<number, Result>();

  function evaluate(k: number): Result {
    if (cache.has(k)) return cache.get(k)!;
    const { score, alignment } = matchKeypointsImpl(
      NN.slice(k, k + n + 1),
      H,
      ws,
      band,
    );
    const remapped = new Map<number, number[]>();
    for (const [ri, hjs] of alignment) {
      const origIdx = (ri + k) % n;
      if (!remapped.has(origIdx)) remapped.set(origIdx, []);
      remapped.get(origIdx)!.push(...hjs);
    }
    const result: Result = { score, alignment: remapped };
    cache.set(k, result);
    return result;
  }

  function topBeam(): number[] {
    return [...cache.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, beamSize)
      .map(([k]) => k);
  }

  // Coarse pass: evenly spaced at ~sqrt(n) intervals
  let step = Math.max(1, Math.floor(Math.sqrt(n)));
  for (let k = 0; k < n; k += step) evaluate(k);

  let beam = topBeam();

  // Refine: halve step, search +-step around beam candidates, repeat until step=1
  while (step > 1) {
    step = Math.max(1, Math.floor(step / 2));
    for (const k of beam) {
      evaluate((((k - step) % n) + n) % n);
      evaluate((k + step) % n);
    }
    beam = topBeam();
  }

  return cache.get(beam[0])!;
}
