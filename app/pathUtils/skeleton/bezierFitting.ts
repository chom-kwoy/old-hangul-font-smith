import { Vec2D } from "@/app/utils/types";

// Number of alternating re-parameterisation iterations (solve → foot-project → repeat).
const N_REFIT_ITERS = 10;

/**
 * Evaluate a point on a cubic Bezier at t ∈ [0, 1].
 * When either control point is undefined, falls back to linear interpolation
 * between pA and pB — handy when callers may or may not have CPs available.
 */
export function evalBezier(
  pA: Vec2D,
  cp1: Vec2D | undefined,
  cp2: Vec2D | undefined,
  pB: Vec2D,
  t: number,
): Vec2D {
  if (!cp1 || !cp2) {
    return { x: pA.x + t * (pB.x - pA.x), y: pA.y + t * (pB.y - pA.y) };
  }
  const u = 1 - t;
  return {
    x:
      u * u * u * pA.x +
      3 * u * u * t * cp1.x +
      3 * u * t * t * cp2.x +
      t * t * t * pB.x,
    y:
      u * u * u * pA.y +
      3 * u * u * t * cp1.y +
      3 * u * t * t * cp2.y +
      t * t * t * pB.y,
  };
}

/**
 * Tangent (first derivative B'(t)) of a cubic Bezier at t ∈ [0, 1].
 * Falls back to the chord direction (pB − pA) when CPs are undefined (linear).
 * Not normalised — magnitude is the speed; callers normalise as needed.
 */
export function bezierTangent(
  pA: Vec2D,
  cp1: Vec2D | undefined,
  cp2: Vec2D | undefined,
  pB: Vec2D,
  t: number,
): Vec2D {
  if (!cp1 || !cp2) {
    return { x: pB.x - pA.x, y: pB.y - pA.y };
  }
  const u = 1 - t;
  return {
    x:
      3 *
      (u * u * (cp1.x - pA.x) +
        2 * u * t * (cp2.x - cp1.x) +
        t * t * (pB.x - cp2.x)),
    y:
      3 *
      (u * u * (cp1.y - pA.y) +
        2 * u * t * (cp2.y - cp1.y) +
        t * t * (pB.y - cp2.y)),
  };
}

/**
 * Second derivative B''(t) of a cubic Bezier at t ∈ [0, 1].
 * Returns zero when CPs are undefined (linear segment has zero curvature).
 */
export function bezierSecondDerivative(
  pA: Vec2D,
  cp1: Vec2D | undefined,
  cp2: Vec2D | undefined,
  pB: Vec2D,
  t: number,
): Vec2D {
  if (!cp1 || !cp2) return { x: 0, y: 0 };
  const u = 1 - t;
  return {
    x: 6 * (u * (cp2.x - 2 * cp1.x + pA.x) + t * (pB.x - 2 * cp2.x + cp1.x)),
    y: 6 * (u * (cp2.y - 2 * cp1.y + pA.y) + t * (pB.y - 2 * cp2.y + cp1.y)),
  };
}

/**
 * Foot-point parameter t* ∈ [0,1] on the cubic Bezier (pA,cp1,cp2,pB) nearest
 * to q. Coarse-samples for a good seed, then Newton-refines. The seed avoids
 * the Newton local-minimum trap near caps/loops.
 *
 * Optional `seed`: when projecting a continuous sequence of points (e.g. a path),
 * pass the previous point's t* so the refinement stays on the same branch
 * instead of jumping; the coarse search is still run and the closer of the two
 * seeds is used.
 */
export function footParamOnBezier(
  q: Vec2D,
  pA: Vec2D,
  cp1: Vec2D | undefined,
  cp2: Vec2D | undefined,
  pB: Vec2D,
  seed?: number,
  coarseSamples = 24,
): number {
  // Linear bone: exact closed-form projection onto the segment pA→pB.
  if (!cp1 || !cp2) {
    const dx = pB.x - pA.x, dy = pB.y - pA.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) return 0;
    const t = ((q.x - pA.x) * dx + (q.y - pA.y) * dy) / lenSq;
    return Math.max(0, Math.min(1, t));
  }

  // Coarse seed: nearest of `coarseSamples+1` uniform samples (plus the optional
  // provided seed), then a Newton refinement from the better starting point.
  let bestT = 0;
  let bestD = Infinity;
  const consider = (t: number) => {
    const b = evalBezier(pA, cp1, cp2, pB, t);
    const d = (b.x - q.x) ** 2 + (b.y - q.y) ** 2;
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  };
  for (let k = 0; k <= coarseSamples; k++) consider(k / coarseSamples);
  if (seed !== undefined) consider(Math.max(0, Math.min(1, seed)));

  return projectOnBezier(
    q.x, q.y, pA.x, pA.y, cp1.x, cp1.y, cp2.x, cp2.y, pB.x, pB.y, bestT,
  );
}

