import { AstNode } from './complexity.service';

export interface CallGraphFunc {
  id: string;
  name: string;
  kind: 'function' | 'method' | 'arrow' | 'module';
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  outDegree: number;
  inDegree: number;
}

export interface CallGraphEdge {
  from: string;
  to: string;
}

export interface CallGraph {
  functions: CallGraphFunc[];
  edges: CallGraphEdge[];
}

interface Collected {
  func: CallGraphFunc;
  body: AstNode | null;
}

const SUPPORTED_LANGS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']);

export function isCallGraphSupported(languageId: string | null): boolean {
  return languageId !== null && SUPPORTED_LANGS.has(languageId);
}

/**
 * Build a per-file call graph: function-like declarations and direct identifier calls between them.
 * Only resolves intra-file calls; calls to imports / methods / unknown identifiers are dropped.
 */
export function extractCallGraph(ast: AstNode, languageId: string): CallGraph {
  if (!isCallGraphSupported(languageId)) return { functions: [], edges: [] };

  const collected: Collected[] = [];
  let idCounter = 0;
  const nameToIds = new Map<string, string[]>();

  const moduleFunc: Collected = {
    func: {
      id: '__module__',
      name: '(module)',
      kind: 'module',
      startRow: ast.startRow,
      startCol: ast.startCol,
      endRow: ast.endRow,
      endCol: ast.endCol,
      outDegree: 0,
      inDegree: 0,
    },
    body: ast,
  };

  function makeId(name: string): string {
    return `${name}#${++idCounter}`;
  }

  function register(func: CallGraphFunc, body: AstNode | null): void {
    collected.push({ func, body });
    const list = nameToIds.get(func.name) ?? [];
    list.push(func.id);
    nameToIds.set(func.name, list);
  }

  function findFirstChild(node: AstNode, type: string): AstNode | null {
    for (const c of node.children) if (c.type === type) return c;
    return null;
  }

  function nameFromIdentifier(node: AstNode | null): string | null {
    if (!node) return null;
    // preview is the source text — for identifier nodes this is the name
    return node.preview || null;
  }

  function walkDeclarations(node: AstNode): void {
    if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
      const nameNode = findFirstChild(node, 'identifier') ?? findFirstChild(node, 'property_identifier');
      const name = nameFromIdentifier(nameNode) ?? '(anonymous)';
      const body = findFirstChild(node, 'statement_block');
      register(
        {
          id: makeId(name),
          name,
          kind: 'function',
          startRow: node.startRow,
          startCol: node.startCol,
          endRow: node.endRow,
          endCol: node.endCol,
          outDegree: 0,
          inDegree: 0,
        },
        body,
      );
      return;
    }
    if (node.type === 'method_definition') {
      const nameNode =
        findFirstChild(node, 'property_identifier') ??
        findFirstChild(node, 'identifier') ??
        findFirstChild(node, 'computed_property_name');
      const name = nameFromIdentifier(nameNode) ?? '(method)';
      const body = findFirstChild(node, 'statement_block');
      register(
        {
          id: makeId(name),
          name,
          kind: 'method',
          startRow: node.startRow,
          startCol: node.startCol,
          endRow: node.endRow,
          endCol: node.endCol,
          outDegree: 0,
          inDegree: 0,
        },
        body,
      );
      // Don't recurse into methods to find nested decls separately — they'll be discovered via body walk if relevant.
    }
    if (node.type === 'variable_declarator') {
      // const foo = () => {...}  or  const foo = function() {...}
      const nameNode = findFirstChild(node, 'identifier');
      const fnNode =
        findFirstChild(node, 'arrow_function') ??
        findFirstChild(node, 'function_expression') ??
        findFirstChild(node, 'function');
      if (nameNode && fnNode) {
        const name = nameFromIdentifier(nameNode) ?? '(anonymous)';
        const body =
          findFirstChild(fnNode, 'statement_block') ??
          fnNode.children.find((c) => c.type === 'expression_statement') ??
          fnNode;
        register(
          {
            id: makeId(name),
            name,
            kind: 'arrow',
            startRow: node.startRow,
            startCol: node.startCol,
            endRow: node.endRow,
            endCol: node.endCol,
            outDegree: 0,
            inDegree: 0,
          },
          body,
        );
      }
    }
    for (const c of node.children) walkDeclarations(c);
  }

  walkDeclarations(ast);
  // module-level pseudo at the end so its calls are resolved against all named decls
  collected.push(moduleFunc);

  // Build a set of node ranges occupied by registered functions (exclude module) so we can
  // detect whether a call expression belongs to the module level or a function body.
  const funcRanges = collected
    .filter((c) => c.func.kind !== 'module')
    .map((c) => ({ id: c.func.id, startRow: c.func.startRow, endRow: c.func.endRow }));

  function ownerOf(callNode: AstNode): string {
    // pick the smallest enclosing registered function range that contains the call
    let bestId = moduleFunc.func.id;
    let bestSize = Infinity;
    for (const r of funcRanges) {
      if (
        callNode.startRow >= r.startRow &&
        callNode.endRow <= r.endRow &&
        !(callNode.startRow === r.startRow && callNode.endRow === r.endRow)
      ) {
        const size = r.endRow - r.startRow;
        if (size < bestSize) {
          bestSize = size;
          bestId = r.id;
        }
      }
    }
    return bestId;
  }

  // Walk the whole AST collecting call_expressions with identifier callees
  const edges: CallGraphEdge[] = [];
  const seenEdgeKeys = new Set<string>();
  function walkCalls(node: AstNode): void {
    if (node.type === 'call_expression') {
      const callee = node.children[0];
      if (callee && callee.type === 'identifier') {
        const name = callee.preview;
        const ids = nameToIds.get(name);
        if (ids && ids.length > 0) {
          const from = ownerOf(node);
          for (const to of ids) {
            const key = from + '' + to;
            if (seenEdgeKeys.has(key)) continue;
            seenEdgeKeys.add(key);
            edges.push({ from, to });
          }
        }
      }
    }
    for (const c of node.children) walkCalls(c);
  }
  walkCalls(ast);

  // Compute degrees
  const byId = new Map<string, CallGraphFunc>();
  for (const c of collected) byId.set(c.func.id, c.func);
  for (const e of edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (from) from.outDegree++;
    if (to) to.inDegree++;
  }

  // Trim module pseudo if it has no outgoing edges (avoids clutter)
  const moduleHasEdges = edges.some((e) => e.from === moduleFunc.func.id);
  const functions = collected
    .map((c) => c.func)
    .filter((f) => f.kind !== 'module' || moduleHasEdges);

  return { functions, edges };
}
