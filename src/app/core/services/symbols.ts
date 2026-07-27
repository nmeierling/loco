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
const KOTLIN_LANGS = new Set(['kt', 'kts']);
const JAVA_LANGS = new Set(['java']);

export function isSymbolIndexSupported(languageId: string | null): boolean {
  return (
    languageId !== null &&
    (JS_LANGS.has(languageId) || KOTLIN_LANGS.has(languageId) || JAVA_LANGS.has(languageId))
  );
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
  if (KOTLIN_LANGS.has(languageId)) return extractKotlinFileSymbols(ast);
  if (JAVA_LANGS.has(languageId)) return extractJavaFileSymbols(ast);
  if (!JS_LANGS.has(languageId)) return [];
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
  if (KOTLIN_LANGS.has(languageId)) return extractKotlinImportBindings(ast);
  if (JAVA_LANGS.has(languageId)) return extractJavaImportBindings(ast);
  if (!JS_LANGS.has(languageId)) return [];
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
  if (KOTLIN_LANGS.has(languageId)) return extractKotlinRawRefs(ast, symbols);
  if (JAVA_LANGS.has(languageId)) return extractJavaRawRefs(ast, symbols);
  if (!JS_LANGS.has(languageId)) return [];

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

// ---- Kotlin -----------------------------------------------------------------
//
// Kotlin's tree-sitter grammar names nodes differently from the JS/TS family, so
// declarations, imports and references are collected with a separate set of node
// types. Resolution downstream is the same as for JS: a bare name resolves through
// import bindings or a local top-level declaration, a member `x.foo` through the
// single class that declares `foo`. `class`, `interface` and `enum class` all parse
// as `class_declaration`; the keyword is an anonymous token that never reaches the
// serialized AST, so the kind is read from the node preview / body shape instead.

const KT_IMPORT_RE = /^\s*import\s+(\w+(?:\.\w+)*)(\.\*)?(?:\s+as\s+(\w+))?/;

/** Kotlin visibility defaults to public; only a `private` modifier hides a top-level name. */
function ktIsPrivate(decl: AstNode): boolean {
  const mods = childOfType(decl, 'modifiers');
  return mods ? /\bprivate\b/.test(mods.preview) : false;
}

function ktClassKind(decl: AstNode): SymbolKind {
  if (childOfType(decl, 'enum_class_body')) return 'enum';
  // `interface` / `enum` are anonymous keyword tokens, so read them from the text.
  if (/\binterface\b/.test(decl.preview)) return 'interface';
  return 'class';
}

function extractKotlinFileSymbols(ast: AstNode): FileSymbol[] {
  const out: FileSymbol[] = [];

  const memberName = (m: AstNode): AstNode | null => {
    if (m.type === 'property_declaration') {
      const vd = childOfType(m, 'variable_declaration');
      return vd ? childOfType(vd, 'simple_identifier') : null;
    }
    return childOfType(m, 'simple_identifier');
  };

  const collectMembers = (body: AstNode | null, owner: string): void => {
    if (!body) return;
    for (const m of body.children) {
      if (m.type === 'companion_object') {
        // A companion's members are reached as `Owner.member`, so credit them to Owner.
        collectMembers(childOfType(m, 'class_body'), owner);
        continue;
      }
      if (
        m.type !== 'function_declaration' &&
        m.type !== 'property_declaration' &&
        m.type !== 'enum_entry'
      ) {
        continue;
      }
      const nameNode = memberName(m);
      if (!nameNode || !nameNode.preview) continue;
      const kind: SymbolKind = m.type === 'function_declaration' ? 'method' : 'property';
      out.push(symbolAt(m, nameNode, kind, owner, true));
    }
  };

  const declare = (decl: AstNode): void => {
    const exported = !ktIsPrivate(decl);
    switch (decl.type) {
      case 'class_declaration': {
        const nameNode = childOfType(decl, 'type_identifier');
        if (!nameNode) return;
        out.push(symbolAt(decl, nameNode, ktClassKind(decl), null, exported));
        collectMembers(childOfType(decl, 'class_body', 'enum_class_body'), nameNode.preview);
        return;
      }
      case 'object_declaration': {
        const nameNode = childOfType(decl, 'type_identifier');
        if (!nameNode) return;
        out.push(symbolAt(decl, nameNode, 'class', null, exported));
        collectMembers(childOfType(decl, 'class_body'), nameNode.preview);
        return;
      }
      case 'function_declaration': {
        const nameNode = childOfType(decl, 'simple_identifier');
        if (nameNode) out.push(symbolAt(decl, nameNode, 'function', null, exported));
        return;
      }
      case 'property_declaration': {
        const vd = childOfType(decl, 'variable_declaration');
        const nameNode = vd ? childOfType(vd, 'simple_identifier') : null;
        if (nameNode) out.push(symbolAt(decl, nameNode, 'const', null, exported));
        return;
      }
      case 'type_alias': {
        const nameNode = childOfType(decl, 'type_identifier');
        if (nameNode) out.push(symbolAt(decl, nameNode, 'type', null, exported));
        return;
      }
    }
  };

  for (const top of ast.children) declare(top);

  return out;
}

/** The name a Kotlin `import` introduces locally, plus the declaration it points at. */
function extractKotlinImportBindings(ast: AstNode): ImportBinding[] {
  const out: ImportBinding[] = [];

  const visit = (node: AstNode): void => {
    if (node.type === 'import_header') {
      const m = node.preview.match(KT_IMPORT_RE);
      // Skip wildcard imports (`import com.example.*`) — they bind no specific name.
      if (m && m[1] && !m[2]) {
        const fqn = m[1];
        const original = fqn.slice(fqn.lastIndexOf('.') + 1);
        const local = m[3] ?? original;
        out.push({ specifier: fqn, names: new Map([[local, original]]) });
      }
      return;
    }
    for (const c of node.children) visit(c);
  };

  visit(ast);
  return out;
}

function extractKotlinRawRefs(ast: AstNode, symbols: readonly FileSymbol[]): RawRef[] {
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

  // `foo.bar()` parses as call_expression(navigation_expression(foo, .bar), call_suffix),
  // so the call flag belongs to the member name inside the navigation, not the call node.
  const calleeKeys = new Set<string>();
  const markCallees = (node: AstNode): void => {
    if (node.type === 'call_expression') {
      const callee = node.children[0];
      if (callee?.type === 'navigation_expression') {
        const suffix = [...callee.children].reverse().find((c) => c.type === 'navigation_suffix');
        const name = suffix ? childOfType(suffix, 'simple_identifier') : null;
        if (name) calleeKeys.add(`${name.startRow}:${name.startCol}`);
      }
    }
    for (const c of node.children) markCallees(c);
  };
  markCallees(ast);

  const pushImportRef = (header: AstNode): void => {
    if (/\.\*/.test(header.preview)) return; // wildcard binds no name
    const alias = childOfType(header, 'import_alias');
    const token = alias
      ? childOfType(alias, 'type_identifier')
      : (() => {
          const id = childOfType(header, 'identifier');
          const segs = id?.children.filter((c) => c.type === 'simple_identifier') ?? [];
          return segs[segs.length - 1] ?? id ?? null;
        })();
    if (token) push(token, 'import', false);
  };

  const visit = (node: AstNode, parent: AstNode | null, index: number): void => {
    // Package segments are not references; import names are recorded separately.
    if (node.type === 'package_header') return;
    if (node.type === 'import_header') {
      pushImportRef(node);
      return;
    }

    if (node.type === 'navigation_suffix') {
      // `receiver.member` — the member is a reference; the receiver is the prior sibling.
      const name = childOfType(node, 'simple_identifier');
      if (name) {
        const receiver = parent?.children[index - 1] ?? null;
        const viaThis =
          receiver?.type === 'this_expression' || receiver?.type === 'super_expression';
        push(name, 'member', calleeKeys.has(`${name.startRow}:${name.startCol}`), viaThis);
      }
      return; // do not descend — the member id is already recorded
    }

    if (node.type === 'simple_identifier' || node.type === 'type_identifier') {
      const isCallee = parent?.type === 'call_expression' && index === 0;
      push(node, 'identifier', isCallee);
    }

    for (let i = 0; i < node.children.length; i++) {
      visit(node.children[i]!, node, i);
    }
  };

  visit(ast, null, 0);

  return out;
}

// ---- Java -------------------------------------------------------------------
//
// Java's grammar gives each declaration form its own node type (class/interface/
// enum/record), names declarations with `identifier` (types are `type_identifier`),
// and models access as `method_invocation`/`field_access` with the receiver as the
// first child. Resolution downstream is shared with Kotlin: imports are FQN-based and
// resolve through {@link resolveJvm}, member names through the single declaring class.

const JAVA_IMPORT_RE = /^\s*import\s+(?:static\s+)?(\w+(?:\.\w+)*)(\.\*)?/;

/** Only a `private` modifier hides a name; top-level Java types are never private. */
function javaIsPrivate(decl: AstNode): boolean {
  const mods = childOfType(decl, 'modifiers');
  return mods ? /\bprivate\b/.test(mods.preview) : false;
}

function extractJavaFileSymbols(ast: AstNode): FileSymbol[] {
  const out: FileSymbol[] = [];

  const collectMembers = (body: AstNode | null, owner: string): void => {
    if (!body) return;
    for (const m of body.children) {
      const exported = !javaIsPrivate(m);
      if (m.type === 'method_declaration') {
        const nameNode = childOfType(m, 'identifier');
        if (nameNode) out.push(symbolAt(m, nameNode, 'method', owner, exported));
      } else if (m.type === 'field_declaration') {
        // `int a, b;` declares several names under one field_declaration.
        for (const d of m.children) {
          if (d.type !== 'variable_declarator') continue;
          const nameNode = childOfType(d, 'identifier');
          if (nameNode) out.push(symbolAt(d, nameNode, 'property', owner, exported));
        }
      } else if (m.type === 'enum_constant') {
        const nameNode = childOfType(m, 'identifier');
        if (nameNode) out.push(symbolAt(m, nameNode, 'property', owner, true));
      }
    }
  };

  const declare = (decl: AstNode): void => {
    const exported = !javaIsPrivate(decl);
    const nameNode = childOfType(decl, 'identifier');
    if (!nameNode) return;
    switch (decl.type) {
      case 'class_declaration':
      case 'record_declaration': {
        out.push(symbolAt(decl, nameNode, 'class', null, exported));
        if (decl.type === 'record_declaration') {
          // A record's components are accessor-backed members (`point.x()`).
          const params = childOfType(decl, 'formal_parameters');
          for (const p of params?.children ?? []) {
            if (p.type !== 'formal_parameter') continue;
            const pn = childOfType(p, 'identifier');
            if (pn) out.push(symbolAt(p, pn, 'property', nameNode.preview, true));
          }
        }
        collectMembers(childOfType(decl, 'class_body'), nameNode.preview);
        return;
      }
      case 'interface_declaration':
      case 'annotation_type_declaration': {
        out.push(symbolAt(decl, nameNode, 'interface', null, exported));
        collectMembers(childOfType(decl, 'interface_body', 'annotation_type_body'), nameNode.preview);
        return;
      }
      case 'enum_declaration': {
        out.push(symbolAt(decl, nameNode, 'enum', null, exported));
        collectMembers(childOfType(decl, 'enum_body'), nameNode.preview);
        return;
      }
    }
  };

  for (const top of ast.children) declare(top);

  return out;
}

/** The name a Java `import` introduces locally, plus the declaration it points at. */
function extractJavaImportBindings(ast: AstNode): ImportBinding[] {
  const out: ImportBinding[] = [];

  const visit = (node: AstNode): void => {
    if (node.type === 'import_declaration') {
      const m = node.preview.match(JAVA_IMPORT_RE);
      // Skip on-demand (`import com.example.*`) imports — they bind no specific name.
      if (m && m[1] && !m[2]) {
        const fqn = m[1];
        const original = fqn.slice(fqn.lastIndexOf('.') + 1);
        out.push({ specifier: fqn, names: new Map([[original, original]]) });
      }
      return;
    }
    for (const c of node.children) visit(c);
  };

  visit(ast);
  return out;
}

function extractJavaRawRefs(ast: AstNode, symbols: readonly FileSymbol[]): RawRef[] {
  // Declaration names, and constructor names (which repeat the class name), are not refs.
  const skip = new Set<string>();
  for (const s of symbols) skip.add(`${s.nameRow}:${s.nameCol}`);

  const isReceiverThis = (n: AstNode | undefined): boolean =>
    n?.type === 'this' || n?.type === 'super';

  // First pass: classify the identifiers that are member accesses or bare-method calls,
  // since Java spells method names, field names and locals all as plain `identifier`.
  const memberInfo = new Map<string, { call: boolean; viaThis: boolean }>();
  const callIdents = new Set<string>();
  const classify = (node: AstNode): void => {
    if (node.type === 'constructor_declaration') {
      const n = childOfType(node, 'identifier');
      if (n) skip.add(`${n.startRow}:${n.startCol}`);
    } else if (node.type === 'method_invocation') {
      // `obj.method(args)` → [object?, name, argument_list]; `method(args)` → [name, argument_list].
      const argIdx = node.children.findIndex((c) => c.type === 'argument_list');
      const end = argIdx >= 0 ? argIdx : node.children.length;
      let nameIdx = -1;
      for (let i = end - 1; i >= 0; i--) {
        if (node.children[i]!.type === 'identifier') {
          nameIdx = i;
          break;
        }
      }
      if (nameIdx >= 0) {
        const name = node.children[nameIdx]!;
        const key = `${name.startRow}:${name.startCol}`;
        if (nameIdx > 0) {
          memberInfo.set(key, { call: true, viaThis: isReceiverThis(node.children[nameIdx - 1]) });
        } else {
          callIdents.add(key);
        }
      }
    } else if (node.type === 'field_access') {
      // `receiver.field` — the field is the last identifier, the receiver the first child.
      const ids = node.children.filter((c) => c.type === 'identifier');
      const name = ids[ids.length - 1];
      if (name) {
        memberInfo.set(`${name.startRow}:${name.startCol}`, {
          call: false,
          viaThis: isReceiverThis(node.children[0]),
        });
      }
    }
    for (const c of node.children) classify(c);
  };
  classify(ast);

  const out: RawRef[] = [];
  const push = (node: AstNode, shape: RefShape, call: boolean, viaThis = false): void => {
    if (!node.preview) return;
    if (skip.has(`${node.startRow}:${node.startCol}`)) return;
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

  const pushImportRef = (decl: AstNode): void => {
    if (/\*/.test(decl.preview)) return; // on-demand import binds no name
    const scoped = childOfType(decl, 'scoped_identifier', 'identifier');
    if (!scoped) return;
    let token: AstNode = scoped;
    if (scoped.type === 'scoped_identifier') {
      const ids = scoped.children.filter((c) => c.type === 'identifier');
      token = ids[ids.length - 1] ?? scoped;
    }
    push(token, 'import', false);
  };

  const visit = (node: AstNode): void => {
    if (node.type === 'package_declaration') return;
    if (node.type === 'import_declaration') {
      pushImportRef(node);
      return;
    }
    if (node.type === 'identifier' || node.type === 'type_identifier') {
      const key = `${node.startRow}:${node.startCol}`;
      const mem = memberInfo.get(key);
      if (mem) push(node, 'member', mem.call, mem.viaThis);
      else push(node, 'identifier', callIdents.has(key));
    }
    for (const c of node.children) visit(c);
  };
  visit(ast);

  return out;
}
