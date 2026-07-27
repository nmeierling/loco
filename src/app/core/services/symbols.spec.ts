import { describe, expect, it } from 'vitest';
import {
  extractFileSymbols,
  extractImportBindings,
  extractRawRefs,
  isSymbolIndexSupported,
} from './symbols';
import type { AstNode } from './complexity.service';

let row = 0;

function node(
  type: string,
  preview: string,
  children: AstNode[] = [],
  at?: [number, number],
): AstNode {
  const [r, c] = at ?? [row++, 0];
  return {
    type,
    named: true,
    startRow: r,
    startCol: c,
    endRow: r,
    endCol: c + preview.length,
    preview,
    children,
  };
}

function file(children: AstNode[]): AstNode {
  return node('program', '', children, [0, 0]);
}

describe('isSymbolIndexSupported', () => {
  it('covers the JS/TS family only', () => {
    for (const id of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']) {
      expect(isSymbolIndexSupported(id)).toBe(true);
    }
    expect(isSymbolIndexSupported('py')).toBe(false);
    expect(isSymbolIndexSupported('java')).toBe(false);
    expect(isSymbolIndexSupported(null)).toBe(false);
  });
});

describe('extractFileSymbols', () => {
  it('finds an exported class and its methods and fields', () => {
    // export class Store { readonly root = 1; selectPath(p) {} }
    const ast = file([
      node('export_statement', 'export class Store …', [
        node('class_declaration', 'class Store …', [
          node('type_identifier', 'Store', [], [1, 13]),
          node('class_body', '…', [
            node('public_field_definition', 'readonly root = 1;', [
              node('property_identifier', 'root', [], [2, 11]),
            ]),
            node('method_definition', 'selectPath(p) {}', [
              node('property_identifier', 'selectPath', [], [3, 2]),
              node('statement_block', '{}'),
            ]),
          ]),
        ]),
      ]),
    ]);

    const symbols = extractFileSymbols(ast, 'ts');
    expect(symbols.map((s) => [s.kind, s.owner, s.name, s.exported])).toEqual([
      ['class', null, 'Store', true],
      ['property', 'Store', 'root', true],
      ['method', 'Store', 'selectPath', true],
    ]);
  });

  it('classifies an arrow-valued const as a function and a plain const as a const', () => {
    const ast = file([
      node('lexical_declaration', 'const go = () => {}', [
        node('variable_declarator', 'go = () => {}', [
          node('identifier', 'go', [], [1, 6]),
          node('arrow_function', '() => {}'),
        ]),
      ]),
      node('lexical_declaration', 'const N = 3', [
        node('variable_declarator', 'N = 3', [node('identifier', 'N', [], [2, 6])]),
      ]),
    ]);

    const symbols = extractFileSymbols(ast, 'ts');
    expect(symbols.map((s) => [s.kind, s.name, s.exported])).toEqual([
      ['function', 'go', false],
      ['const', 'N', false],
    ]);
  });

  it('returns nothing for an unsupported language', () => {
    const ast = file([node('class_definition', 'class Foo:')]);
    expect(extractFileSymbols(ast, 'py')).toEqual([]);
  });
});

describe('extractImportBindings', () => {
  it('reads named, aliased, default and namespace bindings', () => {
    const ast = file([
      node('import_statement', "import Def, { a, b as c } from './x'", [
        node('import_clause', 'Def, { a, b as c }', [
          node('identifier', 'Def', [], [1, 7]),
          node('named_imports', '{ a, b as c }', [
            node('import_specifier', 'a', [node('identifier', 'a', [], [1, 14])]),
            node('import_specifier', 'b as c', [
              node('identifier', 'b', [], [1, 17]),
              node('identifier', 'c', [], [1, 22]),
            ]),
          ]),
        ]),
        node('string', "'./x'", [], [1, 30]),
      ]),
      node('import_statement', "import * as ns from './y'", [
        node('import_clause', '* as ns', [
          node('namespace_import', '* as ns', [node('identifier', 'ns', [], [2, 12])]),
        ]),
        node('string', "'./y'", [], [2, 20]),
      ]),
    ]);

    const bindings = extractImportBindings(ast, 'ts');
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.specifier).toBe('./x');
    expect([...bindings[0]!.names]).toEqual([
      ['Def', 'default'],
      ['a', 'a'],
      ['c', 'b'],
    ]);
    expect(bindings[1]!.specifier).toBe('./y');
    expect([...bindings[1]!.names]).toEqual([['ns', '*']]);
  });
});

describe('extractRawRefs', () => {
  it('separates member accesses from identifiers and flags callees', () => {
    // helper(); this.store.selectPath(p);
    const ast = file([
      node('expression_statement', 'helper();', [
        node('call_expression', 'helper()', [
          node('identifier', 'helper', [], [1, 0]),
          node('arguments', '()'),
        ]),
      ]),
      node('expression_statement', 'this.store.selectPath(p);', [
        node('call_expression', 'this.store.selectPath(p)', [
          node('member_expression', 'this.store.selectPath', [
            node('member_expression', 'this.store', [
              node('this', 'this', [], [2, 0]),
              node('property_identifier', 'store', [], [2, 5]),
            ]),
            node('property_identifier', 'selectPath', [], [2, 11]),
          ]),
          node('arguments', '(p)'),
        ]),
      ]),
    ]);

    const refs = extractRawRefs(ast, 'ts', []);
    const helper = refs.find((r) => r.name === 'helper');
    expect(helper).toMatchObject({ shape: 'identifier', call: true });

    const store = refs.find((r) => r.name === 'store');
    // `this.store` is a member read off the enclosing class, not a call.
    expect(store).toMatchObject({ shape: 'member', call: false, viaThis: true });

    const selectPath = refs.find((r) => r.name === 'selectPath');
    // `this.store.selectPath(…)` targets a collaborator, so it must not read as viaThis.
    expect(selectPath).toMatchObject({ shape: 'member', call: true, viaThis: false });
  });

  it('marks identifiers inside an import statement as import references', () => {
    const ast = file([
      node('import_statement', "import { Store } from './s'", [
        node('import_clause', '{ Store }', [
          node('named_imports', '{ Store }', [
            node('import_specifier', 'Store', [node('identifier', 'Store', [], [1, 9])]),
          ]),
        ]),
        node('string', "'./s'", [], [1, 22]),
      ]),
    ]);

    const refs = extractRawRefs(ast, 'ts', []);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: 'Store', shape: 'import', call: false });
  });

  it('skips the declaration name itself so a symbol is not its own reference', () => {
    const nameNode = node('identifier', 'go', [], [1, 9]);
    const ast = file([node('function_declaration', 'function go() {}', [nameNode])]);
    const symbols = extractFileSymbols(ast, 'ts');

    expect(extractRawRefs(ast, 'ts', symbols)).toEqual([]);
    // Without the declaration list it would look like an ordinary identifier use.
    expect(extractRawRefs(ast, 'ts', [])).toHaveLength(1);
  });
});
