import { Injectable, inject, signal } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { ComplexityService } from './complexity.service';
import { detectLanguage } from '../languages';
import { walk } from '../models/tree';
import { buildJvmContext, resolveJvm, resolveSpecifier } from './module-resolve';
import { extractPackage } from './imports';
import {
  FileSymbol,
  ImportBinding,
  RawRef,
  SymbolKind,
  extractFileSymbols,
  extractImportBindings,
  extractRawRefs,
  isSymbolIndexSupported,
} from './symbols';

/** Languages whose imports are package-qualified and resolve through {@link resolveJvm}. */
const JVM_LANGS = new Set(['kt', 'kts', 'java']);

export interface SymbolDef {
  /** `path#Name` for top-level symbols, `path#Owner.member` for members. */
  id: string;
  path: string;
  name: string;
  owner: string | null;
  kind: SymbolKind;
  exported: boolean;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SymbolRef {
  defId: string;
  /** File the reference appears in. */
  path: string;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
  /** Trimmed source line, for display in the usage list. */
  line: string;
  kind: 'import' | 'call' | 'read';
  /**
   * Declaration the reference sits inside — the method or function that does the
   * calling. Null for top-of-file references such as imports. This is what makes a
   * caller trace possible: a usage is attributable to a symbol, not just a file.
   */
  enclosingId: string | null;
}

/**
 * A use of a symbol imported from outside the repo — a third-party dependency (Spring,
 * a Neo4j client, lodash…). These never resolve to a {@link SymbolDef}, so they are kept
 * separately to power the "External" direction.
 */
export interface ExternalRef {
  /**
   * The dependency it comes from: the package for JVM imports (`org.neo4j.driver`), the
   * bare module specifier for JS/TS (`neo4j-driver`, `@angular/core`).
   */
  module: string;
  /** Local name the import introduces in this file (`Driver`). */
  name: string;
  /** Name as exported by the module (differs from `name` only for aliased imports). */
  imported: string;
  path: string;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
  line: string;
  kind: 'import' | 'call' | 'read';
}

/** A slice of the symbol call/usage graph: nodes and the caller→callee edges among them. */
export interface SymbolGraph {
  nodes: SymbolDef[];
  edges: { from: string; to: string }[];
}

export interface SymbolIndex {
  defsById: ReadonlyMap<string, SymbolDef>;
  defsByPath: ReadonlyMap<string, SymbolDef[]>;
  /** Usages of a declaration, anywhere in the repo. */
  refsByDef: ReadonlyMap<string, SymbolRef[]>;
  /** Usages grouped by the file they appear in — powers the "uses" direction. */
  refsByPath: ReadonlyMap<string, SymbolRef[]>;
  /** Out-of-repo dependency usages per file — powers the "external" direction. */
  externalByPath: ReadonlyMap<string, ExternalRef[]>;
  /** Files that were parsed for symbols. */
  indexedPaths: ReadonlySet<string>;
}

export interface IndexProgress {
  done: number;
  total: number;
}

/** One file's raw extraction, before cross-file resolution. Exported for unit testing. */
export interface FileScan {
  path: string;
  langId: string;
  lines: string[];
  symbols: FileSymbol[];
  bindings: ImportBinding[];
  refs: RawRef[];
  /** Package declaration for JVM files (null elsewhere), used to build the resolve context. */
  pkg: string | null;
}

const EMPTY: SymbolIndex = {
  defsById: new Map(),
  defsByPath: new Map(),
  refsByDef: new Map(),
  refsByPath: new Map(),
  externalByPath: new Map(),
  indexedPaths: new Set(),
};

/**
 * Repo-wide index of declarations and their usages, so a file can answer "who calls
 * this?" as well as "what does this call?".
 *
 * Resolution is import-driven rather than type-driven: a bare identifier resolves via
 * the file's import bindings (or a local declaration), and a member access `x.foo()`
 * resolves only when exactly one class visible in that file — local or imported —
 * declares `foo`. Ambiguous member names are dropped rather than guessed at.
 */
@Injectable({ providedIn: 'root' })
export class SymbolIndexService {
  private readonly store = inject(AnalysisStore);
  private readonly complexity = inject(ComplexityService);

