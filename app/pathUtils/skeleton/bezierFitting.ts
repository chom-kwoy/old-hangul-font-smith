import { Vec2D } from "@/app/utils/types";

/** Evaluate a point on a cubic Bezier at t ∈ [0, 1]. */
export function evalBezier(
  pA: Vec2D,
  cp1: Vec2D,
  cp2: Vec2D,
  pB: Vec2D,
  t: number,
): Vec2D {
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
  let txA = 0, tyA = 0, txB = 0, tyB = 0;
  const n = rawPath.length;
  if (n >= 2) {
    const MIN_STEP = 5.0;
    const MIN_DIST = Math.min(chord * 0.12, 40.0);

    let startA = 1;
    while (startA < n - 1) {
      const ps = rawPoints[rawPath[startA]];
      const p0 = rawPoints[rawPath[0]];
      if (Math.hypot(ps.x - p0.x, ps.y - p0.y) >= MIN_STEP) break;
      startA++;
    }
    let cumA = 0, kA = startA;
    while (kA < n - 1) {
      const curr = rawPoints[rawPath[kA]];
      const next = rawPoints[rawPath[kA + 1]];
      cumA += Math.hypot(next.x - curr.x, next.y - curr.y);
      kA++;
      if (cumA >= MIN_DIST) break;
    }
    const pStart = rawPoints[rawPath[startA]];
    const p1 = rawPoints[rawPath[kA]];
    const la = Math.hypot(p1.x - pStart.x, p1.y - pStart.y);
    if (la > 1e-6) {
      txA = (p1.x - pStart.x) / la;
      tyA = (p1.y - pStart.y) / la;
    } else {
      const r0 = rawPoints[rawPath[0]], rN1 = rawPoints[rawPath[n - 1]];
      const df = Math.hypot(rN1.x - r0.x, rN1.y - r0.y);
      if (df > 1e-6) { txA = (rN1.x - r0.x) / df; tyA = (rN1.y - r0.y) / df; }
    }

    let cumB = 0, kB = n - 2;
    while (kB > 0) {
      const curr = rawPoints[rawPath[kB]];
      const prev = rawPoints[rawPath[kB - 1]];
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
      const r0 = rawPoints[rawPath[0]], rN1 = rawPoints[rawPath[n - 1]];
      const df = Math.hypot(rN1.x - r0.x, rN1.y - r0.y);
      if (df > 1e-6) { txB = (rN1.x - r0.x) / df; tyB = (rN1.y - r0.y) / df; }
    }
  } else if (chord > 1e-6) {
    txA = (pB.x - pA.x) / chord; tyA = (pB.y - pA.y) / chord;
    txB = txA; tyB = tyA;
  }
  const s = chord / 3;
  return [
    { x: pA.x + txA * s, y: pA.y + tyA * s },
    { x: pB.x - txB * s, y: pB.y - tyB * s },
  ];
}

