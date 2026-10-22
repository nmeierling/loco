import { describe, expect, it } from 'vitest';
import { layoutGraph } from './git-graph';

const c = (oid: string, ...parents: string[]) => ({ oid, parents });

describe('layoutGraph', () => {
  it('keeps a linear history in a single lane', () => {
    const l = layoutGraph([c('A', 'B'), c('B', 'C'), c('C')]);
    expect(l.laneCount).toBe(1);
    expect(l.rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(l.gaps).toEqual([
      [{ fromLane: 0, toLane: 0, lane: 0 }],
      [{ fromLane: 0, toLane: 0, lane: 0 }],
    ]);
    expect(l.trailing).toEqual([]);
  });

  it('fans a merge commit out to a second lane and back in at the shared parent', () => {
    //  M   ← merge of P1 and P2
    //  |\
    //  P1 |
    //  |  P2
    //  G   ← both arms rejoin here
    const l = layoutGraph([c('M', 'P1', 'P2'), c('P1', 'G'), c('P2', 'G'), c('G')]);
    expect(l.laneCount).toBe(2);
    expect(l.rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
    expect(l.rows[0]!.extra).toEqual([1]);

    // The merge arm leaves the dot in lane 0 and lands in lane 1.
    expect(l.gaps[0]).toEqual([
      { fromLane: 0, toLane: 0, lane: 0 },
      { fromLane: 0, toLane: 1, lane: 1 },
    ]);
    // Lane 1 converges back into lane 0 where G sits.
    expect(l.gaps[2]).toEqual([
      { fromLane: 0, toLane: 0, lane: 0 },
      { fromLane: 1, toLane: 0, lane: 1 },
    ]);
  });

  it('gives a second branch tip its own lane until the branches join', () => {
    const l = layoutGraph([c('A', 'C'), c('B', 'C'), c('C')]);
    expect(l.laneCount).toBe(2);
    expect(l.rows.map((r) => r.lane)).toEqual([0, 1, 0]);
    expect(l.gaps[1]).toEqual([
      { fromLane: 0, toLane: 0, lane: 0 },
      { fromLane: 1, toLane: 0, lane: 1 },
    ]);
  });

  it('reuses a lane once it is free', () => {
    //  A        lane 0, parent C
    //  B        lane 1 (tip), parent C
    //  C        lane 0, both arms join; lane 1 frees up
    //  D        lane 1 is free again, so a new tip reuses it
    const l = layoutGraph([c('A', 'C'), c('B', 'C'), c('C', 'E'), c('D', 'E')]);
    expect(l.rows.map((r) => r.lane)).toEqual([0, 1, 0, 1]);
  });

  it('marks lanes that run past the end of the window', () => {
    const l = layoutGraph([c('A', 'B')]);
    expect(l.gaps).toEqual([]);
    expect(l.trailing).toEqual([0]);
  });

  it('handles an empty history', () => {
    const l = layoutGraph([]);
    expect(l).toEqual({ rows: [], gaps: [], trailing: [], laneCount: 0 });
  });

  it('treats a root commit as the end of its lane', () => {
    const l = layoutGraph([c('A')]);
    expect(l.rows[0]!.after).toEqual([]);
    expect(l.trailing).toEqual([]);
  });
});
