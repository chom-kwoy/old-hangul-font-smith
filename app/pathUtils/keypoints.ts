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
const CURVATURE_SCALES = [1, 5, 20];

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
type Workspace = {
  dp: Float64Array[];
  bkState: Int32Array[];
  bkI: Int32Array[];
  bkJ: Int32Array[];
};

function makeWorkspace(size: number): Workspace {
  return {
    dp: Array.from({ length: 5 }, () => new Float64Array(size)),
    bkState: Array.from({ length: 5 }, () => new Int32Array(size)),
    bkI: Array.from({ length: 5 }, () => new Int32Array(size)),
    bkJ: Array.from({ length: 5 }, () => new Int32Array(size)),
  };
}

export function matchKeypointsImpl(
  N: Keypoint[],
  H: Keypoint[],
  ws?: Workspace,
  // Sakoe-Chiba half-band: only fill cells where |i - j| <= band.
  // Infinity = full DP. After correct rotation the path stays near the diagonal,
  // so a band of ~n/3 captures practical deformations while reducing work ~3x.
  band: number = Infinity,
): { score: number; alignment: Map<number, number[]> } {
  // States: 0=M, 1=Mh, 2=Mn, 3=X, 4=Y
  // M(i,j) = Sim(Ni,Hj) + max(M(i-1,j-1), Mh(i-1,j-1), Mn(i-1,j-1), X(i-1,j-1), Y(i-1,j-1))
  // Mh(i,j) =              max( M(i,j-1),  Mh(i,j-1) )          [free ride, no +Sim]
  // Mn(i,j) =              max( M(i-1,j),  Mn(i-1,j) )          [free ride, no +Sim]
  // X(i,j) = max( M(i,j-1)-ghopen, Mh(i,j-1)-ghopen, Mn(i,j-1)-ghopen, X(i,j-1)-ghext )
  // Y(i,j) = max( M(i-1,j)-gnopen, Mh(i-1,j)-gnopen, Mn(i-1,j)-gnopen, Y(i-1,j)-gnext )
  // Boundary: M(0,0)=0, X(0,j)=0 for j in [0,band], all other (0,*) = -inf
  // Final: max_j max( M(M_N,j), Mh(M_N,j), Mn(M_N,j), Y(M_N,j) )
  const ghopen = 1.0;
  const ghext = 0.0;
  const gnopen = 10.0;
  const gnext = 5.0;

  const M_N = N.length;
  const M_H = H.length;
  const NEG_INF = -1e18;
  const W = M_H + 1;
  const size = (M_N + 1) * W;

  let dp: Float64Array[];
  let bkState: Int32Array[];
  let bkI: Int32Array[];
  let bkJ: Int32Array[];

  if (ws && ws.dp[0].length >= size) {
    ({ dp, bkState, bkI, bkJ } = ws);
    for (let s = 0; s < 5; s++) {
      dp[s].fill(NEG_INF, 0, size);
      bkState[s].fill(-1, 0, size);
      bkI[s].fill(-1, 0, size);
      bkJ[s].fill(-1, 0, size);
    }
  } else {
    dp = Array.from({ length: 5 }, () => new Float64Array(size).fill(NEG_INF));
    bkState = Array.from({ length: 5 }, () => new Int32Array(size).fill(-1));
    bkI = Array.from({ length: 5 }, () => new Int32Array(size).fill(-1));
    bkJ = Array.from({ length: 5 }, () => new Int32Array(size).fill(-1));
  }

  const at = (i: number, j: number) => i * W + j;

  // Boundary: M(0,0)=0, X(0,j)=0 for j in [0, min(M_H, band)]
  dp[0][at(0, 0)] = 0;
  const initJMax = band === Infinity ? M_H : Math.min(M_H, band);
  for (let j = 0; j <= initJMax; j++) dp[3][at(0, j)] = 0;

  for (let i = 0; i <= M_N; i++) {
    const jExp = M_N > 0 ? Math.round((i * M_H) / M_N) : 0;
    const jLo = band === Infinity ? 0 : Math.max(0, jExp - band);
    const jHi = band === Infinity ? M_H : Math.min(M_H, jExp + band);

    for (let j = jLo; j <= jHi; j++) {
      if (i === 0 && j === 0) continue;

      if (i >= 1 && j >= 1) {
        const sc = keypointSimilarity(N[i - 1], H[j - 1]);
        let v: number;

        // M(i,j) — diagonal, all 5 predecessors
        {
          const p = at(i - 1, j - 1);
          let best = NEG_INF,
            bs = -1;
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
            const c = at(i, j);
            dp[0][c] = sc + best;
            bkState[0][c] = bs;
            bkI[0][c] = i - 1;
            bkJ[0][c] = j - 1;
          }
        }

        // Mh(i,j) — H-step, free ride, predecessors M and Mh
        {
          const p = at(i, j - 1);
          let best = NEG_INF,
            bs = -1;
          if ((v = dp[0][p]) > best) {
            best = v;
            bs = 0;
          }
          if ((v = dp[1][p]) > best) {
            best = v;
            bs = 1;
          }
          if (best > NEG_INF) {
            const c = at(i, j);
            dp[1][c] = best;
            bkState[1][c] = bs;
            bkI[1][c] = i;
            bkJ[1][c] = j - 1;
          }
        }

        // Mn(i,j) — N-step, free ride, predecessors M and Mn
        {
          const p = at(i - 1, j);
          let best = NEG_INF,
            bs = -1;
          if ((v = dp[0][p]) > best) {
            best = v;
            bs = 0;
          }
          if ((v = dp[2][p]) > best) {
            best = v;
            bs = 2;
          }
          if (best > NEG_INF) {
            const c = at(i, j);
            dp[2][c] = best;
            bkState[2][c] = bs;
            bkI[2][c] = i - 1;
            bkJ[2][c] = j;
          }
        }
      }

      // X(i,j) — H-gap
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
        const c = at(i, j);
        if (best > NEG_INF && best > dp[3][c]) {
          dp[3][c] = best;
          bkState[3][c] = bs;
          bkI[3][c] = i;
          bkJ[3][c] = j - 1;
        }
      }

      // Y(i,j) — N-gap
      if (i >= 1) {
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
          const c = at(i, j);
          dp[4][c] = best;
          bkState[4][c] = bs;
          bkI[4][c] = i - 1;
          bkJ[4][c] = j;
        }
      }
    }
  }

  // Final: max over j of max(M, Mh, Mn, Y) at row M_N
  let bestScore = NEG_INF,
    bestJ = -1,
    bestS = -1;
  // j_exp(M_N) = round(M_N * M_H / M_N) = M_H, so the final range is always [M_H-band, M_H]
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

  // Backtrack
  const alignment = new Map<number, number[]>();
  let ci = M_N,
    cj = bestJ,
    cs = bestS;
  while (ci > 0 || cj > 0) {
    if ((cs === 0 || cs === 1 || cs === 2) && ci > 0 && cj > 0) {
      const ni = ci - 1,
        hj = cj - 1;
      if (!alignment.has(ni)) alignment.set(ni, []);
      alignment.get(ni)!.push(hj);
    }
    const pi = bkI[cs][at(ci, cj)];
    const pj = bkJ[cs][at(ci, cj)];
    const ps = bkState[cs][at(ci, cj)];
    if (pi < 0 || pj < 0 || ps < 0) break;
    ci = pi;
    cj = pj;
    cs = ps;
  }

  bestScore = bestScore / Math.max(M_H, M_N);
  return { score: bestScore, alignment };
}

export function matchKeypoints(
  N: Keypoint[],
  H: Keypoint[],
  beamSize: number = 3,
  band?: number,
): { score: number; alignment: Map<number, number[]> } {
  const n = N.length;
  const effectiveBand = band ?? Math.ceil(Math.max(n, H.length) / 3);

  // Pre-allocate workspace once; reused for every rotation candidate to avoid GC.
  const ws = makeWorkspace((n + 2) * (H.length + 1));

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
      effectiveBand,
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
