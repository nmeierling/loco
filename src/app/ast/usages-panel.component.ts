import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalysisStore } from '../core/state/analysis.store';
import {
  CallerEdge,
  SymbolDef,
  SymbolIndexService,
  SymbolRef,
} from '../core/services/symbol-index.service';
import { isSymbolIndexSupported } from '../core/services/symbols';
import { AstSelectionService } from './ast-selection.service';

interface RefGroup {
  path: string;
  label: string;
  refs: SymbolRef[];
}

interface DefRow {
  def: SymbolDef;
  useCount: number;
  fileCount: number;
  external: number;
}

interface UsesRow {
  def: SymbolDef;
  count: number;
  refs: SymbolRef[];
}

/** Cap on rendered usages for one symbol — a hot helper can have thousands. */
const MAX_REFS = 300;

@Component({
  selector: 'loco-usages-panel',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
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
          <input
            class="search"
            type="search"
            placeholder="filter symbols…"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
          <div class="tabs">
            <button
              type="button"
              [class.active]="tab() === 'defined'"
              (click)="tab.set('defined')"
              title="Symbols this file declares, and who uses them"
            >
              Used by ({{ defined().length }})
            </button>
            <button
              type="button"
              [class.active]="tab() === 'uses'"
              (click)="tab.set('uses')"
              title="Symbols from other files that this file references"
            >
              Uses ({{ uses().length }})
            </button>
          </div>
        </div>

        @if (tab() === 'defined') {
          @if (defined().length === 0) {
            <div class="note">No declarations found in this file.</div>
          }
          @for (row of defined(); track row.def.id) {
            <div class="sym">
              <button type="button" class="sym-head" (click)="toggle(row.def.id)">
                <span class="chev">{{ isOpen(row.def.id) ? '▾' : '▸' }}</span>
                <span class="kind" [attr.data-kind]="row.def.kind">{{ row.def.kind }}</span>
                <span class="name">{{ qualified(row.def) }}</span>
                @if (row.useCount === 0) {
                  @if (row.def.owner === null) {
                    <span
                      class="badge unused"
                      title="No reference to this name resolved anywhere in the repo. Dynamic imports and string-keyed access are not tracked."
                      >unused</span
                    >
                  } @else {
                    <span
                      class="badge muted"
                      title="Member accesses only resolve when one visible class declares this name — an ambiguous name is skipped rather than guessed at."
                      >no direct uses</span
                    >
                  }
                } @else {
                  <span class="badge"
                    >{{ row.useCount }} in {{ row.fileCount }}
                    {{ row.fileCount === 1 ? 'file' : 'files' }}</span
                  >
                }
              </button>

              @if (isOpen(row.def.id)) {
                <div class="refs">
                  <div class="submodes">
                    <button
                      type="button"
                      [class.active]="detail() === 'sites'"
                      (click)="detail.set('sites')"
                    >
                      Call sites
                    </button>
                    <button
                      type="button"
                      [class.active]="detail() === 'impact'"
                      (click)="detail.set('impact')"
                      title="Walk outwards through the callers of this symbol"
                    >
                      Impact
                    </button>
                  </div>

                  @if (detail() === 'sites') {
                    @for (g of groupsFor(row.def.id); track g.path) {
                      <div class="ref-file">
                        <span class="ref-path" [class.self]="g.path === path()">{{ g.label }}</span>
                        <span class="ref-count">{{ g.refs.length }}</span>
                      </div>
                      @for (r of g.refs; track r.path + ':' + r.row + ':' + r.col) {
                        <button type="button" class="ref" (click)="jump(r)">
                          <span class="ref-line">{{ r.row + 1 }}</span>
                          <span class="ref-kind" [attr.data-kind]="r.kind">{{ r.kind }}</span>
                          <code>{{ r.line }}</code>
                        </button>
                      }
                    }
                    @if (truncated(row.def.id)) {
                      <div class="note small">
                        Showing the first {{ maxRefs }} of {{ row.useCount }} references.
                      </div>
                    }
                  } @else {
                    @if (callersOf(row.def.id).length === 0) {
                      <div class="note small">
                        Nothing calls this from inside another declaration — it is either an entry
                        point or only referenced at file scope.
                      </div>
                    }
                    @for (edge of callersOf(row.def.id); track edge.def.id) {
                      <ng-container
                        *ngTemplateOutlet="
                          callerNode;
                          context: { $implicit: edge, trail: [row.def.id], depth: 0 }
                        "
                      />
                    }
                  }
                </div>
              }
            </div>
          }
        } @else {
          @if (uses().length === 0) {
            <div class="note">This file does not reference symbols from other files.</div>
          }
          @for (row of uses(); track row.def.id) {
            <div class="sym">
              <button type="button" class="sym-head" (click)="toggle('u:' + row.def.id)">
                <span class="chev">{{ isOpen('u:' + row.def.id) ? '▾' : '▸' }}</span>
                <span class="kind" [attr.data-kind]="row.def.kind">{{ row.def.kind }}</span>
                <span class="name">{{ qualified(row.def) }}</span>
                <span class="badge">{{ row.count }}×</span>
                <span class="from">{{ row.def.path }}</span>
              </button>

              @if (isOpen('u:' + row.def.id)) {
                <div class="refs">
                  <button type="button" class="ref definition" (click)="jumpToDef(row.def)">
                    <span class="ref-line">{{ row.def.startRow + 1 }}</span>
                    <span class="ref-kind" data-kind="def">definition</span>
                    <code>{{ row.def.path }}</code>
                  </button>
                  @for (r of row.refs; track r.path + ':' + r.row + ':' + r.col) {
                    <button type="button" class="ref" (click)="jump(r)">
                      <span class="ref-line">{{ r.row + 1 }}</span>
                      <span class="ref-kind" [attr.data-kind]="r.kind">{{ r.kind }}</span>
                      <code>{{ r.line }}</code>
                    </button>
                  }
                </div>
              }
            </div>
          }
        }
      }
    </div>

    <!-- One level of the caller trace. Expanding a node asks the index for its own
         callers, so the walk goes as deep as the user drags it and no further. -->
    <ng-template #callerNode let-edge let-trail="trail" let-depth="depth">
      <div class="caller" [style.paddingLeft.px]="depth * 10">
        <div class="caller-row">
          <button
            type="button"
            class="chev-btn"
            [disabled]="trail.includes(edge.def.id) || !hasCallers(edge.def.id)"
            (click)="toggle(trailKey(trail, edge.def.id))"
          >
            {{
              trail.includes(edge.def.id) || !hasCallers(edge.def.id)
                ? '·'
                : isOpen(trailKey(trail, edge.def.id))
                  ? '▾'
                  : '▸'
            }}
          </button>
          <button type="button" class="caller-head" (click)="jumpToDef(edge.def)">
            <span class="kind" [attr.data-kind]="edge.def.kind">{{ edge.def.kind }}</span>
            <span class="name">{{ qualified(edge.def) }}</span>
            <span class="badge">{{ edge.refs.length }}×</span>
            <span class="from">{{ edge.def.path }}</span>
          </button>
        </div>
        @if (trail.includes(edge.def.id)) {
          <div class="note small indent">cycle — already on this path</div>
        } @else if (isOpen(trailKey(trail, edge.def.id))) {
          @for (next of callersOf(edge.def.id); track next.def.id) {
            <ng-container
              *ngTemplateOutlet="
                callerNode;
                context: {
                  $implicit: next,
                  trail: trail.concat(edge.def.id),
                  depth: depth + 1,
                }
              "
            />
          }
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }
      .panel {
        height: 100%;
        overflow: auto;
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
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: var(--bar-bg);
        border-bottom: 1px solid var(--border);
      }
      .search {
        flex: 1;
        min-width: 0;
        background: var(--input-bg);
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 12px;
        font-family: inherit;
      }
      .search:focus {
        outline: none;
        border-color: var(--accent);
      }
      .tabs {
        display: flex;
        gap: 2px;
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
      .sym {
        border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      }
      .sym-head {
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
      .sym-head:hover {
        background: var(--hover);
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
      .kind[data-kind='interface'] {
        color: var(--accent);
        border-color: color-mix(in srgb, var(--accent) 45%, transparent);
      }
      .name {
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
      .badge.unused {
        color: var(--danger);
        opacity: 0.85;
      }
      .badge.muted {
        opacity: 0.4;
      }
      .from {
        font-size: 10px;
        opacity: 0.45;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        max-width: 40%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        direction: rtl;
      }
      .refs {
        padding: 2px 0 6px 24px;
      }
      .ref-file {
        display: flex;
        gap: 8px;
        padding: 4px 8px 2px;
        font-size: 10px;
        opacity: 0.6;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .ref-path.self {
        color: var(--accent);
        opacity: 0.9;
      }
      .ref-count {
        margin-left: auto;
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
      .submodes {
        display: flex;
        gap: 2px;
        padding: 4px 8px 6px;
      }
      .submodes button {
        background: transparent;
        border: 1px solid var(--border);
        color: inherit;
        border-radius: 3px;
        font: inherit;
        font-size: 10px;
        padding: 1px 7px;
        cursor: pointer;
      }
      .submodes button.active {
        background: var(--accent);
        color: var(--accent-fg);
        border-color: var(--accent);
      }
      .submodes button:hover:not(.active) {
        background: var(--hover);
      }
      .caller-row {
        display: flex;
        align-items: center;
      }
      .chev-btn {
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        font-size: 10px;
        opacity: 0.5;
        width: 14px;
        padding: 0;
        cursor: pointer;
        flex-shrink: 0;
      }
      .chev-btn:disabled {
        cursor: default;
        opacity: 0.25;
      }
      .chev-btn:hover:not(:disabled) {
        opacity: 1;
        color: var(--accent);
      }
      .caller-head {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        text-align: left;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        padding: 3px 6px;
        cursor: pointer;
        border-radius: 3px;
      }
      .caller-head:hover {
        background: var(--hover);
      }
      .note.small.indent {
        padding-left: 22px;
      }
    `,
  ],
})
export class UsagesPanelComponent {
  private readonly index = inject(SymbolIndexService);
  private readonly selection = inject(AstSelectionService);
  private readonly store = inject(AnalysisStore);

  readonly path = input.required<string>();
  readonly languageId = input.required<string | null>();

  readonly maxRefs = MAX_REFS;
  readonly query = signal('');
  readonly tab = signal<'defined' | 'uses'>('defined');
  readonly detail = signal<'sites' | 'impact'>('sites');
  private readonly open = signal<ReadonlySet<string>>(new Set());

  /** Caller lookups are per-node and repeated during change detection; memoise them. */
  private callerCache = new Map<string, CallerEdge[]>();
  private callerCacheFor: unknown = null;

  readonly progress = this.index.building;
  readonly supported = computed(() => isSymbolIndexSupported(this.languageId()));
  readonly ready = computed(() => this.index.index() !== null);

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

  /** Declarations in the open file, ranked by how widely they are used. */
  readonly defined = computed<DefRow[]>(() => {
    const idx = this.index.index();
    if (!idx) return [];
    const path = this.path();
    const q = this.query().trim().toLowerCase();
    const rows: DefRow[] = [];
    for (const def of idx.defsByPath.get(path) ?? []) {
      if (
        q &&
        !def.name.toLowerCase().includes(q) &&
        !(def.owner ?? '').toLowerCase().includes(q)
      ) {
        continue;
      }
      const refs = idx.refsByDef.get(def.id) ?? [];
      const files = new Set(refs.map((r) => r.path));
      rows.push({
        def,
        useCount: refs.length,
        fileCount: files.size,
        external: refs.filter((r) => r.path !== path).length,
      });
    }
    return rows.sort((a, b) => b.external - a.external || b.useCount - a.useCount);
  });

  /** Symbols this file pulls in from elsewhere, with the lines that reference them. */
  readonly uses = computed<UsesRow[]>(() => {
    const idx = this.index.index();
    if (!idx) return [];
    const path = this.path();
    const q = this.query().trim().toLowerCase();
    const byDef = new Map<string, SymbolRef[]>();
    for (const r of idx.refsByPath.get(path) ?? []) {
      const def = idx.defsById.get(r.defId);
      if (!def || def.path === path) continue;
      const list = byDef.get(r.defId) ?? [];
      list.push(r);
      byDef.set(r.defId, list);
    }
    const rows: UsesRow[] = [];
    for (const [id, refs] of byDef) {
      const def = idx.defsById.get(id);
      if (!def) continue;
      if (q && !def.name.toLowerCase().includes(q) && !def.path.toLowerCase().includes(q)) continue;
      rows.push({ def, count: refs.length, refs: refs.slice(0, MAX_REFS) });
    }
    return rows.sort((a, b) => b.count - a.count || a.def.name.localeCompare(b.def.name));
  });

  groupsFor(id: string): RefGroup[] {
    const idx = this.index.index();
    if (!idx) return [];
    const refs = (idx.refsByDef.get(id) ?? []).slice(0, MAX_REFS);
    const byPath = new Map<string, SymbolRef[]>();
    for (const r of refs) {
      const list = byPath.get(r.path) ?? [];
      list.push(r);
      byPath.set(r.path, list);
    }
    const here = this.path();
    return (
      [...byPath.entries()]
        .map(([path, list]) => ({
          path,
          label: path === here ? path + '  (this file)' : path,
          refs: list,
        }))
        // Other files first — the point of the panel is finding usages elsewhere.
        .sort(
          (a, b) =>
            Number(a.path === here) - Number(b.path === here) || a.path.localeCompare(b.path),
        )
    );
  }

  truncated(id: string): boolean {
    const idx = this.index.index();
    return (idx?.refsByDef.get(id)?.length ?? 0) > MAX_REFS;
  }

  /** `Owner.member` for members, plain name otherwise. Built here so template
   * reflowing can never slip whitespace between the owner and the name. */
  qualified(def: SymbolDef): string {
    return def.owner ? `${def.owner}.${def.name}` : def.name;
  }

  /** Declarations that reach `defId`, one level out. */
  callersOf(defId: string): CallerEdge[] {
    const idx = this.index.index();
    if (this.callerCacheFor !== idx) {
      this.callerCache = new Map();
      this.callerCacheFor = idx;
    }
    let edges = this.callerCache.get(defId);
    if (!edges) {
      edges = this.index.callers(defId);
      this.callerCache.set(defId, edges);
    }
    return edges;
  }

  hasCallers(defId: string): boolean {
    return this.callersOf(defId).length > 0;
  }

  /** Expansion is keyed by the path taken, so one symbol can appear on two branches. */
  trailKey(trail: readonly string[], defId: string): string {
    return `${trail.join('>')}>${defId}`;
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
}
