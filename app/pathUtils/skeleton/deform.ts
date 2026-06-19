import paper from "paper";

import {
  componentsByArea,
  resolveCrossings,
  selfCrossingCount,
} from "@/app/pathUtils/paperExtras";
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
type HandleEnc = {
  edge: number;
  t: number;
  dist: number;
  angle: number;
} | null;

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

/**
 * Tunable parameters for the accurate per-curve warp (1000-unit em space).
 * Set once at `buildDeformRig` / `deformOutline`; carried through the rig.
 */
export interface WarpOptions {
  /** Samples per non-shared curve for warp-error checking (K+1 points). */
  samples?: number;
  /** Max curve deviation (em units) before a curve is subdivided. */
  tolerance?: number;
  /** Subdivision recursion cap (≤ 2^maxDepth cubics per original curve). */
  maxDepth?: number;
  /** Arc-length support over which a shared correction decays. */
  blendSupport?: number;
  /** Cap on the iso-offset stretch ρ before the analytic tangent is rejected. */
  rhoMax?: number;
}

type ResolvedWarpOptions = Required<WarpOptions>;

export const DEFAULT_WARP_OPTIONS: ResolvedWarpOptions = {
  samples: 16,
  tolerance: 1.5,
  maxDepth: 6,
  blendSupport: 150,
  rhoMax: 6,
};

function resolveWarpOptions(o?: WarpOptions): ResolvedWarpOptions {
  return { ...DEFAULT_WARP_OPTIONS, ...o };
}

/** Per-primitive anti-crossing tilt field, aligned with `rp.curveSamples`:
 *  `θ[ring][curve][sample]`, `null` for shared (bisector) curves. */
export type TiltField = (number[] | null)[][];

export type DeformRig = {
  segments: [number, number][];
  points: Vec2D[];
  controlPoints?: [Vec2D, Vec2D][];
  primitives: RigPrimitive[];
  /** Resolved warp options used to build this rig (and reused at apply). */
  options: ResolvedWarpOptions;
  /** Rest (S'=S) tilt field per primitive; the applied tilt is referenced to
   *  this (`θ_applied = θ(S') − θ_rest`) so identity reproduces exactly. */
  tiltRest: TiltField[];
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
  return {
    pA: graph.points[u],
    cp1: cp?.[0],
    cp2: cp?.[1],
    pB: graph.points[v],
  };
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

/**
 * Clamped quintic smootherstep on [0,1] (Perlin): C² at both ends, so the shared
 * correction it weights has continuous curvature across the edge of its support —
 * no curvature seam where the blend fades out. (The cubic 3x²−2x³ is only C¹.)
 */
function smooth01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * x * (x * (x * 6 - 15) + 10);
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
  blendSupport: number,
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
    const Leff = Math.min(blendSupport, runLen / 2);
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
export function buildDeformRig(
  fitted: FittedMedialAxisGraph,
  options?: WarpOptions,
): DeformRig {
  const opts = resolveWarpOptions(options);
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

  const encodeAnchor = (
    q: Vec2D,
    edge: number,
    seed?: number,
  ): AnchorMember => {
    const { pA, cp1, cp2, pB } = boneOf(S, segments, edge);
    const t = footParamOnBezier(q, pA, cp1, cp2, pB, seed);
    const f = frameAt(S, segments, edge, t);
    const wx = q.x - f.o.x,
      wy = q.y - f.o.y;
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
    const oCP1 = {
      x: sA.point.x + sA.handleOut.x,
      y: sA.point.y + sA.handleOut.y,
    };
    const oCP2 = {
      x: sB.point.x + sB.handleIn.x,
      y: sB.point.y + sB.handleIn.y,
    };
    const oP3 = { x: sB.point.x, y: sB.point.y };
    const arr: CurveSample[] = [];
    let arc = 0;
    let prev: Vec2D | null = null;
    for (let k = 0; k <= opts.samples; k++) {
      const s = k / opts.samples;
      const p = evalBezier(oP0, oCP1, oCP2, oP3, s);
      if (prev) arc += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      const pv = bezierTangent(oP0, oCP1, oCP2, oP3, s); // original curve velocity
      const t = footParamOnBezier(
        p,
        bone.pA,
        bone.cp1,
        bone.cp2,
        bone.pB,
        march.t,
      );
      march.t = t;
      const f = boneFrameFull(S, segments, ownEdge, t);
      const wx = p.x - f.o.x,
        wy = p.y - f.o.y;
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
          sampleCurve(
            segs[ci],
            segs[(ci + 1) % segs.length],
            ownEdge,
            bone,
            march,
          ),
        );
      }

      assignBlendWeights(
        segEncs,
        csRing,
        sharedId,
        ring.closed,
        opts.blendSupport,
      );

      rings.push(segEncs);
      closed.push(ring.closed);
      curveSamples.push(csRing);
    }
    return { prim, rings, closed, curveSamples, sharedVerts };
  });

  const rig: DeformRig = {
    segments,
    points: fitted.points,
    controlPoints: fitted.controlPoints,
    primitives: rigPrims,
    options: opts,
    tiltRest: [],
  };
  // Cache the rest tilt field (S-only) so the applied tilt can be referenced to
  // it (θ_applied = θ(S') − θ_rest) and identity reproduces exactly.
  rig.tiltRest = buildTiltField(rig, {
    points: rig.points,
    controlPoints: rig.controlPoints,
  });
  return rig;
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
  const sk: DeformedSkeleton = sPrime ?? {
    points: rig.points,
    controlPoints: rig.controlPoints,
  };
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

