import { MinPriorityQueue } from "@datastructures-js/priority-queue";
import paper from "paper";

import {
  FlatBoundary,
  buildFlatBoundary,
  nearestDistFlatBoundary,
} from "@/app/pathUtils/flatBoundary";
import { MedialAxisGraph } from "@/app/pathUtils/skeleton/medialAxis";
import { Vec2D } from "@/app/utils/types";

export type SkeletonConstructionOptions = {
  /** Maximum total output vertices (seeds + Steiner points). Default: 25. */
  maxTotalVertices: number;
  /** Maximum bisection depth for off-center edges. Default: 4. */
  maxBisectDepth: number;
  /** Centrality ratio threshold below which an edge is off-center. Default: 0.35. */
  centerThreshold: number;
  /** Centrality threshold used for Steiner sub-segment validity. Default: 0.25. */
  centerThresholdValid: number;
  /** Number of sample points along each edge for centrality checks. Default: 12. */
  centerNSamp: number;
  /**
   * Tikhonov regularisation strength for the arc-length LSQ Bezier fit.
   * λ = bezierLSQRegularization × (sumA² + sumB²) / (2 × arcLen), pulling cp1/cp2
   * toward the chord-line prior.  Dividing by arc length makes the regularisation
   * penalise equal relative curvature equally across all segment lengths.
   * 0 = no regularisation; higher values pull more strongly toward the chord line.
   * Default: 0.5.
   */
  bezierLSQRegularization: number;
};

/**
 * Constructs the Medial Skeleton (M_S) from selected vertices (V) and the Raw Medial Axis (M).
 * Implements Section 5.1: Medial Skeleton Construction.
 *
 * Robust design: every output vertex corresponds to exactly one raw axis node.
 * A global rawToOut map deduplicates so that T-junctions shared by multiple seed-pair
 * paths become a single shared vertex — preventing duplicate vertices, zero-length
 * edges, and back-and-forth loops.
 */
