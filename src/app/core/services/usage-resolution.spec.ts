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

function scanOf(
  path: string,
  langId: string,
  source: string,
  ast: AstNode,
  pkg: string | null = null,
): FileScan {
  const symbols = extractFileSymbols(ast, langId);
  return {
    path,
    langId,
    lines: source.split(/\r?\n/),
    symbols,
    bindings: extractImportBindings(ast, langId),
    refs: extractRawRefs(ast, langId, symbols),
    pkg,
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

describe('resolve — same-package JVM references without an import', () => {
  // A Spring-style controller that references a repository sitting in the same package.
  // It neither imports the type (same package needs no import) nor is it declared in the
  // same file, so resolution has to reach the sibling declaration by package.
  //
  // class UserController {
  //     UserRepository repo;
  //     void handle() {
  //         repo.findActive();
  //     }
  // }
  const ctrlSrc =
    'package com.example;\nclass UserController {\n    UserRepository repo;\n    void handle() {\n        repo.findActive();\n    }\n}';
  const ctrlAst = nd('program', '', [0, 0, 6, 1], [
    nd('package_declaration', 'package com.example;', [0, 0, 0, 20]),
    nd('class_declaration', 'class UserController { … }', [1, 0, 6, 1], [
      nd('identifier', 'UserController', [1, 6, 1, 20]),
      nd('class_body', '{ … }', [1, 21, 6, 1], [
        nd('field_declaration', 'UserRepository repo;', [2, 4, 2, 24], [
          nd('type_identifier', 'UserRepository', [2, 4, 2, 18]),
          nd('variable_declarator', 'repo', [2, 19, 2, 23], [
            nd('identifier', 'repo', [2, 19, 2, 23]),
          ]),
        ]),
        nd('method_declaration', 'void handle() { repo.findActive(); }', [3, 4, 5, 5], [
          nd('void_type', 'void', [3, 4, 3, 8]),
          nd('identifier', 'handle', [3, 9, 3, 15]),
          nd('formal_parameters', '()', [3, 15, 3, 17]),
          nd('block', '{ repo.findActive(); }', [3, 18, 5, 5], [
            nd('expression_statement', 'repo.findActive();', [4, 8, 4, 26], [
              nd('method_invocation', 'repo.findActive()', [4, 8, 4, 25], [
                nd('identifier', 'repo', [4, 8, 4, 12]),
                nd('identifier', 'findActive', [4, 13, 4, 23]),
                nd('argument_list', '()', [4, 23, 4, 25]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]);

  // interface UserRepository {
  //     List findActive();
  // }
  const repoSrc = 'package com.example;\ninterface UserRepository {\n    List findActive();\n}';
  const repoAst = nd('program', '', [0, 0, 3, 1], [
    nd('package_declaration', 'package com.example;', [0, 0, 0, 20]),
    nd('interface_declaration', 'interface UserRepository { … }', [1, 0, 3, 1], [
      nd('identifier', 'UserRepository', [1, 10, 1, 24]),
      nd('interface_body', '{ … }', [1, 25, 3, 1], [
        nd('method_declaration', 'List findActive();', [2, 4, 2, 22], [
          nd('type_identifier', 'List', [2, 4, 2, 8]),
          nd('identifier', 'findActive', [2, 9, 2, 19]),
          nd('formal_parameters', '()', [2, 19, 2, 21]),
        ]),
      ]),
    ]),
  ]);

  const files = new Set(['UserController.java', 'UserRepository.java']);
  const classId = 'UserRepository.java#UserRepository';
  const methodId = 'UserRepository.java#UserRepository.findActive';

  it('resolves the sibling type and its member through the shared package', () => {
    const index = resolve(
      [
        scanOf('UserController.java', 'java', ctrlSrc, ctrlAst, 'com.example'),
        scanOf('UserRepository.java', 'java', repoSrc, repoAst, 'com.example'),
      ],
      files,
    );

    // The field's type reference reaches the interface, and the call reaches its method.
    expect(index.refsByDef.get(classId)?.map((r) => r.kind)).toContain('read');
    const call = index.refsByDef.get(methodId) ?? [];
    expect(call).toHaveLength(1);
    expect(call[0]).toMatchObject({
      kind: 'call',
      enclosingId: 'UserController.java#UserController.handle',
    });
  });

  it('reaches a uniquely-named member across packages (inherited/base-type members)', () => {
    // Controller and repository now sit in different packages with no import between them —
    // the shape you get when the called method is declared on a base type in another
    // package (a Spring `BaseRepository`). The bare type reference can't resolve without an
    // import, but the call still lands on the sole declaration of that member repo-wide.
    const index = resolve(
      [
        scanOf('UserController.java', 'java', ctrlSrc, ctrlAst, 'com.example.web'),
        scanOf('UserRepository.java', 'java', repoSrc, repoAst, 'com.example.repo'),
      ],
      files,
    );

    expect(index.refsByDef.get(classId)).toBeUndefined();
    const call = index.refsByDef.get(methodId) ?? [];
    expect(call).toHaveLength(1);
    expect(call[0]).toMatchObject({
      kind: 'call',
      enclosingId: 'UserController.java#UserController.handle',
    });
  });

  it('leaves a member unresolved when its name is declared by more than one class', () => {
    // A second, unrelated class also declares findActive(), so the name is no longer unique
    // repo-wide and the receiver's type is unknown — resolution declines rather than guess.
    const otherSrc = 'package com.example.other;\ninterface OtherRepo {\n    List findActive();\n}';
    const otherAst = nd('program', '', [0, 0, 3, 1], [
      nd('package_declaration', 'package com.example.other;', [0, 0, 0, 26]),
      nd('interface_declaration', 'interface OtherRepo { … }', [1, 0, 3, 1], [
        nd('identifier', 'OtherRepo', [1, 10, 1, 19]),
        nd('interface_body', '{ … }', [1, 20, 3, 1], [
          nd('method_declaration', 'List findActive();', [2, 4, 2, 22], [
            nd('type_identifier', 'List', [2, 4, 2, 8]),
            nd('identifier', 'findActive', [2, 9, 2, 19]),
            nd('formal_parameters', '()', [2, 19, 2, 21]),
          ]),
        ]),
      ]),
    ]);
    const index = resolve(
      [
        scanOf('UserController.java', 'java', ctrlSrc, ctrlAst, 'com.example.web'),
        scanOf('UserRepository.java', 'java', repoSrc, repoAst, 'com.example.repo'),
        scanOf('OtherRepo.java', 'java', otherSrc, otherAst, 'com.example.other'),
      ],
      new Set(['UserController.java', 'UserRepository.java', 'OtherRepo.java']),
    );

    expect(index.refsByDef.get(methodId)).toBeUndefined();
    expect(index.refsByDef.get('OtherRepo.java#OtherRepo.findActive')).toBeUndefined();
  });
});

describe('resolve — external (out-of-repo) dependencies', () => {
  // Scans are built directly here: external capture is about imports that resolve to no
  // repo file, so the AST shape is irrelevant — only bindings and refs matter.
  const raw = (
    name: string,
    shape: 'import' | 'identifier' | 'member',
    row: number,
    call = false,
  ) => ({ name, shape, call, viaThis: false, row, col: 0, endRow: row, endCol: name.length });

  it('groups JVM imports by package and records their uses in the file', () => {
    const scan: FileScan = {
      path: 'com/example/UserGraphRepo.kt',
      langId: 'kt',
      lines: [
        'package com.example',
        'import org.neo4j.driver.Driver',
        'import org.neo4j.driver.GraphDatabase',
        'class UserGraphRepo(val driver: Driver) {',
        '  fun connect(): Driver = GraphDatabase.driver("bolt://x")',
        '}',
      ],
      symbols: [],
      bindings: [
        { specifier: 'org.neo4j.driver.Driver', names: new Map([['Driver', 'Driver']]) },
        {
          specifier: 'org.neo4j.driver.GraphDatabase',
          names: new Map([['GraphDatabase', 'GraphDatabase']]),
        },
      ],
      refs: [
        raw('Driver', 'import', 1),
        raw('GraphDatabase', 'import', 2),
        raw('Driver', 'identifier', 3),
        raw('Driver', 'identifier', 4),
        raw('GraphDatabase', 'identifier', 4, true),
      ],
      pkg: 'com.example',
    };
    const ext = resolve([scan], new Set([scan.path])).externalByPath.get(scan.path) ?? [];

    // Everything comes from the one Neo4j package.
    expect(new Set(ext.map((e) => e.module))).toEqual(new Set(['org.neo4j.driver']));
    // Driver: one import + two uses; GraphDatabase: one import + one call.
    expect(ext.filter((e) => e.imported === 'Driver')).toHaveLength(3);
    expect(ext.filter((e) => e.imported === 'GraphDatabase')).toHaveLength(2);
    expect(ext.find((e) => e.imported === 'GraphDatabase' && e.kind === 'call')).toBeTruthy();
  });

  it('counts bare JS specifiers as external but ignores unresolved relative imports', () => {
    const scan: FileScan = {
      path: 'a.ts',
      langId: 'ts',
      lines: ["import { z } from 'zod'", "import x from './missing'", 'const s = z.object()'],
      symbols: [],
      bindings: [
        { specifier: 'zod', names: new Map([['z', 'z']]) },
        { specifier: './missing', names: new Map([['x', 'default']]) },
      ],
      refs: [raw('z', 'import', 0), raw('x', 'import', 1), raw('z', 'identifier', 2, true)],
      pkg: null,
    };
    const ext = resolve([scan], new Set(['a.ts'])).externalByPath.get('a.ts') ?? [];

    // `zod` is a real dependency; `./missing` is a broken relative path, not a package.
    expect(ext.map((e) => e.imported)).toEqual(['z', 'z']);
    expect(ext.every((e) => e.module === 'zod')).toBe(true);
    expect(ext.some((e) => e.name === 'x')).toBe(false);
  });

  it('excludes an import that resolves to a repo file', () => {
    const dep: FileScan = {
      path: 'com/example/User.kt',
      langId: 'kt',
      lines: ['package com.example', 'class User'],
      symbols: extractFileSymbols(
        nd('program', '', [0, 0, 1, 10], [
          nd('package_declaration', 'package com.example', [0, 0, 0, 19]),
          nd('class_declaration', 'class User', [1, 0, 1, 10], [
            nd('type_identifier', 'User', [1, 6, 1, 10]),
          ]),
        ]),
        'kt',
      ),
      bindings: [],
      refs: [],
      pkg: 'com.example',
    };
    const user: FileScan = {
      path: 'com/example/UserService.kt',
      langId: 'kt',
      lines: ['package com.example', 'import com.example.User', 'class UserService'],
      symbols: [],
      bindings: [{ specifier: 'com.example.User', names: new Map([['User', 'User']]) }],
      refs: [raw('User', 'import', 1)],
      pkg: 'com.example',
    };
    const index = resolve([dep, user], new Set([dep.path, user.path]));
    // User resolves to a repo file, so it is a normal internal ref, not an external dep.
    expect(index.externalByPath.get(user.path)).toBeUndefined();
  });
});
