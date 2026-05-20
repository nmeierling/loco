import { Injectable, computed, inject, signal } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { ComplexityService } from './complexity.service';
import { detectLanguage } from '../languages';
import { walk } from '../models/tree';
import { extractImports, extractPackage, extractTopLevelDeclarations } from './imports';
import { KotlinResolveContext, resolveKotlin, resolveSpecifier } from './module-resolve';

const KOTLIN_LANGS = new Set(['kt', 'kts']);

export interface GraphNode {
  path: string;
  name: string;
  language: string | null;
  loc: number;
  inDegree: number;
  outDegree: number;
  group: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface ModuleGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedCount: number;
  externalCount: number;
}

export interface GraphBuildProgress {
  done: number;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class ModuleGraphService {
  private readonly store = inject(AnalysisStore);
  private readonly complexity = inject(ComplexityService);

  private readonly _graph = signal<ModuleGraph | null>(null);
  readonly graph = this._graph.asReadonly();

  readonly building = signal<GraphBuildProgress | null>(null);

  private buildingFor: string | null = null;

  constructor() {
    this.store.root;
    // Reset when root changes — track via a manual subscription via the root signal value.
    // Since the store's root is a signal, we wire a small effect outside via Angular's auto tracking.
  }

  /**
   * Build the module graph from the currently loaded project.
   * Idempotent for the same root identity; resets when the root changes.
   */
  async build(progress?: (p: GraphBuildProgress) => void): Promise<ModuleGraph> {
    const root = this.store.root();
    if (!root) {
      const empty: ModuleGraph = { nodes: [], edges: [], unresolvedCount: 0, externalCount: 0 };
      this._graph.set(empty);
      return empty;
    }
    const rootKey = this.store.rootName() + ':' + this.buildingFor;
    const cached = this._graph();
    if (cached && this.buildingFor === this.store.rootName()) return cached;

    this.buildingFor = this.store.rootName();

    // Collect candidate files (have a supported language + a blob)
    const blobs = this.store.fileBlobs();
    const fileSet = new Set<string>();
    const langByPath = new Map<string, string>();

    walk(root, (n) => {
      if (n.kind === 'file') {
        const lang = detectLanguage(n.name);
        if (lang && this.complexity.supports(lang.id)) {
          fileSet.add(n.path);
          langByPath.set(n.path, lang.id);
        }
      }
    });

    const candidates = [...fileSet];
    const total = candidates.length;
    const importsByPath = new Map<string, string[]>();
    const packageByPath = new Map<string, string>();
    const declsByPath = new Map<string, string[]>();
    let done = 0;

    for (const path of candidates) {
      const file = blobs.get(path);
      const langId = langByPath.get(path);
      if (!file || !langId) {
        done++;
        continue;
      }
      try {
        const text = await file.text();
        const ast = await this.complexity.parse(text, langId);
        if (ast) {
          const specs = extractImports(ast, langId).map((i) => i.specifier);
          if (specs.length > 0) importsByPath.set(path, specs);
          if (KOTLIN_LANGS.has(langId)) {
            const pkg = extractPackage(ast, langId);
            if (pkg) packageByPath.set(path, pkg);
            const decls = extractTopLevelDeclarations(ast, langId);
            if (decls.length > 0) declsByPath.set(path, decls);
          }
        }
      } catch {
        // skip
      }
      done++;
      const p = { done, total };
      this.building.set(p);
      progress?.(p);
      if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    // Build Kotlin package indices once for the whole repo
    const kotlinCtx: KotlinResolveContext = buildKotlinContext(packageByPath, declsByPath);

    // Build name → path index for absolute Python-like imports
    const allFiles = new Set<string>();
    walk(root, (n) => {
      if (n.kind === 'file') allFiles.add(n.path);
    });

    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    const edges: GraphEdge[] = [];
    let unresolvedCount = 0;
    let externalCount = 0;

    const edgeKeys = new Set<string>();
    const addEdge = (from: string, to: string) => {
      if (from === to) return;
      const key = from + '' + to;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ from, to });
      inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
      outDeg.set(from, (outDeg.get(from) ?? 0) + 1);
    };

    for (const [from, specs] of importsByPath) {
      const langId = langByPath.get(from) ?? 'ts';
      for (const spec of specs) {
        let resolved: string | null;
        if (KOTLIN_LANGS.has(langId)) {
          resolved = resolveKotlin(spec, kotlinCtx);
        } else {
          resolved = resolveSpecifier(spec, from, langId, allFiles);
        }
        if (resolved) {
          addEdge(from, resolved);
        } else if (KOTLIN_LANGS.has(langId)) {
          // Kotlin imports are absolute. Treat unresolved Kotlin imports as external
          // (standard library, kotlin.*, java.*, third-party) — not a bug in our walker.
          externalCount++;
        } else if (spec.startsWith('.') || spec.startsWith('/')) {
          unresolvedCount++;
        } else {
          externalCount++;
        }
      }
    }

    // Build node list — include any file that participates (in or out)
    const nodePaths = new Set<string>();
    for (const e of edges) {
      nodePaths.add(e.from);
      nodePaths.add(e.to);
    }
    // Also include files that didn't end up connected but have a supported language
    for (const p of candidates) nodePaths.add(p);

    const locByPath = new Map<string, number>();
    walk(root, (n) => {
      if (n.kind === 'file') locByPath.set(n.path, n.metrics.loc ?? 0);
    });

    const nodes: GraphNode[] = [...nodePaths].map((path) => {
      const last = path.lastIndexOf('/');
      const name = last >= 0 ? path.slice(last + 1) : path;
      const parent = last >= 0 ? path.slice(0, last) : '';
      const langId = langByPath.get(path) ?? null;
      return {
        path,
        name,
        language: langId,
        loc: locByPath.get(path) ?? 0,
        inDegree: inDeg.get(path) ?? 0,
        outDegree: outDeg.get(path) ?? 0,
        group: parent || '(root)',
      };
    });

    const graph: ModuleGraph = { nodes, edges, unresolvedCount, externalCount };
    this._graph.set(graph);
    this.building.set(null);
    return graph;
  }

