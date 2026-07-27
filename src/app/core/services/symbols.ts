import { AstNode } from './complexity.service';

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'function'
  | 'const'
  | 'method'
  | 'property'
  | 'type'
  | 'enum';

/** A declaration found in one file. Members carry the declaring class/interface in `owner`. */
export interface FileSymbol {
  name: string;
  owner: string | null;
  kind: SymbolKind;
  exported: boolean;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  /** Position of the name token itself — used to keep declarations out of the reference list. */
  nameRow: number;
  nameCol: number;
}

/** `import { a, b as c } from './x'` → one binding with names {a→a, c→b}. */
export interface ImportBinding {
  specifier: string;
  /** local name → name as exported by the target module. */
  names: Map<string, string>;
}

export type RefShape = 'identifier' | 'member' | 'import';

/** An identifier occurrence, before it is matched against any declaration. */
export interface RawRef {
  name: string;
  shape: RefShape;
  /** The occurrence is the callee of a call expression. */
  call: boolean;
  /** Member access straight off `this` — points at the enclosing class, not an import. */
  viaThis: boolean;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
}

const JS_LANGS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);

export function isSymbolIndexSupported(languageId: string | null): boolean {
  return languageId !== null && JS_LANGS.has(languageId);
}

const CLASS_NODES = new Set(['class_declaration', 'abstract_class_declaration']);
const FUNCTION_NODES = new Set(['function_declaration', 'generator_function_declaration']);
const VALUE_NODES = new Set(['lexical_declaration', 'variable_declaration']);
const FUNCTION_VALUE_NODES = new Set(['arrow_function', 'function_expression', 'function']);
const MEMBER_NODES = new Set([
  'method_definition',
  'public_field_definition',
  'method_signature',
  'property_signature',
  'abstract_method_signature',
]);

function childOfType(node: AstNode, ...types: string[]): AstNode | null {
  for (const c of node.children) {
    if (types.includes(c.type)) return c;
  }
  return null;
}

function symbolAt(
  decl: AstNode,
  nameNode: AstNode,
  kind: SymbolKind,
  owner: string | null,
  exported: boolean,
): FileSymbol {
  return {
    name: nameNode.preview,
    owner,
    kind,
    exported,
    startRow: decl.startRow,
    startCol: decl.startCol,
    endRow: decl.endRow,
    endCol: decl.endCol,
    nameRow: nameNode.startRow,
    nameCol: nameNode.startCol,
  };
}

/**
 * Declarations in a file: top-level classes/functions/consts/types plus the members of
 * each class and interface. Only the JS/TS family is understood today.
 */
export function extractFileSymbols(ast: AstNode, languageId: string): FileSymbol[] {
  if (!isSymbolIndexSupported(languageId)) return [];
  const out: FileSymbol[] = [];

  const collectMembers = (body: AstNode | null, owner: string): void => {
    if (!body) return;
    for (const m of body.children) {
      if (!MEMBER_NODES.has(m.type)) continue;
      const nameNode = childOfType(m, 'property_identifier', 'identifier');
      if (!nameNode || !nameNode.preview) continue;
      const kind: SymbolKind =
        m.type === 'method_definition' || m.type.includes('method') ? 'method' : 'property';
      out.push(symbolAt(m, nameNode, kind, owner, true));
    }
  };

  const declare = (decl: AstNode, exported: boolean): void => {
    if (CLASS_NODES.has(decl.type)) {
      const nameNode = childOfType(decl, 'type_identifier', 'identifier');
      if (!nameNode) return;
      out.push(symbolAt(decl, nameNode, 'class', null, exported));
      collectMembers(childOfType(decl, 'class_body'), nameNode.preview);
      return;
    }
    if (decl.type === 'interface_declaration') {
      const nameNode = childOfType(decl, 'type_identifier', 'identifier');
      if (!nameNode) return;
      out.push(symbolAt(decl, nameNode, 'interface', null, exported));
      collectMembers(childOfType(decl, 'interface_body', 'object_type'), nameNode.preview);
      return;
    }
    if (FUNCTION_NODES.has(decl.type)) {
      const nameNode = childOfType(decl, 'identifier');
      if (nameNode) out.push(symbolAt(decl, nameNode, 'function', null, exported));
      return;
    }
    if (decl.type === 'type_alias_declaration') {
      const nameNode = childOfType(decl, 'type_identifier', 'identifier');
      if (nameNode) out.push(symbolAt(decl, nameNode, 'type', null, exported));
      return;
    }
    if (decl.type === 'enum_declaration') {
      const nameNode = childOfType(decl, 'identifier', 'type_identifier');
      if (nameNode) out.push(symbolAt(decl, nameNode, 'enum', null, exported));
      return;
    }
    if (VALUE_NODES.has(decl.type)) {
      for (const d of decl.children) {
        if (d.type !== 'variable_declarator') continue;
        const nameNode = childOfType(d, 'identifier');
        if (!nameNode) continue;
        const isFn = d.children.some((c) => FUNCTION_VALUE_NODES.has(c.type));
        out.push(symbolAt(d, nameNode, isFn ? 'function' : 'const', null, exported));
      }
    }
  };

  for (const top of ast.children) {
    if (top.type === 'export_statement') {
      for (const c of top.children) declare(c, true);
    } else {
      declare(top, false);
    }
  }

  return out;
}

