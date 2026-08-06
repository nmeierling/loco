import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnalysisStore } from '../core/state/analysis.store';
import {
  ExternalRef,
  SymbolDef,
  SymbolIndexService,
  SymbolRef,
} from '../core/services/symbol-index.service';
import { SymbolKind, isSymbolIndexSupported } from '../core/services/symbols';
import { IgnoreService } from '../core/services/ignore.service';
import { AstSelectionService } from './ast-selection.service';

type Direction = 'incoming' | 'outgoing' | 'self' | 'external';

/** A method/property and the sites that reference it, in one direction. */
interface MemberUse {
  def: SymbolDef;
  refs: SymbolRef[];
  count: number;
}

/** An external symbol (from a third-party import) and the sites in this file that use it. */
interface ExtMember {
  imported: string;
  refs: ExternalRef[];
  count: number;
}

/** A third-party dependency (module/package) and the symbols this file pulls from it. */
interface ExtGroup {
  module: string;
  count: number;
  members: ExtMember[];
}

/** The class (or top-level unit / module scope) a set of usages is grouped under. */
interface ClassGroup {
  key: string;
  label: string;
  path: string;
  kind: SymbolKind | 'module';
  count: number;
  members: MemberUse[];
}

/** The class-level unit a declaration belongs to, for grouping. */
interface Unit {
  key: string;
  label: string;
  path: string;
  kind: SymbolKind | 'module';
}

/** Cap on rendered usages for one member — a hot helper can have thousands. */
const MAX_REFS = 300;

