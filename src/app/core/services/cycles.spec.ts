import { describe, expect, it } from 'vitest';
import { findCycles } from './module-graph.service';

const edge = (from: string, to: string) => ({ from, to });

describe('findCycles', () => {
  it('returns nothing for an acyclic graph', () => {
    const paths = ['a', 'b', 'c'];
    expect(findCycles(paths, [edge('a', 'b'), edge('b', 'c')])).toEqual([]);
  });

  it('finds a two-file cycle', () => {
    expect(findCycles(['a', 'b'], [edge('a', 'b'), edge('b', 'a')])).toEqual([['a', 'b']]);
  });

  it('finds a longer chain and leaves the acyclic tail out', () => {
    const cycles = findCycles(
      ['a', 'b', 'c', 'd'],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('c', 'd')],
    );
    expect(cycles).toEqual([['a', 'b', 'c']]);
  });

  it('separates independent cycles and orders the biggest first', () => {
    const cycles = findCycles(
      ['a', 'b', 'x', 'y', 'z'],
      [edge('a', 'b'), edge('b', 'a'), edge('x', 'y'), edge('y', 'z'), edge('z', 'x')],
    );
    expect(cycles).toEqual([
      ['x', 'y', 'z'],
      ['a', 'b'],
    ]);
  });

  it('does not report a lone file as a cycle', () => {
    expect(findCycles(['a'], [])).toEqual([]);
  });

  it('survives a chain deep enough to overflow a recursive walk', () => {
    const paths = Array.from({ length: 20_000 }, (_, i) => `f${i}`);
    const edges = paths.slice(0, -1).map((p, i) => edge(p, `f${i + 1}`));
    // Close the loop so the whole chain is one component.
    edges.push(edge(paths[paths.length - 1]!, paths[0]!));
    const cycles = findCycles(paths, edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(20_000);
  });
});