/**
 * For each shared vertex that *neighbours a non-shared curve* (a junction
 * between a shared bisector segment and a free boundary — not a vertex interior
 * to a shared run), a link from the shared anchor to its foot on every sharing
 * edge's bone, under `sPrime` (default: the original skeleton). One link per
 * (vertex, member) so the per-bone feet are all shown. For visualisation.
 */
export function sharedFootLinks(
  rig: DeformRig,
  sPrime?: DeformedSkeleton,
): BoneLink[] {
  const sk: DeformedSkeleton = sPrime ?? {
    points: rig.points,
    controlPoints: rig.controlPoints,
  };
  const links: BoneLink[] = [];
  for (const rp of rig.primitives) {
    for (let r = 0; r < rp.rings.length; r++) {
      const ring = rp.rings[r];
      const cs = rp.curveSamples[r];
      const n = ring.length;
      if (n === 0) continue;
      const nc = rp.closed[r] ? n : n - 1;
      for (let i = 0; i < n; i++) {
        const enc = ring[i].point;
        if (enc.kind !== "shared") continue;
        // Incident curves of anchor i (curve c runs anchor c → c+1).
        const incident = rp.closed[r]
          ? [(i - 1 + n) % n, i % n]
          : [i - 1, i].filter((c) => c >= 0 && c < nc);
        if (!incident.some((c) => cs[c] != null)) continue; // interior shared vertex
        const anchor = warpAnchor(enc.members[0], sk, rig.segments);
        for (const m of enc.members) {
          const f = frameAt(sk, rig.segments, m.edge, m.t);
          links.push({ anchor, bone: { x: f.o.x, y: f.o.y } });
        }
      }
    }
  }
  return links;
}

/**
 * Re-expand the position average `Q` of the warped shared points `Ps` so its
 * distance to the shared joint `J'` equals the mean of the members' joint
 * distances — restores stroke width at sharp corners (see [[deform]]). No-op
 * when there's no joint or `Q` sits on the joint.
 */
function reExpandToJoint(
  Q: Vec2D,
  Ps: Vec2D[],
  jointIdx: number | null,
  sPrime: DeformedSkeleton,
): Vec2D {
  if (jointIdx == null) return Q;
  const J = sPrime.points[jointIdx];
  let R = 0;
  for (const p of Ps) R += Math.hypot(p.x - J.x, p.y - J.y);
  R /= Ps.length;
  const dx = Q.x - J.x,
    dy = Q.y - J.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Q;
  return { x: J.x + (R * dx) / len, y: J.y + (R * dy) / len };
}

function warpPoint(
  enc: PointEnc,
  sPrime: DeformedSkeleton,
  segments: [number, number][],
): Vec2D {
  if (enc.kind === "single") return warpAnchor(enc.m, sPrime, segments);
  // Shared: warp via every sharing edge, then re-expand to the average
  // joint-distance so sharp corners keep their stroke width. Identical on both
  // sides (same members + joint) ⇒ boundary stays coincident, and a no-op at
  // S'=S (every P_m = Q) ⇒ identity preserved exactly.
  const Ps = enc.members.map((m) => warpAnchor(m, sPrime, segments));
  const k = Ps.length;
  let qx = 0,
    qy = 0;
  for (const p of Ps) {
    qx += p.x;
    qy += p.y;
  }
  return reExpandToJoint({ x: qx / k, y: qy / k }, Ps, enc.jointIdx, sPrime);
}

