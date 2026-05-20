import { describe, expect, it } from 'vitest';
import { extractImports, extractPackage, extractTopLevelDeclarations } from './imports';
import { resolveKotlin, KotlinResolveContext } from './module-resolve';
import { buildKotlinContext } from './module-graph.service';
import type { AstNode } from './complexity.service';

function n(type: string, preview: string, children: AstNode[] = []): AstNode {
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

describe('extractImports — Kotlin', () => {
  it('extracts a simple top-level class import', () => {
    const ast = n('source_file', '', [
      n('import_header', 'import com.example.Foo'),
    ]);
    expect(extractImports(ast, 'kt')).toEqual([
      { specifier: 'com.example.Foo', relative: false },
    ]);
  });

  it('strips an `as` alias', () => {
    const ast = n('source_file', '', [
      n('import_header', 'import com.example.Foo as Bar'),
    ]);
    expect(extractImports(ast, 'kt')).toEqual([
      { specifier: 'com.example.Foo', relative: false },
    ]);
  });

  it('skips wildcard imports (we do not edge to packages today)', () => {
    const ast = n('source_file', '', [
      n('import_header', 'import com.example.*'),
    ]);
    expect(extractImports(ast, 'kt')).toEqual([]);
  });

  it('handles multiple imports + dedup', () => {
    const ast = n('source_file', '', [
      n('import_header', 'import com.example.A'),
      n('import_header', 'import com.example.B'),
      n('import_header', 'import com.example.A'),
    ]);
    expect(extractImports(ast, 'kt').map((i) => i.specifier).sort()).toEqual([
      'com.example.A',
      'com.example.B',
    ]);
  });
});

describe('extractPackage — Kotlin', () => {
  it('returns the package declaration when present', () => {
    const ast = n('source_file', '', [
      n('package_header', 'package com.example.foo'),
      n('import_header', 'import x.Y'),
    ]);
    expect(extractPackage(ast, 'kt')).toBe('com.example.foo');
  });

  it('returns null when there is no package declaration', () => {
    const ast = n('source_file', '', []);
    expect(extractPackage(ast, 'kt')).toBeNull();
  });

  it('returns null for non-Kotlin languages', () => {
    const ast = n('program', 'package x', [n('package_header', 'package x')]);
    expect(extractPackage(ast, 'ts')).toBeNull();
  });
});

describe('extractTopLevelDeclarations — Kotlin', () => {
  it('captures class, object, function names and a property', () => {
    const ast = n('source_file', '', [
      n('class_declaration', '', [n('type_identifier', 'Foo')]),
      n('object_declaration', '', [n('type_identifier', 'Bar')]),
      n('function_declaration', '', [n('simple_identifier', 'baz')]),
      n('property_declaration', '', [n('simple_identifier', 'qux')]),
    ]);
    expect(extractTopLevelDeclarations(ast, 'kt')).toEqual(['Foo', 'Bar', 'baz', 'qux']);
  });
});

describe('buildKotlinContext + resolveKotlin', () => {
  // Mirrors a typical project: a few files, two of them in the same package
  // with multiple top-level declarations (so the file stem isn't enough).
  const packageByPath = new Map<string, string>([
    ['src/main/kotlin/com/example/foo/Bar.kt', 'com.example.foo'],
    ['src/main/kotlin/com/example/foo/Baz.kt', 'com.example.foo'],
    ['src/main/kotlin/com/example/foo/Models.kt', 'com.example.foo'],
    ['src/main/kotlin/com/example/util/Utils.kt', 'com.example.util'],
  ]);
  const declsByPath = new Map<string, readonly string[]>([
    ['src/main/kotlin/com/example/foo/Models.kt', ['UserModel', 'OrderModel']],
    ['src/main/kotlin/com/example/util/Utils.kt', ['parseInt', 'parseFloat']],
  ]);

  const ctx: KotlinResolveContext = buildKotlinContext(packageByPath, declsByPath);

  it('resolves a class by its file stem (Bar.kt declares Bar)', () => {
    expect(resolveKotlin('com.example.foo.Bar', ctx)).toBe(
      'src/main/kotlin/com/example/foo/Bar.kt',
    );
  });

  it('resolves a class declared in a multi-class file (UserModel in Models.kt)', () => {
    expect(resolveKotlin('com.example.foo.UserModel', ctx)).toBe(
      'src/main/kotlin/com/example/foo/Models.kt',
    );
  });

  it('resolves a nested class by walking up the dotted path', () => {
    expect(resolveKotlin('com.example.foo.Bar.Nested', ctx)).toBe(
      'src/main/kotlin/com/example/foo/Bar.kt',
    );
  });

  it('resolves a top-level function via single-file-in-package fallback', () => {
    expect(resolveKotlin('com.example.util.parseInt', ctx)).toBe(
      'src/main/kotlin/com/example/util/Utils.kt',
    );
  });

  it('returns null for an import targeting an unknown package', () => {
    expect(resolveKotlin('kotlin.collections.List', ctx)).toBeNull();
  });
});