  reset(): void {
    this._graph.set(null);
    this.buildingFor = null;
    this.building.set(null);
  }
}

/**
 * Builds the indices that {@link resolveKotlin} needs: one mapping fully-qualified
 * class/object/function names to their file paths, and one mapping package names
 * to the list of files declaring members in that package.
 *
 * Both the explicit declarations (from `extractTopLevelDeclarations`) and the file
 * stem are used as candidate names — Kotlin convention is `Foo.kt` declares `Foo`,
 * but multi-declaration files (`Models.kt`) need the explicit list too.
 */
export function buildKotlinContext(
  packageByPath: ReadonlyMap<string, string>,
  declsByPath: ReadonlyMap<string, readonly string[]>,
): KotlinResolveContext {
  const pkgIndex = new Map<string, string>();
  const pkgFiles = new Map<string, string[]>();

  for (const [path, pkg] of packageByPath) {
    const list = pkgFiles.get(pkg) ?? [];
    list.push(path);
    pkgFiles.set(pkg, list);

    const last = path.lastIndexOf('/');
    const filename = last >= 0 ? path.slice(last + 1) : path;
    const stem = filename.replace(/\.(kts?|java|scala)$/i, '');
    if (stem) {
      const key = pkg ? `${pkg}.${stem}` : stem;
      if (!pkgIndex.has(key)) pkgIndex.set(key, path);
    }

    const decls = declsByPath.get(path);
    if (decls) {
      for (const d of decls) {
        const key = pkg ? `${pkg}.${d}` : d;
        if (!pkgIndex.has(key)) pkgIndex.set(key, path);
      }
    }
  }

  return { pkgIndex, pkgFiles };
}