function warpHandle(
  enc: HandleEnc,
  sPrime: DeformedSkeleton,
  segments: [number, number][],
): Vec2D {
  if (!enc) return { x: 0, y: 0 };
  const f = frameAt(sPrime, segments, enc.edge, enc.t);
  const c = Math.cos(enc.angle),
    s = Math.sin(enc.angle);
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
 *
 * Returns null when ρ is ill-conditioned — i.e. the deformed bone folds its
 * offset at this radius (`1−bκ' ≤ 0`, an offset cusp) or stretches
 * pathologically (`ρ > WARP_RHO_MAX`). There the analytic tangent flips or
 * explodes, so the caller substitutes a finite-difference tangent instead.
 * ρ=1 at identity, so this never trips when S'=S (exact reproduction preserved).
 */
function warpVelocity(
  cs: CurveSample,
  sPrime: DeformedSkeleton,
  segments: [number, number][],
  rhoMax: number,
): Vec2D | null {
  const f = boneFrameFull(sPrime, segments, cs.edge, cs.t);
  let rho = 1;
  if (cs.interior) {
    const denom = cs.sigmaS * (1 - cs.b * cs.kappaS);
    if (!(Math.abs(denom) > 1e-9)) return null;
    rho = (f.sigma * (1 - cs.b * f.kappa)) / denom;
    if (!(rho >= 0 && rho <= rhoMax)) return null;
  }
  return {
    x: rho * cs.vt * f.tau.x + cs.vn * f.nu.x,
    y: rho * cs.vt * f.tau.y + cs.vn * f.nu.y,
  };
}

type CubicPiece = { p0: Vec2D; cp1: Vec2D; cp2: Vec2D; p3: Vec2D };

/** Rotate a vector by `theta` (no-op at θ=0, so identity is exact). */
function rotateVec(v: Vec2D, theta: number): Vec2D {
  if (!theta) return v;
  const c = Math.cos(theta),
    s = Math.sin(theta);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

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
  warpPt: (i: number) => Vec2D, // corrected true warp of sample i (tilt-carrying)
  sPrime: DeformedSkeleton,
  segments: [number, number][],
  depth: number,
  out: CubicPiece[],
  opts: ResolvedWarpOptions,
): void {
  const ds = (hi - lo) / (samples.length - 1); // span in original curve param s
  // Fallback tangent where the analytic one is ill-conditioned (offset fold):
  // the chord A→B (natural cubic handles). Near a cusp the local tangent hooks
  // back, so its handle juts past the endpoint; the chord instead always points
  // toward the other endpoint, giving a well-behaved cubic that subdivision then
  // refines against the true sample positions.
  const chord = { x: (B.x - A.x) / ds, y: (B.y - A.y) / ds };
  // The analytic velocity is the *untilted* boundary velocity (dominated by the
  // bone tangent, which the offset tilt must not rotate). The tilt enters only
  // through the endpoints A,B and the per-sample `warpPt`; subdivision against
  // those tilted points refines the handles, so no velocity rotation is applied.
  const vlo = warpVelocity(samples[lo], sPrime, segments, opts.rhoMax) ?? chord;
  const vhi = warpVelocity(samples[hi], sPrime, segments, opts.rhoMax) ?? chord;
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
  if (maxErr <= opts.tolerance || hi - lo <= 1 || depth >= opts.maxDepth) {
    out.push({ p0: A, cp1, cp2, p3: B });
    return;
  }
  const m = (lo + hi) >> 1;
  const mid = warpPt(m);
  warpCurveChain(
    samples,
    lo,
    m,
    A,
    mid,
    warpPt,
    sPrime,
    segments,
    depth + 1,
    out,
    opts,
  );
  warpCurveChain(
    samples,
    m,
    hi,
    mid,
    B,
    warpPt,
    sPrime,
    segments,
    depth + 1,
    out,
    opts,
  );
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
  /**
   * Optional override for the averaged shared-vertex position `W_avg`, indexed
   * `[primitiveIndex][sharedVertexIndex]`. When present, the shared correction
   * `δ` uses it instead of `warpPoint(...)` — used by the resolve→re-map→average
   * two-pass in `deformOutline`. When absent, `warpPoint` is used (back-compat).
   */
  sharedOverride?: (Vec2D | null)[][],
  /**
   * Per-primitive anti-crossing tilt field (`appliedTiltField`), aligned with
   * `rp.curveSamples`. Rotates the boundary offset by θ so the deformed outline
   * is fold-free by construction. Absent ⇒ no tilt (θ=0, exact reproduction).
   */
  tilt?: TiltField[],
): Primitive[] {
  const segments = rig.segments;
  const opts = rig.options;
  return rig.primitives.map((rp, pi) => {
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

    // Shared-vertex corrections, stored in the owning bone's frame at each shared
    // vertex: (p,q) = (δ·τ', δ·ν') with δ = W_avg − W_own. Applied at a point by
    // re-expressing (p,q) in *that point's* frame (pure rotational transport), so
    // the correction rotates with the bone along the run rather than being a
    // frozen world vector. At the vertex itself the frame matches, so it
    // reproduces δ exactly and joint coincidence is preserved. Disabled when
    // !averageShared (raw single-edge warp, for visualisation).
    const ownOf = (enc: PointEnc): AnchorMember =>
      enc.kind === "single"
        ? enc.m
        : (enc.members.find((m) => m.edge === ownEdge) ?? enc.members[0]);
    const deltas: { p: number; q: number }[] = averageShared
      ? rp.sharedVerts.map((sv, si) => {
          const avg =
            sharedOverride?.[pi]?.[si] ?? warpPoint(sv, sPrime, segments);
          const m = ownOf(sv);
          const own = warpAnchor(m, sPrime, segments);
          const f = frameAt(sPrime, segments, m.edge, m.t);
          const dx = avg.x - own.x,
            dy = avg.y - own.y;
          return {
            p: dx * f.tau.x + dy * f.tau.y,
            q: dx * f.nu.x + dy * f.nu.y,
          };
        })
      : [];
    const tiltP = tilt?.[pi];
    const warpCorrected = (
      m: AnchorMember,
      blend: BlendRef[],
      theta = 0,
    ): Vec2D => {
      const f = frameAt(sPrime, segments, m.edge, m.t);
      // Rotate the bone-frame offset (a·τ' + b·ν') by the anti-crossing tilt θ.
      let ox = m.a * f.tau.x + m.b * f.nu.x;
      let oy = m.a * f.tau.y + m.b * f.nu.y;
      if (theta) {
        const c = Math.cos(theta),
          s = Math.sin(theta);
        const rx = ox * c - oy * s;
        oy = ox * s + oy * c;
        ox = rx;
      }
      let x = f.o.x + ox,
        y = f.o.y + oy;
      if (averageShared) {
        for (const { v, w } of blend) {
          const { p, q } = deltas[v];
          x += w * (p * f.tau.x + q * f.nu.x);
          y += w * (p * f.tau.y + q * f.nu.y);
        }
      }
      return { x, y };
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
        const encA = ringEnc[ci],
          encB = ringEnc[(ci + 1) % n];
        const samples = csRing[ci];
        // θ per sample of this curve (0 if no tilt field). Anchors are forced to
        // θ=0 when shared, so they stay on their averaged position (watertight).
        const thetaArr = tiltP?.[r]?.[ci] ?? null;
        const last = samples ? samples.length - 1 : 0;
        const sharedA = encA.point.kind === "shared";
        const sharedB = encB.point.kind === "shared";
        const thetaA = sharedA ? 0 : (thetaArr?.[0] ?? 0);
        const thetaB = sharedB ? 0 : (thetaArr?.[last] ?? 0);
        const thetaOf = (i: number) =>
          i === 0 ? thetaA : i === last ? thetaB : (thetaArr?.[i] ?? 0);
        const A = warpCorrected(ownOf(encA.point), encA.blend, thetaA);
        const B = warpCorrected(ownOf(encB.point), encB.blend, thetaB);
        const tag: BoundaryTag = rp.prim.boundaryTags?.[ci] ?? {
          kind: "bezier",
        };
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
          const warpPt = (i: number) =>
            warpCorrected(samples[i], samples[i].blend, thetaOf(i));
          const before = pieces.length;
          warpCurveChain(
            samples,
            0,
            samples.length - 1,
            A,
            B,
            warpPt,
            sPrime,
            segments,
            0,
            pieces,
            opts,
          );
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
      ringPaths.push(
        new paper.Path({ segments: segObjs, closed, insert: false }),
      );
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
  const tilt = appliedTiltField(rig, sPrime);
  return rig.primitives.map((rp, pi) => {
    const deltas = sharedCorrectionDeltas(rp, sPrime, segments);
    const tiltP = tilt[pi];
    const pts: Vec2D[] = [];
    for (let r = 0; r < rp.curveSamples.length; r++) {
      const ring = rp.curveSamples[r];
      for (let ci = 0; ci < ring.length; ci++) {
        const cs = ring[ci];
        if (!cs) continue;
        const thetaArr = tiltP?.[r]?.[ci] ?? null;
        // Interior samples only — endpoints are placed by the shared averaging,
        // which intentionally differs from the single-edge warp.
        for (let j = 1; j < cs.length - 1; j++) {
          pts.push(
            warpCurveSample(
              cs[j],
              deltas,
              sPrime,
              segments,
              true,
              thetaArr?.[j] ?? 0,
            ).point,
          );
        }
      }
    }
    return pts;
  });
}

/** Per-shared-vertex correction δ = W_avg − W_own, expressed in the owning
 *  bone's frame at that vertex's foot (p = δ·τ', q = δ·ν'). Shared by the
 *  curve-sample warp and the rib export. */
function sharedCorrectionDeltas(
  rp: RigPrimitive,
  sPrime: DeformedSkeleton,
  segments: [number, number][],
): { p: number; q: number }[] {
  const ownEdge = rp.prim.elementIdx;
  return rp.sharedVerts.map((sv) => {
    const avg = warpPoint(sv, sPrime, segments);
    const m = sv.members.find((mm) => mm.edge === ownEdge) ?? sv.members[0];
    const own = warpAnchor(m, sPrime, segments);
    const f = frameAt(sPrime, segments, m.edge, m.t);
    const dx = avg.x - own.x,
      dy = avg.y - own.y;
    return { p: dx * f.tau.x + dy * f.tau.y, q: dx * f.nu.x + dy * f.nu.y };
  });
}

/** The warp of one boundary sample: the deformed bone foot (frame origin at the
 *  sample's foot param) and the warped boundary point. With `applyShared` the
 *  blended shared correction is added (single-edge warp + correction — the target
 *  the deformed outline tracks); without it, the raw single-edge warp, matching
 *  `applyDeform(..., averageShared=false)`. */
function warpCurveSample(
  s: CurveSample,
  deltas: { p: number; q: number }[],
  sPrime: DeformedSkeleton,
  segments: [number, number][],
  applyShared = true,
  theta = 0,
): { foot: Vec2D; point: Vec2D } {
  const f = frameAt(sPrime, segments, s.edge, s.t);
  const o = rotateVec(
    { x: s.a * f.tau.x + s.b * f.nu.x, y: s.a * f.tau.y + s.b * f.nu.y },
    theta,
  );
  let x = f.o.x + o.x;
  let y = f.o.y + o.y;
  if (applyShared) {
    for (const { v, w } of s.blend) {
      const { p, q } = deltas[v];
      x += w * (p * f.tau.x + q * f.nu.x);
      y += w * (p * f.tau.y + q * f.nu.y);
    }
  }
  return { foot: { x: f.o.x, y: f.o.y }, point: { x, y } };
}

/**
 * A foot→boundary "rib": the deformed bone foot and the warped boundary point it
 * maps to, with the bone foot parameter `t`, the `side` (sign of normal offset),
 * the originating non-shared segment `seg`, and — for the per-bone uniform
 * sampling — the `run` index and within-run arc length `arc`. `boundaryLen` is
 * the rib's free-boundary run length. `point0`/`theta` are filled by
 * `resolveRibTilts` (original endpoint + applied tilt).
 */
export type Rib = {
  side: number;
  seg: number;
  t: number;
  boundaryLen: number;
  run: number;
  arc: number;
  foot: Vec2D;
  point: Vec2D;
  point0?: Vec2D;
  theta?: number;
};

/** One node of a free-boundary run: a `CurveSample` (`ring`,`ci`,`j`) with its
 *  cumulative within-run arc length and the S-fixed warp encoding (`t`,`a`,`b`). */
type RunNode = {
  ring: number;
  ci: number;
  j: number;
  arc: number;
  t: number;
  a: number;
  b: number;
  seg: number;
};
type BoundaryRun = { nodes: RunNode[]; length: number };

/** Split a primitive's boundary into maximal runs of consecutive non-shared
 *  segments (a shared bisector / `null` curve breaks a run), concatenating each
 *  run's per-segment samples onto one within-run arc axis. The shared anchor
 *  where two segments meet appears as duplicate coincident nodes (same arc), so
 *  every `CurveSample` (ring,ci,j) is represented exactly once. */
function boundaryRuns(rp: RigPrimitive): BoundaryRun[] {
  const runs: BoundaryRun[] = [];
  let seg = 0;
  for (let r = 0; r < rp.curveSamples.length; r++) {
    const ring = rp.curveSamples[r];
    let nodes: RunNode[] = [];
    let arcOff = 0;
    const flush = () => {
      const len = nodes.length ? nodes[nodes.length - 1].arc : 0;
      if (nodes.length >= 2 && len > 1e-9) runs.push({ nodes, length: len });
      nodes = [];
      arcOff = 0;
    };
    for (let ci = 0; ci < ring.length; ci++) {
      const cs = ring[ci];
      if (!cs) {
        flush(); // shared bisector breaks the run
        continue;
      }
      for (let k = 0; k < cs.length; k++) {
        nodes.push({
          ring: r,
          ci,
          j: k,
          arc: arcOff + cs[k].arc,
          t: cs[k].t,
          a: cs[k].a,
          b: cs[k].b,
          seg,
        });
      }
      arcOff += cs[cs.length - 1].arc;
      seg++;
    }
    flush();
  }
  return runs;
}

/**
 * Faithful foot→boundary ribs per primitive (index-aligned with
 * `rig.primitives`), sampled per bone at a uniform arc-length `spacing` rather
 * than a fixed count per boundary segment — so rib density is consistent however
 * the boundary is split. Each primitive's free (non-shared) boundary is broken
 * into maximal runs (see `boundaryRuns`); each run's total length / `spacing`
 * gives its rib count, placed at uniform arc-length midpoints, with `(t,a,b)`
 * linearly interpolated from the rig's dense per-segment samples.
 *
 * Uses the raw single-edge (pre-averaging) warp — the same one
 * `applyDeform(..., averageShared=false)` produces.
 */
export function warpedBoundaryRibs(
  rig: DeformRig,
  sPrime: DeformedSkeleton,
  spacing: number,
): Rib[][] {
  const segments = rig.segments;
  return rig.primitives.map((rp) => {
    const ribs: Rib[] = [];
    if (rp.prim.type !== "edge") return ribs;
    const edge = rp.prim.elementIdx;
    const runs = boundaryRuns(rp);
    for (let ri = 0; ri < runs.length; ri++) {
      const { nodes, length: total } = runs[ri];
      const n = Math.max(1, Math.round(total / spacing));
      const step = total / n;
      let j = 0;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) * step;
        while (j < nodes.length - 2 && nodes[j + 1].arc < u) j++;
        const a0 = nodes[j],
          a1 = nodes[j + 1];
        const f = Math.max(0, Math.min(1, (u - a0.arc) / (a1.arc - a0.arc || 1e-9)));
        const t = a0.t + f * (a1.t - a0.t);
        const a = a0.a + f * (a1.a - a0.a);
        const b = a0.b + f * (a1.b - a0.b);
        const fr = frameAt(sPrime, segments, edge, t);
        ribs.push({
          side: Math.sign(b) || 1,
          seg: a0.seg,
          t,
          boundaryLen: total,
          run: ri,
          arc: u,
          foot: { x: fr.o.x, y: fr.o.y },
          point: {
            x: fr.o.x + a * fr.tau.x + b * fr.nu.x,
            y: fr.o.y + a * fr.tau.y + b * fr.nu.y,
          },
        });
      }
    }
    return ribs;
  });
}

/** Tunables for the deterministic anti-crossing rib tilt (1000-unit em space). */
const TILT_THETA_MAX = (30 * Math.PI) / 180; // cap on per-rib splay
// Target rib-end gap = this × free-boundary run length. 0 ⇒ the minimal tilt that
// just un-crosses the ribs (focal point at the boundary): no cosmetic margin, so
// a fold-free rest needs no tilt (θ_rest = 0) and identity is reproduced exactly.
const TILT_GAP_COEF = 0;

/**
 * Deterministic anti-crossing rib tilt. Per side of one capsule, ribs are ordered
 * by foot parameter and each adjacent gap gets an angular budget β = c − σ·g0 from
 * the focal-distance condition (c = max(0,|Δf×u|−gMin)/b is the increment that
 * keeps the next rib's focal point a gap gMin past the boundary; g0 the natural
 * increment; σ the side orientation; gMin = TILT_GAP_COEF·runLen). A forward
 * (min,0) + backward (max,0) + average sweep caps the increments so converging
 * ribs splay just enough not to cross, staying at the normal wherever no fold
 * demands a tilt. Cap ribs (foot pinned to a bone end) fan around the end: the two
 * border ribs join the sweep with their side; the inner cap ribs are re-fanned at
 * uniform angular steps between those two adjusted borders.
 *
 * Returns the ribs with the tilted `point`, the original endpoint `point0`, and
 * the applied tilt `theta` (capped at TILT_THETA_MAX).
 */
export function resolveRibTilts(ribs: Rib[]): Rib[] {
  const wrapPi = (d: number) => {
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const T_EPS = 1e-4; // cap ribs: foot pinned to a bone end (t≈0 or t≈1)
  const out = ribs.map((r) => ({ ...r, point0: { ...r.point } }));
  const nR = out.length;

  const dirOf = out.map((r) => {
    const dx = r.point0!.x - r.foot.x,
      dy = r.point0!.y - r.foot.y;
    const b = Math.hypot(dx, dy) || 1e-9;
    return { ux: dx / b, uy: dy / b, b, ang: Math.atan2(dy, dx) };
  });
  const theta = new Array<number>(nR).fill(0);
  const apply = (i: number, ang: number) => {
    theta[i] = ang - dirOf[i].ang;
    out[i].point = {
      x: out[i].foot.x + Math.cos(ang) * dirOf[i].b,
      y: out[i].foot.y + Math.sin(ang) * dirOf[i].b,
    };
  };

  // Cap blocks: maximal contiguous runs of same-end cap ribs in boundary order.
  const isCap = (i: number) => out[i].t <= T_EPS || out[i].t >= 1 - T_EPS;
  const capBlocks: { lo: number; hi: number }[] = [];
  const innerCap = new Array<boolean>(nR).fill(false);
  for (let k = 0; k < nR; ) {
    if (!isCap(k)) {
      k++;
      continue;
    }
    const end0 = out[k].t <= T_EPS;
    let j = k;
    while (j + 1 < nR && isCap(j + 1) && out[j + 1].t <= T_EPS === end0) j++;
    capBlocks.push({ lo: k, hi: j });
    for (let m = k + 1; m < j; m++) innerCap[m] = true;
    k = j + 1;
  }

  // Sweep groups: every wall rib plus the cap-block border ribs, by side.
  const bySide = new Map<number, number[]>();
  out.forEach((r, i) => {
    if (innerCap[i]) return;
    const g = bySide.get(r.side) ?? [];
    g.push(i);
    bySide.set(r.side, g);
  });
  for (const idxs of bySide.values()) {
    idxs.sort((a, b) => out[a].t - out[b].t);
    const n = idxs.length;
    if (n < 2) continue;
    const beta = new Array<number>(n - 1);
    let sumN = 0;
    const g0s = new Array<number>(n - 1);
    const cs = new Array<number>(n - 1);
    for (let k = 0; k < n - 1; k++) {
      const d0 = dirOf[idxs[k]],
        d1 = dirOf[idxs[k + 1]];
      const fa = out[idxs[k]].foot,
        fb = out[idxs[k + 1]].foot;
      const dfx = fb.x - fa.x,
        dfy = fb.y - fa.y;
      const N = dfx * d0.uy - dfy * d0.ux; // cross(Δf, u_k)
      const g0 = wrapPi(d1.ang - d0.ang);
      const bmax = Math.max(d0.b, d1.b, 1e-6);
      const gMin =
        TILT_GAP_COEF *
        Math.min(out[idxs[k]].boundaryLen, out[idxs[k + 1]].boundaryLen);
      g0s[k] = g0;
      cs[k] = Math.max(0, Math.abs(N) - gMin) / bmax;
      sumN += N;
    }
    const sigma = sumN >= 0 ? 1 : -1;
    for (let k = 0; k < n - 1; k++) beta[k] = cs[k] - sigma * g0s[k];
    const phiF = new Array<number>(n).fill(0);
    for (let m = 1; m < n; m++) phiF[m] = Math.min(0, phiF[m - 1] + beta[m - 1]);
    const phiB = new Array<number>(n).fill(0);
    for (let m = n - 2; m >= 0; m--) phiB[m] = Math.max(0, phiB[m + 1] - beta[m]);
    for (let m = 0; m < n; m++) {
      let th = sigma * 0.5 * (phiF[m] + phiB[m]);
      th = Math.max(-TILT_THETA_MAX, Math.min(TILT_THETA_MAX, th));
      apply(idxs[m], dirOf[idxs[m]].ang + th);
    }
  }

  // Fan each cap block's inner ribs uniformly between its two tilted border ribs.
  for (const { lo, hi } of capBlocks) {
    if (hi - lo < 2) continue;
    let dOrig = 0; // original cumulative angle lo→hi (the long way, via the tip)
    for (let m = lo; m < hi; m++) dOrig += wrapPi(dirOf[m + 1].ang - dirOf[m].ang);
    const dNew = dOrig + (theta[hi] - theta[lo]);
    const base = dirOf[lo].ang + theta[lo];
    for (let m = lo + 1; m < hi; m++) {
      apply(m, base + ((m - lo) / (hi - lo)) * dNew);
    }
  }
  for (let i = 0; i < nR; i++) out[i].theta = theta[i];
  return out;
}

const TILT_SPACING = 8; // em units between ribs when computing the tilt field

/**
 * Build the per-primitive anti-crossing tilt field for skeleton `sPrime`:
 * sample each capsule's free boundary into ribs (`warpedBoundaryRibs`), splay
 * them (`resolveRibTilts`), then interpolate the per-rib tilt θ back onto every
 * `CurveSample` by its within-run arc length. θ is pinned to 0 at each run's ends
 * (the shared vertices) so the free boundary still meets the averaged shared
 * anchor — preserving watertightness. Index-aligned with `rig.primitives` and,
 * within each, with `rp.curveSamples`.
 */
function buildTiltField(rig: DeformRig, sPrime: DeformedSkeleton): TiltField[] {
  const ribsByPrim = warpedBoundaryRibs(rig, sPrime, TILT_SPACING);
  return rig.primitives.map((rp, pi) => {
    const field: TiltField = rp.curveSamples.map((ring) =>
      ring.map((cs) => (cs ? new Array<number>(cs.length).fill(0) : null)),
    );
    if (rp.prim.type !== "edge") return field;
    const tilted = resolveRibTilts(ribsByPrim[pi]);
    const runs = boundaryRuns(rp);
    const byRun = new Map<number, Rib[]>();
    for (const r of tilted) {
      const g = byRun.get(r.run) ?? [];
      g.push(r);
      byRun.set(r.run, g);
    }
    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri];
      const rs = (byRun.get(ri) ?? []).slice().sort((a, b) => a.arc - b.arc);
      // Knots: θ=0 at both run ends (shared vertices), rib θ in between.
      const kA = [0, ...rs.map((r) => r.arc), run.length];
      const kT = [0, ...rs.map((r) => r.theta ?? 0), 0];
      let kp = 0;
      for (const node of run.nodes) {
        const x = node.arc;
        while (kp < kA.length - 2 && kA[kp + 1] < x) kp++;
        const a0 = kA[kp],
          a1 = kA[kp + 1];
        const f = a1 > a0 ? (x - a0) / (a1 - a0) : 0;
        const arr = field[node.ring][node.ci];
        if (arr) arr[node.j] = kT[kp] + f * (kT[kp + 1] - kT[kp]);
      }
    }
    return field;
  });
}

/** Rest-referenced applied tilt `θ(S') − θ_rest`, per primitive/ring/curve/sample
 *  (so it is exactly 0 at S'=S). */
function appliedTiltField(rig: DeformRig, sPrime: DeformedSkeleton): TiltField[] {
  const def = buildTiltField(rig, sPrime);
  return def.map((dPrim, pi) =>
    dPrim.map((dRing, r) =>
      dRing.map((dArr, ci) => {
        if (!dArr) return null;
        const rArr = rig.tiltRest[pi]?.[r]?.[ci];
        return dArr.map((v, j) => v - (rArr?.[j] ?? 0));
      }),
    ),
  );
}

/**
 * Remove a path's self-intersections (the offset fold a sharply-bent bone makes
 * when the stroke half-width exceeds the bone's radius of curvature), tracing by
 * non-zero winding — the swept-region envelope. Bezier-native (paper.js), keeps
 * the curves. A no-op when the path has no crossings (so identity is unchanged).
 * Operates on a clone; the input is left untouched.
 */
export function resolveSelfIntersections(path: paper.PathItem): paper.PathItem {
  const clone = path.clone({ insert: false });
  if (selfCrossingCount(clone) === 0) return clone; // no fold ⇒ untouched (identity-safe)
  // Resolve the fold, then reorient by non-zero winding (drops reverse-loop
  // children) — mirrors paper's own boolean `preparePath`.
  const resolved = resolveCrossings(clone).reorient(true, true);
  // A capsule is one connected region; the fold removal can leave a tiny
  // same-winding sliver as a separate child, which still gets stroked/filled and
  // reads as a self-intersection. Drop slivers (< 2% of the largest child).
  if (resolved instanceof paper.CompoundPath) {
    const comps = componentsByArea(resolved);
    if (comps.length > 1) {
      const maxA = comps[0].area;
      for (const c of comps) if (c.area < maxA * 0.02) c.path.remove();
    }
  }
  return resolved;
}

/**
 * `W_avg` per shared vertex, computed on the *resolved* (fold-free) capsules:
 * each capsule's shared anchor is re-mapped to the nearest point on its resolved
 * boundary (so a vertex swallowed by a removed fold maps to the surviving
 * crossing vertex), then averaged across the sharing capsules and re-expanded to
 * the joint. Returns `[primitiveIndex][sharedVertexIndex] → W_avg`, consistent
 * across the capsules that share each vertex. Feeds `applyDeform`'s
 * `sharedOverride`.
 */
function computeSharedAverages(
  rig: DeformRig,
  sPrime: DeformedSkeleton,
  resolved: (paper.PathItem | null)[],
  needsRemap: boolean[],
): (Vec2D | null)[][] {
  const segments = rig.segments;
  const sOrig: DeformedSkeleton = {
    points: rig.points,
    controlPoints: rig.controlPoints,
  };
  type Group = {
    cells: { pi: number; si: number }[];
    reMapped: Vec2D[];
    jointIdx: number | null;
  };
  const groups = new Map<string, Group>();
  rig.primitives.forEach((rp, pi) => {
    const path = resolved[pi];
    if (!path) return;
    const ownEdge = rp.prim.elementIdx;
    rp.sharedVerts.forEach((sv, si) => {
      const own = sv.members.find((m) => m.edge === ownEdge) ?? sv.members[0];
      // Group across capsules by the original shared-anchor coordinate.
      const orig = warpAnchor(own, sOrig, segments);
      const key = coordKey(orig.x, orig.y);
      const raw = warpAnchor(own, sPrime, segments);
      // The raw anchor stays on the resolved boundary unless its capsule folded
      // *and* this vertex was swallowed by the fold — i.e. its foot is past the
      // deformed bone's centre of curvature (1 − b·κ' ≤ 0). Only then re-map
      // (nearest point on the resolved boundary — Compound-safe). getNearestPoint
      // is O(curves), so gating it on the swallow test is the main speedup.
      let reMapped = raw;
      if (needsRemap[pi]) {
        const f = boneFrameFull(sPrime, segments, own.edge, own.t);
        if (1 - own.b * f.kappa <= 1e-3) {
          const q = new paper.Point(raw.x, raw.y);
          let bd = Infinity;
          for (const ring of ringsOf(path)) {
            const np = ring.getNearestPoint(q);
            if (!np) continue;
            const d = np.getDistance(q);
            if (d < bd) {
              bd = d;
              reMapped = { x: np.x, y: np.y };
            }
          }
        }
      }
      let g = groups.get(key);
      if (!g) {
        g = { cells: [], reMapped: [], jointIdx: sv.jointIdx };
        groups.set(key, g);
      }
      g.cells.push({ pi, si });
      g.reMapped.push(reMapped);
    });
  });

  const out: (Vec2D | null)[][] = rig.primitives.map((rp) =>
    rp.sharedVerts.map(() => null),
  );
  for (const g of groups.values()) {
    const k = g.reMapped.length;
    let qx = 0,
      qy = 0;
    for (const p of g.reMapped) {
      qx += p.x;
      qy += p.y;
    }
    const wavg = reExpandToJoint(
      { x: qx / k, y: qy / k },
      g.reMapped,
      g.jointIdx,
      sPrime,
    );
    for (const c of g.cells) out[c.pi][c.si] = wavg;
  }
  return out;
}

/**
 * Bezier-preserving union of warped primitives into a single outline.
 * Divide-and-conquer (pairwise tree) rather than a linear accumulate: a linear
 * fold re-resolves the whole growing union on every step (O(N·|union|)); pairing
 * keeps operands small, which dominates the cost (paper boolean is the bottleneck).
 */
export function unionDeformedPrimitives(
  prims: Primitive[],
): paper.PathItem | null {
  let level: paper.PathItem[] = [];
  for (const prim of prims) {
    if (prim.clippedPath) level.push(prim.clippedPath.clone({ insert: false }));
  }
  if (level.length === 0) return null;
  while (level.length > 1) {
    const next: paper.PathItem[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const u: paper.PathItem = level[i].unite(level[i + 1], {
          insert: false,
        });
        level[i].remove();
        level[i + 1].remove();
        next.push(u);
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0];
}

const selfCrosses = (p: paper.PathItem) => selfCrossingCount(p) > 0;

/**
 * The averaged + blended capsules (still possibly folded). Two passes:
 * (1) raw single-edge warp → resolve only the folded capsules (re-mapping a
 * shared anchor only matters where its capsule folded — getNearestPoint over
 * every capsule's curves is otherwise the dominant cost) → re-map + average
 * shared vertices on the cleaned geometry; (2) re-warp with that `W_avg` + the
 * smooth blend. Folds are NOT removed here — `deformOutline`'s union resolves
 * them, and `deformCapsules` resolves per-capsule for visualisation.
 */
function averagedCapsules(
  rig: DeformRig,
  sPrime: DeformedSkeleton,
): Primitive[] {
  // Anti-crossing tilt (rest-referenced ⇒ 0 at identity), shared by both passes.
  const tilt = appliedTiltField(rig, sPrime);
  const raw = applyDeform(rig, sPrime, false, undefined, tilt);
  // Re-mapping (and thus the pass-1 resolve) is only needed where a capsule
  // folds AND one of its shared vertices is swallowed by the fold (its foot is
  // past the deformed bone's centre of curvature). Gate the resolve on that, so
  // a capsule that merely folds on a free boundary isn't resolved here.
  const needsRemap = raw.map((p, i) => {
    if (!p.clippedPath || !selfCrosses(p.clippedPath)) return false;
    const rp = rig.primitives[i];
    const ownEdge = rp.prim.elementIdx;
    return rp.sharedVerts.some((sv) => {
      const m = sv.members.find((x) => x.edge === ownEdge) ?? sv.members[0];
      const f = boneFrameFull(sPrime, rig.segments, m.edge, m.t);
      return 1 - m.b * f.kappa <= 1e-3;
    });
  });
  const resolvedRaw = raw.map((p, i) =>
    p.clippedPath && needsRemap[i]
      ? resolveSelfIntersections(p.clippedPath)
      : (p.clippedPath ?? null),
  );
  const overrides = computeSharedAverages(rig, sPrime, resolvedRaw, needsRemap);
  const averaged = applyDeform(rig, sPrime, true, overrides, tilt);
  // Free intermediates (re-mapped resolvedRaw are clones; others reuse raw).
  for (let i = 0; i < resolvedRaw.length; i++)
    if (needsRemap[i]) resolvedRaw[i]?.remove();
  for (const p of raw) p.clippedPath?.remove();
  return averaged;
}

/**
 * Deform a rig and return the final, fold-free capsules — `averagedCapsules`
 * plus a per-capsule self-intersection resolve. For visualisation / standalone
 * use; `deformOutline` skips this resolve (its union removes folds). Identity-
 * exact (no folds ⇒ resolves are no-ops and the average equals `warpPoint`).
 */
export function deformCapsules(
  rig: DeformRig,
  sPrime: DeformedSkeleton,
): Primitive[] {
  return averagedCapsules(rig, sPrime).map((p) => {
    if (p.clippedPath && selfCrosses(p.clippedPath)) {
      const resolved = resolveSelfIntersections(p.clippedPath);
      p.clippedPath.remove();
      return { ...p, clippedPath: resolved };
    }
    return p;
  });
}

/**
 * Deformed, fold-free outline from a prebuilt rig — the interactive per-frame
 * call (build the rig once, then this per drag frame). Capsules are fed to the
 * union unresolved: paper's boolean resolves each operand's fold, so a separate
 * per-capsule resolve would be redundant.
 */
export function deformOutlineFromRig(
  rig: DeformRig,
  sPrime: DeformedSkeleton,
): paper.PathItem | null {
  const caps = averagedCapsules(rig, sPrime);
  const out = unionDeformedPrimitives(caps);
  for (const p of caps) p.clippedPath?.remove();
  return out;
}

/**
 * Stateless deformation: deform(S, S', C). Builds the rig from `fitted` (S + C)
 * and returns the deformed, fold-free bezier outline. Identity when sPrime
 * equals S.
 */
export function deformOutline(
  fitted: FittedMedialAxisGraph,
  sPrime: DeformedSkeleton,
  options?: WarpOptions,
): paper.PathItem | null {
  return deformOutlineFromRig(buildDeformRig(fitted, options), sPrime);
}
