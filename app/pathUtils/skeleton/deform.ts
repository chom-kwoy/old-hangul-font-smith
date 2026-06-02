import paper from "paper";

import {
  bezierTangent,
  evalBezier,
  footParamOnBezier,
} from "@/app/pathUtils/skeleton/bezierFitting";
import {
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
 *   - a boundary shared between neighbouring capsules (from boundaryTags) is
 *     warped independently on each side by that capsule's own frame (full stroke
 *     width preserved), and the seam strip between the two diverged sides is
 *     stitched shut with quads — see `buildStitchQuads`.
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

// Polar handle relative to the owning edge's tangent at the anchor's foot.
// null when the handle is zero (straight segment).
type HandleEnc = { edge: number; t: number; dist: number; angle: number } | null;

type SegEnc = {
  // Own-edge encoding: the anchor is warped by this capsule's own bone frame.
  point: AnchorMember;
  // True when the anchor lies on a shared seam (endpoint of a `shared:n` curve).
  // Such anchors diverge from the neighbour under deformation; the seam is
  // closed by stitch quads rather than by averaging the two sides.
  shared: boolean;
  handleIn: HandleEnc;
  handleOut: HandleEnc;
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
};

/**
 * One shared-boundary curve of capsule A together with the matching mirror
 * anchors of neighbour B, by (ring, segment) index into each primitive's warped
 * clippedPath. After deformation the seam strip A0'→B0'→B1'→A1' is filled.
 */
type StitchLink = {
  aPrim: number;
  aRing: number;
  aSeg0: number;
  aSeg1: number;
  bPrim: number;
  bRing0: number;
  bSeg0: number;
  bRing1: number;
  bSeg1: number;
};

export type DeformRig = {
  segments: [number, number][];
  points: Vec2D[];
  controlPoints?: [Vec2D, Vec2D][];
  primitives: RigPrimitive[];
  stitches: StitchLink[];
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

  // Per-primitive anchor index: snapped coord → (ring, segment) into its
  // clippedPath. Lets a primitive's shared curve find the neighbour's mirror
  // anchors for stitching.
  const anchorIndex: Map<string, { ring: number; seg: number }>[] = [];

  const rigPrims: RigPrimitive[] = fitted.primitives.map((prim) => {
    const index = new Map<string, { ring: number; seg: number }>();
    anchorIndex.push(index);
    if (prim.type !== "edge" || !prim.clippedPath) {
      return { prim, rings: [], closed: [] };
    }
    const ownEdge = prim.elementIdx;
    const rings: SegEnc[][] = [];
    const closed: boolean[] = [];
    let r = 0;
    for (const ring of ringsOf(prim.clippedPath)) {
      const segEncs: SegEnc[] = [];
      let prevT = 0;
      let s = 0;
      for (const seg of ring.segments) {
        const q = seg.point;
        const own = encodeAnchor(q, ownEdge, prevT);
        prevT = own.t;

        const key = coordKey(q.x, q.y);
        index.set(key, { ring: r, seg: s });
        const sharers = sharedAt.get(key);

        segEncs.push({
          point: own,
          shared: !!sharers && sharers.size >= 2,
          handleIn: encodeHandle(seg.handleIn, ownEdge, own.t),
          handleOut: encodeHandle(seg.handleOut, ownEdge, own.t),
        });
        s++;
      }
      rings.push(segEncs);
      closed.push(ring.closed);
      r++;
    }
    return { prim, rings, closed };
  });

  // Stitch links: one per shared boundary curve, recorded from the lower-index
  // capsule so each seam strip is built exactly once.
  const stitches: StitchLink[] = [];
  for (let pi = 0; pi < fitted.primitives.length; pi++) {
    const prim = fitted.primitives[pi];
    if (!prim.clippedPath || !prim.boundaryTags) continue;
    let r = 0;
    for (const ring of ringsOf(prim.clippedPath)) {
      const segs = ring.segments;
      const n = segs.length;
      for (let ci = 0; ci < n; ci++) {
        const tag = prim.boundaryTags[ci];
        if (!tag || tag.kind !== "shared") continue;
        const nB = tag.neighbour;
        if (pi >= nB) continue; // canonical: build from the lower-index side
        const ci1 = (ci + 1) % n;
        const b0 = anchorIndex[nB].get(coordKey(segs[ci].point.x, segs[ci].point.y));
        const b1 = anchorIndex[nB].get(coordKey(segs[ci1].point.x, segs[ci1].point.y));
        if (!b0 || !b1) continue; // mirror anchor missing — skip rather than crash
        stitches.push({
          aPrim: pi,
          aRing: r,
          aSeg0: ci,
          aSeg1: ci1,
          bPrim: nB,
          bRing0: b0.ring,
          bSeg0: b0.seg,
          bRing1: b1.ring,
          bSeg1: b1.seg,
        });
      }
      r++;
    }
  }

  return {
    segments,
    points: fitted.points,
    controlPoints: fitted.controlPoints,
    stitches,
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
        if (se.shared) continue; // seam anchors are stitched, not spoked
        const m = se.point;
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
 * Apply a precomputed rig to an edited skeleton, returning the deformed
 * primitives (each with a warped `clippedPath`; original boundaryTags / type /
 * elementIdx / origins / directions / radii carried through).
 */
export function applyDeform(
  rig: DeformRig,
  sPrime: DeformedSkeleton,
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

    const ringPaths: paper.Path[] = [];
    for (let r = 0; r < rp.rings.length; r++) {
      const segs = rp.rings[r].map((se) => {
        const pt = warpAnchor(se.point, sPrime, segments);
        const hin = warpHandle(se.handleIn, sPrime, segments);
        const hout = warpHandle(se.handleOut, sPrime, segments);
        return new paper.Segment(
          new paper.Point(pt.x, pt.y),
          new paper.Point(hin.x, hin.y),
          new paper.Point(hout.x, hout.y),
        );
      });
      ringPaths.push(new paper.Path({ segments: segs, closed: rp.closed[r], insert: false }));
    }
    const clippedPath: paper.PathItem =
      ringPaths.length === 1
        ? ringPaths[0]
        : new paper.CompoundPath({ children: ringPaths, insert: false });
    return { ...prim, clippedPath };
  });
}

