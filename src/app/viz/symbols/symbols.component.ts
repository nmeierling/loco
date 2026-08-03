import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AnalysisStore } from '../../core/state/analysis.store';
import {
  FolderSurface,
  SymbolDef,
  SymbolIndexService,
} from '../../core/services/symbol-index.service';
import { AstSelectionService } from '../../ast/ast-selection.service';

interface UnusedGroup {
  path: string;
  defs: SymbolDef[];
}

type Tab = 'unused' | 'surface';
type Bucket = 'external' | 'internal' | 'unused';

@Component({
  selector: 'loco-symbols-viz',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="controls">
        <div class="tabs">
          <button type="button" [class.active]="tab() === 'unused'" (click)="tab.set('unused')">
            Unused exports
          </button>
          <button type="button" [class.active]="tab() === 'surface'" (click)="tab.set('surface')">
            Folder surface
          </button>
        </div>
        <div class="spacer"></div>
        @if (ready()) {
          <div class="count">
            {{ tab() === 'unused' ? unusedCount() + ' unused' : folders().length + ' folders' }}
          </div>
          <button
            type="button"
            class="copy"
            [disabled]="copyDisabled()"
            (click)="copy()"
            title="Copy the list below to the clipboard as text"
          >
            {{ copied() ? 'copied' : 'copy' }}
          </button>
        }
      </div>

      @if (!store.root()) {
        <div class="empty"><p>Drop a folder to analyze.</p></div>
      } @else if (progress(); as p) {
        <div class="empty">
          <p class="title">Indexing symbols…</p>
          <div class="bar"><div class="fill" [style.width.%]="(p.done / p.total) * 100"></div></div>
          <p class="hint">{{ p.done }} / {{ p.total }} files</p>
        </div>
      } @else if (!ready()) {
        <div class="empty"><p>Preparing symbol index…</p></div>
      } @else if (tab() === 'unused') {
        @if (unused().length === 0) {
          <div class="empty">
            <p class="title">Every export is referenced somewhere.</p>
            <p class="hint">Nothing exported from an indexed file is left unreferenced.</p>
          </div>
        } @else {
          <div class="list">
            <p class="caveat">
              Exported names that nothing in the repo resolves to. Entry points, dynamic
              <code>import()</code> and string-keyed access are not tracked, so read this as a
              shortlist to check, not a delete list.
            </p>
            @for (g of unused(); track g.path) {
              <div class="group">
                <div class="group-head">
                  <span class="path">{{ g.path }}</span>
                  <span class="badge">{{ g.defs.length }}</span>
                </div>
                @for (d of g.defs; track d.id) {
                  <button type="button" class="row" (click)="open(d)">
                    <span class="kind" [attr.data-kind]="d.kind">{{ d.kind }}</span>
                    <span class="name">{{ d.name }}</span>
                    <span class="line">:{{ d.startRow + 1 }}</span>
                  </button>
                }
              </div>
            }
          </div>
        }
      } @else {
        @if (folders().length === 0) {
          <div class="empty"><p>No exported symbols found.</p></div>
        } @else {
          <div class="list">
            <p class="caveat">
              How much of each folder's export list is reached from outside it. A folder that
              exports twenty names and publishes two has a boundary; one that publishes all twenty
              is a folder, not a module.
            </p>
            @for (f of folders(); track f.folder) {
              <div class="group">
                <button type="button" class="group-head clickable" (click)="toggle(f.folder)">
                  <span class="chev">{{ isOpen(f.folder) ? '▾' : '▸' }}</span>
                  <span class="path">{{ f.folder || '(root)' }}</span>
                  <span class="ratio">
                    <span class="meter" [title]="meterTitle(f)">
                      <span
                        class="meter-part external"
                        [style.flex]="f.external.length || 0"
                      ></span>
                      <span
                        class="meter-part internal"
                        [style.flex]="f.internal.length || 0"
                      ></span>
                      <span class="meter-part unused" [style.flex]="f.unused.length || 0"></span>
                    </span>
                    <span class="badge"
                      >{{ f.external.length }}/{{ f.exported.length }} public</span
                    >
                  </span>
                </button>
                @if (isOpen(f.folder)) {
                  @for (bucket of buckets; track bucket) {
                    @if (defsIn(f, bucket).length > 0) {
                      <div class="bucket-head" [attr.data-bucket]="bucket">
                        {{ bucketLabel(bucket) }} ({{ defsIn(f, bucket).length }})
                      </div>
                      @for (d of defsIn(f, bucket); track d.id) {
                        <button type="button" class="row" (click)="open(d)">
                          <span class="kind" [attr.data-kind]="d.kind">{{ d.kind }}</span>
                          <span class="name">{{ d.name }}</span>
                          <span class="line">{{ fileOf(d) }}</span>
                        </button>
                      }
                    }
                  }
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .wrap {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }
      .controls {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        flex: none;
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
        padding: 3px 8px;
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
      .copy {
        background: transparent;
        border: 1px solid var(--border);
        color: inherit;
        border-radius: 3px;
        font: inherit;
        font-size: 11px;
        padding: 2px 8px;
        cursor: pointer;
      }
      .copy:hover:not(:disabled) {
        border-color: var(--accent);
        color: var(--accent);
      }
      .copy:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .spacer {
        flex: 1;
      }
      .count {
        font-size: 11px;
        opacity: 0.7;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding-bottom: 16px;
      }
      .caveat {
        margin: 0;
        padding: 8px 12px;
        font-size: 11px;
        line-height: 1.5;
        opacity: 0.6;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      }
      .caveat code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .group {
        border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
      }
      .group-head {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 5px 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        background: transparent;
        border: none;
        color: inherit;
        text-align: left;
      }
      .group-head.clickable {
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .group-head.clickable:hover {
        background: var(--hover);
      }
      .chev {
        width: 10px;
        opacity: 0.5;
        font-size: 10px;
        flex-shrink: 0;
      }
      .path {
        opacity: 0.8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ratio {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .meter {
        display: flex;
        width: 90px;
        height: 6px;
        border-radius: 3px;
        overflow: hidden;
        background: color-mix(in srgb, var(--fg) 10%, transparent);
      }
      .meter-part.external {
        background: var(--accent);
      }
      .meter-part.internal {
        background: color-mix(in srgb, var(--accent) 35%, transparent);
      }
      .meter-part.unused {
        background: color-mix(in srgb, var(--danger) 55%, transparent);
      }
      .badge {
        font-size: 10px;
        opacity: 0.65;
        white-space: nowrap;
      }
      .bucket-head {
        padding: 4px 10px 2px 24px;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.5;
      }
      .bucket-head[data-bucket='unused'] {
        color: var(--danger);
        opacity: 0.75;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        font-size: 12px;
        padding: 2px 10px 2px 24px;
        cursor: pointer;
      }
      .row:hover {
        background: var(--hover);
      }
      .kind {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.7;
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 0 4px;
        flex-shrink: 0;
      }
      .name {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .line {
        margin-left: auto;
        font-size: 10px;
        opacity: 0.45;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px;
        text-align: center;
        opacity: 0.85;
      }
      .empty p {
        margin: 0;
        max-width: 460px;
      }
      .empty .title {
        font-weight: 500;
      }
      .empty .hint {
        font-size: 12px;
        opacity: 0.65;
        line-height: 1.45;
      }
      .bar {
        width: 220px;
        height: 3px;
        border-radius: 2px;
        overflow: hidden;
        background: color-mix(in srgb, var(--accent) 15%, transparent);
      }
      .fill {
        height: 100%;
        background: var(--accent);
      }
    `,
  ],
})
export class SymbolsVizComponent {
  readonly store = inject(AnalysisStore);
  private readonly index = inject(SymbolIndexService);
  private readonly selection = inject(AstSelectionService);

  readonly tab = signal<Tab>('unused');
  readonly copied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  readonly buckets: Bucket[] = ['external', 'internal', 'unused'];
  readonly progress = this.index.building;
  readonly ready = computed(() => this.index.index() !== null);

  constructor() {
    effect(() => {
      this.store.projectId();
      if (this.store.root()) void this.index.build();
    });
  }

  /** Unused exports, filtered and grouped by the file that declares them. */
  readonly unused = computed<UnusedGroup[]>(() => {
    this.index.index();
    // The toolbar's name/path filter and the ignore list already scope every other
    // viz; this one honours the same selection rather than adding a second box.
    const visible = this.store.filteredPaths();
    const groups = new Map<string, SymbolDef[]>();
    for (const def of this.index.unusedExports()) {
      if (!visible.has(def.path)) continue;
      const list = groups.get(def.path) ?? [];
      list.push(def);
      groups.set(def.path, list);
    }
    return [...groups.entries()].map(([path, defs]) => ({ path, defs }));
  });

  readonly unusedCount = computed(() =>
    this.unused().reduce((total, g) => total + g.defs.length, 0),
  );

  readonly folders = computed<FolderSurface[]>(() => {
    this.index.index();
    const visible = this.store.filteredPaths();
    const out: FolderSurface[] = [];
    for (const f of this.index.folderSurface()) {
      // Drop symbols whose file the global filter hides, and the folder with them if
      // nothing survives.
      const keep = (defs: SymbolDef[]) => defs.filter((d) => visible.has(d.path));
      const exported = keep(f.exported);
      if (exported.length === 0) continue;
      out.push({
        folder: f.folder,
        exported,
        external: keep(f.external),
        internal: keep(f.internal),
        unused: keep(f.unused),
      });
    }
    return out;
  });

  defsIn(surface: FolderSurface, bucket: Bucket): SymbolDef[] {
    return surface[bucket];
  }

  bucketLabel(bucket: Bucket): string {
    if (bucket === 'external') return 'used outside the folder';
    if (bucket === 'internal') return 'used only inside';
    return 'never referenced';
  }

  meterTitle(f: FolderSurface): string {
    return (
      `${f.external.length} used outside · ${f.internal.length} internal only · ` +
      `${f.unused.length} never referenced`
    );
  }

  fileOf(def: SymbolDef): string {
    const idx = def.path.lastIndexOf('/');
    return `${idx >= 0 ? def.path.slice(idx + 1) : def.path}:${def.startRow + 1}`;
  }

  isOpen(folder: string): boolean {
    return this.expanded().has(folder);
  }

  toggle(folder: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });
  }

  readonly copyDisabled = computed(() =>
    this.tab() === 'unused' ? this.unused().length === 0 : this.folders().length === 0,
  );

  /** Plain text of whichever tab is showing, so a list can leave the app. */
  private asText(): string {
    if (this.tab() === 'unused') {
      return this.unused()
        .map((g) =>
          [g.path, ...g.defs.map((d) => `  ${d.kind} ${d.name}:${d.startRow + 1}`)].join('\n'),
        )
        .join('\n');
    }
    return this.folders()
      .map((f) => {
        const head = `${f.folder || '(root)'}  ${f.external.length}/${f.exported.length} public`;
        const lines = this.buckets.flatMap((b) =>
          this.defsIn(f, b).map(
            (d) => `  [${this.bucketLabel(b)}] ${d.kind} ${d.name} (${d.path}:${d.startRow + 1})`,
          ),
        );
        return [head, ...lines].join('\n');
      })
      .join('\n\n');
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.asText());
    } catch {
      // Clipboard access can be denied; the button simply does not confirm.
      return;
    }
    this.copied.set(true);
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(false), 1500);
  }

  open(def: SymbolDef): void {
    this.selection.jumpTo(def.path, {
      startRow: def.startRow,
      startCol: def.startCol,
      endRow: def.endRow,
      endCol: def.endCol,
    });
  }
}