export function constructMedialSkeleton(
  selectedPoints: paper.Point[],
  rawMedialAxis: MedialAxisGraph,
  originalPath: paper.CompoundPath,
  enforceInsideEdges: boolean = false,
  options: Partial<SkeletonConstructionOptions> = {},
): MedialAxisGraph {
  const opts: SkeletonConstructionOptions = {
    maxTotalVertices: options.maxTotalVertices ?? 25,
    maxBisectDepth: options.maxBisectDepth ?? 4,
    centerThreshold: options.centerThreshold ?? CENTER_THRESHOLD,
    centerThresholdValid:
      options.centerThresholdValid ?? CENTER_THRESHOLD_VALID,
    centerNSamp: options.centerNSamp ?? CENTER_N_SAMP,
    bezierLSQRegularization: options.bezierLSQRegularization ?? 20,
  };

  // ---------------------------------------------------------
  // Pre-processing
  // ---------------------------------------------------------
  const rawAdj = buildAdjacencyList(rawMedialAxis);
  const rawPoints = rawMedialAxis.points;
  const numNodes = rawPoints.length;

  if (!isGraphConnected(rawAdj)) {
    throw new Error("Raw Medial Axis is not connected!");
  }

  // ---------------------------------------------------------
  // Step 1: Restricted Voronoi Diagram (multi-source Dijkstra)
  // ---------------------------------------------------------
  const seedIndices: number[] = selectedPoints.map((p) =>
    getNearestNodeIndex(p, rawPoints),
  );

  const nodeOwner = new Int32Array(numNodes).fill(-1);
  const distToSeed = new Float64Array(numNodes).fill(Infinity);

  const pq = new MinPriorityQueue<{ dist: number; u: number; owner: number }>(
    (x) => x.dist,
  );
  seedIndices.forEach((rawNodeIdx, seedIdx) => {
    nodeOwner[rawNodeIdx] = seedIdx;
    distToSeed[rawNodeIdx] = 0;
    pq.push({ dist: 0, u: rawNodeIdx, owner: seedIdx });
  });
  while (!pq.isEmpty()) {
    const { dist, u, owner } = pq.pop()!;
    if (dist > distToSeed[u] + 1e-5) continue;
    for (const v of rawAdj[u]) {
      const ru = rawPoints[u],
        rv = rawPoints[v];
      const w = Math.sqrt((rv.x - ru.x) ** 2 + (rv.y - ru.y) ** 2);
      if (!Number.isFinite(w)) continue;
      const nd = dist + w;
      if (nd < distToSeed[v]) {
        distToSeed[v] = nd;
        nodeOwner[v] = owner;
        pq.push({ dist: nd, u: v, owner });
      }
    }
  }

  // Step 1.5: Enforce single connected component per Voronoi cell
  for (let seedIdx = 0; seedIdx < selectedPoints.length; seedIdx++) {
    const seedRaw = seedIndices[seedIdx];
    const mainCC = new Set<number>([seedRaw]);
    const bfsQ = [seedRaw];
    while (bfsQ.length > 0) {
      const curr = bfsQ.shift()!;
      for (const nb of rawAdj[curr]) {
        if (!mainCC.has(nb) && nodeOwner[nb] === seedIdx) {
          mainCC.add(nb);
          bfsQ.push(nb);
        }
      }
    }
    const orphanVisited = new Set<number>();
    for (let i = 0; i < numNodes; i++) {
      if (nodeOwner[i] !== seedIdx || mainCC.has(i) || orphanVisited.has(i))
        continue;
      const cc: number[] = [];
      const ccQ = [i];
      orphanVisited.add(i);
      while (ccQ.length > 0) {
        const curr = ccQ.shift()!;
        cc.push(curr);
        for (const nb of rawAdj[curr]) {
          if (!orphanVisited.has(nb) && nodeOwner[nb] === seedIdx) {
            orphanVisited.add(nb);
            ccQ.push(nb);
          }
        }
      }
      let cx = 0,
        cy = 0;
      for (const n of cc) {
        cx += rawPoints[n].x;
        cy += rawPoints[n].y;
      }
      cx /= cc.length;
      cy /= cc.length;
      let minD = Infinity,
        nearest = seedIdx;
      for (let s = 0; s < selectedPoints.length; s++) {
        if (s === seedIdx) continue;
        const d = Math.hypot(
          selectedPoints[s].x - cx,
          selectedPoints[s].y - cy,
        );
        if (d < minD) {
          minD = d;
          nearest = s;
        }
      }
      for (const n of cc) nodeOwner[n] = nearest;
    }
  }

  const flatBoundary = buildFlatBoundary(originalPath);
  const rawNodeR = new Float64Array(numNodes);
  for (let i = 0; i < numNodes; i++)
    rawNodeR[i] = nearestDistFlatBoundary(
      rawPoints[i].x,
      rawPoints[i].y,
      flatBoundary,
    );

  // ---------------------------------------------------------
  // Step 2: Detect adjacent seed pairs via interface raw edges
  // ---------------------------------------------------------
  const adjacentPairs = new Set<string>();
  for (const [u, v] of rawMedialAxis.segments) {
    const oU = nodeOwner[u],
      oV = nodeOwner[v];
    if (oU < 0 || oV < 0 || oU === oV) continue;
    const [sA, sB] = oU < oV ? [oU, oV] : [oV, oU];
    adjacentPairs.add(`${sA}-${sB}`);
  }

  // ---------------------------------------------------------
  // Step 3: For each adjacent pair, find raw path(s) and collect T-junctions.
  // ---------------------------------------------------------
  // Use unconstrained BFS to find the true topological pair paths.  For ring
  // shapes the raw axis has a cycle, so after finding the first path we re-run
  // BFS with those edges excluded; if a second path exists it is the other side.
  const essentialRawNodes = new Set<number>(seedIndices);
  const pairPaths: Array<{ seedA: number; seedB: number; path: number[] }> = [];

  for (const key of adjacentPairs) {
    const [aStr, bStr] = key.split("-");
    const seedA = parseInt(aStr),
      seedB = parseInt(bStr);
    const rawA = seedIndices[seedA];
    const rawB = seedIndices[seedB];

    // Use unconstrained BFS so pair paths follow the true topological arms of the
    // raw medial axis.  The former A+B Voronoi constraint caused detours through
    // wrong-arm nodes (those owned by A or B but physically in a third arm C),
    // which then appeared as spurious T-junctions in essentialRawNodes and produced
    // phantom vertices and edges in the skeleton topology.  For directly adjacent
    // seed pairs the unique topological path is always found by unconstrained BFS.
    const path1 = bfsPath(rawA, rawB, rawAdj);
    if (!path1) continue;

    for (const node of path1) {
      if (rawAdj[node].length >= 3) essentialRawNodes.add(node);
    }
    pairPaths.push({ seedA, seedB, path: path1 });

    // Ring detection: build edge-exclusion set from path1, try to find a second path.
    // Use unconstrained BFS with edge exclusion so the ring's second side is also
    // traced along the true topological path.
    const excludeEdges = new Set<string>();
    for (let i = 0; i + 1 < path1.length; i++) {
      const a = path1[i],
        b = path1[i + 1];
      excludeEdges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
    const path2 = bfsPathFiltered(rawA, rawB, rawAdj, () => true, excludeEdges);
    if (path2) {
      for (const node of path2) {
        if (rawAdj[node].length >= 3) essentialRawNodes.add(node);
      }
      pairPaths.push({ seedA, seedB, path: path2 });
    }
  }

  // ---------------------------------------------------------
  // Step 4: Create one output vertex per essential raw node (global dedup)
  // ---------------------------------------------------------
  // Seeds use their MSD-optimized positions (selectedPoints); all other essential
  // nodes use the raw axis position.
  const rawToOut = new Map<number, number>();
  const finalPoints: paper.Point[] = [];

  // Seeds first — preserves indices 0..nSeeds-1 for the leaf-snap loop.
  // T-junction seeds (raw node degree >= 3) snap to the raw axis position so
  // that multi-branch junctions land exactly on the topological branch point.
  for (let si = 0; si < selectedPoints.length; si++) {
    const rn = seedIndices[si];
    if (!rawToOut.has(rn)) {
      rawToOut.set(rn, finalPoints.length);
      const useRawPos = rawAdj[rn].length >= 3;
      finalPoints.push(
        useRawPos
          ? new paper.Point(rawPoints[rn])
          : new paper.Point(selectedPoints[si]),
      );
    }
  }

  function getOrAddVertex(rn: number): number {
    let idx = rawToOut.get(rn);
    if (idx !== undefined) return idx;
    idx = finalPoints.length;
    rawToOut.set(rn, idx);
    finalPoints.push(new paper.Point(rawPoints[rn]));
    return idx;
  }

  for (const rn of essentialRawNodes) getOrAddVertex(rn);

  // ---------------------------------------------------------
  // Step 5: Build output edges from essential chains; check centrality
  // ---------------------------------------------------------
  const newSegments: [number, number][] = [];
  const finalControlPoints: [Vec2D, Vec2D][] = [];
  const rawPathSamples: [Vec2D, Vec2D, Vec2D][] = [];
  const segmentRawPaths: number[][] = []; // stored so leaf-snap can re-run bezierCPs
  const segmentSet = new Set<string>();

  function addSegment(
    u: number,
    v: number,
    cp1: Vec2D,
    cp2: Vec2D,
    rawPath: number[],
  ): void {
    if (u === v) return;
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (segmentSet.has(key)) return;
    segmentSet.add(key);
    newSegments.push([u, v]);
    finalControlPoints.push([cp1, cp2]);
    segmentRawPaths.push(rawPath);
    const n = rawPath.length;
    rawPathSamples.push([
      rawPoints[rawPath[Math.floor(n / 4)]],
      rawPoints[rawPath[Math.floor(n / 2)]],
      rawPoints[rawPath[Math.floor((3 * n) / 4)]],
    ]);
  }

  // Fallback: tangent-based control point estimation (arc-length look-ahead).
  // Used when the LSQ system is ill-conditioned or the raw path is too short.
  function tangentBasedBezierCPs(
    rawPath: number[],
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
      // Skip micro-steps at the start of the raw path (< 5px) that appear when
      // a T-junction node is offset from the rest of the raw axis.  Then walk
      // forward until cumulative arc-length >= MIN_DIST.
      // The departure tangent is computed as the body direction (rawPath[startA]
      // → rawPath[kA]) rather than the vertex-to-look-ahead direction, so the
      // junction kink at rawPath[0] doesn't tilt the Bezier.
      const MIN_STEP = 5.0;
      const MIN_DIST = Math.min(chord * 0.12, 40.0);

      let startA = 1;
      while (startA < n - 1) {
        const ps = rawPoints[rawPath[startA]];
        const p0 = rawPoints[rawPath[0]];
        if (Math.hypot(ps.x - p0.x, ps.y - p0.y) >= MIN_STEP) break;
        startA++;
      }
      // Walk forward from startA: advance kA first, then check cumulative distance.
      // This guarantees kA > startA so pStart != p1 and the tangent is never zero.
      let cumA = 0,
        kA = startA;
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
        // Path too short for body-direction: fall back to raw-path chord
        const r0 = rawPoints[rawPath[0]],
          rN1 = rawPoints[rawPath[n - 1]];
        const df = Math.hypot(rN1.x - r0.x, rN1.y - r0.y);
        if (df > 1e-6) {
          txA = (rN1.x - r0.x) / df;
          tyA = (rN1.y - r0.y) / df;
        }
      }

      // Arrival tangent at pB: walk backward from n-2 until cumulative arc >= MIN_DIST,
      // then use direction from rawPath[kB] toward pB (the actual output vertex).
      // Unlike the departure, we always aim toward pB — not toward a raw node — so that
      // T-junction snaps and NM-displaced endpoints arrive at the correct vertex position.
      let cumB = 0,
        kB = n - 2;
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
        // kB is right next to pB; use the raw-path chord as fallback
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

  // Arc-length least-squares fit of cp1/cp2 to all raw path nodes.
  // Minimises sum of squared distances from raw axis points to the cubic Bezier.
  // Falls back to tangent-based estimation when the system is ill-conditioned.
  function bezierCPs(rawPath: number[], pA: Vec2D, pB: Vec2D): [Vec2D, Vec2D] {
    const n = rawPath.length;
    // Need ≥4 nodes: endpoints (t=0,1) contribute A=B=0; n=3 gives a rank-1 system.
    if (n < 4) return tangentBasedBezierCPs(rawPath, pA, pB);

    // Arc-length parameterisation along the raw path
    const arcLen = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const prev = rawPoints[rawPath[i - 1]],
        curr = rawPoints[rawPath[i]];
      arcLen[i] = arcLen[i - 1] + Math.hypot(curr.x - prev.x, curr.y - prev.y);
    }
    const totalLen = arcLen[n - 1];
    if (totalLen < 1e-6) return tangentBasedBezierCPs(rawPath, pA, pB);

    // Accumulate normal-equation sums for the 2×2 system (x and y share the same matrix)
    let sumA2 = 0,
      sumAB = 0,
      sumB2 = 0;
    let sumARx = 0,
      sumBRx = 0,
      sumARy = 0,
      sumBRy = 0;
    for (let i = 0; i < n; i++) {
      const t = arcLen[i] / totalLen,
        u = 1 - t;
      const Ai = 3 * u * u * t,
        Bi = 3 * u * t * t;
      const pt = rawPoints[rawPath[i]];
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

    // Tikhonov regularisation: add λ·‖(cp − cp_nat)/L‖² toward the chord-line prior.
    // Dividing by totalLen normalises by arc length so the relative-curvature bias
    // is constant across segment lengths (without it, longer segments get suppressed
    // more than shorter ones with equal curvature).
    const lambda =
      (opts.bezierLSQRegularization * (sumA2 + sumB2)) / 2 / totalLen;
    const cp1NatX = pA.x + (pB.x - pA.x) / 3,
      cp1NatY = pA.y + (pB.y - pA.y) / 3;
    const cp2NatX = pA.x + (2 * (pB.x - pA.x)) / 3,
      cp2NatY = pA.y + (2 * (pB.y - pA.y)) / 3;
    const rA2 = sumA2 + lambda,
      rB2 = sumB2 + lambda;
    const rARx = sumARx + lambda * cp1NatX,
      rARy = sumARy + lambda * cp1NatY;
    const rBRx = sumBRx + lambda * cp2NatX,
      rBRy = sumBRy + lambda * cp2NatY;

    // Cramer's rule; fall back if matrix is still ill-conditioned
    const det = rA2 * rB2 - sumAB * sumAB;
    if (!(Math.abs(det) >= 1e-10 * rA2 * rB2)) {
      return tangentBasedBezierCPs(rawPath, pA, pB);
    }
    return [
      {
        x: (rARx * rB2 - rBRx * sumAB) / det,
        y: (rARy * rB2 - rBRy * sumAB) / det,
      },
      {
        x: (rA2 * rBRx - sumAB * rARx) / det,
        y: (rA2 * rBRy - sumAB * rARy) / det,
      },
    ];
  }

  // Returns true if the bone curve from pA to pB (Bezier if cp given) stays inside the path.
  function isEdgeInside(
    pA: Vec2D,
    pB: Vec2D,
    cp1?: Vec2D,
    cp2?: Vec2D,
  ): boolean {
    for (let k = 1; k < opts.centerNSamp; k++) {
      const { x, y } = evalBone(pA, pB, cp1, cp2, k / opts.centerNSamp);
      if (!originalPath.contains(new paper.Point(x, y))) return false;
    }
    return true;
  }

  // Emit a skeleton edge along a specific raw-axis sub-path.
  // Steiner candidates are picked from rawPath itself (not from a fresh BFS),
  // so ring shapes whose two pair-paths share the same endpoints still produce
  // distinct Steiner nodes (one from each half of the raw ring).
  function emitEdge(
    rawPath: number[],
    depth: number,
    maxDepth = opts.maxBisectDepth,
  ): void {
    if (rawPath.length < 2) return;
    const rawA = rawPath[0];
    const rawB = rawPath[rawPath.length - 1];
    if (rawA === rawB) return;
    const idxA = rawToOut.get(rawA)!;
    const idxB = rawToOut.get(rawB)!;
    if (idxA === idxB) return;

    const pA = finalPoints[idxA];
    const pB = finalPoints[idxB];
    const [cp1, cp2] = bezierCPs(rawPath, pA, pB);

    if (depth >= maxDepth || finalPoints.length >= opts.maxTotalVertices) {
      addSegment(idxA, idxB, cp1, cp2, rawPath);
      return;
    }

    const centerd = isEdgeCenterd(
      pA,
      pB,
      flatBoundary,
      opts.centerThreshold,
      opts.centerNSamp,
      cp1,
      cp2,
    );
    const inside = !enforceInsideEdges || isEdgeInside(pA, pB, cp1, cp2);

    if (centerd && inside) {
      addSegment(idxA, idxB, cp1, cp2, rawPath);
      return;
    }

    // Find Steiner candidates within rawPath (interior nodes only).
    // Priority: T-junction, then max-R, then path midpoint.
    // Sub-segment control points are not pre-computed here; sub-segments use straight-line
    // checks (no cp) since their bezierCPs will be recomputed when emitEdge recurses.
    let branchCandIdx = -1,
      maxRCandIdx = -1,
      maxR = -1;
    for (let i = 1; i < rawPath.length - 1; i++) {
      const n = rawPath[i];
      if (branchCandIdx < 0 && rawAdj[n].length >= 3) branchCandIdx = i;
      if (rawNodeR[n] > maxR) {
        maxR = rawNodeR[n];
        maxRCandIdx = i;
      }
    }
    const midCandIdx =
      rawPath.length >= 3 ? Math.floor((rawPath.length - 1) / 2) : -1;

    for (const ci of [branchCandIdx, maxRCandIdx, midCandIdx]) {
      if (ci <= 0 || ci >= rawPath.length - 1) continue;
      const candRaw = rawPath[ci];
      const candPt = new paper.Point(rawPoints[candRaw]);
      const subCenterd =
        isEdgeCenterd(
          pA,
          candPt,
          flatBoundary,
          opts.centerThresholdValid,
          opts.centerNSamp,
        ) &&
        isEdgeCenterd(
          candPt,
          pB,
          flatBoundary,
          opts.centerThresholdValid,
          opts.centerNSamp,
        );
      // Bisect if sub-segments are centrally valid, OR if the current edge exits the shape
      // (in which case any bisection is better than accepting an outside edge).
      if (subCenterd || !inside) {
        getOrAddVertex(candRaw);
        emitEdge(rawPath.slice(0, ci + 1), depth + 1, maxDepth);
        emitEdge(rawPath.slice(ci), depth + 1, maxDepth);
        return;
      }
    }

    addSegment(idxA, idxB, cp1, cp2, rawPath);
  }

  for (const { path } of pairPaths) {
    // Identify where each essential node sits in the raw path, then emit
    // sub-paths between consecutive essential nodes.
    const chainPositions: number[] = [];
    for (let i = 0; i < path.length; i++) {
      if (
        rawToOut.has(path[i]) &&
        (chainPositions.length === 0 ||
          path[chainPositions[chainPositions.length - 1]] !== path[i])
      ) {
        chainPositions.push(i);
      }
    }
    for (let i = 0; i + 1 < chainPositions.length; i++) {
      const subPath = path.slice(chainPositions[i], chainPositions[i + 1] + 1);
      emitEdge(subPath, 0);
    }
  }

  // ---------------------------------------------------------
  // Step 6: Snap leaf seeds to raw medial-axis tips
  // ---------------------------------------------------------
  // Seed positions are snapped to nearest raw node which may be short of the
  // actual stroke tip. For each leaf seed, snap to the raw degree-1 node in
  // its Voronoi region that is most aligned with the outward direction.
  // Only direct-snap if tipR ≥ origR × 0.65; otherwise append as a stub leaf
  // (keeps the original wide-coverage disk while adding a tip for the cap).

  // Reverse map: output vertex index → the raw node that created it.
  // Used after direct-snap to re-run BFS for incident edge raw paths.
  const outToRaw = new Map<number, number>();
  for (const [rn, outIdx] of rawToOut) outToRaw.set(outIdx, rn);

  const outDegree = new Int32Array(finalPoints.length);
  for (const [u, v] of newSegments) {
    outDegree[u]++;
    outDegree[v]++;
  }

  const nSeeds = selectedPoints.length;
  for (let si = 0; si < nSeeds; si++) {
    const seedOutIdx = rawToOut.get(seedIndices[si])!;
    if (outDegree[seedOutIdx] !== 1) continue;

    let nbIdx = -1;
    for (const [u, v] of newSegments) {
      if (u === seedOutIdx) {
        nbIdx = v;
        break;
      }
      if (v === seedOutIdx) {
        nbIdx = u;
        break;
      }
    }
    if (nbIdx < 0) continue;
    const nbPt = finalPoints[nbIdx];

    const siPt = finalPoints[seedOutIdx];
    const brDx = siPt.x - nbPt.x,
      brDy = siPt.y - nbPt.y;
    const brLen = Math.hypot(brDx, brDy);
    const outX = brLen > 1e-6 ? brDx / brLen : 1;
    const outY = brLen > 1e-6 ? brDy / brLen : 0;

    const rawTips: Array<{ rn: number; dist: number }> = [];
    for (let rn = 0; rn < numNodes; rn++) {
      if (nodeOwner[rn] !== si || rawAdj[rn].length !== 1) continue;
      const dist = Math.hypot(
        rawPoints[rn].x - siPt.x,
        rawPoints[rn].y - siPt.y,
      );
      if (dist < 2) continue;
      rawTips.push({ rn, dist });
    }

    const origR = rawNodeR[seedIndices[si]];

    // Direct snap: try tips sorted by outward-projection score (score-first).
    // Moves the seed vertex to the raw tip position when the edge is centerd.
    let directSnapRn = -1;
    rawTips.sort((a, b) => {
      const sA =
        (rawPoints[a.rn].x - siPt.x) * outX +
        (rawPoints[a.rn].y - siPt.y) * outY;
      const sB =
        (rawPoints[b.rn].x - siPt.x) * outX +
        (rawPoints[b.rn].y - siPt.y) * outY;
      return sB - sA;
    });
    for (const { rn } of rawTips) {
      if (finalPoints.length >= opts.maxTotalVertices) break;
      // Skip tips that are behind the outward direction — snapping to them would move
      // the seed toward the junction rather than away from it, causing topological
      // contradictions when the stub later tries to reach the correct arm tip.
      const tdx = rawPoints[rn].x - siPt.x, tdy = rawPoints[rn].y - siPt.y;
      if (tdx * outX + tdy * outY <= 0) continue;
      const tipR = rawNodeR[rn];
      if (
        tipR >= origR * 0.65 &&
        isEdgeCenterd(
          rawPoints[rn],
          nbPt,
          flatBoundary,
          opts.centerThreshold,
          opts.centerNSamp,
        ) &&
        (!enforceInsideEdges || isEdgeInside(rawPoints[rn], nbPt))
      ) {
        finalPoints[seedOutIdx] = new paper.Point(rawPoints[rn]);
        directSnapRn = rn;
        // Register the snapped raw node so emitEdge can resolve it to seedOutIdx,
        // and update the reverse map so subsequent edge re-BFS uses the new position.
        rawToOut.set(directSnapRn, seedOutIdx);
        outToRaw.set(seedOutIdx, directSnapRn);
        // The vertex moved: re-run BFS between the actual final raw nodes of each
        // incident edge so that raw paths, samples, and CPs all reflect the true
        // medial-axis geometry between the snapped endpoint and its neighbour.
        for (let segI = 0; segI < newSegments.length; segI++) {
          const [su, sv] = newSegments[segI];
          if (su !== seedOutIdx && sv !== seedOutIdx) continue;
          const suRaw =
            su === seedOutIdx ? directSnapRn : outToRaw.get(su);
          const svRaw =
            sv === seedOutIdx ? directSnapRn : outToRaw.get(sv);
          const pA2 = finalPoints[su],
            pB2 = finalPoints[sv];
          if (suRaw !== undefined && svRaw !== undefined) {
            const newRawPath =
              bfsPath(suRaw, svRaw, rawAdj) ?? segmentRawPaths[segI];
            segmentRawPaths[segI] = newRawPath;
            const np = newRawPath.length;
            rawPathSamples[segI] = [
              rawPoints[newRawPath[Math.floor(np / 4)]],
              rawPoints[newRawPath[Math.floor(np / 2)]],
              rawPoints[newRawPath[Math.floor((3 * np) / 4)]],
            ];
          }
          finalControlPoints[segI] = bezierCPs(segmentRawPaths[segI], pA2, pB2);
        }
        break;
      }
    }

    // Stub: route from seed to farthest raw tip via emitEdge (handles curved arms).
    // Always add UNLESS direct snap already reached that exact tip.
    // emitEdge bisects using actual path midpoints so curved arms stay centerd.
    rawTips.sort((a, b) => b.dist - a.dist);
    if (rawTips.length > 0 && finalPoints.length < opts.maxTotalVertices) {
      const { rn: tipRn } = rawTips[0];
      if (tipRn !== directSnapRn) {
        getOrAddVertex(tipRn);
        const inSeed = (n: number) => nodeOwner[n] === si;
        // Start the stub BFS from the snapped raw node when a direct-snap occurred,
        // so the stub raw path begins at the seed's actual final position.
        // Fall back to the original seed raw node if the snapped node is not
        // reachable from tipRn through seed-owned nodes.
        const stubStart =
          directSnapRn >= 0 ? directSnapRn : seedIndices[si];
        const stubPath =
          bfsPathFiltered(stubStart, tipRn, rawAdj, inSeed) ??
          (directSnapRn >= 0
            ? bfsPathFiltered(seedIndices[si], tipRn, rawAdj, inSeed)
            : null);
        // Limit stub to 1 bisection: deeper recursion can't help since the
        // tip-side sub-segment always fails isEdgeCenterd (r→0 at the tip).
        if (stubPath) emitEdge(stubPath, 0, 1);
      }
    }
  }

  return {
    points: finalPoints,
    segments: newSegments,
    controlPoints: finalControlPoints,
    rawPathSamples,
  };
}

// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------

// BFS shortest path from `from` to `to`; returns node sequence or null if unreachable.
function bfsPath(from: number, to: number, adj: number[][]): number[] | null {
  if (from === to) return [from];
  const parent = new Int32Array(adj.length).fill(-2);
  parent[from] = -1;
  const queue = [from];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] === -2) {
        parent[nb] = curr;
        if (nb === to) {
          found = true;
          break outer;
        }
        queue.push(nb);
      }
    }
  }
  if (!found) return null;
  const path: number[] = [];
  let curr = to;
  while (curr !== -1) {
    path.push(curr);
    curr = parent[curr];
  }
  path.reverse();
  return path;
}

