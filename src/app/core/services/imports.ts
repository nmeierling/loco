import { AstNode } from './complexity.service';

export interface RawImport {
  /** Raw specifier as it appears in source, e.g. './foo', '../bar', 'react'. */
  specifier: string;
  /** True when the specifier is a relative path (starts with ./ or ../ or /). */
  relative: boolean;
}

/** Extracts module/package specifiers a file imports. Supports JS/TS family + Python. */
export function extractImports(ast: AstNode, languageId: string): RawImport[] {
  const out: RawImport[] = [];
  const pushed = new Set<string>();
  const push = (raw: string) => {
    const s = raw.replace(/^['"`]/, '').replace(/['"`]$/, '');
    if (!s || pushed.has(s)) return;
    pushed.add(s);
    out.push({ specifier: s, relative: s.startsWith('./') || s.startsWith('../') || s.startsWith('/') });
  };

  const visit = (node: AstNode, fn: (n: AstNode) => boolean | void): void => {
    const stop = fn(node);
    if (stop === true) return;
    for (const c of node.children) visit(c, fn);
  };

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
