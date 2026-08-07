import { Injectable, inject } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import {
  SymbolAdjacency,
  SymbolDef,
  SymbolIndex,
  SymbolIndexService,
  buildSymbolAdjacency,
} from './symbol-index.service';

/** One function in a flow's call tree, with the functions it calls. */
export interface FlowNode {
  def: SymbolDef;
  /** This function's own branch count (McCabe-style, 1 when branchless). */
  complexity: number;
  children: FlowNode[];
  /**
   * A callee already shown elsewhere in this flow — a diamond join or a recursive
   * back-edge. Rendered as a dimmed leaf and not expanded again, so the tree stays finite.
   */
  repeat?: boolean;
}

/** An execution flow: an entry-point function and everything it transitively calls. */
export interface Flow {
  root: SymbolDef;
  /** Σ complexity over every distinct function the flow reaches. */
  total: number;
  /** Deepest call chain, in edges from the root. */
  depth: number;
  /** Distinct functions in the flow, including the root. */
  count: number;
  tree: FlowNode;
}

/** Per-flow bound on expanded nodes, so a hub callee can't blow one tree up. */
const NODE_CAP = 2000;
const FLOW_KINDS = new Set<SymbolDef['kind']>(['function', 'method']);

/**
 * Ranks "flows" through the application: entry-point functions (nothing in the indexed
 * code calls them, but they call others) scored by the total branching of everything they
 * reach. Derived entirely from the already-built {@link SymbolIndex} — no parsing here.
 */
@Injectable({ providedIn: 'root' })
export class ComplexityDepthService {
  private readonly index = inject(SymbolIndexService);
  private readonly store = inject(AnalysisStore);

  // Full ranked flow list, memoised against the index instance that produced it.
  private flowsFor: SymbolIndex | null = null;
  private cachedFlows: Flow[] = [];

  /** All flows, ranked by total complexity, whose root file survives the active filter. */
  flows(): Flow[] {
    const idx = this.index.index();
    if (!idx) return [];
    const all = this.ensureFlows(idx);
    const visible = this.store.filteredPaths();
    return all.filter((f) => visible.has(f.root.path));
  }

  private ensureFlows(idx: SymbolIndex): Flow[] {
    if (this.flowsFor === idx) return this.cachedFlows;
    const adj = buildSymbolAdjacency(idx);
    const flows: Flow[] = [];
    for (const id of roots(idx, adj)) {
      const flow = buildFlow(idx, adj, id);
      if (flow) flows.push(flow);
    }
    flows.sort((a, b) => b.total - a.total || b.depth - a.depth || a.root.id.localeCompare(b.root.id));
    this.flowsFor = idx;
    this.cachedFlows = flows;
    return flows;
  }
}

/** Entry points: callable declarations that call something but that nothing calls. */
function roots(idx: SymbolIndex, adj: SymbolAdjacency): string[] {
  const out: string[] = [];
  for (const [id, callees] of adj.out) {
    if (callees.size === 0) continue;
    if ((adj.in.get(id)?.size ?? 0) > 0) continue;
    const def = idx.defsById.get(id);
    if (def && FLOW_KINDS.has(def.kind)) out.push(id);
  }
  return out;
}

function buildFlow(idx: SymbolIndex, adj: SymbolAdjacency, rootId: string): Flow | null {
  const rootDef = idx.defsById.get(rootId);
  if (!rootDef) return null;

  const distinct = new Set<string>();
  const seen = new Set<string>([rootId]);
  let nodeCount = 1;
  const cx = (id: string): number => idx.complexityById.get(id) ?? 1;

  const build = (id: string, def: SymbolDef, onPath: Set<string>): FlowNode => {
    distinct.add(id);
    const node: FlowNode = { def, complexity: cx(id), children: [] };
    onPath.add(id);
    for (const callee of adj.out.get(id) ?? []) {
      if (nodeCount >= NODE_CAP) break;
      const cdef = idx.defsById.get(callee);
      if (!cdef) continue;
      nodeCount++;
      if (onPath.has(callee) || seen.has(callee)) {
        // Cycle back-edge or a subtree already shown — a leaf, not a re-expansion.
        distinct.add(callee);
        node.children.push({ def: cdef, complexity: cx(callee), children: [], repeat: true });
        continue;
      }
      seen.add(callee);
      node.children.push(build(callee, cdef, onPath));
    }
    onPath.delete(id);
    return node;
  };

  const tree = build(rootId, rootDef, new Set());
  let total = 0;
  for (const id of distinct) total += cx(id);
  return { root: rootDef, total, depth: depthOf(tree), count: distinct.size, tree };
}

function depthOf(node: FlowNode): number {
  let max = 0;
  for (const c of node.children) max = Math.max(max, 1 + depthOf(c));
  return max;
}
