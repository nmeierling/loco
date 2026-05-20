import { describe, expect, it } from 'vitest';
import { extractCallGraph, isCallGraphSupported } from './call-graph';
import type { AstNode } from './complexity.service';

function node(type: string, preview: string, children: AstNode[] = [], rows = [0, 0]): AstNode {
  return {
    type,
    named: true,
    startRow: rows[0],
    startCol: 0,
    endRow: rows[1],
    endCol: 0,
    preview,
    children,
  };
}

describe('isCallGraphSupported', () => {
  it('supports TS/JS families', () => {
    for (const id of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']) {
      expect(isCallGraphSupported(id)).toBe(true);
    }
  });
  it('rejects other languages', () => {
    expect(isCallGraphSupported('py')).toBe(false);
    expect(isCallGraphSupported(null)).toBe(false);
  });
});

describe('extractCallGraph', () => {
  it('finds two function declarations and a direct call between them', () => {
    // Synthesized AST resembling:
    //   function foo() { bar(); }
    //   function bar() {}
    const fooBody = node('statement_block', '', [
      node('expression_statement', '', [
        node('call_expression', 'bar()', [
          node('identifier', 'bar'),
          node('arguments', '()'),
        ], [2, 2]),
      ], [2, 2]),
    ], [1, 3]);

    const fooDecl = node(
      'function_declaration',
      'function foo() { bar(); }',
      [node('identifier', 'foo'), node('formal_parameters', '()'), fooBody],
      [1, 3],
    );

    const barDecl = node(
      'function_declaration',
      'function bar() {}',
      [node('identifier', 'bar'), node('formal_parameters', '()'), node('statement_block', '', [], [5, 5])],
      [5, 5],
    );

    const program = node('program', '', [fooDecl, barDecl], [0, 6]);
    const cg = extractCallGraph(program, 'ts');

    const names = cg.functions.map((f) => f.name);
    expect(names).toContain('foo');
    expect(names).toContain('bar');

    const foo = cg.functions.find((f) => f.name === 'foo')!;
    const bar = cg.functions.find((f) => f.name === 'bar')!;
    expect(cg.edges).toContainEqual({ from: foo.id, to: bar.id });
    expect(foo.outDegree).toBe(1);
    expect(bar.inDegree).toBe(1);
  });

  it('skips calls to non-identifier callees (e.g. obj.method())', () => {
    const fooBody = node('statement_block', '', [
      node('expression_statement', '', [
        node('call_expression', 'obj.method()', [
          node('member_expression', 'obj.method'),
          node('arguments', '()'),
        ]),
      ]),
    ]);
    const fooDecl = node('function_declaration', '', [node('identifier', 'foo'), fooBody]);
    const cg = extractCallGraph(node('program', '', [fooDecl]), 'ts');
    expect(cg.edges).toEqual([]);
  });

  it('returns empty graph for unsupported languages', () => {
    const ast = node('module', '', []);
    expect(extractCallGraph(ast, 'py')).toEqual({ functions: [], edges: [] });
  });
});
