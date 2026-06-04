import paper from "paper";

import {
  bezierSecondDerivative,
  bezierTangent,
  evalBezier,
  footParamOnBezier,
} from "@/app/pathUtils/skeleton/bezierFitting";
import {
  BoundaryTag,
  FittedMedialAxisGraph,
  Primitive,
} from "@/app/pathUtils/skeleton/localPrimitiveFitting";
import { MedialAxisGraph } from "@/app/pathUtils/skeleton/medialAxis";
import { Vec2D } from "@/app/utils/types";

/**
 * Stateless skeletal-warp deformation of a fitted glyph.
 *
 * Given the original skeleton + capsules (a FittedMedialAxisGraph from
 * skeletonize) and an edited skeleton S' (same topology, moved anchors/control
 * points), produce a deformed bezier outline. Each capsule's bezier boundary is
 * re-expressed in its owning edge's moving frame:
 *
 *   - an anchor Q gets foot parameter T on the edge's bone and local-frame
 *     coords (a along the tangent τ, b along the normal ν); it re-places to
 *     o'(T) + a·τ'(T) + b·ν'(T) on the deformed bone (distance preserved, offset
 *     follows the edge normal — interior feet have a≈0);
 *   - handles are stored polar (length + angle relative to τ) and rotate with
 *     the deformed tangent;
 *   - vertices shared between neighbouring capsules (from boundaryTags) are
 *     placed at the average of every sharing edge's warp, so the shared boundary
 *     stays coincident — no gap, no overlap.
 *
 * Identity (S' = S) reproduces the original outline exactly.
 */

/** Edited skeleton: same `segments` as the fitted graph; new geometry. */
export type DeformedSkeleton = Pick<
  MedialAxisGraph,
  "points" | "controlPoints"
>;

// --- Rig encodings --------------------------------------------------------

type AnchorMember = { edge: number; t: number; a: number; b: number };

type PointEnc =
  | { kind: "single"; m: AnchorMember }
  | { kind: "shared"; members: AnchorMember[]; jointIdx: number | null };

// Polar handle relative to the owning edge's tangent at the anchor's foot.
// null when the handle is zero (straight segment).
type HandleEnc = { edge: number; t: number; dist: number; angle: number } | null;

/**
 * A weighted reference to a shared vertex's correction δ (see `RigPrimitive.
 * sharedVerts`). The corrected warp of any boundary point is
 * `W_own(q) + Σ blend.w · δ[blend.v]`, blending the shared snap smoothly into
 * the surrounding non-shared boundary so it no longer jumps at shared vertices.
 */
type BlendRef = { v: number; w: number };

type SegEnc = {
  point: PointEnc;
  handleIn: HandleEnc;
  handleOut: HandleEnc;
  blend: BlendRef[]; // shared-correction weights at this anchor
};

/**
 * A point sampled along an original (non-shared) boundary curve, with every
 * quantity that depends only on S precomputed. At apply time only the S' bone
 * frame is evaluated to obtain the warped point and the analytic curve velocity
 * (see `warpVelocity`).
 */
type CurveSample = {
  edge: number; // owning edge (its bone defines the frame)
  t: number; // foot parameter on bone S
  a: number; // tangential offset in S's frame (≈0 for interior feet)
  b: number; // signed normal offset in S's frame
  vt: number; // original curve velocity · τ_S  (tangential component)
  vn: number; // original curve velocity · ν_S  (normal component)
  sigmaS: number; // |B'_S(t)|  (bone speed)
  kappaS: number; // signed curvature of bone S at t
  interior: boolean; // foot strictly interior ⇒ iso-offset stretch; else ρ→1
  arc: number; // cumulative arc length from the curve's start anchor (original)
  blend: BlendRef[]; // shared-correction weights at this sample
};

type RigPrimitive = {
  /** Reference to the original primitive (carries type/elementIdx/boundaryTags). */
  prim: Primitive;
  /**
   * Per-ring, per-segment encodings for edge primitives (a paper.Path is one
   * ring; a CompoundPath has several). Empty for point/disk primitives, which
   * are deformed by a rigid translation of their stored path.
   */
  rings: SegEnc[][];
  closed: boolean[];
  /**
   * Per-ring, per-curve sampled warp data for accurate reconstruction. Indexed
   * [ring][curve] where curve `ci` runs segment `ci`→`ci+1`. `null` for shared
   * (straight bisector) curves — those stay the straight segment between the two
   * shared anchors so neighbouring capsules remain coincident.
   */
  curveSamples: (CurveSample[] | null)[][];
  /**
   * Shared vertices of this capsule (the endpoints of its shared bisector
   * segments), in `BlendRef.v` index order. At apply time each yields a
   * correction δ = W_avg − W_own; see `BlendRef`.
   */
  sharedVerts: Extract<PointEnc, { kind: "shared" }>[];
};

