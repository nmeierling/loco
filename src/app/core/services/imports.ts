import { AstNode } from './complexity.service';

export interface RawImport {
  /** Raw specifier as it appears in source, e.g. './foo', '../bar', 'react', 'com.example.Foo'. */
  specifier: string;
  /** True when the specifier is a relative path (starts with ./ or ../ or /). */
  relative: boolean;
}

function walk(node: AstNode, fn: (n: AstNode) => boolean | void): void {
  const stop = fn(node);
  if (stop === true) return;
  for (const c of node.children) walk(c, fn);
}

/** Extracts module/package specifiers a file imports. Supports JS/TS family, Python, Kotlin. */
export function extractImports(ast: AstNode, languageId: string): RawImport[] {
  const out: RawImport[] = [];
  const pushed = new Set<string>();
  const push = (raw: string) => {
    const s = raw.replace(/^['"`]/, '').replace(/['"`]$/, '');
    if (!s || pushed.has(s)) return;
    pushed.add(s);
    out.push({ specifier: s, relative: s.startsWith('./') || s.startsWith('../') || s.startsWith('/') });
  };

  const visit = walk;

  switch (languageId) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs': {
      visit(ast, (n) => {
        if (n.type === 'import_statement' || n.type === 'export_statement') {
          // string child holds the specifier
          for (const c of n.children) {
            if (c.type === 'string') {
              push(c.preview);
              return;
            }
          }
        }
        // dynamic import()
        if (n.type === 'call_expression') {
          const head = n.children[0];
          if (head && (head.type === 'import' || head.preview === 'import')) {
            for (const c of n.children) {
              if (c.type === 'arguments') {
                for (const a of c.children) {
                  if (a.type === 'string') push(a.preview);
                }
              }
            }
          }
        }
        // require('x')
        if (n.type === 'call_expression') {
          const head = n.children[0];
          if (head && head.preview === 'require') {
            for (const c of n.children) {
              if (c.type === 'arguments') {
                for (const a of c.children) {
                  if (a.type === 'string') push(a.preview);
                }
              }
            }
          }
        }
      });
      break;
    }
    case 'kt':
    case 'kts': {
      visit(ast, (n) => {
        if (n.type === 'import_header') {
          // preview looks like: 'import com.example.Foo', 'import com.example.foo.*',
          // or 'import com.example.Foo as Bar'. Use alternation (not [\w.]+) so the
          // dot in '.*' isn't greedily consumed by the identifier capture.
          const m = n.preview.match(/^\s*import\s+(\w+(?:\.\w+)*)(\.\*)?(?:\s+as\s+\w+)?/);
          if (m && m[1] && !m[2]) push(m[1]);
        }
      });
      break;
    }
    case 'py': {
      visit(ast, (n) => {
        if (n.type === 'import_statement') {
          for (const c of n.children) {
            if (c.type === 'dotted_name' || c.type === 'aliased_import') {
              const name = c.type === 'aliased_import' ? c.children[0]?.preview ?? '' : c.preview;
              if (name) push(name);
            }
          }
        }
        if (n.type === 'import_from_statement') {
          let module = '';
          let leadingDots = 0;
          for (const c of n.children) {
            if (c.type === 'dotted_name') {
              if (!module) module = c.preview;
            } else if (c.type === 'relative_import') {
              const t = c.preview;
              leadingDots = (t.match(/^\.+/)?.[0] ?? '').length;
              const after = t.replace(/^\.+/, '');
              if (after) module = after;
            }
          }
          const prefix = '.'.repeat(leadingDots);
          const full = prefix + module;
          if (full) push(full);
        }
      });
      break;
    }
  }

  return out;
}

/** Returns the package declaration of a file, if the language has one (Kotlin today). */
export function extractPackage(ast: AstNode, languageId: string): string | null {
  if (languageId !== 'kt' && languageId !== 'kts') return null;
  let found: string | null = null;
  walk(ast, (n) => {
    if (found) return true;
    if (n.type === 'package_header') {
      const m = n.preview.match(/^\s*package\s+(\w+(?:\.\w+)*)/);
      if (m) found = m[1];
      return true;
    }
    return false;
  });
  return found;
}

/**
 * Top-level declaration names (classes/objects/interfaces/top-level fns) for a Kotlin file.
 * Used to populate the package index for cross-file import resolution.
 */
export function extractTopLevelDeclarations(ast: AstNode, languageId: string): string[] {
  if (languageId !== 'kt' && languageId !== 'kts') return [];
  const out: string[] = [];
  for (const c of ast.children) {
    if (
      c.type !== 'class_declaration' &&
      c.type !== 'object_declaration' &&
      c.type !== 'function_declaration' &&
      c.type !== 'property_declaration' &&
      c.type !== 'type_alias'
    ) {
      continue;
    }
    for (const cc of c.children) {
      if (
        cc.type === 'identifier' ||
        cc.type === 'type_identifier' ||
        cc.type === 'simple_identifier'
      ) {
        if (cc.preview) out.push(cc.preview);
        break;
      }
    }
  }
  return out;
}
