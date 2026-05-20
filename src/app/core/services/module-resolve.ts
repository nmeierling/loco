const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;
const PY_EXTENSIONS = ['.py'] as const;

export interface JvmResolveContext {
  /** Fully-qualified name (`com.example.Foo`) → file path. Built from package + top-level declarations. */
  pkgIndex: ReadonlyMap<string, string>;
  /** Package name (`com.example`) → file paths in that package. Lets us resolve top-level functions. */
  pkgFiles: ReadonlyMap<string, readonly string[]>;
}

/**
 * Resolves a JVM-language import specifier (Kotlin or Java). Walks the dotted path
 * from deepest to shallowest looking for an indexed class; falls back to matching the
 * parent package when it contains exactly one file (typical for top-level function
 * imports in Kotlin or static-member imports in Java).
 */
export function resolveJvm(spec: string, ctx: JvmResolveContext): string | null {
  let cur = spec;
  while (cur.length > 0) {
    const hit = ctx.pkgIndex.get(cur);
    if (hit) return hit;
    const dot = cur.lastIndexOf('.');
    if (dot <= 0) break;
    cur = cur.slice(0, dot);
  }
  const dot = spec.lastIndexOf('.');
  if (dot > 0) {
    const pkgPart = spec.slice(0, dot);
    const files = ctx.pkgFiles.get(pkgPart);
    if (files && files.length === 1) return files[0] ?? null;
  }
  return null;
}

/**
 * Resolves an import specifier to a file path within the repo, or null if external/unresolvable.
 * Pure function — exported for unit testing.
 */
export function resolveSpecifier(
  spec: string,
  importerPath: string,
  languageId: string,
  files: Set<string>,
): string | null {
  if (languageId === 'py') return resolvePython(spec, importerPath, files);
  return resolveJsLike(spec, importerPath, files);
}

export function resolveJsLike(
  spec: string,
  importerPath: string,
  files: Set<string>,
): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/')) return null;

  const importerDir = parentDir(importerPath);
  const base = spec.startsWith('/') ? spec.slice(1) : joinPath(importerDir, spec);
  const candidates: string[] = [base];

  if (!hasKnownJsExtension(base)) {
    for (const ext of JS_EXTENSIONS) candidates.push(base + ext);
  }
  for (const ext of JS_EXTENSIONS) candidates.push(joinPath(base, 'index' + ext));

  for (const c of candidates) {
    const norm = normalizePath(c);
    if (files.has(norm)) return norm;
  }
  return null;
}

export function resolvePython(
  spec: string,
  importerPath: string,
  files: Set<string>,
): string | null {
  const leadingDots = (spec.match(/^\.+/)?.[0] ?? '').length;
  const tail = spec.slice(leadingDots);

  if (leadingDots > 0) {
    let dir = parentDir(importerPath);
    for (let i = 1; i < leadingDots; i++) dir = parentDir(dir);
    const asPath = tail.replace(/\./g, '/');
    const candidates = [
      joinPath(dir, asPath + '.py'),
      joinPath(joinPath(dir, asPath), '__init__.py'),
    ];
    for (const c of candidates) {
      const norm = normalizePath(c);
      if (files.has(norm)) return norm;
    }
    return null;
  }

  const asPath = spec.replace(/\./g, '/');
  for (const ext of PY_EXTENSIONS) {
    if (files.has(asPath + ext)) return asPath + ext;
  }
  if (files.has(asPath + '/__init__.py')) return asPath + '/__init__.py';
  return null;
}

export function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

export function joinPath(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return a + '/' + b;
}

export function hasKnownJsExtension(path: string): boolean {
  const last = path.lastIndexOf('/');
  const name = last >= 0 ? path.slice(last + 1) : path;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = '.' + name.slice(dot + 1).toLowerCase();
  return (JS_EXTENSIONS as readonly string[]).includes(ext);
}

export function normalizePath(path: string): string {
  const parts = path.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}