// Accurate-warp tuning (1000-unit em space).
const WARP_K = 16; // samples per non-shared curve (K+1 points)
const WARP_TOL = 1.0; // max curve deviation before subdividing (em units)
const WARP_MAX_DEPTH = 6; // recursion cap (≤ 2^depth cubics per original curve)
const WARP_BLEND_L = 150; // arc-length support over which a shared correction decays

export type DeformRig = {
  segments: [number, number][];
  points: Vec2D[];
  controlPoints?: [Vec2D, Vec2D][];
  primitives: RigPrimitive[];
};

// --- Bone frame helpers ---------------------------------------------------

type Frame = { o: Vec2D; tau: Vec2D; nu: Vec2D };

function boneOf(
  graph: DeformedSkeleton,
  segments: [number, number][],
  edge: number,
): { pA: Vec2D; cp1?: Vec2D; cp2?: Vec2D; pB: Vec2D } {
  const [u, v] = segments[edge];
  const cp = graph.controlPoints?.[edge];
  return { pA: graph.points[u], cp1: cp?.[0], cp2: cp?.[1], pB: graph.points[v] };
}

function frameAt(
  graph: DeformedSkeleton,
  segments: [number, number][],
  edge: number,
  t: number,
): Frame {
  const { pA, cp1, cp2, pB } = boneOf(graph, segments, edge);
  const o = evalBezier(pA, cp1, cp2, pB, t);
  const tg = bezierTangent(pA, cp1, cp2, pB, t);
  let len = Math.hypot(tg.x, tg.y);
  if (len < 1e-9) len = 1;
  const tau = { x: tg.x / len, y: tg.y / len };
  const nu = { x: -tau.y, y: tau.x };
  return { o, tau, nu };
}

type FullFrame = Frame & { sigma: number; kappa: number };

/** Frame plus bone speed σ=|B'| and signed curvature κ=(B'×B'')/σ³ at t. */
function boneFrameFull(
  graph: DeformedSkeleton,
  segments: [number, number][],
  edge: number,
  t: number,
): FullFrame {
  const { pA, cp1, cp2, pB } = boneOf(graph, segments, edge);
  const o = evalBezier(pA, cp1, cp2, pB, t);
  const d1 = bezierTangent(pA, cp1, cp2, pB, t);
  const d2 = bezierSecondDerivative(pA, cp1, cp2, pB, t);
  let sigma = Math.hypot(d1.x, d1.y);
  if (sigma < 1e-9) sigma = 1e-9;
  const tau = { x: d1.x / sigma, y: d1.y / sigma };
  const nu = { x: -tau.y, y: tau.x };
  const kappa = (d1.x * d2.y - d1.y * d2.x) / (sigma * sigma * sigma);
  return { o, tau, nu, sigma, kappa };
}

// --- buildDeformRig -------------------------------------------------------