/** Named/default/namespace import bindings, keyed by the local name each one introduces. */
export function extractImportBindings(ast: AstNode, languageId: string): ImportBinding[] {
  if (!isSymbolIndexSupported(languageId)) return [];
  const out: ImportBinding[] = [];

  const visit = (node: AstNode): void => {
    if (node.type === 'import_statement') {
      const source = childOfType(node, 'string');
      const clause = childOfType(node, 'import_clause');
      if (source && clause) {
        const spec = source.preview.replace(/^['"`]/, '').replace(/['"`]$/, '');
        const names = new Map<string, string>();
        for (const c of clause.children) {
          if (c.type === 'identifier') {
            names.set(c.preview, 'default');
          } else if (c.type === 'namespace_import') {
            const id = childOfType(c, 'identifier');
            if (id) names.set(id.preview, '*');
          } else if (c.type === 'named_imports') {
            for (const s of c.children) {
              if (s.type !== 'import_specifier') continue;
              const ids = s.children.filter(
                (x) => x.type === 'identifier' || x.type === 'type_identifier',
              );
              const imported = ids[0];
              if (!imported) continue;
              // `{ a as b }` gives two identifiers: imported first, local second.
              const local = ids[1] ?? imported;
              names.set(local.preview, imported.preview);
            }
          }
        }
        if (names.size > 0) out.push({ specifier: spec, names });
      }
      return;
    }
    for (const c of node.children) visit(c);
  };

  visit(ast);
  return out;
}

/**
 * Every identifier occurrence that could point at a declaration, minus the declaration
 * names themselves. Member accesses (`x.foo`) are kept separately from bare identifiers
 * because they resolve through a different path.
 */
export function extractRawRefs(
  ast: AstNode,
  languageId: string,
  symbols: readonly FileSymbol[],
): RawRef[] {
  if (!isSymbolIndexSupported(languageId)) return [];

  const declPositions = new Set<string>();
  for (const s of symbols) declPositions.add(`${s.nameRow}:${s.nameCol}`);

  const out: RawRef[] = [];

  const push = (node: AstNode, shape: RefShape, call: boolean, viaThis = false): void => {
    if (!node.preview) return;
    if (declPositions.has(`${node.startRow}:${node.startCol}`)) return;
    out.push({
      name: node.preview,
      shape,
      call,
      viaThis,
      row: node.startRow,
      col: node.startCol,
      endRow: node.endRow,
      endCol: node.endCol,
    });
  };

  const visit = (node: AstNode, parent: AstNode | null, index: number, inImport: boolean): void => {
    const importing = inImport || node.type === 'import_statement';

    if (node.type === 'identifier' || node.type === 'type_identifier') {
      if (importing) {
        push(node, 'import', false);
      } else {
        const isCallee = parent?.type === 'call_expression' && index === 0;
        // The object half of `a.b` is a plain identifier; treat it as one.
        push(node, 'identifier', isCallee);
      }
    } else if (node.type === 'property_identifier' && !importing) {
      // Only the property half of a member expression is a member reference; a
      // property_identifier elsewhere (object literal key, decorator) is not.
      if (parent?.type === 'member_expression' && index > 0) {
        push(node, 'member', false, parent.children[0]?.type === 'this');
      }
    }

    for (let i = 0; i < node.children.length; i++) {
      visit(node.children[i]!, node, i, importing);
    }
  };

  visit(ast, null, 0, false);

  // Mark member callees: `foo.bar()` parses as call_expression(member_expression, arguments),
  // so the call flag belongs to the member_expression's property, not to the call node.
  const calleeKeys = new Set<string>();
  const markCallees = (node: AstNode): void => {
    if (node.type === 'call_expression') {
      const callee = node.children[0];
      if (callee?.type === 'member_expression') {
        const prop = [...callee.children].reverse().find((c) => c.type === 'property_identifier');
        if (prop) calleeKeys.add(`${prop.startRow}:${prop.startCol}`);
      }
    }
    for (const c of node.children) markCallees(c);
  };
  markCallees(ast);

  for (const r of out) {
    if (r.shape === 'member' && calleeKeys.has(`${r.row}:${r.col}`)) r.call = true;
  }

  return out;
}
