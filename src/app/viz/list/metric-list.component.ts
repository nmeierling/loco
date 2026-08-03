import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TabsStore } from '../../core/state/tabs.store';
import { AnalysisStore } from '../../core/state/analysis.store';
import { IgnoreService } from '../../core/services/ignore.service';
import { FileNode, MetricKind, TreeNode, fileCount, isFile } from '../../core/models/tree';

type SortKey = 'name' | 'dir' | 'language' | MetricKind;
type SortDir = 1 | -1;

interface Column {
  key: SortKey;
  label: string;
  numeric: boolean;
  width: string;
  align: 'left' | 'right';
}

interface Row {
  path: string;
  name: string;
  dir: string;
  language: string | null;
  loc: number | null;
  complexity: number | null;
  churn: number | null;
  risk: number | null;
}

interface CellView {
  key: SortKey;
  numeric: boolean;
  text: string;
  /** 0–100, share of the column max. Drives the magnitude bar behind numeric cells. */
  pct: number;
}

interface RowView {
  path: string;
  cells: CellView[];
}

interface RowWindow {
  items: RowView[];
  padTop: number;
  padBottom: number;
}

type EmptyReason =
  | { kind: 'no-project' }
  | { kind: 'no-matches'; canClearFilters: boolean; userIgnoreCount: number }
  | { kind: 'no-rows' };

const ROW_H = 26;
const OVERSCAN = 8;
const METRIC_LABELS: Record<MetricKind, string> = {
  loc: 'LOC',
  complexity: 'Complexity',
  churn: 'Churn',
  risk: 'Risk',
};
const METRICS: MetricKind[] = ['loc', 'complexity', 'churn', 'risk'];