@Component({
  selector: 'loco-usages-panel',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel">
      @if (!supported()) {
        <div class="note">
          Usages are indexed for TypeScript, TSX, JavaScript, JSX, Kotlin and Java files.
        </div>
      } @else if (progress(); as p) {
        <div class="note">
          Indexing symbols across the repo…
          <div class="bar"><div class="fill" [style.width.%]="(p.done / p.total) * 100"></div></div>
          <div class="counts">{{ p.done }} / {{ p.total }} files</div>
        </div>
      } @else if (!ready()) {
        <div class="note">Preparing symbol index…</div>
      } @else {
        <div class="controls">
          <div class="tabs">
            <button
              type="button"
              [class.active]="dir() === 'incoming'"
              (click)="dir.set('incoming')"
              title="Classes elsewhere that use this file's methods and properties"
            >
              Incoming ({{ incoming().length }})
            </button>
            <button
              type="button"
              [class.active]="dir() === 'outgoing'"
              (click)="dir.set('outgoing')"
              title="Classes elsewhere that this file uses"
            >
              Outgoing ({{ outgoing().length }})
            </button>
            <button
              type="button"
              [class.active]="dir() === 'external'"
              (click)="dir.set('external')"
              title="Third-party dependencies (outside this repo) that this file imports"
            >
              External ({{ external().length }})
            </button>
            <button
              type="button"
              [class.active]="dir() === 'self'"
              (click)="dir.set('self')"
              title="Members of this file used from within the file itself"
            >
              Self ({{ self().length }})
            </button>
          </div>
          <input
            class="search"
            type="search"
            placeholder="filter classes & members…"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
        </div>

        @if (dir() === 'self') {
          @if (self().length === 0) {
            <div class="note">
              Nothing in this file references its own declarations — or the file has none.
            </div>
          }
          @for (m of self(); track m.def.id) {
            <div class="sym">
              <button type="button" class="sym-head" (click)="toggle('self|' + m.def.id)">
                <span class="chev">{{ isOpen('self|' + m.def.id) ? '▾' : '▸' }}</span>
                <span class="kind" [attr.data-kind]="m.def.kind">{{ m.def.kind }}</span>
                <span class="name">{{ qualified(m.def) }}</span>
                <span class="badge">{{ m.count }}×</span>
              </button>
              @if (isOpen('self|' + m.def.id)) {
                <div class="refs">
                  @for (r of m.refs; track r.path + ':' + r.row + ':' + r.col) {
                    <button type="button" class="ref" (click)="jump(r)">
                      <span class="ref-line">{{ r.row + 1 }}</span>
                      <span class="ref-kind" [attr.data-kind]="r.kind">{{ r.kind }}</span>
                      <code>{{ r.line }}</code>
                    </button>
                  }
                  @if (m.count > m.refs.length) {
                    <div class="note small">
                      Showing the first {{ m.refs.length }} of {{ m.count }} references.
                    </div>
                  }
                </div>
              }
            </div>
          }
        } @else if (dir() === 'external') {
          @if (external().length === 0) {
            <div class="note">This file imports nothing from outside the repository.</div>
          }
          @for (g of external(); track g.module) {
            <div class="grp">
              <button type="button" class="grp-head" (click)="toggle('ext|' + g.module)">
                <span class="chev">{{ isOpen('ext|' + g.module) ? '▾' : '▸' }}</span>
                <span class="kind" data-kind="module">dep</span>
                <span class="name">{{ g.module }}</span>
                <span class="badge">{{ g.count }}×</span>
              </button>
              @if (isOpen('ext|' + g.module)) {
                <div class="members">
                  @for (m of g.members; track m.imported) {
                    <div class="mem">
                      <button
                        type="button"
                        class="mem-head"
                        (click)="toggle('ext|' + g.module + '|' + m.imported)"
                      >
                        <span class="chev">{{
                          isOpen('ext|' + g.module + '|' + m.imported) ? '▾' : '▸'
                        }}</span>
                        <span class="name">{{ m.imported }}</span>
                        <span class="badge">{{ m.count }}×</span>
                      </button>
                      @if (isOpen('ext|' + g.module + '|' + m.imported)) {
                        <div class="refs">
                          @for (r of m.refs; track r.row + ':' + r.col) {
                            <button type="button" class="ref" (click)="jumpExt(r)">
                              <span class="ref-line">{{ r.row + 1 }}</span>
                              <span class="ref-kind" [attr.data-kind]="r.kind">{{ r.kind }}</span>
                              <code>{{ r.line }}</code>
                            </button>
                          }
                          @if (m.count > m.refs.length) {
                            <div class="note small">
                              Showing the first {{ m.refs.length }} of {{ m.count }} references.
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        } @else {
          @if (groups().length === 0) {
            <div class="note">
              @if (dir() === 'incoming') {
                No class in another file uses a declaration from this file.
              } @else {
                This file does not use declarations from any other file.
              }
            </div>
          }
          @for (g of groups(); track g.key) {
            <div class="grp">
              <button type="button" class="grp-head" (click)="toggle(g.key)">
                <span class="chev">{{ isOpen(g.key) ? '▾' : '▸' }}</span>
                <span class="kind" [attr.data-kind]="g.kind">{{ g.kind }}</span>
                <span class="name">{{ g.label }}</span>
                <span class="from">{{ g.path }}</span>
                <span class="badge">{{ g.count }}×</span>
              </button>
              @if (isOpen(g.key)) {
                <div class="members">
                  @for (m of g.members; track m.def.id) {
                    <div class="mem">
                      <button
                        type="button"
                        class="mem-head"
                        (click)="toggle(g.key + '|' + m.def.id)"
                      >
                        <span class="chev">{{ isOpen(g.key + '|' + m.def.id) ? '▾' : '▸' }}</span>
                        <span class="kind" [attr.data-kind]="m.def.kind">{{ m.def.kind }}</span>
                        <span class="name">{{ qualified(m.def) }}</span>
                        <span class="badge">{{ m.count }}×</span>
                      </button>
                      @if (isOpen(g.key + '|' + m.def.id)) {
                        <div class="refs">
                          @if (dir() === 'outgoing') {
                            <button
                              type="button"
                              class="ref definition"
                              (click)="jumpToDef(m.def)"
                            >
                              <span class="ref-line">{{ m.def.startRow + 1 }}</span>
                              <span class="ref-kind" data-kind="def">definition</span>
                              <code>{{ m.def.path }}</code>
                            </button>
                          }
                          @for (r of m.refs; track r.path + ':' + r.row + ':' + r.col) {
                            <button type="button" class="ref" (click)="jump(r)">
                              <span class="ref-line">{{ r.row + 1 }}</span>
                              <span class="ref-kind" [attr.data-kind]="r.kind">{{ r.kind }}</span>
                              <code>{{ r.line }}</code>
                            </button>
                          }
                          @if (m.count > m.refs.length) {
                            <div class="note small">
                              Showing the first {{ m.refs.length }} of {{ m.count }} references.
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
        /* Allow the panel to shrink below its content width inside the AST split grid,
           instead of overflowing its cell under the Ignore sidebar. */
        min-width: 0;
      }
      .panel {
        height: 100%;
        /* Only scroll vertically. Horizontal scrolling would let a wide row stretch the
           sticky controls past the visible pane, pushing the tabs under the sidebar; rows
           truncate with ellipsis instead. */
        overflow-y: auto;
        overflow-x: hidden;
        font-size: 12px;
      }
      .note {
        padding: 14px;
        opacity: 0.7;
        line-height: 1.5;
      }
      .note.small {
        padding: 6px 10px;
        font-size: 11px;
      }
      .bar {
        margin-top: 8px;
        height: 3px;
        max-width: 240px;
        background: color-mix(in srgb, var(--accent) 15%, transparent);
        border-radius: 2px;
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: var(--accent);
      }
      .counts {
        margin-top: 4px;
        font-size: 11px;
        opacity: 0.7;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .controls {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: var(--bar-bg);
        border-bottom: 1px solid var(--border);
      }
      .search {
        /* Shares the row with the tabs when wide, drops to its own full-width line when
           the pane is narrow — the tabs stay visible either way. */
        flex: 1 1 130px;
        min-width: 0;
        background: var(--input-bg);
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 11px;
        font-family: inherit;
      }
      .search:focus {
        outline: none;
        border-color: var(--accent);
      }
      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        flex: 0 1 auto;
      }
      .tabs button {
        background: transparent;
        border: 1px solid var(--border);
        color: inherit;
        border-radius: 3px;
        font: inherit;
        font-size: 11px;
        padding: 2px 8px;
        cursor: pointer;
        white-space: nowrap;
      }
      .tabs button.active {
        background: var(--accent);
        color: var(--accent-fg);
        border-color: var(--accent);
      }
      .tabs button:hover:not(.active) {
        background: var(--hover);
      }
      .grp,
      .sym {
        border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      }
      .grp-head,
      .sym-head,
      .mem-head {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        padding: 4px 8px;
        cursor: pointer;
      }
      .grp-head:hover,
      .sym-head:hover,
      .mem-head:hover {
        background: var(--hover);
      }
      .grp-head .name {
        font-weight: 600;
      }
      .chev {
        width: 10px;
        opacity: 0.5;
        font-size: 10px;
        flex-shrink: 0;
      }
      .kind {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.75;
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 0 4px;
        flex-shrink: 0;
      }
      .kind[data-kind='class'],
      .kind[data-kind='interface'],
      .kind[data-kind='module'] {
        color: var(--accent);
        border-color: color-mix(in srgb, var(--accent) 45%, transparent);
      }
      .name {
        flex: 1;
        min-width: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .badge {
        margin-left: auto;
        font-size: 10px;
        opacity: 0.7;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .from {
        font-size: 10px;
        opacity: 0.45;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        max-width: 45%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: rtl;
      }
      .members {
        padding-left: 14px;
      }
      .mem {
        border-top: 1px solid color-mix(in srgb, var(--border) 35%, transparent);
      }
      .refs {
        padding: 2px 0 6px 24px;
      }
      .ref {
        display: flex;
        align-items: baseline;
        gap: 8px;
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        padding: 2px 8px;
        cursor: pointer;
        border-radius: 3px;
      }
      .ref:hover {
        background: var(--hover);
      }
      .ref-line {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        opacity: 0.5;
        min-width: 34px;
        text-align: right;
        flex-shrink: 0;
      }
      .ref-kind {
        font-size: 9px;
        opacity: 0.55;
        min-width: 48px;
        flex-shrink: 0;
      }
      .ref-kind[data-kind='call'] {
        color: var(--accent);
        opacity: 0.9;
      }
      .ref code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        opacity: 0.85;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ref.definition code {
        color: var(--accent);
      }
    `,
  ],
})
export class UsagesPanelComponent {
  private readonly index = inject(SymbolIndexService);
  private readonly selection = inject(AstSelectionService);
  private readonly store = inject(AnalysisStore);
  private readonly ig = inject(IgnoreService);

  readonly path = input.required<string>();
  readonly languageId = input.required<string | null>();

  readonly maxRefs = MAX_REFS;
  readonly query = signal('');
  readonly dir = signal<Direction>('incoming');
  private readonly open = signal<ReadonlySet<string>>(new Set());

  readonly progress = this.index.building;
  readonly supported = computed(() => isSymbolIndexSupported(this.languageId()));
  readonly ready = computed(() => this.index.index() !== null);

  /**
   * Predicate hiding usages that live in files the user has ignored — the symbol index
   * spans the whole project, but a class in an ignored folder (e.g. `**​/src/test/**`)
   * should not surface here. Reuses the ignore matcher, so it honours globs; tracking
   * `userPatterns()` keeps the derived lists reactive to edits.
   */
  private readonly ignoredPath = computed<(p: string) => boolean>(() => {
    const patterns = this.ig.userPatterns();
    if (patterns.length === 0) return () => false;
    return (p: string) => this.ig.userIgnores(p);
  });

  constructor() {
    effect(() => {
      // Rebuild whenever a new project loads, and build lazily on first open.
      this.store.projectId();
      if (this.supported()) void this.index.build();
    });

    effect(() => {
      // Collapse everything when the open file changes — the rows are file-specific.
      this.path();
      this.open.set(new Set());
    });
  }

  /**
   * Classes elsewhere that reference a declaration in this file, grouped by the calling
   * class and, within it, by which of this file's members they use.
   */
  readonly incoming = computed<ClassGroup[]>(() => {
    const idx = this.index.index();
    if (!idx) return [];
    const path = this.path();
    const ignored = this.ignoredPath();
    const groups = new Map<string, { unit: Unit; members: Map<string, MemberUse> }>();
    for (const def of idx.defsByPath.get(path) ?? []) {
      for (const ref of idx.refsByDef.get(def.id) ?? []) {
        // Only usages from *other* files count as incoming — same-file usage is "self".
        if (ref.path === path) continue;
        // Skip references coming from files the user has ignored.
        if (ignored(ref.path)) continue;
        const encl = ref.enclosingId ? idx.defsById.get(ref.enclosingId) : undefined;
        const unit = encl
          ? this.classUnit(encl, idx)
          : { key: `mod:${ref.path}`, label: baseName(ref.path), path: ref.path, kind: 'module' as const };
        add(groups, unit, def, ref);
      }
    }
    return this.finishGroups(groups, this.query().trim().toLowerCase());
  });

  /**
   * Classes in other files that this file uses, grouped by the target class and, within
   * it, by which of its members this file touches.
   */
  readonly outgoing = computed<ClassGroup[]>(() => {
    const idx = this.index.index();
    if (!idx) return [];
    const path = this.path();
    const ignored = this.ignoredPath();
    const groups = new Map<string, { unit: Unit; members: Map<string, MemberUse> }>();
    for (const ref of idx.refsByPath.get(path) ?? []) {
      const target = idx.defsById.get(ref.defId);
      // Only targets that live in another file are outgoing.
      if (!target || target.path === path) continue;
      // Skip targets in files the user has ignored.
      if (ignored(target.path)) continue;
      add(groups, this.classUnit(target, idx), target, ref);
    }
    return this.finishGroups(groups, this.query().trim().toLowerCase());
  });

  /** This file's own declarations, ranked by how often the file references them itself. */
  readonly self = computed<MemberUse[]>(() => {
    const idx = this.index.index();
    if (!idx) return [];
    const path = this.path();
    const q = this.query().trim().toLowerCase();
    const byDef = new Map<string, MemberUse>();
    for (const ref of idx.refsByPath.get(path) ?? []) {
      const target = idx.defsById.get(ref.defId);
      if (!target || target.path !== path) continue;
      let m = byDef.get(target.id);
      if (!m) {
        m = { def: target, refs: [], count: 0 };
        byDef.set(target.id, m);
      }
      m.count++;
      if (m.refs.length < MAX_REFS) m.refs.push(ref);
    }
    let rows = [...byDef.values()];
    if (q) rows = rows.filter((m) => this.qualified(m.def).toLowerCase().includes(q));
    return rows.sort(
      (a, b) => b.count - a.count || this.qualified(a.def).localeCompare(this.qualified(b.def)),
    );
  });

  /** The class-group list for the current non-self tab. */
  readonly groups = computed<ClassGroup[]>(() =>
    this.dir() === 'incoming' ? this.incoming() : this.outgoing(),
  );

  /** Third-party dependencies this file imports, grouped by module then by symbol. */
  readonly external = computed<ExtGroup[]>(() => {
    const idx = this.index.index();
    if (!idx) return [];
    const q = this.query().trim().toLowerCase();
    const groups = new Map<string, Map<string, ExtMember>>();
    for (const r of idx.externalByPath.get(this.path()) ?? []) {
      let g = groups.get(r.module);
      if (!g) {
        g = new Map();
        groups.set(r.module, g);
      }
      let m = g.get(r.imported);
      if (!m) {
        m = { imported: r.imported, refs: [], count: 0 };
        g.set(r.imported, m);
      }
      m.count++;
      if (m.refs.length < MAX_REFS) m.refs.push(r);
    }
    const out: ExtGroup[] = [];
    for (const [module, members] of groups) {
      let mem = [...members.values()].sort(
        (a, b) => b.count - a.count || a.imported.localeCompare(b.imported),
      );
      if (q) {
        if (!module.toLowerCase().includes(q)) {
          mem = mem.filter((m) => m.imported.toLowerCase().includes(q));
          if (mem.length === 0) continue;
        }
      }
      out.push({ module, count: mem.reduce((s, m) => s + m.count, 0), members: mem });
    }
    return out.sort((a, b) => b.count - a.count || a.module.localeCompare(b.module));
  });

  /** The class (or top-level symbol) a declaration is grouped under. */
  private classUnit(def: SymbolDef, idx: { defsById: ReadonlyMap<string, SymbolDef> }): Unit {
    if (def.owner) {
      const id = `${def.path}#${def.owner}`;
      return {
        key: id,
        label: def.owner,
        path: def.path,
        kind: idx.defsById.get(id)?.kind ?? 'class',
      };
    }
    return { key: def.id, label: def.name, path: def.path, kind: def.kind };
  }

  /** Orders members within each group, applies the search filter, and ranks the groups. */
  private finishGroups(
    groups: Map<string, { unit: Unit; members: Map<string, MemberUse> }>,
    q: string,
  ): ClassGroup[] {
    const out: ClassGroup[] = [];
    for (const { unit, members } of groups.values()) {
      let mem = [...members.values()].sort(
        (a, b) => b.count - a.count || this.qualified(a.def).localeCompare(this.qualified(b.def)),
      );
      if (q) {
        const unitMatch =
          unit.label.toLowerCase().includes(q) || unit.path.toLowerCase().includes(q);
        if (!unitMatch) {
          mem = mem.filter((m) => this.qualified(m.def).toLowerCase().includes(q));
          if (mem.length === 0) continue;
        }
      }
      const count = mem.reduce((s, m) => s + m.count, 0);
      out.push({ key: unit.key, label: unit.label, path: unit.path, kind: unit.kind, count, members: mem });
    }
    return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  /** `Owner.member` for members, plain name otherwise. */
  qualified(def: SymbolDef): string {
    return def.owner ? `${def.owner}.${def.name}` : def.name;
  }

  isOpen(id: string): boolean {
    return this.open().has(id);
  }

  toggle(id: string): void {
    this.open.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  jump(r: SymbolRef): void {
    this.selection.jumpTo(r.path, {
      startRow: r.row,
      startCol: r.col,
      endRow: r.endRow,
      endCol: r.endCol,
    });
  }

  jumpToDef(def: SymbolDef): void {
    this.selection.jumpTo(def.path, {
      startRow: def.startRow,
      startCol: def.startCol,
      endRow: def.endRow,
      endCol: def.endCol,
    });
  }

  jumpExt(r: ExternalRef): void {
    this.selection.jumpTo(r.path, {
      startRow: r.row,
      startCol: r.col,
      endRow: r.endRow,
      endCol: r.endCol,
    });
  }
}

/** Files, folders and packages all key on the trailing segment of the path. */
function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** Folds one reference into its class group and member bucket. */
function add(
  groups: Map<string, { unit: Unit; members: Map<string, MemberUse> }>,
  unit: Unit,
  member: SymbolDef,
  ref: SymbolRef,
): void {
  let g = groups.get(unit.key);
  if (!g) {
    g = { unit, members: new Map() };
    groups.set(unit.key, g);
  }
  let m = g.members.get(member.id);
  if (!m) {
    m = { def: member, refs: [], count: 0 };
    g.members.set(member.id, m);
  }
  m.count++;
  if (m.refs.length < MAX_REFS) m.refs.push(ref);
}