/**
 * Build the seam-stitch shapes for the warped primitives. Each shared boundary
 * curve of capsule A — whose two anchors A0,A1 diverge from neighbour B's mirror
 * anchors B0,B1 once each side is warped by its own frame — yields the strip cell
 * A0'→B0'→B1'→A1'. The strip is emitted as two triangles (A0'B0'B1' and
 * A0'B1'A1') so it stays well-formed even where A and B cross at a concave
 * corner. Degenerate strips (a straight seam, where A'=B') are skipped, so the
 * identity warp adds nothing.
 */
export function buildStitchQuads(
  rig: DeformRig,
  warped: Primitive[],
): paper.Path[] {
  const anchor = (primIdx: number, ring: number, seg: number): paper.Point => {
    const cp = warped[primIdx].clippedPath!;
    const p = ringsOf(cp)[ring].segments[seg].point;
    return new paper.Point(p.x, p.y);
  };
  const tris: paper.Path[] = [];
  for (const s of rig.stitches) {
    const a0 = anchor(s.aPrim, s.aRing, s.aSeg0);
    const a1 = anchor(s.aPrim, s.aRing, s.aSeg1);
    const b0 = anchor(s.bPrim, s.bRing0, s.bSeg0);
    const b1 = anchor(s.bPrim, s.bRing1, s.bSeg1);
    if (a0.getDistance(b0) < 1e-6 && a1.getDistance(b1) < 1e-6) continue; // straight seam
    tris.push(
      new paper.Path({ segments: [a0, b0, b1], closed: true, insert: false }),
      new paper.Path({ segments: [a0, b1, a1], closed: true, insert: false }),
    );
  }
  return tris;
}

/**
 * Bezier-preserving union of warped primitives (plus any extra shapes, e.g.
 * stitch quads) into a single outline.
 */
export function unionDeformedPrimitives(
  prims: Primitive[],
  extraShapes: paper.PathItem[] = [],
): paper.PathItem | null {
  const shapes: paper.PathItem[] = [];
  for (const prim of prims) if (prim.clippedPath) shapes.push(prim.clippedPath);
  shapes.push(...extraShapes);

  let acc: paper.PathItem | null = null;
  for (const s of shapes) {
    const shape = s.clone({ insert: false });
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
 * bezier outline with seams stitched. Identity when sPrime equals the original
 * skeleton.
 */
export function deformOutline(
  fitted: FittedMedialAxisGraph,
  sPrime: DeformedSkeleton,
): paper.PathItem | null {
  const rig = buildDeformRig(fitted);
  const warped = applyDeform(rig, sPrime);
  const quads = buildStitchQuads(rig, warped);
  return unionDeformedPrimitives(warped, quads);
}