/**
 * Arc-length least-squares Bezier control point fit over all raw path nodes.
 * Minimises sum of squared distances from raw axis points to the cubic Bezier,
 * with Tikhonov regularisation toward the chord-line prior (normalised by arc length).
 * Falls back to tangentFallbackCPs when the system is ill-conditioned or path too short.
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

  const arcLen = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const prev = rawPoints[rawPath[i - 1]], curr = rawPoints[rawPath[i]];
    arcLen[i] = arcLen[i - 1] + Math.hypot(curr.x - prev.x, curr.y - prev.y);
  }
  const totalLen = arcLen[n - 1];
  if (totalLen < 1e-6) return tangentFallbackCPs(rawPath, rawPoints, pA, pB);

  let sumA2 = 0, sumAB = 0, sumB2 = 0;
  let sumARx = 0, sumBRx = 0, sumARy = 0, sumBRy = 0;
  for (let i = 0; i < n; i++) {
    const t = arcLen[i] / totalLen, u = 1 - t;
    const Ai = 3 * u * u * t, Bi = 3 * u * t * t;
    const pt = rawPoints[rawPath[i]];
    const Rxi = pt.x - u * u * u * pA.x - t * t * t * pB.x;
    const Ryi = pt.y - u * u * u * pA.y - t * t * t * pB.y;
    sumA2 += Ai * Ai; sumAB += Ai * Bi; sumB2 += Bi * Bi;
    sumARx += Ai * Rxi; sumBRx += Bi * Rxi;
    sumARy += Ai * Ryi; sumBRy += Bi * Ryi;
  }

  const lambda = (regularization * (sumA2 + sumB2)) / 2 / totalLen;
  const cp1NatX = pA.x + (pB.x - pA.x) / 3, cp1NatY = pA.y + (pB.y - pA.y) / 3;
  const cp2NatX = pA.x + (2 * (pB.x - pA.x)) / 3, cp2NatY = pA.y + (2 * (pB.y - pA.y)) / 3;
  const rA2 = sumA2 + lambda, rB2 = sumB2 + lambda;
  const rARx = sumARx + lambda * cp1NatX, rARy = sumARy + lambda * cp1NatY;
  const rBRx = sumBRx + lambda * cp2NatX, rBRy = sumBRy + lambda * cp2NatY;

  const det = rA2 * rB2 - sumAB * sumAB;
  if (!(Math.abs(det) >= 1e-10 * rA2 * rB2))
    return tangentFallbackCPs(rawPath, rawPoints, pA, pB);

  return [
    { x: (rARx * rB2 - rBRx * sumAB) / det, y: (rARy * rB2 - rBRy * sumAB) / det },
    { x: (rA2 * rBRx - sumAB * rARx) / det, y: (rA2 * rBRy - sumAB * rARy) / det },
  ];
}

/**
 * Same LSQ system as fitBezierCPs, but takes pre-sampled points and their
 * arc-length fractions directly rather than raw-path node indices.
 * Useful when the samples come from an already-fitted curve (e.g. a composite
 * of existing Beziers) rather than from the raw medial axis.
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
    // Tangent fallback: use departure/arrival directions from the first and last sample gaps
    const chord = Math.hypot(pB.x - pA.x, pB.y - pA.y);
    const s = chord / 3;
    let txA = 0, tyA = 0, txB = 0, tyB = 0;
    if (n >= 2) {
      const dx0 = samples[1].x - samples[0].x, dy0 = samples[1].y - samples[0].y;
      const l0 = Math.hypot(dx0, dy0);
      if (l0 > 1e-6) { txA = dx0 / l0; tyA = dy0 / l0; }
      const dx1 = samples[n - 1].x - samples[n - 2].x, dy1 = samples[n - 1].y - samples[n - 2].y;
      const l1 = Math.hypot(dx1, dy1);
      if (l1 > 1e-6) { txB = dx1 / l1; tyB = dy1 / l1; }
    } else if (chord > 1e-6) {
      txA = (pB.x - pA.x) / chord; tyA = (pB.y - pA.y) / chord;
      txB = txA; tyB = tyA;
    }
    return [
      { x: pA.x + txA * s, y: pA.y + tyA * s },
      { x: pB.x - txB * s, y: pB.y - tyB * s },
    ];
  }

  let sumA2 = 0, sumAB = 0, sumB2 = 0;
  let sumARx = 0, sumBRx = 0, sumARy = 0, sumBRy = 0;
  for (let i = 0; i < n; i++) {
    const t = ts[i], u = 1 - t;
    const Ai = 3 * u * u * t, Bi = 3 * u * t * t;
    const pt = samples[i];
    const Rxi = pt.x - u * u * u * pA.x - t * t * t * pB.x;
    const Ryi = pt.y - u * u * u * pA.y - t * t * t * pB.y;
    sumA2 += Ai * Ai; sumAB += Ai * Bi; sumB2 += Bi * Bi;
    sumARx += Ai * Rxi; sumBRx += Bi * Rxi;
    sumARy += Ai * Ryi; sumBRy += Bi * Ryi;
  }

  // Arc length of the sampled curve (for Tikhonov normalisation)
  let totalLen = 0;
  for (let i = 1; i < n; i++)
    totalLen += Math.hypot(samples[i].x - samples[i-1].x, samples[i].y - samples[i-1].y);

  const lambda = totalLen > 1e-6
    ? (regularization * (sumA2 + sumB2)) / 2 / totalLen
    : 0;
  const cp1NatX = pA.x + (pB.x - pA.x) / 3, cp1NatY = pA.y + (pB.y - pA.y) / 3;
  const cp2NatX = pA.x + (2 * (pB.x - pA.x)) / 3, cp2NatY = pA.y + (2 * (pB.y - pA.y)) / 3;
  const rA2 = sumA2 + lambda, rB2 = sumB2 + lambda;
  const rARx = sumARx + lambda * cp1NatX, rARy = sumARy + lambda * cp1NatY;
  const rBRx = sumBRx + lambda * cp2NatX, rBRy = sumBRy + lambda * cp2NatY;

  const det = rA2 * rB2 - sumAB * sumAB;
  if (!(Math.abs(det) >= 1e-10 * rA2 * rB2)) {
    // Ill-conditioned: fall back to chord-line prior
    return [
      { x: cp1NatX, y: cp1NatY },
      { x: cp2NatX, y: cp2NatY },
    ];
  }
  return [
    { x: (rARx * rB2 - rBRx * sumAB) / det, y: (rARy * rB2 - rBRy * sumAB) / det },
    { x: (rA2 * rBRx - sumAB * rARx) / det, y: (rA2 * rBRy - sumAB * rARy) / det },
  ];
}
