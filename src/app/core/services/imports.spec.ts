import { describe, expect, it } from 'vitest';
import { extractImports } from './imports';
import type { AstNode } from './complexity.service';

function node(type: string, preview: string, children: AstNode[] = []): AstNode {
  return {
    type,
    named: true,
    startRow: 0,
    startCol: 0,
    endRow: 0,
    endCol: 0,
    preview,
    children,
  };
}

describe('extractImports — TypeScript', () => {
  it('extracts the specifier from a static import_statement', () => {
    const ast = node('program', '', [
      node('import_statement', 'import x from "./foo";', [
        node('import_clause', 'x'),
        node('string', '"./foo"'),
      ]),
    ]);
    expect(extractImports(ast, 'ts')).toEqual([
      { specifier: './foo', relative: true },
    ]);
  });

  it('extracts a dynamic import() argument', () => {
    const ast = node('program', '', [
      node('expression_statement', '', [
        node('call_expression', 'import("./lazy")', [
          node('import', 'import'),
          node('arguments', '("./lazy")', [
            node('string', '"./lazy"'),
          ]),
        ]),
      ]),
    ]);
    expect(extractImports(ast, 'ts')).toEqual([
      { specifier: './lazy', relative: true },
    ]);
  });

  it('extracts a CommonJS require() call', () => {
    const ast = node('program', '', [
      node('expression_statement', '', [
        node('call_expression', "require('lodash')", [
          node('identifier', 'require'),
          node('arguments', "('lodash')", [
            node('string', "'lodash'"),
          ]),
        ]),
      ]),
    ]);
    expect(extractImports(ast, 'ts')).toEqual([
      { specifier: 'lodash', relative: false },
    ]);
  });

  it('flags relative vs external correctly', () => {
    const ast = node('program', '', [
      node('import_statement', '', [node('string', "'@angular/core'")]),
      node('import_statement', '', [node('string', "'./sibling'")]),
    ]);
    const imports = extractImports(ast, 'ts');
    expect(imports).toContainEqual({ specifier: '@angular/core', relative: false });
    expect(imports).toContainEqual({ specifier: './sibling', relative: true });
  });
});

describe('extractImports — Python', () => {
  it('extracts a plain import statement', () => {
    const ast = node('module', '', [
      node('import_statement', 'import os', [node('dotted_name', 'os')]),
    ]);
    expect(extractImports(ast, 'py')).toEqual([
      { specifier: 'os', relative: false },
    ]);
  });

  it('extracts a relative from-import with leading dots', () => {
    const ast = node('module', '', [
      node('import_from_statement', 'from .pkg import bar', [
        node('relative_import', '.pkg'),
      ]),
    ]);
    expect(extractImports(ast, 'py')).toEqual([
      { specifier: '.pkg', relative: false },
    ]);
  });

  it('extracts an absolute from-import', () => {
    const ast = node('module', '', [
      node('import_from_statement', 'from pkg.sub import baz', [
        node('dotted_name', 'pkg.sub'),
      ]),
    ]);
    expect(extractImports(ast, 'py')).toEqual([
      { specifier: 'pkg.sub', relative: false },
    ]);
  });
});
