import { MedialAxisGraph } from "@/app/pathUtils/skeleton/medialAxis";

/** Build an adjacency list from a MedialAxisGraph's segments. */
export function buildAdjacencyList(graph: MedialAxisGraph): number[][] {
  const adj: number[][] = Array.from({ length: graph.points.length }, () => []);
  for (const [u, v] of graph.segments) {
    adj[u].push(v);
    adj[v].push(u);
  }
  return adj;
}

/** Per-vertex degree (number of incident segments). */
export function computeDegrees(graph: MedialAxisGraph): Int32Array {
  const deg = new Int32Array(graph.points.length);
  for (const [u, v] of graph.segments) {
    deg[u]++;
    deg[v]++;
  }
  return deg;
}

/**
 * BFS shortest path (by edge count) from `from` to `to` over an unweighted
 * adjacency list. Returns the node sequence, or null if unreachable.
 */
export function bfsPath(
  from: number,
  to: number,
  adj: number[][],
): number[] | null {
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