/**
 * Newton foot-point projection: returns t* ∈ [0,1] on B(t; pA,c1,c2,pB)
 * nearest to (px, py), starting from t0.
 */
function projectOnBezier(
  px: number,
  py: number,
  pAx: number,
  pAy: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  pBx: number,
  pBy: number,
  t0: number,
): number {
  let t = t0;
  for (let k = 0; k < 4; k++) {
    const u = 1 - t;
    // B(t) - p
    const ex =
      u * u * u * pAx +
      3 * u * u * t * c1x +
      3 * u * t * t * c2x +
      t * t * t * pBx -
      px;
    const ey =
      u * u * u * pAy +
      3 * u * u * t * c1y +
      3 * u * t * t * c2y +
      t * t * t * pBy -
      py;
    // B'(t)
    const dx =
      3 * (u * u * (c1x - pAx) + 2 * u * t * (c2x - c1x) + t * t * (pBx - c2x));
    const dy =
      3 * (u * u * (c1y - pAy) + 2 * u * t * (c2y - c1y) + t * t * (pBy - c2y));
    // B''(t)
    const d2x = 6 * (u * (c2x - 2 * c1x + pAx) + t * (pBx - 2 * c2x + c1x));
    const d2y = 6 * (u * (c2y - 2 * c1y + pAy) + t * (pBy - 2 * c2y + c1y));
    // f(t) = B'(t)·(B(t)-p),  f'(t) = |B'(t)|² + B''(t)·(B(t)-p)
    const f = dx * ex + dy * ey;
    const fp = dx * dx + dy * dy + d2x * ex + d2y * ey;
    if (Math.abs(fp) < 1e-10) break;
    t = Math.max(0, Math.min(1, t - f / fp));
  }
  return t;
}

/**
 * Shared alternating re-parameterisation loop for both fitting functions.
 *
 * Iterates N_REFIT_ITERS+1 times: parametric LSQ solve → Newton foot-point
 * re-projection of interior parameters → repeat.  ts[0] and ts[n-1] are kept
 * fixed at 0 and 1.  On an ill-conditioned matrix at the first iteration,
 * returns onFirstIterFail(); on later iterations returns the last valid CPs.
 */
function fitBezierCPsCore(
  n: number,
  getPoint: (i: number) => Vec2D,
  ts: Float64Array,
  pA: Vec2D,
  pB: Vec2D,
  totalLen: number,
  regularization: number,
  onFirstIterFail: () => [Vec2D, Vec2D],
): [Vec2D, Vec2D] {
  const cp1NatX = pA.x + (pB.x - pA.x) / 3,
    cp1NatY = pA.y + (pB.y - pA.y) / 3;
  const cp2NatX = pA.x + (2 * (pB.x - pA.x)) / 3,
    cp2NatY = pA.y + (2 * (pB.y - pA.y)) / 3;
  let cp1x = cp1NatX,
    cp1y = cp1NatY;
  let cp2x = cp2NatX,
    cp2y = cp2NatY;

  for (let iter = 0; iter <= N_REFIT_ITERS; iter++) {
    let sumA2 = 0,
      sumAB = 0,
      sumB2 = 0;
    let sumARx = 0,
      sumBRx = 0,
      sumARy = 0,
      sumBRy = 0;
    for (let i = 0; i < n; i++) {
      const t = ts[i],
        u = 1 - t;
      const Ai = 3 * u * u * t,
        Bi = 3 * u * t * t;
      const pt = getPoint(i);
      const Rxi = pt.x - u * u * u * pA.x - t * t * t * pB.x;
      const Ryi = pt.y - u * u * u * pA.y - t * t * t * pB.y;
      sumA2 += Ai * Ai;
      sumAB += Ai * Bi;
      sumB2 += Bi * Bi;
      sumARx += Ai * Rxi;
      sumBRx += Bi * Rxi;
      sumARy += Ai * Ryi;
      sumBRy += Bi * Ryi;
    }
    const lambda =
      totalLen > 1e-6 ? (regularization * (sumA2 + sumB2)) / 2 / totalLen : 0;
    const rA2 = sumA2 + lambda,
      rB2 = sumB2 + lambda;
    const rARx = sumARx + lambda * cp1NatX,
      rARy = sumARy + lambda * cp1NatY;
    const rBRx = sumBRx + lambda * cp2NatX,
      rBRy = sumBRy + lambda * cp2NatY;
    const det = rA2 * rB2 - sumAB * sumAB;
    if (!(Math.abs(det) >= 1e-10 * rA2 * rB2)) {
      return iter === 0
        ? onFirstIterFail()
        : [
            { x: cp1x, y: cp1y },
            { x: cp2x, y: cp2y },
          ];
    }
    cp1x = (rARx * rB2 - rBRx * sumAB) / det;
    cp1y = (rARy * rB2 - rBRy * sumAB) / det;
    cp2x = (rA2 * rBRx - sumAB * rARx) / det;
    cp2y = (rA2 * rBRy - sumAB * rARy) / det;

    if (iter < N_REFIT_ITERS) {
      for (let i = 1; i < n - 1; i++) {
        const pt = getPoint(i);
        ts[i] = projectOnBezier(
          pt.x,
          pt.y,
          pA.x,
          pA.y,
          cp1x,
          cp1y,
          cp2x,
          cp2y,
          pB.x,
          pB.y,
          ts[i],
        );
      }
    }
  }
  return [
    { x: cp1x, y: cp1y },
    { x: cp2x, y: cp2y },
  ];
}