/** 1e-6-grid coordinate key, matching voronoiClip's shared-vertex tolerance. */
function coordKey(x: number, y: number): string {
  return `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
}

function ringsOf(path: paper.PathItem): paper.Path[] {
  if (path instanceof paper.CompoundPath) return path.children as paper.Path[];
  return [path as paper.Path];
}

/** Clamped smoothstep on [0,1]. */
function smooth01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/**
 * Fill `blend` on every anchor (`segEncs`) and every curve sample so the shared
 * correction decays smoothly into the surrounding non-shared boundary instead of
 * snapping only at the shared vertex. The boundary is split into maximal runs of
 * consecutive non-shared curves (shared bisector segments act as barriers); each
 * run blends the corrections of its two bounding shared vertices by arc-length,
 * over a support `Leff = min(WARP_BLEND_L, runLen/2)`. The half-run cap makes the
 * weight of the far vertex exactly 0 at each shared vertex, so a shared anchor
 * still lands exactly on its averaged position (coincidence preserved).
 */
function assignBlendWeights(
  segEncs: SegEnc[],
  csRing: (CurveSample[] | null)[],
  sharedId: number[],
  closed: boolean,
): void {
  const n = segEncs.length;
  const nc = closed ? n : n - 1;
  const isShared = (ci: number) => csRing[ci] === null;
  const curveLen = (ci: number) => {
    const s = csRing[ci]!;
    return s[s.length - 1].arc;
  };

  let startShared = -1;
  for (let ci = 0; ci < nc; ci++)
    if (isShared(ci)) {
      startShared = ci;
      break;
    }
  if (startShared < 0) return; // no shared boundary on this ring → no correction

  let ci = (startShared + 1) % nc;
  let visited = 0;
  while (visited < nc) {
    if (isShared(ci)) {
      ci = (ci + 1) % nc;
      visited++;
      continue;
    }
    const runCurves: number[] = [];
    while (visited < nc && !isShared(ci)) {
      runCurves.push(ci);
      ci = (ci + 1) % nc;
      visited++;
    }
    const startAnchor = runCurves[0];
    const endAnchor = (runCurves[runCurves.length - 1] + 1) % n;
    const vS = sharedId[startAnchor];
    const vE = sharedId[endAnchor];
    let runLen = 0;
    for (const c of runCurves) runLen += curveLen(c);
    const Leff = Math.min(WARP_BLEND_L, runLen / 2);
    const weightAt = (d: number): BlendRef[] => {
      if (Leff <= 1e-9) return vS >= 0 ? [{ v: vS, w: 1 }] : [];
      const out: BlendRef[] = [];
      const wS = vS >= 0 ? smooth01(1 - d / Leff) : 0;
      const wE = vE >= 0 ? smooth01(1 - (runLen - d) / Leff) : 0;
      if (wS > 1e-6) out.push({ v: vS, w: wS });
      if (wE > 1e-6) out.push({ v: vE, w: wE });
      return out;
    };

    segEncs[startAnchor].blend = weightAt(0);
    let acc = 0;
    for (const c of runCurves) {
      const samples = csRing[c]!;
      for (const s of samples) s.blend = weightAt(acc + s.arc);
      acc += curveLen(c);
      segEncs[(c + 1) % n].blend = weightAt(acc);
    }
  }

  // Shared vertices flanked by shared curves on both sides aren't part of any
  // run; they still correct themselves fully.
  for (let i = 0; i < n; i++) {
    if (sharedId[i] >= 0 && segEncs[i].blend.length === 0) {
      segEncs[i].blend = [{ v: sharedId[i], w: 1 }];
    }
  }
}

/**
 * Precompute the deformation rig from the original fitted glyph. Depends only on
 * the original skeleton (embedded in `fitted`) and the original capsules.
 */
export function buildDeformRig(fitted: FittedMedialAxisGraph): DeformRig {
  const segments = fitted.segments;
  const S: DeformedSkeleton = {
    points: fitted.points,
    controlPoints: fitted.controlPoints,
  };

  // Shared-vertex map: snapped anchor coord → set of primitive indices whose
  // clippedPath has a shared-tagged curve ending there.
  const sharedAt = new Map<string, Set<number>>();
  for (let pi = 0; pi < fitted.primitives.length; pi++) {
    const prim = fitted.primitives[pi];
    if (!prim.clippedPath || !prim.boundaryTags) continue;
    for (const ring of ringsOf(prim.clippedPath)) {
      const segs = ring.segments;
      const n = segs.length;
      for (let ci = 0; ci < n; ci++) {
        const tag = prim.boundaryTags[ci];
        if (!tag || tag.kind !== "shared") continue;
        // Curve ci runs segment ci → (ci+1)%n; both endpoints are shared.
        for (const si of [ci, (ci + 1) % n]) {
          const p = segs[si].point;
          const key = coordKey(p.x, p.y);
          let set = sharedAt.get(key);
          if (!set) {
            set = new Set();
            sharedAt.set(key, set);
          }
          set.add(pi);
        }
      }
    }
  }

  const encodeAnchor = (q: Vec2D, edge: number, seed?: number): AnchorMember => {
    const { pA, cp1, cp2, pB } = boneOf(S, segments, edge);
    const t = footParamOnBezier(q, pA, cp1, cp2, pB, seed);
    const f = frameAt(S, segments, edge, t);
    const wx = q.x - f.o.x, wy = q.y - f.o.y;
    return {
      edge,
      t,
      a: wx * f.tau.x + wy * f.tau.y,
      b: wx * f.nu.x + wy * f.nu.y,
    };
  };

  const encodeHandle = (
    handle: paper.Point,
    edge: number,
    t: number,
  ): HandleEnc => {
    const dist = Math.hypot(handle.x, handle.y);
    if (dist < 1e-9) return null;
    const f = frameAt(S, segments, edge, t);
    const dot = f.tau.x * handle.x + f.tau.y * handle.y;
    const cross = f.tau.x * handle.y - f.tau.y * handle.x;
    return { edge, t, dist, angle: Math.atan2(cross, dot) };
  };

  // Sample one non-shared curve (segments ci → ci+1) and precompute the
  // S-dependent warp data for each sample. `march` seeds footParam on-branch.
  const sampleCurve = (
    sA: paper.Segment,
    sB: paper.Segment,
    ownEdge: number,
    bone: { pA: Vec2D; cp1?: Vec2D; cp2?: Vec2D; pB: Vec2D },
    march: { t: number | undefined },
  ): CurveSample[] => {
    const oP0 = { x: sA.point.x, y: sA.point.y };
    const oCP1 = { x: sA.point.x + sA.handleOut.x, y: sA.point.y + sA.handleOut.y };
    const oCP2 = { x: sB.point.x + sB.handleIn.x, y: sB.point.y + sB.handleIn.y };
    const oP3 = { x: sB.point.x, y: sB.point.y };
    const arr: CurveSample[] = [];
    let arc = 0;
    let prev: Vec2D | null = null;
    for (let k = 0; k <= WARP_K; k++) {
      const s = k / WARP_K;
      const p = evalBezier(oP0, oCP1, oCP2, oP3, s);
      if (prev) arc += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      const pv = bezierTangent(oP0, oCP1, oCP2, oP3, s); // original curve velocity
      const t = footParamOnBezier(p, bone.pA, bone.cp1, bone.cp2, bone.pB, march.t);
      march.t = t;
      const f = boneFrameFull(S, segments, ownEdge, t);
      const wx = p.x - f.o.x, wy = p.y - f.o.y;
      arr.push({
        edge: ownEdge,
        t,
        a: wx * f.tau.x + wy * f.tau.y,
        b: wx * f.nu.x + wy * f.nu.y,
        vt: pv.x * f.tau.x + pv.y * f.tau.y,
        vn: pv.x * f.nu.x + pv.y * f.nu.y,
        sigmaS: f.sigma,
        kappaS: f.kappa,
        interior: t > 1e-6 && t < 1 - 1e-6,
        arc,
        blend: [],
      });
    }
    return arr;
  };

  const rigPrims: RigPrimitive[] = fitted.primitives.map((prim) => {
    if (prim.type !== "edge" || !prim.clippedPath) {
      return { prim, rings: [], closed: [], curveSamples: [], sharedVerts: [] };
    }
    const ownEdge = prim.elementIdx;
    const bone = boneOf(S, segments, ownEdge);
    const rings: SegEnc[][] = [];
    const closed: boolean[] = [];
    const curveSamples: (CurveSample[] | null)[][] = [];
    const sharedVerts: Extract<PointEnc, { kind: "shared" }>[] = [];
    for (const ring of ringsOf(prim.clippedPath)) {
      const segEncs: SegEnc[] = [];
      const sharedId: number[] = []; // per anchor: shared-vertex id, else -1
      let prevT = 0;
      for (const seg of ring.segments) {
        const q = seg.point;
        const own = encodeAnchor(q, ownEdge, prevT);
        prevT = own.t;

        const key = coordKey(q.x, q.y);
        const sharers = sharedAt.get(key);
        let point: PointEnc;
        let sid = -1;
        if (sharers && sharers.size >= 2) {
          const members: AnchorMember[] = [];
          const edges: number[] = [];
          for (const spi of sharers) {
            const e = fitted.primitives[spi].elementIdx;
            edges.push(e);
            members.push(e === ownEdge ? own : encodeAnchor(q, e));
          }
          // The shared bone joint = skeleton vertex common to all member edges.
          let candidates = new Set(segments[edges[0]]);
          for (let i = 1; i < edges.length; i++) {
            const ends = new Set(segments[edges[i]]);
            candidates = new Set([...candidates].filter((v) => ends.has(v)));
          }
          let jointIdx: number | null = null;
          let best = Infinity;
          for (const idx of candidates) {
            const p = fitted.points[idx];
            const d2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
            if (d2 < best) {
              best = d2;
              jointIdx = idx;
            }
          }
          const sharedPoint = { kind: "shared" as const, members, jointIdx };
          point = sharedPoint;
          sid = sharedVerts.length;
          sharedVerts.push(sharedPoint);
        } else {
          point = { kind: "single", m: own };
        }
        sharedId.push(sid);

        segEncs.push({
          point,
          handleIn: encodeHandle(seg.handleIn, ownEdge, own.t),
          handleOut: encodeHandle(seg.handleOut, ownEdge, own.t),
          blend: [],
        });
      }
      // Per-curve warp samples for accurate reconstruction. Shared (straight
      // bisector) curves stay straight ⇒ null; non-shared curves are sampled.
      const segs = ring.segments;
      const nc = ring.closed ? segs.length : segs.length - 1;
      const csRing: (CurveSample[] | null)[] = [];
      const march = { t: undefined as number | undefined };
      for (let ci = 0; ci < nc; ci++) {
        if (prim.boundaryTags?.[ci]?.kind === "shared") {
          csRing.push(null);
          march.t = undefined; // restart marching after a straight gap
          continue;
        }
        csRing.push(
          sampleCurve(segs[ci], segs[(ci + 1) % segs.length], ownEdge, bone, march),
        );
      }

      assignBlendWeights(segEncs, csRing, sharedId, ring.closed);

      rings.push(segEncs);
      closed.push(ring.closed);
      curveSamples.push(csRing);
    }
    return { prim, rings, closed, curveSamples, sharedVerts };
  });

  return {
    segments,
    points: fitted.points,
    controlPoints: fitted.controlPoints,
    primitives: rigPrims,
  };
}

// --- applyDeform ----------------------------------------------------------

function warpAnchor(
  m: AnchorMember,
  sPrime: DeformedSkeleton,
  segments: [number, number][],
): Vec2D {
  const f = frameAt(sPrime, segments, m.edge, m.t);
  return {
    x: f.o.x + m.a * f.tau.x + m.b * f.nu.x,
    y: f.o.y + m.a * f.tau.y + m.b * f.nu.y,
  };
}

/** An outline anchor paired with its foot point on the owning bone. */
export type BoneLink = { anchor: Vec2D; bone: Vec2D };

/**
 * For every non-shared clippedPath anchor, returns the anchor position and its
 * corresponding foot point on the owning edge's bone, evaluated under `sPrime`
 * (default: the original skeleton). Shared anchors are excluded — they have no
 * single owning bone. Useful for visualising the anchor→bone correspondence.
 */
export function boneLinks(
  rig: DeformRig,
  sPrime?: DeformedSkeleton,
): BoneLink[] {
  const sk: DeformedSkeleton =
    sPrime ?? { points: rig.points, controlPoints: rig.controlPoints };
  const links: BoneLink[] = [];
  for (const rp of rig.primitives) {
    for (const ring of rp.rings) {
      for (const se of ring) {
        if (se.point.kind !== "single") continue; // shared anchors have no single bone
        const m = se.point.m;
        const f = frameAt(sk, rig.segments, m.edge, m.t);
        links.push({
          anchor: {
            x: f.o.x + m.a * f.tau.x + m.b * f.nu.x,
            y: f.o.y + m.a * f.tau.y + m.b * f.nu.y,
          },
          bone: { x: f.o.x, y: f.o.y },
        });
      }
    }
  }
  return links;
}

function warpPoint(
  enc: PointEnc,
  sPrime: DeformedSkeleton,
  segments: [number, number][],
): Vec2D {
  if (enc.kind === "single") return warpAnchor(enc.m, sPrime, segments);
  // Shared: warp via every sharing edge, then re-expand to the average
  // joint-distance so sharp corners keep their stroke width. The plain position
  // average pulls inward when the bones' tangents diverge; rescaling its
  // distance to the shared joint to the mean member radius restores the width.
  // Identical on both sides (same members + joint) ⇒ boundary stays coincident,
  // and a no-op at S'=S (every P_m = Q) ⇒ identity preserved exactly.
  const Ps = enc.members.map((m) => warpAnchor(m, sPrime, segments));
  const k = Ps.length;
  let qx = 0, qy = 0;
  for (const p of Ps) {
    qx += p.x;
    qy += p.y;
  }
  const Q = { x: qx / k, y: qy / k };
  if (enc.jointIdx == null) return Q; // no common joint → plain average
  const J = sPrime.points[enc.jointIdx];
  let R = 0;
  for (const p of Ps) R += Math.hypot(p.x - J.x, p.y - J.y);
  R /= k;
  const dx = Q.x - J.x, dy = Q.y - J.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Q; // anchor sits on the joint
  return { x: J.x + (R * dx) / len, y: J.y + (R * dy) / len };
}

function warpHandle(
  enc: HandleEnc,
  sPrime: DeformedSkeleton,
  segments: [number, number][],
): Vec2D {
  if (!enc) return { x: 0, y: 0 };
  const f = frameAt(sPrime, segments, enc.edge, enc.t);
  const c = Math.cos(enc.angle), s = Math.sin(enc.angle);
  // rotate τ' by `angle`, scale by `dist`.
  const rx = f.tau.x * c - f.tau.y * s;
  const ry = f.tau.x * s + f.tau.y * c;
  return { x: enc.dist * rx, y: enc.dist * ry };
}

/**
 * Analytic velocity dC/ds of the warped curve `C(s)=W(p(s))` at a sample, in S'.
 * The original velocity's tangential part scales by the iso-offset stretch ratio
 * ρ = σ'(1−bκ') / (σ(1−bκ)) and rides τ'; the normal part rides ν' rigidly.
 * Clamped (cap) feet have a locally constant frame ⇒ ρ=1 (frame rotation only).
 */
function warpVelocity(
  cs: CurveSample,
  sPrime: DeformedSkeleton,
  segments: [number, number][],
): Vec2D {
  const f = boneFrameFull(sPrime, segments, cs.edge, cs.t);
  let rho = 1;
  if (cs.interior) {
    const denom = cs.sigmaS * (1 - cs.b * cs.kappaS);
    if (Math.abs(denom) > 1e-9) {
      rho = (f.sigma * (1 - cs.b * f.kappa)) / denom;
    }
  }
  return {
    x: rho * cs.vt * f.tau.x + cs.vn * f.nu.x,
    y: rho * cs.vt * f.tau.y + cs.vn * f.nu.y,
  };
}

type CubicPiece = { p0: Vec2D; cp1: Vec2D; cp2: Vec2D; p3: Vec2D };

/**
 * Warp one original curve into a chain of cubic pieces. The default is a single
 * Hermite cubic matching the warped endpoint positions (A,B) and the analytic
 * endpoint velocities; if the true warp of interior samples deviates beyond
 * `WARP_TOL`, split at the worst sample (a true warp point) and recurse.
 */
function warpCurveChain(
  samples: CurveSample[],
  lo: number,
  hi: number,
  A: Vec2D,
  B: Vec2D,
  warpPt: (i: number) => Vec2D, // corrected true warp of sample i
  sPrime: DeformedSkeleton,
  segments: [number, number][],
  depth: number,
  out: CubicPiece[],
): void {
  const ds = (hi - lo) / WARP_K; // span in original curve parameter s
  const vlo = warpVelocity(samples[lo], sPrime, segments);
  const vhi = warpVelocity(samples[hi], sPrime, segments);
  const cp1 = { x: A.x + (vlo.x * ds) / 3, y: A.y + (vlo.y * ds) / 3 };
  const cp2 = { x: B.x - (vhi.x * ds) / 3, y: B.y - (vhi.y * ds) / 3 };

  let maxErr = 0;
  for (let j = lo + 1; j < hi; j++) {
    const tp = warpPt(j); // true (corrected) warp point
    const u = (j - lo) / (hi - lo);
    const c = evalBezier(A, cp1, cp2, B, u);
    maxErr = Math.max(maxErr, Math.hypot(tp.x - c.x, tp.y - c.y));
  }

  // Stop when accurate enough, out of intervals, or at the depth cap. Split at
  // the MIDPOINT (balanced bisection) so every refined piece shrinks to a single
  // sample interval within log2(K) levels — guaranteeing the emitted curve
  // passes through every sample. (Splitting at the worst sample can stall under
  // the depth cap when splits are lopsided.)
  if (maxErr <= WARP_TOL || hi - lo <= 1 || depth >= WARP_MAX_DEPTH) {
    out.push({ p0: A, cp1, cp2, p3: B });
    return;
  }
  const m = (lo + hi) >> 1;
  const mid = warpPt(m);
  warpCurveChain(samples, lo, m, A, mid, warpPt, sPrime, segments, depth + 1, out);
  warpCurveChain(samples, m, hi, mid, B, warpPt, sPrime, segments, depth + 1, out);
}

/**
 * Apply a precomputed rig to an edited skeleton, returning the deformed
 * primitives (each with a warped `clippedPath`; original boundaryTags / type /
 * elementIdx / origins / directions / radii carried through).
 */
export function applyDeform(
  rig: DeformRig,
  sPrime: DeformedSkeleton,
  averageShared = true,
): Primitive[] {
  const segments = rig.segments;
  return rig.primitives.map((rp) => {
    const prim = rp.prim;
    if (prim.type !== "edge" || !prim.clippedPath) {
      // Point/disk primitive: rigid translation by its vertex displacement.
      if (prim.type === "point" && prim.clippedPath) {
        const idx = prim.elementIdx;
        const dx = sPrime.points[idx].x - rig.points[idx].x;
        const dy = sPrime.points[idx].y - rig.points[idx].y;
        const moved = prim.clippedPath.clone({ insert: false });
        moved.translate(new paper.Point(dx, dy));
        return { ...prim, clippedPath: moved };
      }
      return { ...prim };
    }

    // Rebuilt per-piece tags (subdivision changes the curve count, so the
    // original boundaryTags no longer align with the warped path's curves).
    const ownEdge = prim.elementIdx;

    // Shared-vertex corrections δ = W_avg − W_own. Blended smoothly into the
    // surrounding boundary (per-anchor / per-sample `blend` weights) so the
    // shared snap no longer jumps at the shared vertex. Disabled when
    // !averageShared (raw single-edge warp, for visualisation).
    const ownOf = (enc: PointEnc): AnchorMember =>
      enc.kind === "single"
        ? enc.m
        : enc.members.find((m) => m.edge === ownEdge) ?? enc.members[0];
    const deltas: Vec2D[] = averageShared
      ? rp.sharedVerts.map((sv) => {
          const avg = warpPoint(sv, sPrime, segments);
          const own = warpAnchor(ownOf(sv), sPrime, segments);
          return { x: avg.x - own.x, y: avg.y - own.y };
        })
      : [];
    const warpCorrected = (m: AnchorMember, blend: BlendRef[]): Vec2D => {
      const base = warpAnchor(m, sPrime, segments);
      if (!averageShared) return base; // raw single-edge warp (visualisation)
      let cx = 0, cy = 0;
      for (const { v, w } of blend) {
        cx += w * deltas[v].x;
        cy += w * deltas[v].y;
      }
      return { x: base.x + cx, y: base.y + cy };
    };

    const newTags: BoundaryTag[] = [];
    const ringPaths: paper.Path[] = [];
    for (let r = 0; r < rp.rings.length; r++) {
      const ringEnc = rp.rings[r];
      const csRing = rp.curveSamples[r];
      const n = ringEnc.length;
      const closed = rp.closed[r];
      const nc = closed ? n : n - 1; // curves in this ring

      // Emit each curve as one or more cubic pieces, tagging each piece with its
      // originating curve's boundary tag.
      const pieces: CubicPiece[] = [];
      for (let ci = 0; ci < nc; ci++) {
        const encA = ringEnc[ci], encB = ringEnc[(ci + 1) % n];
        const A = warpCorrected(ownOf(encA.point), encA.blend);
        const B = warpCorrected(ownOf(encB.point), encB.blend);
        const samples = csRing[ci];
        const tag: BoundaryTag = rp.prim.boundaryTags?.[ci] ?? { kind: "bezier" };
        if (!samples) {
          // Shared / straight: keep the (zero-handle) segment between anchors so
          // neighbouring capsules stay coincident.
          const hout = warpHandle(encA.handleOut, sPrime, segments);
          const hin = warpHandle(encB.handleIn, sPrime, segments);
          pieces.push({
            p0: A,
            cp1: { x: A.x + hout.x, y: A.y + hout.y },
            cp2: { x: B.x + hin.x, y: B.y + hin.y },
            p3: B,
          });
          newTags.push(tag);
        } else {
          const warpPt = (i: number) => warpCorrected(samples[i], samples[i].blend);
          const before = pieces.length;
          warpCurveChain(samples, 0, samples.length - 1, A, B, warpPt, sPrime, segments, 0, pieces);
          for (let k = before; k < pieces.length; k++) newTags.push(tag);
        }
      }

      // Assemble piece chain into segment nodes (out-handle of one anchor +
      // in-handle of the next). Consecutive pieces share an endpoint exactly.
      const segObjs: paper.Segment[] = [];
      if (pieces.length > 0) {
        const nodes: { point: Vec2D; hin: Vec2D; hout: Vec2D }[] = [
          { point: pieces[0].p0, hin: { x: 0, y: 0 }, hout: { x: 0, y: 0 } },
        ];
        for (let k = 0; k < pieces.length; k++) {
          const pc = pieces[k];
          const cur = nodes[nodes.length - 1];
          cur.hout = { x: pc.cp1.x - pc.p0.x, y: pc.cp1.y - pc.p0.y };
          const inH = { x: pc.cp2.x - pc.p3.x, y: pc.cp2.y - pc.p3.y };
          if (k === pieces.length - 1 && closed) {
            nodes[0].hin = inH; // last piece returns to the first anchor
          } else {
            nodes.push({ point: pc.p3, hin: inH, hout: { x: 0, y: 0 } });
          }
        }
        for (const nd of nodes) {
          segObjs.push(
            new paper.Segment(
              new paper.Point(nd.point.x, nd.point.y),
              new paper.Point(nd.hin.x, nd.hin.y),
              new paper.Point(nd.hout.x, nd.hout.y),
            ),
          );
        }
      }
      ringPaths.push(new paper.Path({ segments: segObjs, closed, insert: false }));
    }
    const clippedPath: paper.PathItem =
      ringPaths.length === 1
        ? ringPaths[0]
        : new paper.CompoundPath({ children: ringPaths, insert: false });
    return { ...prim, clippedPath, boundaryTags: newTags };
  });
}

/**
 * The corrected warp of the *interior* samples of every non-shared boundary
 * curve (single-edge warp + the blended shared correction — the same target the
 * deformed outline is built to track), per primitive (index-aligned with
 * `rig.primitives`). For verification: the deformed outline should pass within
 * tolerance of all of these points.
 *
 * Curve endpoints are excluded — they are placed by the shared averaging, which
 * intentionally differs from the single-edge warp, so only interior samples test
 * the per-curve warp accuracy.
 */
export function warpedCurveSamplePoints(
  rig: DeformRig,
  sPrime: DeformedSkeleton,
): Vec2D[][] {
  const segments = rig.segments;
  return rig.primitives.map((rp) => {
    const ownEdge = rp.prim.elementIdx;
    const deltas = rp.sharedVerts.map((sv) => {
      const avg = warpPoint(sv, sPrime, segments);
      const own = warpAnchor(
        sv.members.find((m) => m.edge === ownEdge) ?? sv.members[0],
        sPrime,
        segments,
      );
      return { x: avg.x - own.x, y: avg.y - own.y };
    });
    const pts: Vec2D[] = [];
    for (const ring of rp.curveSamples) {
      for (const cs of ring) {
        if (!cs) continue;
        for (let j = 1; j < cs.length - 1; j++) {
          const base = warpAnchor(cs[j], sPrime, segments);
          let cx = 0, cy = 0;
          for (const { v, w } of cs[j].blend) {
            cx += w * deltas[v].x;
            cy += w * deltas[v].y;
          }
          pts.push({ x: base.x + cx, y: base.y + cy });
        }
      }
    }
    return pts;
  });
}

/** Bezier-preserving union of warped primitives into a single outline. */
export function unionDeformedPrimitives(prims: Primitive[]): paper.PathItem | null {
  let acc: paper.PathItem | null = null;
  for (const prim of prims) {
    if (!prim.clippedPath) continue;
    const shape = prim.clippedPath.clone({ insert: false });
    if (acc === null) {
      acc = shape;
    } else {
      const united: paper.PathItem = acc.unite(shape, { insert: false });
      acc.remove();
      shape.remove();
      acc = united;
    }
  }
  return acc;
}

/**
 * Stateless deformation: deform(S, S', C). Builds the rig from `fitted` (S + C)
 * and applies it to the edited skeleton `sPrime` (S'), returning the deformed
 * bezier outline. Identity when sPrime equals the original skeleton.
 */
export function deformOutline(
  fitted: FittedMedialAxisGraph,
  sPrime: DeformedSkeleton,
): paper.PathItem | null {
  const rig = buildDeformRig(fitted);
  const warped = applyDeform(rig, sPrime);
  return unionDeformedPrimitives(warped);
}
