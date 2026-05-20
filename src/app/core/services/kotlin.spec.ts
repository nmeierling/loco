import { describe, expect, it } from 'vitest';
import { extractImports, extractPackage, extractTopLevelDeclarations } from './imports';
import { resolveJvm, JvmResolveContext } from './module-resolve';
import { buildJvmContext } from './module-graph.service';
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

describe('extractImports — Java', () => {
  it('extracts a simple class import (with trailing semicolon)', () => {
    const ast = n('program', '', [
      n('import_declaration', 'import com.example.Foo;'),
    ]);
    expect(extractImports(ast, 'java')).toEqual([
      { specifier: 'com.example.Foo', relative: false },
    ]);
  });

  it('extracts a static import (the dotted path still leads to the enclosing class)', () => {
    const ast = n('program', '', [
      n('import_declaration', 'import static com.example.Utils.parseInt;'),
    ]);
    expect(extractImports(ast, 'java')).toEqual([
      { specifier: 'com.example.Utils.parseInt', relative: false },
    ]);
  });

  it('skips wildcard imports', () => {
    const ast = n('program', '', [
      n('import_declaration', 'import com.example.*;'),
      n('import_declaration', 'import static com.example.Utils.*;'),
    ]);
    expect(extractImports(ast, 'java')).toEqual([]);
  });
});

describe('extractPackage — Java', () => {
  it('handles `package x.y.z;` with trailing semicolon', () => {
    const ast = n('program', '', [
      n('package_declaration', 'package com.example.foo;'),
      n('import_declaration', 'import x.Y;'),
    ]);
    expect(extractPackage(ast, 'java')).toBe('com.example.foo');
  });
});

describe('extractTopLevelDeclarations — Java', () => {
  it('captures interface, enum, record, annotation, class names', () => {
    const ast = n('program', '', [
      n('class_declaration', '', [n('identifier', 'Foo')]),
      n('interface_declaration', '', [n('identifier', 'Bar')]),
      n('enum_declaration', '', [n('identifier', 'Color')]),
      n('annotation_type_declaration', '', [n('identifier', 'Marker')]),
      n('record_declaration', '', [n('identifier', 'Point')]),
    ]);
    expect(extractTopLevelDeclarations(ast, 'java')).toEqual([
      'Foo',
      'Bar',
      'Color',
      'Marker',
      'Point',
    ]);
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

describe('buildJvmContext + resolveJvm', () => {
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

  const ctx: JvmResolveContext = buildJvmContext(packageByPath, declsByPath);

  it('resolves a class by its file stem (Bar.kt declares Bar)', () => {
    expect(resolveJvm('com.example.foo.Bar', ctx)).toBe(
      'src/main/kotlin/com/example/foo/Bar.kt',
    );
  });

  it('resolves a class declared in a multi-class file (UserModel in Models.kt)', () => {
    expect(resolveJvm('com.example.foo.UserModel', ctx)).toBe(
      'src/main/kotlin/com/example/foo/Models.kt',
    );
  });

  it('resolves a nested class by walking up the dotted path', () => {
    expect(resolveJvm('com.example.foo.Bar.Nested', ctx)).toBe(
      'src/main/kotlin/com/example/foo/Bar.kt',
    );
  });

  it('resolves a top-level function via single-file-in-package fallback', () => {
    expect(resolveJvm('com.example.util.parseInt', ctx)).toBe(
      'src/main/kotlin/com/example/util/Utils.kt',
    );
  });

  it('returns null for an import targeting an unknown package', () => {
    expect(resolveJvm('kotlin.collections.List', ctx)).toBeNull();
  });
});
