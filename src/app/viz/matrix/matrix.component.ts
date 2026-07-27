import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AnalysisStore } from '../../core/state/analysis.store';
import { ModuleGraphService } from '../../core/services/module-graph.service';

/** A matrix row/column: either a folder aggregating everything beneath it, or a file. */
interface Group {
  /** Directory path (no trailing slash) or file path. */
  path: string;
  label: string;
  isDir: boolean;
  /** Files rolled into this group. */
  fileCount: number;
}

interface Cell {
  ri: number;
  ci: number;
  x: number;
  y: number;
  size: number;
  /** Import edges from the row group to the column group. On the diagonal: internal edges. */
  weight: number;
}

interface Crumb {
  label: string;
  path: string;
}

type Mode = 'folders' | 'files';

@Component({
  selector: 'loco-dependency-matrix',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="controls">
        <nav class="crumbs" aria-label="Folder">
          @for (c of crumbs(); track c.path; let last = $last) {
            <button
              type="button"
              class="crumb"
              [class.current]="last"
              [disabled]="last"
              (click)="focusOn(c.path)"
            >
              {{ c.label }}
            </button>
            @if (!last) {
              <span class="sep">/</span>
            }
          }
        </nav>

        <div class="group">
          <span class="cap">level</span>
          <button
            type="button"
            class="chip"
            [class.active]="mode() === 'folders'"
            (click)="setMode('folders')"
            title="Roll files up into folder-sized rows — readable on large codebases"
          >
            Folders
          </button>
          <button
            type="button"
            class="chip"
            [class.active]="mode() === 'files'"
            (click)="setMode('files')"
            title="One row per file below the current folder"
          >
            Files
          </button>
        </div>

        <div class="spacer"></div>

        @if (status() === 'ready') {
          <div class="count">{{ groups().length }} × {{ groups().length }}</div>
        }
      </div>

      <div class="canvas" #canvas>
        @if (status() === 'idle' || status() === 'building') {
          <div class="status-overlay">
            @if (progress(); as p) {
              <div class="msg">
                Building dependency matrix…
                <div class="bar">
                  <div class="fill" [style.width.%]="(p.done / p.total) * 100"></div>
                </div>
                <div class="counts">{{ p.done }} / {{ p.total }}</div>
              </div>
            } @else {
              <div class="msg">Preparing matrix…</div>
            }
          </div>
        } @else if (status() === 'empty') {
          <div class="status-overlay">
            <div class="msg">
              No imports found. Matrix supports TS/TSX/JS/JSX, Python, Kotlin and Java.
            </div>
          </div>
        } @else if (groups().length === 0) {
          <div class="status-overlay">
            <div class="msg">
              Nothing to show in this folder.
              @if (focus()) {
                <button type="button" class="link" (click)="focusOn('')">Back to the top</button>
              }
            </div>
          </div>
        } @else if (status() === 'ready') {
          <svg [attr.width]="svgWidth()" [attr.height]="svgHeight()">
            <g [attr.transform]="'translate(' + originX() + ',' + originY() + ')'">
              <rect
                [attr.width]="gridSize()"
                [attr.height]="gridSize()"
                fill="var(--input-bg)"
                stroke="var(--border)"
              />
              @for (cell of cells(); track cell.ri * 4096 + cell.ci) {
                <rect
                  [attr.x]="cell.x"
                  [attr.y]="cell.y"
                  [attr.width]="cell.size"
                  [attr.height]="cell.size"
                  [attr.fill]="cellFill(cell)"
                  (mouseenter)="hoverCell.set({ ri: cell.ri, ci: cell.ci })"
                  (mouseleave)="hoverCell.set(null)"
                  (click)="onCellClick(cell)"
                />
              }
              @if (showWeights()) {
                @for (cell of labelledCells(); track cell.ri * 4096 + cell.ci) {
                  <text
                    [attr.x]="cell.x + cell.size / 2"
                    [attr.y]="cell.y + cell.size / 2 + 3"
                    text-anchor="middle"
                    font-size="9"
                    font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
                    [attr.fill]="cell.ri === cell.ci ? 'var(--fg)' : 'var(--accent-fg)'"
                    pointer-events="none"
                  >
                    {{ cell.weight }}
                  </text>
                }
              }
              @if (hoverCell(); as hc) {
                <rect
                  x="0"
                  [attr.y]="hc.ri * cellSize()"
                  [attr.width]="gridSize()"
                  [attr.height]="cellSize()"
                  fill="color-mix(in srgb, var(--accent) 12%, transparent)"
                  pointer-events="none"
                />
                <rect
                  [attr.x]="hc.ci * cellSize()"
                  y="0"
                  [attr.width]="cellSize()"
                  [attr.height]="gridSize()"
                  fill="color-mix(in srgb, var(--accent) 12%, transparent)"
                  pointer-events="none"
                />
              }
            </g>

            <!-- row labels -->
            <g
              class="row-labels"
              [attr.transform]="'translate(' + (originX() - 6) + ',' + originY() + ')'"
            >
              @for (g of groups(); track g.path; let i = $index) {
                <text
                  [attr.y]="i * cellSize() + cellSize() / 2 + 3"
                  text-anchor="end"
                  font-size="10"
                  fill="var(--fg)"
                  [attr.opacity]="hoverCell()?.ri === i ? 1 : 0.72"
                  [class.drillable]="g.isDir"
                  (click)="onLabelClick(g)"
                >
                  {{ g.label }}
                </text>
              }
            </g>

            <!-- column labels -->
            <g
              class="col-labels"
              [attr.transform]="'translate(' + originX() + ',' + (originY() - 6) + ')'"
            >
              @for (g of groups(); track g.path; let i = $index) {
                <text
                  [attr.transform]="
                    'translate(' + (i * cellSize() + cellSize() / 2 + 3) + ',0) rotate(-60)'
                  "
                  text-anchor="start"
                  font-size="10"
                  fill="var(--fg)"
                  [attr.opacity]="hoverCell()?.ci === i ? 1 : 0.72"
                  [class.drillable]="g.isDir"
                  (click)="onLabelClick(g)"
                >
                  {{ g.label }}
                </text>
              }
            </g>
          </svg>

          @if (hoverInfo(); as h) {
            <div class="tip">
              <div class="row">
                <span>row</span> <code>{{ h.row }}</code>
              </div>
              <div class="row">
                <span>col</span> <code>{{ h.col }}</code>
              </div>
              <div class="row">
                <span>{{ h.kind }}</span> <strong>{{ h.detail }}</strong>
              </div>
              @if (h.hint) {
                <div class="row hint">{{ h.hint }}</div>
              }
            </div>
          }
        }
      </div>
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
        gap: 10px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        flex: none;
      }
      .crumbs {
        display: flex;
        align-items: center;
        gap: 2px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        min-width: 0;
        overflow: hidden;
      }
      .crumb {
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        padding: 2px 4px;
        border-radius: 3px;
        cursor: pointer;
        opacity: 0.7;
      }
      .crumb:hover:not(:disabled) {
        background: var(--hover);
        opacity: 1;
        color: var(--accent);
      }
      .crumb.current {
        opacity: 1;
        font-weight: 600;
        cursor: default;
      }
      .sep {
        opacity: 0.35;
      }
      .group {
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
      .chip {
        border: 1px solid var(--border);
        background: transparent;
        color: inherit;
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      .chip.active {
        background: var(--accent);
        color: var(--accent-fg);
        border-color: var(--accent);
      }
      .chip:hover:not(.active) {
        background: var(--hover);
      }
      .spacer {
        flex: 1;
      }
      .count {
        font-size: 11px;
        opacity: 0.7;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .canvas {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .status-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .msg {
        background: var(--bar-bg);
        border: 1px solid var(--border);
        padding: 12px 16px;
        border-radius: 6px;
        font-size: 12px;
        min-width: 260px;
        text-align: center;
      }
      .link {
        display: block;
        margin: 6px auto 0;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 4px;
        color: inherit;
        font: inherit;
        font-size: 11px;
        padding: 3px 10px;
        cursor: pointer;
      }
      .link:hover {
        border-color: var(--accent);
        color: var(--accent);
      }
      .bar {
        margin-top: 6px;
        height: 3px;
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
        opacity: 0.6;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      text.drillable {
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 2px;
      }
      .tip {
        position: fixed;
        right: 14px;
        bottom: 14px;
        background: rgba(20, 22, 26, 0.96);
        color: #eee;
        padding: 8px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        pointer-events: none;
        max-width: 380px;
        line-height: 1.45;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        z-index: 10;
      }
      .tip .row {
        display: flex;
        gap: 8px;
      }
      .tip span {
        opacity: 0.6;
        width: 36px;
        flex-shrink: 0;
      }
      .tip .hint {
        opacity: 0.6;
        margin-top: 2px;
      }
      .tip code {
        word-break: break-all;
      }
    `,
  ],
})
export class DependencyMatrixComponent implements AfterViewInit {
  private readonly store = inject(AnalysisStore);
  private readonly service = inject(ModuleGraphService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLDivElement>;

  readonly width = signal(0);
  readonly height = signal(0);
  readonly status = signal<'idle' | 'building' | 'empty' | 'ready'>('idle');
  readonly progress = this.service.building;
  readonly hoverCell = signal<{ ri: number; ci: number } | null>(null);

  /** Directory the matrix is scoped to. Empty string is the repo root. */
  readonly focus = signal<string>('');
  readonly mode = signal<Mode>('folders');

  readonly leftPad = 220;
  readonly topPad = 120;

  private readonly edges = signal<readonly { from: string; to: string }[]>([]);
  private readonly nodePaths = signal<readonly string[]>([]);

  /** Graph files that pass the global filters and sit under the current focus. */
  private readonly scopedPaths = computed<string[]>(() => {
    const visible = this.store.filteredPaths();
    const prefix = this.focus() ? this.focus() + '/' : '';
    return this.nodePaths()
      .filter((p) => visible.has(p) && p.startsWith(prefix))
      .sort((a, b) => a.localeCompare(b));
  });

  /**
   * Rows/columns for the current view. Folder mode partitions the focused subtree into
   * folder-sized buckets rather than files, so a 3000-file repo opens as a readable
   * grid; files only become rows where a folder was split down to them.
   */
  readonly groups = computed<Group[]>(() => {
    const paths = this.scopedPaths();
    const prefix = this.focus() ? this.focus() + '/' : '';
    if (paths.length === 0) return [];
    if (this.mode() === 'files') {
      return paths.map((p) => ({
        path: p,
        label: p.slice(prefix.length),
        isDir: false,
        fileCount: 1,
      }));
    }
    return partition(paths, prefix).sort((a, b) =>
      a.isDir === b.isDir ? a.label.localeCompare(b.label) : a.isDir ? -1 : 1,
    );
  });

  /** group index → weight matrix, flattened. Diagonal entries hold internal edges. */
  private readonly weights = computed<Map<number, number>>(() => {
    const groups = this.groups();
    const n = groups.length;
    const out = new Map<number, number>();
    if (n === 0) return out;
    const indexOf = new Map<string, number>();
    groups.forEach((g, i) => {
      if (g.isDir) indexOf.set(g.path + '/', i);
      else indexOf.set(g.path, i);
    });
    const groupOf = (p: string): number | undefined => {
      const direct = indexOf.get(p);
      if (direct !== undefined) return direct;
      for (const [key, i] of indexOf) {
        if (key.endsWith('/') && p.startsWith(key)) return i;
      }
      return undefined;
    };
    const cache = new Map<string, number | undefined>();
    const memo = (p: string): number | undefined => {
      if (cache.has(p)) return cache.get(p);
      const g = groupOf(p);
      cache.set(p, g);
      return g;
    };
    for (const e of this.edges()) {
      const ri = memo(e.from);
      const ci = memo(e.to);
      if (ri === undefined || ci === undefined) continue;
      const key = ri * n + ci;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  });

  readonly maxWeight = computed(() => {
    const n = this.groups().length;
    let max = 0;
    for (const [key, w] of this.weights()) {
      const ri = Math.floor(key / n);
      if (ri !== key - ri * n && w > max) max = w;
    }
    return max;
  });

  readonly cellSize = computed(() => {
    const n = this.groups().length;
    if (n === 0) return 0;
    const wAvail = Math.max(160, this.width() - this.leftPad - 12);
    const hAvail = Math.max(160, this.height() - this.topPad - 12);
    // Folder mode has few rows, so let cells grow big enough to carry a count label.
    const cap = this.mode() === 'folders' ? 44 : 24;
    return Math.max(6, Math.min(cap, Math.floor(Math.min(wAvail, hAvail) / n)));
  });

  readonly gridSize = computed(() => this.groups().length * this.cellSize());
  readonly svgWidth = computed(() => Math.max(this.width(), this.leftPad + this.gridSize() + 12));
  readonly svgHeight = computed(() => Math.max(this.height(), this.topPad + this.gridSize() + 12));
  readonly showWeights = computed(() => this.cellSize() >= 18);

  // Folder-level grids are small; centring the leftover space keeps them from
  // hugging the top-left corner of a wide viz area.
  readonly originX = computed(
    () =>
      this.leftPad + Math.max(0, Math.floor((this.width() - this.leftPad - this.gridSize()) / 2)),
  );
  readonly originY = computed(
    () =>
      this.topPad + Math.max(0, Math.floor((this.height() - this.topPad - this.gridSize()) / 2)),
  );

  readonly cells = computed<Cell[]>(() => {
    const n = this.groups().length;
    const s = this.cellSize();
    if (n === 0 || s === 0) return [];
    const w = this.weights();
    const out: Cell[] = [];
    for (let ri = 0; ri < n; ri++) {
      for (let ci = 0; ci < n; ci++) {
        out.push({ ri, ci, x: ci * s, y: ri * s, size: s, weight: w.get(ri * n + ci) ?? 0 });
      }
    }
    return out;
  });

  readonly labelledCells = computed<Cell[]>(() => this.cells().filter((c) => c.weight > 0));

  readonly crumbs = computed<Crumb[]>(() => {
    const out: Crumb[] = [{ label: this.store.rootName() || 'root', path: '' }];
    const focus = this.focus();
    if (!focus) return out;
    const segments = focus.split('/');
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      out.push({ label: seg, path: acc });
    }
    return out;
  });

  readonly hoverInfo = computed(() => {
    const hc = this.hoverCell();
    if (!hc) return null;
    const groups = this.groups();
    const row = groups[hc.ri];
    const col = groups[hc.ci];
    if (!row || !col) return null;
    const n = groups.length;
    const weight = this.weights().get(hc.ri * n + hc.ci) ?? 0;
    if (hc.ri === hc.ci) {
      return {
        row: row.label,
        col: col.label,
        kind: 'inside',
        detail: `${weight} internal ${weight === 1 ? 'import' : 'imports'}, ${row.fileCount} ${
          row.fileCount === 1 ? 'file' : 'files'
        }`,
        hint: row.isDir ? 'click the label to drill in' : null,
      };
    }
    return {
      row: row.label,
      col: col.label,
      kind: 'edges',
      detail:
        weight === 0
          ? 'row does not import col'
          : `row imports col ${weight} ${weight === 1 ? 'time' : 'times'}`,
      hint: null,
    };
  });

  constructor() {
    effect(() => {
      // Key off the project, not the root node — a background churn update replaces
      // the root and must not throw away a built graph.
      this.store.projectId();
      this.service.reset();
      this.edges.set([]);
      this.nodePaths.set([]);
      this.focus.set('');
      this.mode.set('folders');
      this.status.set('idle');
    });

    effect(() => {
      const w = this.width();
      const h = this.height();
      const root = this.store.root();
      if (root && w > 0 && h > 0 && this.status() === 'idle') {
        void this.kickoff();
      }
    });
  }

  ngAfterViewInit(): void {
    const el = this.canvas.nativeElement;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        this.width.set(Math.max(0, Math.floor(r.width)));
        this.height.set(Math.max(0, Math.floor(r.height)));
      }
    });
    ro.observe(el);
    this.destroyRef.onDestroy(() => ro.disconnect());
  }

  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.hoverCell.set(null);
  }

  /** Breadcrumb navigation — lands exactly where the user pointed. */
  focusOn(path: string): void {
    this.focus.set(path);
    this.hoverCell.set(null);
  }

  onLabelClick(g: Group): void {
    if (g.isDir) this.focusOn(g.path);
    else this.store.selectPath(g.path);
  }

  onCellClick(cell: Cell): void {
    const g = this.groups()[cell.ri];
    if (!g) return;
    if (!g.isDir) this.store.selectPath(g.path);
  }

  cellFill(cell: Cell): string {
    if (cell.ri === cell.ci) {
      return cell.weight > 0
        ? 'color-mix(in srgb, var(--fg) 26%, transparent)'
        : 'color-mix(in srgb, var(--fg) 12%, transparent)';
    }
    if (cell.weight === 0) return 'transparent';
    // Single-hue sequential ramp: heavier coupling reads as a denser accent.
    const max = Math.max(1, this.maxWeight());
    const t = Math.min(1, cell.weight / max);
    const pct = Math.round(35 + t * 65);
    return `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;
  }

  private async kickoff(): Promise<void> {
    this.status.set('building');
    const project = this.store.projectId();
    const graph = await this.service.build();
    if (this.store.projectId() !== project) return;
    if (graph.nodes.length === 0) {
      this.status.set('empty');
      return;
    }
    this.nodePaths.set(graph.nodes.map((n) => n.path));
    this.edges.set(graph.edges);
    this.focus.set('');
    this.status.set('ready');
  }
}

/** Fewer rows than this reads as a near-empty grid; more starts to get unreadable. */
const MIN_GROUPS = 8;
const MAX_GROUPS = 40;

/**
 * Splits a set of file paths into folder-sized buckets. Starts from the immediate
 * children of `prefix` and keeps splitting the biggest folder until there are enough
 * rows to be informative — so a repo where everything lives under one `src/app` opens
 * on the folders that actually differ instead of on a single row.
 */
function partition(paths: readonly string[], prefix: string): Group[] {
  const childrenOf = (dir: string): Map<string, { isDir: boolean; count: number }> => {
    const dirPrefix = dir ? dir + '/' : '';
    const out = new Map<string, { isDir: boolean; count: number }>();
    for (const p of paths) {
      if (!p.startsWith(dirPrefix)) continue;
      const rest = p.slice(dirPrefix.length);
      const slash = rest.indexOf('/');
      const key = dirPrefix + (slash === -1 ? rest : rest.slice(0, slash));
      const entry = out.get(key);
      if (entry) entry.count++;
      else out.set(key, { isDir: slash !== -1, count: 1 });
    }
    return out;
  };

  const toGroups = (m: Map<string, { isDir: boolean; count: number }>): Group[] =>
    [...m.entries()].map(([path, v]) => ({
      path,
      label: path.slice(prefix.length) + (v.isDir ? '/' : ''),
      isDir: v.isDir,
      fileCount: v.count,
    }));

  let groups = toGroups(childrenOf(prefix.replace(/\/$/, '')));

  for (let guard = 0; guard < 64 && groups.length < MIN_GROUPS; guard++) {
    const candidates = groups.filter((g) => g.isDir);
    if (candidates.length === 0) break;
    const biggest = candidates.reduce((a, b) => (b.fileCount > a.fileCount ? b : a));
    const split = toGroups(childrenOf(biggest.path));
    // A folder with a single child splits to one group — still progress, since the
    // label gets more specific, but it can't be what pushes us over MAX_GROUPS.
    if (split.length === 0 || groups.length - 1 + split.length > MAX_GROUPS) break;
    groups = groups.filter((g) => g.path !== biggest.path).concat(split);
  }

  return groups;
}
