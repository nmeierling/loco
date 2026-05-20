import { describe, expect, it } from 'vitest';
import {
  hasKnownJsExtension,
  joinPath,
  normalizePath,
  parentDir,
  resolveJsLike,
  resolvePython,
  resolveSpecifier,
} from './module-resolve';

describe('module-resolve helpers', () => {
  it('parentDir', () => {
    expect(parentDir('a/b/c')).toBe('a/b');
    expect(parentDir('top.ts')).toBe('');
  });

  it('joinPath ignores empty parts', () => {
    expect(joinPath('a', 'b')).toBe('a/b');
    expect(joinPath('', 'b')).toBe('b');
    expect(joinPath('a', '')).toBe('a');
  });

  it('normalizePath collapses . and ..', () => {
    expect(normalizePath('a/./b/../c')).toBe('a/c');
    expect(normalizePath('a/b//c')).toBe('a/b/c');
    expect(normalizePath('a/b/c/..')).toBe('a/b');
  });

  it('hasKnownJsExtension recognises real JS extensions but ignores domain-style names like foo.service', () => {
    expect(hasKnownJsExtension('app/foo.ts')).toBe(true);
    expect(hasKnownJsExtension('app/foo.tsx')).toBe(true);
    expect(hasKnownJsExtension('app/index.js')).toBe(true);
    expect(hasKnownJsExtension('app/foo.service')).toBe(false);
    expect(hasKnownJsExtension('app/no-ext')).toBe(false);
  });
});

describe('resolveJsLike', () => {
  const files = new Set([
    'app/core/services/foo.service.ts',
    'app/core/services/bar.service.tsx',
    'app/core/services/index.ts',
    'app/utils.js',
    'app/index.ts',
  ]);

  it('resolves a dotless relative TS specifier with multi-dot basename', () => {
    expect(
      resolveJsLike('../core/services/foo.service', 'app/shell/shell.component.ts', files),
    ).toBe('app/core/services/foo.service.ts');
  });

  it('resolves a tsx file when the spec is dotless', () => {
    expect(
      resolveJsLike('../core/services/bar.service', 'app/shell/shell.component.ts', files),
    ).toBe('app/core/services/bar.service.tsx');
  });

  it('resolves a folder import to its index file', () => {
    expect(
      resolveJsLike('../core/services', 'app/shell/shell.component.ts', files),
    ).toBe('app/core/services/index.ts');
  });

  it('returns null for external package specifiers', () => {
    expect(resolveJsLike('@angular/core', 'app/shell/shell.component.ts', files)).toBeNull();
    expect(resolveJsLike('lodash', 'app/shell/shell.component.ts', files)).toBeNull();
  });

  it('returns null for relative paths that point outside the file set', () => {
    expect(resolveJsLike('./nope', 'app/shell/shell.component.ts', files)).toBeNull();
  });
});

describe('resolvePython', () => {
  const files = new Set([
    'pkg/__init__.py',
    'pkg/sub/__init__.py',
    'pkg/sub/foo.py',
    'pkg/bar.py',
  ]);

  it('resolves a relative single-dot import to a sibling module', () => {
    expect(resolvePython('.foo', 'pkg/sub/__init__.py', files)).toBe('pkg/sub/foo.py');
  });

  it('resolves a double-dot import that climbs one level', () => {
    expect(resolvePython('..bar', 'pkg/sub/foo.py', files)).toBe('pkg/bar.py');
  });

  it('resolves an absolute import to a module file', () => {
    expect(resolvePython('pkg.bar', 'pkg/sub/foo.py', files)).toBe('pkg/bar.py');
  });

  it('resolves an absolute import to a package __init__.py', () => {
    expect(resolvePython('pkg.sub', 'pkg/__init__.py', files)).toBe('pkg/sub/__init__.py');
  });
});

describe('resolveSpecifier dispatches by language', () => {
  it('dispatches to python resolver for py', () => {
    const files = new Set(['pkg/__init__.py', 'pkg/foo.py']);
    expect(resolveSpecifier('.foo', 'pkg/__init__.py', 'py', files)).toBe('pkg/foo.py');
  });

  it('dispatches to js-like resolver for ts', () => {
    const files = new Set(['app/foo.ts']);
    expect(resolveSpecifier('./foo', 'app/bar.ts', 'ts', files)).toBe('app/foo.ts');
  });
});