@Component({
  selector: 'loco-metric-list',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="controls">
        <label class="pick">
          <span class="cap">lang</span>
          <select [ngModel]="language()" (ngModelChange)="setLanguage($event)">
            <option value="">all</option>
            @for (l of languages(); track l) {
              <option [value]="l">{{ l }}</option>
            }
          </select>
        </label>

        @for (m of activeMetrics(); track m) {
          <label class="pick">
            <span class="cap">min {{ m }}</span>
            <input
              type="number"
              min="0"
              class="num"
              [ngModel]="mins()[m]"
              (ngModelChange)="setMin(m, $event)"
            />
          </label>
        }

        @if (hasLocalFilters()) {
          <button type="button" class="reset" (click)="clearLocalFilters()">reset</button>
        }

        <div class="spacer"></div>

        @if (churnNote(); as note) {
          <div class="note">{{ note }}</div>
        }
        <div class="count">{{ rows().length | number }} / {{ totalFiles() | number }} files</div>
      </div>

      @if (emptyReason(); as e) {
        <div class="empty">
          @switch (e.kind) {
            @case ('no-project') {
              <p>Drop a folder to analyze.</p>
            }
            @case ('no-matches') {
              <p class="empty-title">No files match the current filters.</p>
              <p class="empty-hint">
                Filters are applied across the list, sidebar, and other vizzes.
                @if (e.userIgnoreCount > 0) {
                  {{ e.userIgnoreCount }} custom ignore
                  {{ e.userIgnoreCount === 1 ? 'pattern is' : 'patterns are' }}
                  active — review them in the right panel if needed.
                }
              </p>
              @if (e.canClearFilters) {
                <button type="button" class="clear-filters" (click)="clearFilters()">
                  Clear name &amp; path filters
                </button>
              }
            }
            @case ('no-rows') {
              <p class="empty-title">No rows match the list filters.</p>
              <p class="empty-hint">
                The language or minimum-value filters above exclude every visible file. Name and
                path filtering lives in the toolbar.
              </p>
              <button type="button" class="clear-filters" (click)="clearLocalFilters()">
                Reset list filters
              </button>
            }
          }
        </div>
      } @else {
        <div class="table" role="table">
          <div class="head" role="row" [style.gridTemplateColumns]="gridTemplate()">
            @for (c of columns(); track c.key) {
              <button
                type="button"
                role="columnheader"
                class="th"
                [class.right]="c.align === 'right'"
                [class.sorted]="sortKey() === c.key"
                [attr.aria-sort]="ariaSort(c.key)"
                (click)="toggleSort(c.key)"
              >
                <span class="th-label">{{ c.label }}</span>
                <span class="arrow">{{
                  sortKey() === c.key ? (sortDir() === -1 ? '▼' : '▲') : ''
                }}</span>
              </button>
            }
          </div>

          <div class="scroller" #scroller (scroll)="onScroll()">
            <div [style.height.px]="window().padTop"></div>
            @for (r of window().items; track r.path) {
              <div
                class="row"
                role="row"
                [class.selected]="selectedPath() === r.path"
                [style.gridTemplateColumns]="gridTemplate()"
                [style.height.px]="rowHeight"
                [title]="r.path"
                (click)="select(r.path)"
                (dblclick)="openAst(r.path)"
              >
                @for (c of r.cells; track c.key) {
                  <div class="td" role="cell" [class.num]="c.numeric">
                    @if (c.numeric) {
                      <span class="bar" [style.width.%]="c.pct"></span>
                    }
                    <span class="val">{{ c.text }}</span>
                  </div>
                }
              </div>
            }
            <div [style.height.px]="window().padBottom"></div>
          </div>
        </div>
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
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        flex: none;
      }
      .pick select:focus,
      .pick input:focus {
        outline: none;
        border-color: var(--accent);
      }
      .pick {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .cap {
        font-size: 10px;
        opacity: 0.55;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .pick select,
      .pick input {
        background: var(--input-bg);
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 2px 4px;
        font-size: 11px;
        font-family: inherit;
      }
      .pick input.num {
        width: 62px;
      }
      .reset {
        background: transparent;
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 2px 8px;
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        opacity: 0.75;
      }
      .reset:hover {
        opacity: 1;
        border-color: var(--accent);
        color: var(--accent);
      }
      .spacer {
        flex: 1;
      }
      .count {
        font-size: 11px;
        opacity: 0.7;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .note {
        font-size: 11px;
        opacity: 0.6;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      .table {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }
      .head {
        display: grid;
        border-bottom: 1px solid var(--border-strong);
        background: var(--bar-bg);
        flex: none;
      }
      .th {
        display: flex;
        align-items: center;
        gap: 4px;
        background: transparent;
        border: none;
        border-right: 1px solid var(--border);
        color: inherit;
        font: inherit;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.6;
        padding: 5px 8px;
        cursor: pointer;
        overflow: hidden;
      }
      .th:last-child {
        border-right: none;
      }
      .th.right {
        justify-content: flex-end;
      }
      .th:hover {
        opacity: 0.95;
        background: var(--hover);
      }
      .th.sorted {
        opacity: 1;
        color: var(--accent);
      }
      .th-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .arrow {
        font-size: 8px;
      }

      .scroller {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .row {
        display: grid;
        align-items: stretch;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
        cursor: pointer;
      }
      .row:hover {
        background: var(--hover);
      }
      .row.selected {
        background: color-mix(in srgb, var(--accent) 18%, transparent);
        box-shadow: inset 2px 0 0 var(--accent);
      }
      .td {
        position: relative;
        display: flex;
        align-items: center;
        padding: 0 8px;
        font-size: 11.5px;
        overflow: hidden;
        white-space: nowrap;
      }
      .td.num {
        justify-content: flex-end;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-variant-numeric: tabular-nums;
      }
      .bar {
        position: absolute;
        left: 0;
        top: 4px;
        bottom: 4px;
        background: color-mix(in srgb, var(--accent) 30%, transparent);
        border-top-right-radius: 4px;
        border-bottom-right-radius: 4px;
        pointer-events: none;
      }
      .val {
        position: relative;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .td:not(.num) .val {
        opacity: 0.85;
      }

      .empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
        text-align: center;
        gap: 8px;
        opacity: 0.85;
      }
      .empty p {
        margin: 0;
        max-width: 420px;
      }
      .empty-title {
        font-weight: 500;
      }
      .empty-hint {
        opacity: 0.65;
        font-size: 12px;
        line-height: 1.45;
      }
      .clear-filters {
        background: transparent;
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 4px 12px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        margin-top: 4px;
      }
      .clear-filters:hover {
        border-color: var(--accent);
        color: var(--accent);
      }
    `,
  ],
})
export class MetricListComponent {
  private readonly store = inject(AnalysisStore);
  private readonly ig = inject(IgnoreService);
  private readonly tabs = inject(TabsStore);
  private readonly destroyRef = inject(DestroyRef);

  /** Absent while an empty state is showing — the scroller is inside the @else branch. */
  private readonly scrollerRef = viewChild<ElementRef<HTMLDivElement>>('scroller');

  readonly rowHeight = ROW_H;
  readonly selectedPath = this.store.selectedPath;

  readonly sortKey = signal<SortKey>('loc');
  readonly sortDir = signal<SortDir>(-1);

  readonly language = signal('');
  readonly mins = signal<Record<MetricKind, number | null>>({
    loc: null,
    complexity: null,
    churn: null,
    risk: null,
  });

  private readonly scrollTop = signal(0);
  private readonly viewportH = signal(0);

  /**
   * Metric columns actually shown — churn appears as soon as a `.git/` is detected,
   * placeholder-filled until the background history walk lands.
   */
  readonly activeMetrics = computed<MetricKind[]>(() =>
    METRICS.filter((m) => {
      if (m === 'churn') return this.store.churnOffered();
      // Risk is computed on demand, so its column appears once the score exists.
      if (m === 'risk') return this.store.risk().status === 'ready';
      return true;
    }),
  );

  readonly churnNote = computed<string | null>(() => {
    const c = this.store.churn();
    if (c.status === 'pending') return 'walking git history…';
    if (c.status === 'running')
      return c.total > 0 ? `walking git history ${c.done}/${c.total}…` : 'walking git history…';
    if (c.status === 'error') return `churn unavailable: ${c.message}`;
    return null;
  });

  readonly columns = computed<Column[]>(() => {
    const cols: Column[] = [
      { key: 'name', label: 'File', numeric: false, width: 'minmax(120px, 1.3fr)', align: 'left' },
      { key: 'dir', label: 'Folder', numeric: false, width: 'minmax(140px, 2fr)', align: 'left' },
      { key: 'language', label: 'Lang', numeric: false, width: '88px', align: 'left' },
    ];
    for (const m of this.activeMetrics()) {
      cols.push({
        key: m,
        label: METRIC_LABELS[m],
        numeric: true,
        width: '118px',
        align: 'right',
      });
    }
    return cols;
  });

  readonly gridTemplate = computed(() =>
    this.columns()
      .map((c) => c.width)
      .join(' '),
  );

  /** Every file surviving the global filters, flattened. */
  private readonly allRows = computed<Row[]>(() => {
    const root = this.store.filteredRoot();
    if (!root) return [];
    const out: Row[] = [];
    const visit = (n: TreeNode): void => {
      if (isFile(n)) {
        out.push(toRow(n));
      } else {
        for (const c of n.children) visit(c);
      }
    };
    visit(root);
    return out;
  });

  readonly totalFiles = computed(() => this.allRows().length);

  readonly languages = computed<string[]>(() => {
    const set = new Set<string>();
    for (const r of this.allRows()) if (r.language) set.add(r.language);
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  /** Rows after the list-local filters, ordered by the active sort. */
  readonly rows = computed<Row[]>(() => {
    const lang = this.language();
    const mins = this.mins();
    const kept = this.allRows().filter((r) => {
      if (lang && r.language !== lang) return false;
      for (const m of METRICS) {
        const min = mins[m];
        if (min === null || min === undefined) continue;
        const v = r[m];
        if (v === null || v < min) return false;
      }
      return true;
    });
    const key = this.sortKey();
    const dir = this.sortDir();
    return kept.sort((a, b) => compare(a, b, key, dir));
  });

  /** Column maxima, for the in-cell magnitude bars. Recomputed from the visible rows. */
  private readonly maxima = computed<Record<MetricKind, number>>(() => {
    const max: Record<MetricKind, number> = { loc: 0, complexity: 0, churn: 0, risk: 0 };
    for (const r of this.rows()) {
      for (const m of METRICS) {
        const v = r[m];
        if (v !== null && v > max[m]) max[m] = v;
      }
    }
    return max;
  });

  /** Only the slice of rows the scroller can actually show, plus spacer heights. */
  readonly window = computed<RowWindow>(() => {
    const rows = this.rows();
    const cols = this.columns();
    const max = this.maxima();
    const churnPending = this.store.churnPending();
    const start = Math.max(0, Math.floor(this.scrollTop() / ROW_H) - OVERSCAN);
    const count = Math.ceil(Math.max(this.viewportH(), ROW_H) / ROW_H) + OVERSCAN * 2;
    const end = Math.min(rows.length, start + count);
    const items: RowView[] = [];
    for (let i = start; i < end; i++) {
      const r = rows[i];
      items.push({
        path: r.path,
        cells: cols.map((c) => cellView(r, c, max, churnPending)),
      });
    }
    return {
      items,
      padTop: start * ROW_H,
      padBottom: Math.max(0, (rows.length - end) * ROW_H),
    };
  });

  readonly hasLocalFilters = computed(() => {
    const mins = this.mins();
    return !!this.language() || METRICS.some((m) => mins[m] !== null);
  });

  readonly emptyReason = computed<EmptyReason | null>(() => {
    if (this.rows().length > 0) return null;
    const root = this.store.root();
    if (!root) return { kind: 'no-project' };
    const filtered = this.store.filteredRoot();
    const visibleFiles = filtered ? fileCount(filtered) : 0;
    if (visibleFiles === 0) {
      const f = this.store.filters();
      return {
        kind: 'no-matches',
        canClearFilters: !!(f.name || f.path),
        userIgnoreCount: this.ig.userPatterns().length,
      };
    }
    return { kind: 'no-rows' };
  });

  constructor() {
    // Follow the toolbar's metric chip: picking a metric ranks the list by it.
    effect(() => {
      const metric = this.store.filters().metric;
      untracked(() => {
        this.sortKey.set(metric);
        this.sortDir.set(-1);
        this.resetScroll();
      });
    });

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) this.viewportH.set(Math.max(0, Math.floor(e.contentRect.height)));
    });
    this.destroyRef.onDestroy(() => ro.disconnect());

    // The scroller comes and goes with the empty states, so re-observe it every
    // time the query resolves to a different element.
    effect((onCleanup) => {
      const el = this.scrollerRef()?.nativeElement;
      if (!el) return;
      ro.observe(el);
      this.viewportH.set(el.clientHeight);
      onCleanup(() => ro.unobserve(el));
    });
  }

  onScroll(): void {
    const el = this.scrollerRef()?.nativeElement;
    if (el) this.scrollTop.set(el.scrollTop);
  }

  toggleSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 1 ? -1 : 1));
    } else {
      this.sortKey.set(key);
      // Numbers are most interesting biggest-first; names read best A→Z.
      this.sortDir.set(this.columns().find((c) => c.key === key)?.numeric ? -1 : 1);
    }
    this.resetScroll();
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 1 ? 'ascending' : 'descending';
  }

  setLanguage(lang: string): void {
    this.language.set(lang ?? '');
    this.resetScroll();
  }

  setMin(metric: MetricKind, value: number | string | null): void {
    const n = value === null || value === '' || value === undefined ? null : Number(value);
    this.mins.update((m) => ({ ...m, [metric]: n !== null && Number.isFinite(n) ? n : null }));
    this.resetScroll();
  }

  clearLocalFilters(): void {
    this.language.set('');
    this.mins.set({ loc: null, complexity: null, churn: null, risk: null });
    this.resetScroll();
  }

  clearFilters(): void {
    this.store.updateFilters({ name: '', path: '' });
  }

  select(path: string): void {
    this.store.selectPath(path);
  }

  openAst(path: string): void {
    this.tabs.openFile(path);
  }

  private resetScroll(): void {
    this.scrollTop.set(0);
    const el = this.scrollerRef()?.nativeElement;
    if (el) el.scrollTop = 0;
  }
}

function toRow(f: FileNode): Row {
  const slash = f.path.lastIndexOf('/');
  return {
    path: f.path,
    name: f.name,
    dir: slash > 0 ? f.path.slice(0, slash) : '.',
    language: f.language,
    loc: f.metrics.loc,
    complexity: f.metrics.complexity,
    churn: f.metrics.churn,
    risk: f.metrics.risk,
  };
}

function cellView(
  r: Row,
  c: Column,
  max: Record<MetricKind, number>,
  churnPending: boolean,
): CellView {
  if (!c.numeric) {
    const raw = c.key === 'name' ? r.name : c.key === 'dir' ? r.dir : (r.language ?? '—');
    return { key: c.key, numeric: false, text: raw, pct: 0 };
  }
  const metric = c.key as MetricKind;
  const v = r[metric];
  const m = max[metric];
  // An empty churn cell means "not computed yet" while the walk is running, which
  // reads differently from "this file has no commits".
  const missing = metric === 'churn' && churnPending ? '…' : '—';
  return {
    key: c.key,
    numeric: true,
    text: v === null ? missing : v.toLocaleString(),
    pct: v === null || m <= 0 ? 0 : (v / m) * 100,
  };
}

function compare(a: Row, b: Row, key: SortKey, dir: SortDir): number {
  if (key === 'name' || key === 'dir') {
    return dir * a[key].localeCompare(b[key]) || a.path.localeCompare(b.path);
  }
  if (key === 'language') {
    const av = a.language ?? '';
    const bv = b.language ?? '';
    return dir * av.localeCompare(bv) || a.path.localeCompare(b.path);
  }
  const av = a[key];
  const bv = b[key];
  // Missing values sink to the bottom in both directions — they are absent data,
  // not a value of zero.
  if (av === null && bv === null) return a.path.localeCompare(b.path);
  if (av === null) return 1;
  if (bv === null) return -1;
  return dir * (av - bv) || a.path.localeCompare(b.path);
}