// BFS shortest path constrained to nodes passing nodeFilter (endpoints always included).
// Optional excludeEdges set (keys "u-v" with u<v) skips those edges entirely.
function bfsPathFiltered(
  from: number,
  to: number,
  adj: number[][],
  nodeFilter: (n: number) => boolean,
  excludeEdges?: Set<string>,
): number[] | null {
  if (from === to) return [from];
  const parent = new Int32Array(adj.length).fill(-2);
  parent[from] = -1;
  const queue = [from];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] !== -2) continue;
      if (nb !== to && !nodeFilter(nb)) continue;
      if (excludeEdges) {
        const ek = curr < nb ? `${curr}-${nb}` : `${nb}-${curr}`;
        if (excludeEdges.has(ek)) continue;
      }
      parent[nb] = curr;
      if (nb === to) {
        found = true;
        break outer;
      }
      queue.push(nb);
    }
  }
  if (!found) return null;
  const path: number[] = [];
  let curr = to;
  while (curr !== -1) {
    path.push(curr);
    curr = parent[curr];
  }
  path.reverse();
  return path;
}

// Max inscribed-radius node strictly between nodeA and nodeB on BFS shortest path.
function findMaxRSteinerId(
  nodeA: number,
  nodeB: number,
  adj: number[][],
  nodeR: Float64Array,
): number {
  if (nodeA === nodeB) return -1;
  const n = adj.length;
  const parent = new Int32Array(n).fill(-2);
  parent[nodeA] = -1;
  const queue = [nodeA];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] === -2) {
        parent[nb] = curr;
        if (nb === nodeB) {
          found = true;
          break outer;
        }
        queue.push(nb);
      }
    }
  }
  if (!found) return -1;
  let maxR = -1,
    best = -1;
  let curr = parent[nodeB];
  while (curr !== nodeA && curr !== -1) {
    if (nodeR[curr] > maxR) {
      maxR = nodeR[curr];
      best = curr;
    }
    curr = parent[curr];
  }
  return best;
}

