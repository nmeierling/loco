import { describe, expect, it } from 'vitest';
import { extractFileSymbols, extractImportBindings, extractRawRefs } from './symbols';
import type { AstNode } from './complexity.service';

/**
 * Node shapes mirror what tree-sitter-java actually emits (verified against the bundled
 * grammar): each declaration form has its own node type, names are `identifier` while
 * type references are `type_identifier`, members live under `class_body`/`interface_body`,
 * and access is `method_invocation` / `field_access` with the receiver as the first child.
 */

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

/** `com.example.Foo` → nested `scoped_identifier` ending in the leaf `identifier`. */
function scoped(fqn: string): AstNode {
  const segs = fqn.split('.');
  let acc = node('identifier', segs[0]!);
  for (let i = 1; i < segs.length; i++) {
    acc = node('scoped_identifier', segs.slice(0, i + 1).join('.'), [acc, node('identifier', segs[i]!)]);
  }
  return acc;
}

describe('extractFileSymbols — Java', () => {
  it('reads a class with fields and methods, skipping the constructor', () => {
    const ast = file([
      node('class_declaration', 'public class Greeter { … }', [
        node('modifiers', 'public'),
        node('identifier', 'Greeter', [], [0, 13]),
        node('class_body', '{ … }', [
          node('field_declaration', 'int count = 0;', [
            node('variable_declarator', 'count = 0', [node('identifier', 'count', [], [1, 8])]),
          ]),
          node('constructor_declaration', 'Greeter() {}', [node('identifier', 'Greeter', [], [2, 4])]),
          node('method_declaration', 'String greet() {}', [
            node('type_identifier', 'String'),
            node('identifier', 'greet', [], [3, 11]),
          ]),
        ]),
      ]),
    ]);

    expect(extractFileSymbols(ast, 'java').map((s) => [s.kind, s.owner, s.name])).toEqual([
      ['class', null, 'Greeter'],
      ['property', 'Greeter', 'count'],
      ['method', 'Greeter', 'greet'],
    ]);
  });

  it('distinguishes interface, enum and record, with enum constants and record components', () => {
    const ast = file([
      node('interface_declaration', 'interface Base {}', [node('identifier', 'Base')]),
      node('enum_declaration', 'enum Color { RED }', [
        node('identifier', 'Color'),
        node('enum_body', '{ RED }', [
          node('enum_constant', 'RED', [node('identifier', 'RED')]),
        ]),
      ]),
      node('record_declaration', 'record Point(int x) {}', [
        node('identifier', 'Point'),
        node('formal_parameters', '(int x)', [
          node('formal_parameter', 'int x', [node('integral_type', 'int'), node('identifier', 'x')]),
        ]),
        node('class_body', '{}'),
      ]),
    ]);

    expect(extractFileSymbols(ast, 'java').map((s) => [s.kind, s.owner, s.name])).toEqual([
      ['interface', null, 'Base'],
      ['enum', null, 'Color'],
      ['property', 'Color', 'RED'],
      ['class', null, 'Point'],
      ['property', 'Point', 'x'],
    ]);
  });

  it('treats a private member as not exported', () => {
    const ast = file([
      node('class_declaration', 'class C {}', [
        node('identifier', 'C'),
        node('class_body', '{ … }', [
          node('field_declaration', 'private int secret;', [
            node('modifiers', 'private'),
            node('variable_declarator', 'secret', [node('identifier', 'secret')]),
          ]),
        ]),
      ]),
    ]);

    const secret = extractFileSymbols(ast, 'java').find((s) => s.name === 'secret');
    expect(secret?.exported).toBe(false);
  });
});

describe('extractImportBindings — Java', () => {
  it('binds the last segment and skips on-demand imports', () => {
    const ast = file([
      node('import_declaration', 'import com.example.util.Helper;', [scoped('com.example.util.Helper')]),
      node('import_declaration', 'import static com.example.util.Utils.compute;', [
        scoped('com.example.util.Utils.compute'),
      ]),
      node('import_declaration', 'import com.example.util.*;'),
    ]);

    expect(extractImportBindings(ast, 'java').map((b) => [b.specifier, [...b.names][0]])).toEqual([
      ['com.example.util.Helper', ['Helper', 'Helper']],
      ['com.example.util.Utils.compute', ['compute', 'compute']],
    ]);
  });
});

describe('extractRawRefs — Java', () => {
  it('separates receivers, member accesses and bare calls', () => {
    // h.assist(target); this.count = 0; compute();
    const ast = file([
      node('method_invocation', 'h.assist(target)', [
        node('identifier', 'h', [], [1, 0]),
        node('identifier', 'assist', [], [1, 2]),
        node('argument_list', '(target)', [node('identifier', 'target', [], [1, 9])]),
      ]),
      node('field_access', 'this.count', [
        node('this', 'this', [], [2, 0]),
        node('identifier', 'count', [], [2, 5]),
      ]),
      node('method_invocation', 'compute()', [
        node('identifier', 'compute', [], [3, 0]),
        node('argument_list', '()'),
      ]),
    ]);

    const refs = extractRawRefs(ast, 'java', []);
    expect(refs.find((r) => r.name === 'h')).toMatchObject({ shape: 'identifier', call: false });
    expect(refs.find((r) => r.name === 'assist')).toMatchObject({
      shape: 'member',
      call: true,
      viaThis: false,
    });
    expect(refs.find((r) => r.name === 'count')).toMatchObject({
      shape: 'member',
      call: false,
      viaThis: true,
    });
    expect(refs.find((r) => r.name === 'compute')).toMatchObject({
      shape: 'identifier',
      call: true,
    });
  });

  it('records an import as a usage of the imported name and skips wildcards', () => {
    const ast = file([
      node('import_declaration', 'import com.example.util.Helper;', [scoped('com.example.util.Helper')]),
      node('import_declaration', 'import com.example.util.*;', [scoped('com.example.util')]),
    ]);

    expect(extractRawRefs(ast, 'java', []).map((r) => [r.name, r.shape])).toEqual([
      ['Helper', 'import'],
    ]);
  });

  it('does not treat a declaration or constructor name as a reference', () => {
    const ast = file([
      node('class_declaration', 'class Greeter {}', [
        node('identifier', 'Greeter', [], [1, 6]),
        node('class_body', '{ … }', [
          node('constructor_declaration', 'Greeter() {}', [node('identifier', 'Greeter', [], [2, 2])]),
        ]),
      ]),
    ]);
    const symbols = extractFileSymbols(ast, 'java');
    // The class name (decl) and the constructor name (repeats it) are both excluded.
    expect(extractRawRefs(ast, 'java', symbols)).toEqual([]);
  });
});