/**
 * Tangent-based Bezier control point estimation (arc-length look-ahead fallback).
 * Used when the LSQ system is ill-conditioned or the raw path is too short.
 */
export function tangentFallbackCPs(
  rawPath: number[],
  rawPoints: Vec2D[],
  pA: Vec2D,
  pB: Vec2D,
): [Vec2D, Vec2D] {
  const chord = Math.hypot(pB.x - pA.x, pB.y - pA.y);
  let txA = 0,
    tyA = 0,
    txB = 0,
    tyB = 0;
  const n = rawPath.length;
  if (n >= 2) {
    const MIN_STEP = 5.0;
    const MIN_DIST = Math.min(chord * 0.12, 40.0);

    let startA = 1;
    while (startA < n - 1) {
      const ps = rawPoints[rawPath[startA]],
        p0 = rawPoints[rawPath[0]];
      if (Math.hypot(ps.x - p0.x, ps.y - p0.y) >= MIN_STEP) break;
      startA++;
    }
    let cumA = 0,
      kA = startA;
    while (kA < n - 1) {
      const curr = rawPoints[rawPath[kA]],
        next = rawPoints[rawPath[kA + 1]];
      cumA += Math.hypot(next.x - curr.x, next.y - curr.y);
      kA++;
      if (cumA >= MIN_DIST) break;
    }
    const pStart = rawPoints[rawPath[startA]],
      p1 = rawPoints[rawPath[kA]];
    const la = Math.hypot(p1.x - pStart.x, p1.y - pStart.y);
    if (la > 1e-6) {
      txA = (p1.x - pStart.x) / la;
      tyA = (p1.y - pStart.y) / la;
    } else {
      const r0 = rawPoints[rawPath[0]],
        rN1 = rawPoints[rawPath[n - 1]];
      const df = Math.hypot(rN1.x - r0.x, rN1.y - r0.y);
      if (df > 1e-6) {
        txA = (rN1.x - r0.x) / df;
        tyA = (rN1.y - r0.y) / df;
      }
    }

    let cumB = 0,
      kB = n - 2;
    while (kB > 0) {
      const curr = rawPoints[rawPath[kB]],
        prev = rawPoints[rawPath[kB - 1]];
      cumB += Math.hypot(curr.x - prev.x, curr.y - prev.y);
      kB--;
      if (cumB >= MIN_DIST) break;
    }
    const pK = rawPoints[rawPath[kB]];
    const lb = Math.hypot(pB.x - pK.x, pB.y - pK.y);
    if (lb > 1e-6) {
      txB = (pB.x - pK.x) / lb;
      tyB = (pB.y - pK.y) / lb;
    } else {
      const r0 = rawPoints[rawPath[0]],
        rN1 = rawPoints[rawPath[n - 1]];
      const df = Math.hypot(rN1.x - r0.x, rN1.y - r0.y);
      if (df > 1e-6) {
        txB = (rN1.x - r0.x) / df;
        tyB = (rN1.y - r0.y) / df;
      }
    }
  } else if (chord > 1e-6) {
    txA = (pB.x - pA.x) / chord;
    tyA = (pB.y - pA.y) / chord;
    txB = txA;
    tyB = tyA;
  }
  const s = chord / 3;
  return [
    { x: pA.x + txA * s, y: pA.y + tyA * s },
    { x: pB.x - txB * s, y: pB.y - tyB * s },
  ];
}

