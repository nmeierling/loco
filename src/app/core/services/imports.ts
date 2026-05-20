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
    case 'java': {
      visit(ast, (n) => {
        if (n.type === 'import_declaration') {
          // preview looks like: 'import com.example.Foo;', 'import static com.example.Utils.bar;',
          // or 'import com.example.foo.*;'. Static imports point at a class member; the dotted
          // path still includes the enclosing class, so the same walk-up resolver handles them.
          const m = n.preview.match(
            /^\s*import\s+(?:static\s+)?(\w+(?:\.\w+)*)(\.\*)?\s*;?/,
          );
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

const JVM_LANGS = new Set(['kt', 'kts', 'java']);

const JVM_PACKAGE_NODES = new Set([
  // Kotlin
  'package_header',
  // Java
  'package_declaration',
]);

const JVM_TOP_LEVEL_DECL_NODES = new Set([
  // Kotlin
  'class_declaration',
  'object_declaration',
  'function_declaration',
  'property_declaration',
  'type_alias',
  // Java
  'interface_declaration',
  'enum_declaration',
  'annotation_type_declaration',
  'record_declaration',
]);

const JVM_IDENTIFIER_NODES = new Set([
  'identifier',
  'type_identifier',
  'simple_identifier',
]);

/** Returns the package declaration of a file, if the language has one (Kotlin + Java today). */
export function extractPackage(ast: AstNode, languageId: string): string | null {
  if (!JVM_LANGS.has(languageId)) return null;
  let found: string | null = null;
  walk(ast, (n) => {
    if (found) return true;
    if (JVM_PACKAGE_NODES.has(n.type)) {
      const m = n.preview.match(/^\s*package\s+(\w+(?:\.\w+)*)/);
      if (m) found = m[1];
      return true;
    }
    return false;
  });
  return found;
}

/**
 * Top-level declaration names (classes/objects/interfaces/top-level fns/records/etc.).
 * Used to populate the package index for cross-file import resolution.
 */
export function extractTopLevelDeclarations(ast: AstNode, languageId: string): string[] {
  if (!JVM_LANGS.has(languageId)) return [];
  const out: string[] = [];
  for (const c of ast.children) {
    if (!JVM_TOP_LEVEL_DECL_NODES.has(c.type)) continue;
    for (const cc of c.children) {
      if (JVM_IDENTIFIER_NODES.has(cc.type)) {
        if (cc.preview) out.push(cc.preview);
        break;
      }
    }
  }
  return out;
}
