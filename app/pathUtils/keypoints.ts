import { TSimplePathData } from "fabric";

import { fabricPathDataToPaper } from "@/app/pathUtils/convert";
import { sampleBoundary } from "@/app/pathUtils/flatBoundary";
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

export function extractKeypointDescriptors(path: TSimplePathData): Keypoint[] {
  const { points, origCurveIdx } = sampleBoundary(fabricPathDataToPaper(path), {
    samplesPerCurve: 10,
  });

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

export function matchKeypointsImpl(
  N: Keypoint[],
  H: Keypoint[],
): { score: number; alignment: Map<number, number[]> } {
  // Dynamic time warping with skipping to match keypoints
  // M (i, j):   step (1, 1) into (i, j)  — diagonal match         gains Sim(N[i], H[j])
  // Mₕ(i, j):   step (0, 1) into (i, j)  — H-stretch (free ride)  gains nothing
  // Mₙ(i, j):   step (1, 0) into (i, j)  — N-stretch (free ride)  gains nothing
  // X (i, j):   step (0, 1) into (i, j)  — H-side gap (no correspondence)
  // Y (i, j):   step (1, 0) into (i, j)  — N-side gap (no correspondence)
  // M(i,j) = Sim(Ni,Hj) + max(M(i−1,j−1), Mh(i−1,j−1), Mn(i−1,j−1), X(i−1,j−1), Y(i−1,j−1))
  // Mh(i,j) =              max( M(i,j−1),  Mh(i,j−1) )
  // Mn(i,j) =              max( M(i−1,j),  Mn(i−1,j) )
  // X(i,j) = max( M(i,j−1)−ghopen, Mh(i,j−1)−ghopen, Mn(i,j−1)−ghopen, X(i,j−1)−ghext )
  // Y(i,j) = max( M(i−1,j)−gnopen, Mh(i−1,j)−gnopen, Mn(i−1,j)−gnopen, Y(i−1,j)−gnext )
  // Mh/Mn carry the score forward without adding to it, so the diagonal (all-M) path
  // strictly dominates any L-shaped path on featureless segments.
  // Boundary (semi-global with free start on H, as before)
  // M(0,0)=0, X(0,j)=0 ∀j, all other (0,∗) entries=−∞
  // Final score (free end on H)
  // score = max_j max( M(M_N,j), Mh(M_N,j), Mn(M_N,j), Y(M_N,j) )
  const ghopen = 1.0; // H gap open penalty
  const ghext = 0.0; // H gap extension penalty
  const gnopen = 10.0; // N gap open penalty
  const gnext = 5.0; // N gap extension penalty

  const M_N = N.length;
  const M_H = H.length;
  const NEG_INF = -1e18;
  const W = M_H + 1;

  // States: 0=M, 1=Mh, 2=Mn, 3=X, 4=Y
  const dp = Array.from({ length: 5 }, () =>
    new Float64Array((M_N + 1) * W).fill(NEG_INF),
  );
  const bkState = Array.from({ length: 5 }, () =>
    new Int8Array((M_N + 1) * W).fill(-1),
  );
  const bkI = Array.from({ length: 5 }, () =>
    new Int32Array((M_N + 1) * W).fill(-1),
  );
  const bkJ = Array.from({ length: 5 }, () =>
    new Int32Array((M_N + 1) * W).fill(-1),
  );

  const at = (i: number, j: number) => i * W + j;

  // Boundary: M(0,0)=0, X(0,j)=0 for all j
  dp[0][at(0, 0)] = 0;
  for (let j = 0; j <= M_H; j++) dp[3][at(0, j)] = 0;

  for (let i = 0; i <= M_N; i++) {
    for (let j = 0; j <= M_H; j++) {
      if (i === 0 && j === 0) continue;

      if (i >= 1 && j >= 1) {
        const sc = keypointSimilarity(N[i - 1], H[j - 1]);

        // M(i,j) — diagonal from (i-1, j-1), all 5 predecessors
        {
          let best = NEG_INF,
            bs = -1;
          for (let s = 0; s < 5; s++) {
            const v = dp[s][at(i - 1, j - 1)];
            if (v > best) {
              best = v;
              bs = s;
            }
          }
          if (best > NEG_INF) {
            dp[0][at(i, j)] = sc + best;
            bkState[0][at(i, j)] = bs;
            bkI[0][at(i, j)] = i - 1;
            bkJ[0][at(i, j)] = j - 1;
          }
        }

        // Mh(i,j) — H-step from (i, j-1), predecessors M and Mh; no +sc
        {
          let best = NEG_INF,
            bs = -1;
          for (const s of [0, 1]) {
            const v = dp[s][at(i, j - 1)];
            if (v > best) {
              best = v;
              bs = s;
            }
          }
          if (best > NEG_INF) {
            dp[1][at(i, j)] = best;
            bkState[1][at(i, j)] = bs;
            bkI[1][at(i, j)] = i;
            bkJ[1][at(i, j)] = j - 1;
          }
        }

        // Mn(i,j) — N-step from (i-1, j), predecessors M and Mn; no +sc
        {
          let best = NEG_INF,
            bs = -1;
          for (const s of [0, 2]) {
            const v = dp[s][at(i - 1, j)];
            if (v > best) {
              best = v;
              bs = s;
            }
          }
          if (best > NEG_INF) {
            dp[2][at(i, j)] = best;
            bkState[2][at(i, j)] = bs;
            bkI[2][at(i, j)] = i - 1;
            bkJ[2][at(i, j)] = j;
          }
        }
      }

      // X(i,j) — H-gap step from (i, j-1)
      if (j >= 1) {
        let best = NEG_INF,
          bs = -1;
        const pens: [number, number][] = [
          [0, ghopen],
          [1, ghopen],
          [2, ghopen],
          [3, ghext],
        ];
        for (const [s, pen] of pens) {
          const v = dp[s][at(i, j - 1)] - pen;
          if (v > best) {
            best = v;
            bs = s;
          }
        }
        // don't overwrite the free-start boundary X(0,j)=0
        if (best > NEG_INF && best > dp[3][at(i, j)]) {
          dp[3][at(i, j)] = best;
          bkState[3][at(i, j)] = bs;
          bkI[3][at(i, j)] = i;
          bkJ[3][at(i, j)] = j - 1;
        }
      }

      // Y(i,j) — N-gap step from (i-1, j)
      if (i >= 1) {
        let best = NEG_INF,
          bs = -1;
        const pens: [number, number][] = [
          [0, gnopen],
          [1, gnopen],
          [2, gnopen],
          [4, gnext],
        ];
        for (const [s, pen] of pens) {
          const v = dp[s][at(i - 1, j)] - pen;
          if (v > best) {
            best = v;
            bs = s;
          }
        }
        if (best > NEG_INF) {
          dp[4][at(i, j)] = best;
          bkState[4][at(i, j)] = bs;
          bkI[4][at(i, j)] = i - 1;
          bkJ[4][at(i, j)] = j;
        }
      }
    }
  }

  // Final: max over j of max(M, Mh, Mn, Y) at row M_N
  let bestScore = NEG_INF,
    bestJ = -1,
    bestS = -1;
  for (let j = 0; j <= M_H; j++) {
    for (const s of [0, 1, 2, 4]) {
      const v = dp[s][at(M_N, j)];
      if (v > bestScore) {
        bestScore = v;
        bestJ = j;
        bestS = s;
      }
    }
  }

  // Backtrack to build alignment (N-index → H-index[])
  const alignment = new Map<number, number[]>();
  let ci = M_N,
    cj = bestJ,
    cs = bestS;
  while (ci > 0 || cj > 0) {
    // Match states record a correspondence for the current cell
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

  // normalize score by the max number of possible matches
  bestScore = bestScore / Math.max(M_H, M_N);
  return { score: bestScore, alignment };
}

export function matchKeypoints(
  N: Keypoint[],
  H: Keypoint[],
  rotateSteps: number = 10,
): { score: number; alignment: Map<number, number[]> } {
  let bestScore = -Infinity;
  let bestAlignment = new Map<number, number[]>();

  const rotated = [...N];

  for (let k = 0; k < N.length; k += rotateSteps) {
    const augmented = [...rotated, rotated[0]];
    const { score, alignment } = matchKeypointsImpl(augmented, H);

    if (score > bestScore) {
      bestScore = score;
      bestAlignment = new Map();
      for (const [ri, hjs] of alignment) {
        const origIdx = (ri + k) % N.length;
        if (!bestAlignment.has(origIdx)) bestAlignment.set(origIdx, []);
        bestAlignment.get(origIdx)!.push(...hjs);
      }
    }

    // rotate left by rotateSteps for the next iteration
    for (let r = 0; r < rotateSteps; r++) {
      rotated.push(rotated.shift()!);
    }
  }

  return { score: bestScore, alignment: bestAlignment };
}
