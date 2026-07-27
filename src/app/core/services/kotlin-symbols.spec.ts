import { describe, expect, it } from 'vitest';
import { extractFileSymbols, extractImportBindings, extractRawRefs } from './symbols';
import type { AstNode } from './complexity.service';

/**
 * Node shapes here mirror what tree-sitter-kotlin actually emits (verified against the
 * bundled grammar): `class`/`interface`/`enum class` all parse as `class_declaration`,
 * names are `type_identifier` (types) or `simple_identifier` (functions/properties),
 * members live under `class_body`, and `a.b` is `navigation_expression(a, .b)`.
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
  return node('source_file', '', children, [0, 0]);
}

/** `com.example.Foo` → an `identifier` node with one `simple_identifier` per segment. */
function dotted(fqn: string): AstNode {
  const segs = fqn.split('.');
  return node(
    'identifier',
    fqn,
    segs.map((s) => node('simple_identifier', s)),
  );
}

function importHeader(fqn: string, alias?: string): AstNode {
  const preview = `import ${fqn}${alias ? ` as ${alias}` : ''}`;
  const children = [dotted(fqn)];
  if (alias) children.push(node('import_alias', `as ${alias}`, [node('type_identifier', alias)]));
  return node('import_header', preview, children);
}

describe('extractFileSymbols — Kotlin', () => {
  it('reads a class, its members, and a companion object credited to the class', () => {
    const ast = file([
      node('class_declaration', 'class Greeter { … }', [
        node('type_identifier', 'Greeter', [], [0, 6]),
        node('class_body', '{ … }', [
          node('property_declaration', 'val prefix = "Hi"', [
            node('variable_declaration', 'prefix', [node('simple_identifier', 'prefix', [], [1, 6])]),
          ]),
          node('function_declaration', 'fun greet() {}', [
            node('simple_identifier', 'greet', [], [2, 6]),
          ]),
          node('companion_object', 'companion object { … }', [
            node('class_body', '{ … }', [
              node('function_declaration', 'fun create() {}', [
                node('simple_identifier', 'create', [], [3, 8]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);

    expect(extractFileSymbols(ast, 'kt').map((s) => [s.kind, s.owner, s.name])).toEqual([
      ['class', null, 'Greeter'],
      ['property', 'Greeter', 'prefix'],
      ['method', 'Greeter', 'greet'],
      ['method', 'Greeter', 'create'],
    ]);
  });

  it('distinguishes interface, enum, object, top-level fn, const and typealias', () => {
    const ast = file([
      node('class_declaration', 'interface Base { }', [node('type_identifier', 'Base')]),
      node('class_declaration', 'enum class Color { }', [
        node('type_identifier', 'Color'),
        node('enum_class_body', '{ RED }', [
          node('enum_entry', 'RED', [node('simple_identifier', 'RED')]),
        ]),
      ]),
      node('object_declaration', 'object Registry { }', [node('type_identifier', 'Registry')]),
      node('function_declaration', 'fun run() {}', [node('simple_identifier', 'run')]),
      node('property_declaration', 'const val TOP = 1', [
        node('variable_declaration', 'TOP', [node('simple_identifier', 'TOP')]),
      ]),
      node('type_alias', 'typealias Name = String', [node('type_identifier', 'Name')]),
    ]);

    expect(extractFileSymbols(ast, 'kt').map((s) => [s.kind, s.name])).toEqual([
      ['interface', 'Base'],
      ['enum', 'Color'],
      ['property', 'RED'],
      ['class', 'Registry'],
      ['function', 'run'],
      ['const', 'TOP'],
      ['type', 'Name'],
    ]);
  });

  it('marks a private top-level declaration as not exported', () => {
    const ast = file([
      node('class_declaration', 'private class Hidden {}', [
        node('modifiers', 'private', [node('visibility_modifier', 'private')]),
        node('type_identifier', 'Hidden'),
      ]),
      node('class_declaration', 'class Shown {}', [node('type_identifier', 'Shown')]),
    ]);

    expect(extractFileSymbols(ast, 'kt').map((s) => [s.name, s.exported])).toEqual([
      ['Hidden', false],
      ['Shown', true],
    ]);
  });
});

describe('extractImportBindings — Kotlin', () => {
  it('binds the last segment, honours an alias, and skips wildcards', () => {
    const ast = file([
      node('import_list', '', [
        importHeader('com.example.util.Helper'),
        importHeader('com.example.util.compute', 'calc'),
        node('import_header', 'import com.example.foo.*'),
      ]),
    ]);

    const bindings = extractImportBindings(ast, 'kt');
    expect(bindings.map((b) => [b.specifier, [...b.names][0]])).toEqual([
      ['com.example.util.Helper', ['Helper', 'Helper']],
      ['com.example.util.compute', ['calc', 'compute']],
    ]);
  });
});

describe('extractRawRefs — Kotlin', () => {
  it('separates member accesses from identifiers and flags callees', () => {
    // h.assist(target); this.count = 0
    const ast = file([
      node('call_expression', 'h.assist(target)', [
        node('navigation_expression', 'h.assist', [
          node('simple_identifier', 'h', [], [1, 0]),
          node('navigation_suffix', '.assist', [node('simple_identifier', 'assist', [], [1, 2])]),
        ]),
        node('call_suffix', '(target)', [
          node('value_arguments', '(target)', [node('simple_identifier', 'target', [], [1, 9])]),
        ]),
      ]),
      node('assignment', 'this.count = 0', [
        node('directly_assignable_expression', 'this.count', [
          node('this_expression', 'this', [], [2, 0]),
          node('navigation_suffix', '.count', [node('simple_identifier', 'count', [], [2, 5])]),
        ]),
      ]),
    ]);

    const refs = extractRawRefs(ast, 'kt', []);
    expect(refs.find((r) => r.name === 'h')).toMatchObject({ shape: 'identifier', call: false });
    expect(refs.find((r) => r.name === 'assist')).toMatchObject({
      shape: 'member',
      call: true,
      viaThis: false,
    });
    // `this.count` is a member off the enclosing class.
    expect(refs.find((r) => r.name === 'count')).toMatchObject({
      shape: 'member',
      viaThis: true,
    });
  });

  it('records an import as a usage of the imported name and skips wildcards', () => {
    const ast = file([
      node('import_list', '', [
        importHeader('com.example.util.Helper'),
        importHeader('com.example.util.compute', 'calc'),
        node('import_header', 'import com.example.foo.*', [dotted('com.example.foo')]),
      ]),
    ]);

    const refs = extractRawRefs(ast, 'kt', []);
    // Only the two named imports produce a ref, at the local name (alias wins).
    expect(refs.map((r) => [r.name, r.shape])).toEqual([
      ['Helper', 'import'],
      ['calc', 'import'],
    ]);
  });

  it('does not treat a declaration name as a reference to itself', () => {
    const ast = file([
      node('function_declaration', 'fun go() {}', [node('simple_identifier', 'go', [], [1, 4])]),
    ]);
    const symbols = extractFileSymbols(ast, 'kt');
    expect(extractRawRefs(ast, 'kt', symbols)).toEqual([]);
    // Without the declaration list the same identifier reads as an ordinary use.
    expect(extractRawRefs(ast, 'kt', [])).toHaveLength(1);
  });
});