  private readonly _index = signal<SymbolIndex | null>(null);
  readonly index = this._index.asReadonly();
  readonly building = signal<IndexProgress | null>(null);

  private builtFor = -1;
  private inFlight: Promise<SymbolIndex> | null = null;

  // Symbol-to-symbol adjacency (caller→callee), derived lazily from the index and
  // memoised against the index instance that produced it.
  private adjacencyFor: SymbolIndex | null = null;
  private adjacency: SymbolAdjacency = { out: new Map(), in: new Map() };

  /** Builds once per loaded project; concurrent callers share the same run. */
  async build(): Promise<SymbolIndex> {
    const project = this.store.projectId();
    const cached = this._index();
    if (cached && this.builtFor === project) return cached;
    if (this.inFlight) return this.inFlight;

    const run = this.doBuild(project).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  reset(): void {
    this._index.set(null);
    this.building.set(null);
    this.builtFor = -1;
  }

  private ensureAdjacency(idx: SymbolIndex): SymbolAdjacency {
    if (this.adjacencyFor !== idx) {
      this.adjacency = buildSymbolAdjacency(idx);
      this.adjacencyFor = idx;
    }
    return this.adjacency;
  }

  /**
   * Declarations in `paths` that take part in at least one call/usage edge — the seed
   * set for the graph. Symbols nothing reaches and that reach nothing are left out so
   * the initial view isn't a field of disconnected dots.
   */
  seed(paths: Iterable<string>): string[] {
    const idx = this._index();
    if (!idx) return [];
    return seedSymbols(idx, this.ensureAdjacency(idx), paths);
  }

  /**
   * The graph to draw: the `focused` symbols, their immediate callers and callees, and
   * every caller→callee edge among that node set. Adding a symbol to `focused` (clicking
   * a node) pulls its neighbours in, so the graph is explored outward a step at a time
   * rather than dumped whole.
   */
  subgraph(focused: ReadonlySet<string>): SymbolGraph {
    const idx = this._index();
    if (!idx) return { nodes: [], edges: [] };
    return symbolSubgraph(idx, this.ensureAdjacency(idx), focused);
  }

  /**
   * Exported top-level declarations nothing resolves to. Members are excluded: their
   * resolution is a heuristic, so a zero there means "not proven", not "unused".
   */
  unusedExports(): SymbolDef[] {
    const idx = this._index();
    if (!idx) return [];
    const out: SymbolDef[] = [];
    for (const def of idx.defsById.values()) {
      if (def.owner !== null || !def.exported) continue;
      if ((idx.refsByDef.get(def.id)?.length ?? 0) === 0) out.push(def);
    }
    return out.sort((a, b) => a.path.localeCompare(b.path) || a.startRow - b.startRow);
  }

  /**
   * Per folder: which of its exports are reached from outside it. A folder whose
   * exports are nearly all internal has a real boundary; one that leaks everything
   * is a folder, not a module.
   */
  folderSurface(): FolderSurface[] {
    const idx = this._index();
    if (!idx) return [];
    const byFolder = new Map<string, FolderSurface>();
    for (const def of idx.defsById.values()) {
      if (def.owner !== null || !def.exported) continue;
      const folder = parentFolder(def.path);
      let entry = byFolder.get(folder);
      if (!entry) {
        entry = { folder, exported: [], external: [], internal: [], unused: [] };
        byFolder.set(folder, entry);
      }
      entry.exported.push(def);
      const refs = idx.refsByDef.get(def.id) ?? [];
      if (refs.length === 0) {
        entry.unused.push(def);
      } else if (refs.some((r) => parentFolder(r.path) !== folder)) {
        entry.external.push(def);
      } else {
        entry.internal.push(def);
      }
    }
    return [...byFolder.values()].sort(
      (a, b) => b.external.length - a.external.length || a.folder.localeCompare(b.folder),
    );
  }

  private async doBuild(project: number): Promise<SymbolIndex> {
    const root = this.store.root();
    if (!root) return EMPTY;

    const blobs = this.store.fileBlobs();
    const allFiles = new Set<string>();
    const targets: { path: string; langId: string }[] = [];
    walk(root, (n) => {
      if (n.kind !== 'file') return;
      allFiles.add(n.path);
      const lang = detectLanguage(n.name);
      if (lang && isSymbolIndexSupported(lang.id)) targets.push({ path: n.path, langId: lang.id });
    });

    const scans: FileScan[] = [];
    let done = 0;
    this.building.set({ done: 0, total: targets.length });

    for (const t of targets) {
      const file = blobs.get(t.path);
      if (file) {
        try {
          const text = await file.text();
          const ast = await this.complexity.parse(text, t.langId);
          if (ast) {
            const symbols = extractFileSymbols(ast, t.langId);
            scans.push({
              path: t.path,
              langId: t.langId,
              lines: text.split(/\r?\n/),
              symbols,
              bindings: extractImportBindings(ast, t.langId),
              refs: extractRawRefs(ast, t.langId, symbols),
              pkg: JVM_LANGS.has(t.langId) ? extractPackage(ast, t.langId) : null,
            });
          }
        } catch {
          // A file that won't parse simply contributes nothing to the index.
        }
      }
      done++;
      this.building.set({ done, total: targets.length });
      if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    const index = resolve(scans, allFiles);
    this.building.set(null);
    // A project swap mid-build invalidates the result; drop it rather than publish it.
    if (this.store.projectId() !== project) return EMPTY;
    this.builtFor = project;
    this._index.set(index);
    return index;
  }
}

/** The export surface of one folder, split by who reaches it. */
export interface FolderSurface {
  folder: string;
  exported: SymbolDef[];
  /** Reached from outside the folder — the folder's real public API. */
  external: SymbolDef[];
  /** Referenced, but only from inside the folder. */
  internal: SymbolDef[];
  /** Exported and never resolved anywhere. */
  unused: SymbolDef[];
}

export function parentFolder(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

/** The package part of a JVM import FQN — everything before the imported class name. */
function packageOf(fqn: string): string {
  const dot = fqn.lastIndexOf('.');
  return dot > 0 ? fqn.slice(0, dot) : fqn;
}

function defId(path: string, owner: string | null, name: string): string {
  return owner ? `${path}#${owner}.${name}` : `${path}#${name}`;
}

/** Caller→callee adjacency over the symbol index, both directions. Exported for testing. */
export interface SymbolAdjacency {
  /** symbol → symbols it calls/uses. */
  out: Map<string, Set<string>>;
  /** symbol → symbols that call/use it. */
  in: Map<string, Set<string>>;
}

/** Derives the symbol call/usage graph from an index: an edge per resolved, attributed usage. */
export function buildSymbolAdjacency(idx: SymbolIndex): SymbolAdjacency {
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  const link = (m: Map<string, Set<string>>, key: string, val: string): void => {
    let set = m.get(key);
    if (!set) {
      set = new Set();
      m.set(key, set);
    }
    set.add(val);
  };
  for (const refs of idx.refsByDef.values()) {
    for (const r of refs) {
      // Edge = the symbol a usage sits in → the symbol it resolves to. Self-edges
      // (recursion, a class naming its own type) are not worth drawing.
      if (!r.enclosingId || r.enclosingId === r.defId) continue;
      link(out, r.enclosingId, r.defId);
      link(inn, r.defId, r.enclosingId);
    }
  }
  return { out, in: inn };
}

export function seedSymbols(
  idx: SymbolIndex,
  adj: SymbolAdjacency,
  paths: Iterable<string>,
): string[] {
  const out: string[] = [];
  for (const p of paths) {
    for (const d of idx.defsByPath.get(p) ?? []) {
      if (adj.out.get(d.id)?.size || adj.in.get(d.id)?.size) out.push(d.id);
    }
  }
  return out;
}

export function symbolSubgraph(
  idx: SymbolIndex,
  adj: SymbolAdjacency,
  focused: ReadonlySet<string>,
): SymbolGraph {
  const ids = new Set<string>();
  for (const id of focused) {
    if (!idx.defsById.has(id)) continue;
    ids.add(id);
    for (const n of adj.out.get(id) ?? []) ids.add(n);
    for (const n of adj.in.get(id) ?? []) ids.add(n);
  }
  const nodes: SymbolDef[] = [];
  for (const id of ids) {
    const d = idx.defsById.get(id);
    if (d) nodes.push(d);
  }
  const edges: { from: string; to: string }[] = [];
  for (const from of ids) {
    for (const to of adj.out.get(from) ?? []) {
      if (ids.has(to)) edges.push({ from, to });
    }
  }
  return { nodes, edges };
}

/** Cross-file resolution of raw scans into the queryable index. Exported for unit testing. */
export function resolve(scans: readonly FileScan[], allFiles: ReadonlySet<string>): SymbolIndex {
  const defsById = new Map<string, SymbolDef>();
  const defsByPath = new Map<string, SymbolDef[]>();

  for (const scan of scans) {
    const list: SymbolDef[] = [];
    for (const s of scan.symbols) {
      const def: SymbolDef = {
        id: defId(scan.path, s.owner, s.name),
        path: scan.path,
        name: s.name,
        owner: s.owner,
        kind: s.kind,
        exported: s.exported,
        startRow: s.startRow,
        startCol: s.startCol,
        endRow: s.endRow,
        endCol: s.endCol,
      };
      // Overloads and merged declarations can collide; the first one wins.
      if (!defsById.has(def.id)) {
        defsById.set(def.id, def);
        list.push(def);
      }
    }
    defsByPath.set(scan.path, list);
  }

  /** name → def, for the top-level declarations of one file. */
  const topLevelOf = new Map<string, Map<string, SymbolDef>>();
  /** owner name → member name → def, per file. */
  const membersOf = new Map<string, Map<string, SymbolDef[]>>();
  for (const [path, defs] of defsByPath) {
    const tops = new Map<string, SymbolDef>();
    const members = new Map<string, SymbolDef[]>();
    for (const d of defs) {
      if (d.owner === null) {
        if (!tops.has(d.name)) tops.set(d.name, d);
      } else {
        const list = members.get(d.owner) ?? [];
        list.push(d);
        members.set(d.owner, list);
      }
    }
    topLevelOf.set(path, tops);
    membersOf.set(path, members);
  }

  // JVM imports (Kotlin today) are package-qualified rather than path-relative, so they
  // resolve through a fully-qualified-name index built from every scanned file's package
  // and top-level declarations instead of through {@link resolveSpecifier}.
  const packageByPath = new Map<string, string>();
  const declsByPath = new Map<string, string[]>();
  // Kotlin and Java reach a sibling declaration in the same package without importing it
  // (a Spring controller and its repository often share one package), so index every JVM
  // file's top-level names and members by package. These are consulted only when a name is
  // unique in the package — the same no-guessing rule the import-driven resolution uses.
  const jvmTopsByPackage = new Map<string, Map<string, SymbolDef[]>>();
  const jvmMembersByPackage = new Map<string, Map<string, SymbolDef[]>>();
  // Members declared anywhere in the project, by name. A member call that resolves to no
  // imported, local or same-package class falls back to this — inherited members live on a
  // project-defined supertype (a Spring `BaseRepository`, an abstract controller) in
  // another package, and the receiver's static type is unknown here. Consulted last and
  // only when the name is unique repo-wide, so a common name stays unresolved rather than
  // guessed at. Framework methods (`findAll`, `save`) are never indexed, so they don't
  // pollute this map.
  const jvmMembersByName = new Map<string, SymbolDef[]>();
  const addToPackage = (m: Map<string, SymbolDef[]>, name: string, def: SymbolDef): void => {
    const list = m.get(name) ?? [];
    list.push(def);
    m.set(name, list);
  };
  for (const scan of scans) {
    if (!JVM_LANGS.has(scan.langId)) continue;
    const pkg = scan.pkg ?? '';
    packageByPath.set(scan.path, pkg);
    declsByPath.set(
      scan.path,
      scan.symbols.filter((s) => s.owner === null).map((s) => s.name),
    );
    let tops = jvmTopsByPackage.get(pkg);
    if (!tops) {
      tops = new Map();
      jvmTopsByPackage.set(pkg, tops);
    }
    for (const d of topLevelOf.get(scan.path)?.values() ?? []) addToPackage(tops, d.name, d);
    let mems = jvmMembersByPackage.get(pkg);
    if (!mems) {
      mems = new Map();
      jvmMembersByPackage.set(pkg, mems);
    }
    for (const list of membersOf.get(scan.path)?.values() ?? []) {
      for (const d of list) {
        addToPackage(mems, d.name, d);
        addToPackage(jvmMembersByName, d.name, d);
      }
    }
  }
  const jvmCtx = buildJvmContext(packageByPath, declsByPath);

  const refsByDef = new Map<string, SymbolRef[]>();
  const refsByPath = new Map<string, SymbolRef[]>();
  const externalByPath = new Map<string, ExternalRef[]>();

  const record = (ref: SymbolRef): void => {
    const byDef = refsByDef.get(ref.defId) ?? [];
    byDef.push(ref);
    refsByDef.set(ref.defId, byDef);
    const byPath = refsByPath.get(ref.path) ?? [];
    byPath.push(ref);
    refsByPath.set(ref.path, byPath);
  };

  for (const scan of scans) {
    // Innermost declaration containing a position — a method beats its class, so a
    // usage is credited to the code that actually performs it.
    const enclosers = (defsByPath.get(scan.path) ?? [])
      .map((d) => ({ def: d, span: (d.endRow - d.startRow) * 10_000 + (d.endCol - d.startCol) }))
      .sort((a, b) => a.span - b.span);
    const enclosingOf = (row: number, col: number): string | null => {
      for (const { def } of enclosers) {
        if (row < def.startRow || row > def.endRow) continue;
        if (row === def.startRow && col < def.startCol) continue;
        if (row === def.endRow && col > def.endCol) continue;
        return def.id;
      }
      return null;
    };

    // local name → the declaration it was imported from
    const imported = new Map<string, SymbolDef>();
    // local name → the file it was imported from, for namespace/default bindings
    const importedOwners: string[] = [];
    for (const b of scan.bindings) {
      const target = JVM_LANGS.has(scan.langId)
        ? resolveJvm(b.specifier, jvmCtx)
        : resolveSpecifier(b.specifier, scan.path, scan.langId, allFiles as Set<string>);
      if (!target) continue;
      const tops = topLevelOf.get(target);
      if (!tops) continue;
      for (const [local, original] of b.names) {
        const def = tops.get(original);
        if (def) {
          imported.set(local, def);
          importedOwners.push(`${target} ${original}`);
        }
      }
    }

    // local name to the out-of-repo dependency it came from. An import that resolves to no
    // repo file is a third-party package (Spring, a Neo4j client, lodash…). For JS/TS only
    // a bare specifier counts — an unresolved relative path is a missing or asset import.
    const isJvmLang = JVM_LANGS.has(scan.langId);
    const externalNames = new Map<string, { module: string; imported: string }>();
    for (const b of scan.bindings) {
      const target = isJvmLang
        ? resolveJvm(b.specifier, jvmCtx)
        : resolveSpecifier(b.specifier, scan.path, scan.langId, allFiles as Set<string>);
      if (target) continue;
      const isBare = isJvmLang || (!b.specifier.startsWith('.') && !b.specifier.startsWith('/'));
      if (!isBare) continue;
      const module = isJvmLang ? packageOf(b.specifier) : b.specifier;
      for (const [local, original] of b.names) {
        externalNames.set(local, { module, imported: original });
      }
    }

    const localTops = topLevelOf.get(scan.path) ?? new Map<string, SymbolDef>();

    // Member names reachable from this file, split by where they come from. `this.foo`
    // means the enclosing class; anything else most likely means a collaborator, which
    // is enough to tell `this.hasData` apart from `this.store.hasData`. A name still
    // ambiguous inside its bucket is left unresolved rather than guessed at.
    const localMembers = new Map<string, SymbolDef[]>();
    const importedMembers = new Map<string, SymbolDef[]>();
    const addMembers = (
      into: Map<string, SymbolDef[]>,
      defs: readonly SymbolDef[] | undefined,
    ): void => {
      if (!defs) return;
      for (const d of defs) {
        const list = into.get(d.name) ?? [];
        list.push(d);
        into.set(d.name, list);
      }
    };
    const only = (list: SymbolDef[] | undefined): SymbolDef | undefined =>
      list && list.length === 1 ? list[0] : undefined;
    for (const list of membersOf.get(scan.path)?.values() ?? []) addMembers(localMembers, list);
    for (const key of importedOwners) {
      const [path, owner] = key.split(' ');
      addMembers(importedMembers, membersOf.get(path!)?.get(owner!));
    }

    const isJvmScan = JVM_LANGS.has(scan.langId);
    // Sibling declarations in the same package, resolved without an import.
    const pkgTops = isJvmScan ? jvmTopsByPackage.get(scan.pkg ?? '') : undefined;
    const pkgMembers = isJvmScan ? jvmMembersByPackage.get(scan.pkg ?? '') : undefined;
    // A member declared on the class an unqualified call sits in. Java and Kotlin call
    // sibling methods without a `this.` receiver (`create()`), so a bare call resolves
    // against the enclosing class before giving up — scoped to that class, and only when
    // the name is unique there, to stay consistent with the no-guessing member rule.
    const enclosingClassMember = (
      enclosingId: string | null,
      name: string,
    ): SymbolDef | undefined => {
      if (!enclosingId) return undefined;
      const encl = defsById.get(enclosingId);
      if (!encl) return undefined;
      const className = encl.owner ?? encl.name;
      const matches = (membersOf.get(scan.path)?.get(className) ?? []).filter(
        (d) => d.name === name,
      );
      return matches.length === 1 ? matches[0] : undefined;
    };

    for (const raw of scan.refs) {
      const enclosingId = raw.shape === 'import' ? null : enclosingOf(raw.row, raw.col);
      let def: SymbolDef | undefined;
      if (raw.shape === 'member') {
        const first = raw.viaThis ? localMembers : importedMembers;
        const second = raw.viaThis ? importedMembers : localMembers;
        def = only(first.get(raw.name)) ?? only(second.get(raw.name));
        // Fall back to a uniquely-named member in the same package, then repo-wide — the
        // latter catches members inherited from a supertype declared in another package.
        if (!def && pkgMembers) def = only(pkgMembers.get(raw.name));
        if (!def && isJvmScan) def = only(jvmMembersByName.get(raw.name));
      } else {
        def = imported.get(raw.name) ?? localTops.get(raw.name);
        if (!def && raw.call && isJvmScan) def = enclosingClassMember(enclosingId, raw.name);
        // A bare type or top-level name from a sibling file in the same package.
        if (!def && pkgTops) def = only(pkgTops.get(raw.name));
      }
      if (!def) {
        // An unresolved name that came from a third-party import is an external dependency
        // use; everything else (locals, framework globals) is simply not tracked.
        const ext = externalNames.get(raw.name);
        if (ext) {
          const list = externalByPath.get(scan.path) ?? [];
          list.push({
            module: ext.module,
            name: raw.name,
            imported: ext.imported,
            path: scan.path,
            row: raw.row,
            col: raw.col,
            endRow: raw.endRow,
            endCol: raw.endCol,
            line: (scan.lines[raw.row] ?? '').trim().slice(0, 160),
            kind: raw.shape === 'import' ? 'import' : raw.call ? 'call' : 'read',
          });
          externalByPath.set(scan.path, list);
        }
        continue;
      }
      record({
        defId: def.id,
        path: scan.path,
        row: raw.row,
        col: raw.col,
        endRow: raw.endRow,
        endCol: raw.endCol,
        line: (scan.lines[raw.row] ?? '').trim().slice(0, 160),
        kind: raw.shape === 'import' ? 'import' : raw.call ? 'call' : 'read',
        enclosingId,
      });
    }
  }

  for (const list of refsByDef.values()) {
    list.sort((a, b) => a.path.localeCompare(b.path) || a.row - b.row);
  }
  for (const list of externalByPath.values()) {
    list.sort((a, b) => a.row - b.row || a.col - b.col);
  }

  return {
    defsById,
    defsByPath,
    refsByDef,
    refsByPath,
    externalByPath,
    indexedPaths: new Set(scans.map((s) => s.path)),
  };
}
