import { describe, expect, it } from 'vitest';
import { extractFileSymbols, extractImportBindings, extractRawRefs } from './symbols';
import {
  buildSymbolAdjacency,
  resolve,
  seedSymbols,
  symbolSubgraph,
  type FileScan,
} from './symbol-index.service';
import type { AstNode } from './complexity.service';

/**
 * Drives the real cross-file resolver over scans produced by the real extractors, so it
 * covers the wiring end to end. Nodes carry explicit multi-line spans because resolution
 * attributes a usage to the declaration whose span contains it (the enclosing-class
 * fallback for unqualified JVM calls depends on that).
 */

function nd(
  type: string,
  preview: string,
  span: [number, number, number, number],
  children: AstNode[] = [],
): AstNode {
  const [startRow, startCol, endRow, endCol] = span;
  return { type, named: true, startRow, startCol, endRow, endCol, preview, children };
}

function scanOf(path: string, langId: string, source: string, ast: AstNode): FileScan {
  const symbols = extractFileSymbols(ast, langId);
  return {
    path,
    langId,
    lines: source.split(/\r?\n/),
    symbols,
    bindings: extractImportBindings(ast, langId),
    refs: extractRawRefs(ast, langId, symbols),
    pkg: null,
  };
}

describe('resolve — unqualified same-class Java call', () => {
  // class Greeter {
  //     void greet() {
  //         create();
  //     }
  //     static Greeter create() { … }
  // }
  const source = 'class Greeter {\n    void greet() {\n        create();\n    }\n    static Greeter create() {\n    }\n}';
  const ast = nd('program', '', [0, 0, 6, 1], [
    nd('class_declaration', 'class Greeter { … }', [0, 0, 6, 1], [
      nd('identifier', 'Greeter', [0, 6, 0, 13]),
      nd('class_body', '{ … }', [0, 14, 6, 1], [
        nd('method_declaration', 'void greet() { create(); }', [1, 4, 3, 5], [
          nd('void_type', 'void', [1, 4, 1, 8]),
          nd('identifier', 'greet', [1, 9, 1, 14]),
          nd('formal_parameters', '()', [1, 14, 1, 16]),
          nd('block', '{ create(); }', [1, 17, 3, 5], [
            nd('expression_statement', 'create();', [2, 8, 2, 17], [
              nd('method_invocation', 'create()', [2, 8, 2, 16], [
                nd('identifier', 'create', [2, 8, 2, 14]),
                nd('argument_list', '()', [2, 14, 2, 16]),
              ]),
            ]),
          ]),
        ]),
        nd('method_declaration', 'static Greeter create() {}', [4, 4, 5, 5], [
          nd('modifiers', 'static', [4, 4, 4, 10]),
          nd('type_identifier', 'Greeter', [4, 11, 4, 18]),
          nd('identifier', 'create', [4, 19, 4, 25]),
          nd('formal_parameters', '()', [4, 25, 4, 27]),
          nd('block', '{}', [4, 28, 5, 5]),
        ]),
      ]),
    ]),
  ]);

  it('attributes the bare create() call to the enclosing class member', () => {
    const scan = scanOf('Greeter.java', 'java', source, ast);
    const index = resolve([scan], new Set(['Greeter.java']));

    const createId = 'Greeter.java#Greeter.create';
    const refs = index.refsByDef.get(createId) ?? [];
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: 'call', enclosingId: 'Greeter.java#Greeter.greet' });
  });

  it('does not apply the member fallback for a non-JVM language', () => {
    // The same scan tagged as TS: the extractors yield nothing for TS node types, so
    // there is no create() usage to resolve — proving the fallback is JVM-scoped.
    const scan = scanOf('Greeter.ts', 'ts', source, ast);
    const index = resolve([scan], new Set(['Greeter.ts']));
    expect(index.refsByDef.get('Greeter.ts#Greeter.create')).toBeUndefined();
  });

  it('exposes the call as a graph edge that a focused subgraph pulls in', () => {
    const index = resolve([scanOf('Greeter.java', 'java', source, ast)], new Set(['Greeter.java']));
    const adj = buildSymbolAdjacency(index);
    const greet = 'Greeter.java#Greeter.greet';
    const create = 'Greeter.java#Greeter.create';

    const greeterClass = 'Greeter.java#Greeter';
    expect([...(adj.out.get(greet) ?? [])]).toEqual([create]);
    expect([...(adj.in.get(create) ?? [])]).toEqual([greet]);
    // create()'s return type is a real usage edge: create → Greeter.
    expect([...(adj.out.get(create) ?? [])]).toEqual([greeterClass]);

    // Seed = the file's symbols that take part in an edge.
    expect(new Set(seedSymbols(index, adj, ['Greeter.java']))).toEqual(
      new Set([greet, create, greeterClass]),
    );

    // Focusing greet pulls in its immediate neighbours (create) and the edge to it, but
    // not the neighbour-of-a-neighbour (Greeter) until create is focused too.
    const g = symbolSubgraph(index, adj, new Set([greet]));
    expect(new Set(g.nodes.map((n) => n.id))).toEqual(new Set([greet, create]));
    expect(g.edges).toEqual([{ from: greet, to: create }]);

    // Focusing create as well now reaches the class node and both edges.
    const g2 = symbolSubgraph(index, adj, new Set([greet, create]));
    expect(new Set(g2.nodes.map((n) => n.id))).toEqual(new Set([greet, create, greeterClass]));
    expect(g2.edges).toEqual([
      { from: greet, to: create },
      { from: create, to: greeterClass },
    ]);
  });
});