// First degree-3+ node on BFS shortest path from nodeA to nodeB (excluding endpoints).
function findBranchSteinerId(
  nodeA: number,
  nodeB: number,
  adj: number[][],
): number {
  if (nodeA === nodeB) return -1;
  const n = adj.length;
  const parent = new Int32Array(n).fill(-2);
  parent[nodeA] = -1;
  const queue = [nodeA];
  let found = false;
  outer: while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const nb of adj[curr]) {
      if (parent[nb] === -2) {
        parent[nb] = curr;
        if (nb === nodeB) {
          found = true;
          break outer;
        }
        queue.push(nb);
      }
    }
  }
  if (!found) return -1;
  let curr = parent[nodeB];
  while (curr !== nodeA && curr !== -1) {
    if (adj[curr].length >= 3) return curr;
    curr = parent[curr];
  }
  if (adj[nodeA].length >= 3) return nodeA;
  return -1;
}

const CENTER_THRESHOLD = 0.35;
const CENTER_THRESHOLD_VALID = 0.25;
const CENTER_N_SAMP = 12;

// Evaluate a point on the bone curve at t ∈ [0,1].
// Uses the cubic Bezier when cp1/cp2 are given, otherwise linear interpolation.
function evalBone(
  pA: Vec2D,
  pB: Vec2D,
  cp1: Vec2D | undefined,
  cp2: Vec2D | undefined,
  t: number,
): { x: number; y: number } {
  if (!cp1 || !cp2)
    return { x: pA.x + t * (pB.x - pA.x), y: pA.y + t * (pB.y - pA.y) };
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

function isEdgeCenterd(
  pA: Vec2D,
  pB: Vec2D,
  fb: FlatBoundary,
  threshold = CENTER_THRESHOLD,
  nSamp = CENTER_N_SAMP,
  cp1?: Vec2D,
  cp2?: Vec2D,
): boolean {
  let minDist = Infinity,
    maxDist = 0;
  for (let k = 0; k <= nSamp; k++) {
    const { x, y } = evalBone(pA, pB, cp1, cp2, k / nSamp);
    const d = nearestDistFlatBoundary(x, y, fb);
    if (d < minDist) minDist = d;
    if (d > maxDist) maxDist = d;
  }
  if (maxDist <= 0) return true;
  return minDist / maxDist >= threshold;
}

function isGraphConnected(adj: number[][]): boolean {
  const n = adj.length;
  if (n <= 1) return true;
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    for (const nb of adj[queue.shift()!]) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited.size === n;
}

function buildAdjacencyList(graph: MedialAxisGraph): number[][] {
  const adj: number[][] = Array.from({ length: graph.points.length }, () => []);
  for (const [u, v] of graph.segments) {
    adj[u].push(v);
    adj[v].push(u);
  }
  return adj;
}

function getNearestNodeIndex(pt: paper.Point, nodes: Vec2D[]): number {
  let minDst = Infinity,
    idx = -1;
  for (let i = 0; i < nodes.length; i++) {
    const dx = pt.x - nodes[i].x,
      dy = pt.y - nodes[i].y;
    const d = dx * dx + dy * dy;
    if (d < minDst) {
      minDst = d;
      idx = i;
    }
  }
  return idx;
}
