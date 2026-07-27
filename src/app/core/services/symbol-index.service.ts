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

/** One step of a caller trace: who reaches a symbol, and from which lines. */
export interface CallerEdge {
  def: SymbolDef;
  refs: SymbolRef[];
}

export interface SymbolIndex {
  defsById: ReadonlyMap<string, SymbolDef>;
  defsByPath: ReadonlyMap<string, SymbolDef[]>;
  /** Usages of a declaration, anywhere in the repo. */
  refsByDef: ReadonlyMap<string, SymbolRef[]>;
  /** Usages grouped by the file they appear in — powers the "uses" direction. */
  refsByPath: ReadonlyMap<string, SymbolRef[]>;
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

  /**
   * Declarations that reference `defId`, each with the lines that do it. One level —
   * callers of callers come from calling this again, which keeps a trace lazy.
   */
  callers(defId: string): CallerEdge[] {
    const idx = this._index();
    if (!idx) return [];
    const byCaller = new Map<string, SymbolRef[]>();
    for (const ref of idx.refsByDef.get(defId) ?? []) {
      // A symbol referencing itself (recursion, or a class naming its own type) is
      // not a caller worth walking.
      if (!ref.enclosingId || ref.enclosingId === defId) continue;
      const list = byCaller.get(ref.enclosingId) ?? [];
      list.push(ref);
      byCaller.set(ref.enclosingId, list);
    }
    const out: CallerEdge[] = [];
    for (const [id, refs] of byCaller) {
      const def = idx.defsById.get(id);
      if (def) out.push({ def, refs });
    }
    return out.sort(
      (a, b) => b.refs.length - a.refs.length || a.def.name.localeCompare(b.def.name),
    );
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

function defId(path: string, owner: string | null, name: string): string {
  return owner ? `${path}#${owner}.${name}` : `${path}#${name}`;
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
  for (const scan of scans) {
    if (!JVM_LANGS.has(scan.langId)) continue;
    packageByPath.set(scan.path, scan.pkg ?? '');
    declsByPath.set(
      scan.path,
      scan.symbols.filter((s) => s.owner === null).map((s) => s.name),
    );
  }
  const jvmCtx = buildJvmContext(packageByPath, declsByPath);

  const refsByDef = new Map<string, SymbolRef[]>();
  const refsByPath = new Map<string, SymbolRef[]>();

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
      } else {
        def = imported.get(raw.name) ?? localTops.get(raw.name);
        if (!def && raw.call && isJvmScan) def = enclosingClassMember(enclosingId, raw.name);
      }
      if (!def) continue;
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

  return {
    defsById,
    defsByPath,
    refsByDef,
    refsByPath,
    indexedPaths: new Set(scans.map((s) => s.path)),
  };
}
