/**
 * Lane assignment for a commit graph — the "railway" of coloured lines that VS Code,
 * gitk and friends draw down the left of a history list.
 *
 * The input must be in the order `git log` produced (child before parent). The output
 * is purely geometric: which column each commit's dot sits in, and which line segments
 * run through the gap between each pair of adjacent rows. The component turns that into
 * SVG; nothing here knows about pixels.
 */

export interface GraphCommit {
  oid: string;
  parents: readonly string[];
}

export interface GraphRow {
  /** Column the commit's dot sits in. */
  lane: number;
  /** Lane state leaving this row: index → oid that lane is waiting for, null if free. */
  after: readonly (string | null)[];
  /** Lanes opened (or joined) for this commit's second and later parents. */
  extra: readonly number[];
}

export interface GraphEdge {
  /** Column the segment leaves the upper row at. */
  fromLane: number;
  /** Column it arrives at in the lower row. */
  toLane: number;
  /** The lane this segment belongs to — drives its colour. */
  lane: number;
}

export interface GraphLayout {
  rows: readonly GraphRow[];
  /** `gaps[i]` holds the segments drawn between row `i` and row `i + 1`. */
  gaps: readonly (readonly GraphEdge[])[];
  /**
   * Lanes still waiting for a commit after the last row — history that continues past
   * the window we fetched. Drawn as short stubs so the list doesn't look like a root.
   */
  trailing: readonly number[];
  laneCount: number;
}

export function layoutGraph(commits: readonly GraphCommit[]): GraphLayout {
  /** index → oid the lane is waiting to draw next, or null when the lane is free. */
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  const claimFree = (oid: string): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) {
        lanes[i] = oid;
        return i;
      }
    }
    lanes.push(oid);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    // A lane already waiting for this commit owns it; otherwise it starts a new one
    // (a branch tip, or a parent we reach before any child in this window).
    let lane = lanes.indexOf(commit.oid);
    if (lane === -1) lane = claimFree(commit.oid);

    // Any other lane waiting for the same commit converges into `lane`.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.oid) lanes[i] = null;
    }

    lanes[lane] = commit.parents[0] ?? null;

    const extra: number[] = [];
    for (let p = 1; p < commit.parents.length; p++) {
      const parent = commit.parents[p]!;
      const existing = lanes.indexOf(parent);
      extra.push(existing === -1 ? claimFree(parent) : existing);
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ lane, after: [...lanes], extra });
  }

  const gaps: GraphEdge[][] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const row = rows[i]!;
    const nextOid = commits[i + 1]!.oid;
    const nextLane = rows[i + 1]!.lane;
    const edges: GraphEdge[] = [];
    for (let L = 0; L < row.after.length; L++) {
      const waiting = row.after[L];
      if (waiting === null || waiting === undefined) continue;
      // The commit's own lane and its merge arms fan out from the dot; every other
      // lane just passes this row by, so it leaves at its own column.
      const fromLane = L === row.lane || row.extra.includes(L) ? row.lane : L;
      const toLane = waiting === nextOid ? nextLane : L;
      edges.push({ fromLane, toLane, lane: L });
    }
    gaps.push(edges);
  }

  const last = rows[rows.length - 1];
  const trailing: number[] = [];
  if (last) {
    for (let L = 0; L < last.after.length; L++) {
      if (last.after[L] !== null && last.after[L] !== undefined) trailing.push(L);
    }
  }

  let laneCount = 0;
  for (const row of rows) {
    laneCount = Math.max(laneCount, row.lane + 1, row.after.length);
    for (const e of row.extra) laneCount = Math.max(laneCount, e + 1);
  }

  return { rows, gaps, trailing, laneCount };
}