/**
 * Least-squares Bezier control point fit over all raw medial axis nodes,
 * with alternating re-parameterisation to minimise orthogonal distance.
 * Falls back to tangentFallbackCPs when ill-conditioned or path too short.
 */
export function fitBezierCPs(
  rawPath: number[],
  rawPoints: Vec2D[],
  pA: Vec2D,
  pB: Vec2D,
  regularization: number,
): [Vec2D, Vec2D] {
  const n = rawPath.length;
  if (n < 4) return tangentFallbackCPs(rawPath, rawPoints, pA, pB);

  const ts = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const prev = rawPoints[rawPath[i - 1]],
      curr = rawPoints[rawPath[i]];
    ts[i] = ts[i - 1] + Math.hypot(curr.x - prev.x, curr.y - prev.y);
  }
  const totalLen = ts[n - 1];
  if (totalLen < 1e-6) return tangentFallbackCPs(rawPath, rawPoints, pA, pB);
  for (let i = 1; i < n - 1; i++) ts[i] /= totalLen;
  ts[n - 1] = 1.0;

  return fitBezierCPsCore(
    n,
    (i) => rawPoints[rawPath[i]],
    ts,
    pA,
    pB,
    totalLen,
    regularization,
    () => tangentFallbackCPs(rawPath, rawPoints, pA, pB),
  );
}

/**
 * Same LSQ + alternating re-parameterisation as fitBezierCPs, but takes
 * pre-sampled Vec2D points and their initial arc-length fractions directly.
 * Used when samples come from an already-fitted composite Bezier curve.
 */
export function fitBezierCPsFromSamples(
  samples: Vec2D[],
  ts: Float64Array,
  pA: Vec2D,
  pB: Vec2D,
  regularization: number,
): [Vec2D, Vec2D] {
  const n = samples.length;
  if (n < 4) {
    const chord = Math.hypot(pB.x - pA.x, pB.y - pA.y);
    const s = chord / 3;
    let txA = 0,
      tyA = 0,
      txB = 0,
      tyB = 0;
    if (n >= 2) {
      const dx0 = samples[1].x - samples[0].x,
        dy0 = samples[1].y - samples[0].y;
      const l0 = Math.hypot(dx0, dy0);
      if (l0 > 1e-6) {
        txA = dx0 / l0;
        tyA = dy0 / l0;
      }
      const dx1 = samples[n - 1].x - samples[n - 2].x,
        dy1 = samples[n - 1].y - samples[n - 2].y;
      const l1 = Math.hypot(dx1, dy1);
      if (l1 > 1e-6) {
        txB = dx1 / l1;
        tyB = dy1 / l1;
      }
    } else if (chord > 1e-6) {
      txA = (pB.x - pA.x) / chord;
      tyA = (pB.y - pA.y) / chord;
      txB = txA;
      tyB = tyA;
    }
    return [
      { x: pA.x + txA * s, y: pA.y + tyA * s },
      { x: pB.x - txB * s, y: pB.y - tyB * s },
    ];
  }

  const tsMut = Float64Array.from(ts); // mutable copy; don't modify caller's array
  let totalLen = 0;
  for (let i = 1; i < n; i++)
    totalLen += Math.hypot(
      samples[i].x - samples[i - 1].x,
      samples[i].y - samples[i - 1].y,
    );

  const cp1Nat = { x: pA.x + (pB.x - pA.x) / 3, y: pA.y + (pB.y - pA.y) / 3 };
  const cp2Nat = {
    x: pA.x + (2 * (pB.x - pA.x)) / 3,
    y: pA.y + (2 * (pB.y - pA.y)) / 3,
  };

  return fitBezierCPsCore(
    n,
    (i) => samples[i],
    tsMut,
    pA,
    pB,
    totalLen,
    regularization,
    () => [cp1Nat, cp2Nat],
  );
}
