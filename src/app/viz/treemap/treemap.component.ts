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
import { TabsStore } from '../../core/state/tabs.store';
import { HierarchyRectangularNode, hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { interpolateYlOrRd } from 'd3-scale-chromatic';
import { scaleSequential } from 'd3-scale';
import { AnalysisStore } from '../../core/state/analysis.store';
import { IgnoreService } from '../../core/services/ignore.service';
import {
  DirNode,
  DisplayMetric,
  TreeNode,
  fileCount,
  isDir,
  isFile,
  metricValue,
} from '../../core/models/tree';

/** Tooltip box metrics, kept in step with the .tip rule below. */
const TIP_WIDTH = 320;
const TIP_HEIGHT = 74;
const TIP_GAP = 8;

type EmptyReason =
  | { kind: 'no-project' }
  | { kind: 'no-matches'; canClearFilters: boolean; userIgnoreCount: number }
  | { kind: 'churn-loading'; done: number; total: number }
  | { kind: 'churn-error'; message: string }
  | { kind: 'risk-loading' }
  | { kind: 'risk-error'; message: string }
  | { kind: 'no-data'; metric: DisplayMetric };

interface TileDatum {
  node: TreeNode;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  textColor: string;
  loc: number;
  complexity: number;
  churn: number | null;
}

@Component({
  selector: 'loco-treemap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      @if (emptyReason(); as e) {
        <div class="empty">
          @switch (e.kind) {
            @case ('no-project') {
              <p>Drop a folder to analyze.</p>
            }
            @case ('no-matches') {
              <p class="empty-title">No files match the current filters.</p>
              <p class="empty-hint">
                Filters are applied across the Overview, sidebar, and other vizzes.
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
            @case ('churn-loading') {
              <p class="empty-title">Walking git history…</p>
              <p class="empty-hint">
                Churn is computed in the background. Tiles appear as soon as the walk finishes —
                other metrics are usable in the meantime.
              </p>
              <div class="progress" role="progressbar">
                @if (e.total > 0) {
                  <div class="progress-fill" [style.width.%]="(e.done / e.total) * 100"></div>
                } @else {
                  <div class="progress-fill indeterminate"></div>
                }
              </div>
              @if (e.total > 0) {
                <p class="empty-hint">{{ e.done }} / {{ e.total }} commits</p>
              }
            }
            @case ('churn-error') {
              <p class="empty-title">Churn is unavailable.</p>
              <p class="empty-hint">{{ e.message }}</p>
            }
            @case ('risk-loading') {
              <p class="empty-title">Scoring risk…</p>
              <p class="empty-hint">
                Risk needs the import graph to know how many files depend on each one, so it is
                built the first time the metric is used.
              </p>
              <div class="progress" role="progressbar">
                <div class="progress-fill indeterminate"></div>
              </div>
            }
            @case ('risk-error') {
              <p class="empty-title">Risk is unavailable.</p>
              <p class="empty-hint">{{ e.message }}</p>
            }
            @case ('no-data') {
              <p class="empty-title">No {{ e.metric }} values for the visible files.</p>
              <p class="empty-hint">Try switching the metric in the Files sidebar.</p>
            }
          }
        </div>
      } @else {
        <svg [attr.width]="width()" [attr.height]="height()">
          @for (t of tiles(); track t.node.path) {
            <g
              [attr.transform]="'translate(' + t.x + ',' + t.y + ')'"
              (mousemove)="onHover($event, t)"
              (mouseleave)="onLeave()"
              (click)="onSelect(t)"
              (dblclick)="onOpenAst(t)"
              class="tile"
            >
              <rect
                [attr.width]="t.width"
                [attr.height]="t.height"
                [attr.fill]="t.fill"
                [attr.stroke]="isSelected(t) ? 'var(--accent)' : 'rgba(0,0,0,0.35)'"
                [attr.stroke-width]="isSelected(t) ? 2 : t.width > 4 && t.height > 4 ? 0.5 : 0"
              />
              @if (t.width > 60 && t.height > 18) {
                <text
                  x="4"
                  y="13"
                  [attr.fill]="t.textColor"
                  font-size="11"
                  font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
                  pointer-events="none"
                >
                  {{ t.node.name }}
                </text>
              }
            </g>
          }
        </svg>
      }

      @if (tip(); as t) {
        <div
          class="tip"
          [class.flip-x]="t.flipX"
          [class.flip-y]="t.flipY"
          [style.left.px]="t.x"
          [style.top.px]="t.y"
        >
          <div class="tip-path">{{ t.path }}</div>
          <div class="tip-row">
            LOC <strong>{{ t.loc }}</strong>
          </div>
          <div class="tip-row">
            Complexity <strong>{{ t.complexity }}</strong>
          </div>
          @if (t.churn !== null) {
            <div class="tip-row">
              Churn <strong>{{ t.churn }}</strong>
            </div>
          }
        </div>
      }

      @if (legend(); as l) {
        <div class="legend" aria-label="Color legend">
          <div class="legend-label">color: complexity</div>
          <div class="legend-bar">
            @for (s of l.stops; track $index) {
              <span class="legend-stop" [style.background]="s"></span>
            }
          </div>
          <div class="legend-scale">
            <span>{{ l.min }}</span>
            <span>{{ l.max }}</span>
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
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .empty {
        position: absolute;
        inset: 0;
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
      .progress {
        width: 220px;
        height: 3px;
        border-radius: 2px;
        overflow: hidden;
        background: color-mix(in srgb, var(--accent) 15%, transparent);
        position: relative;
      }
      .progress-fill {
        height: 100%;
        background: var(--accent);
        transition: width 0.15s ease-out;
      }
      .progress-fill.indeterminate {
        position: absolute;
        width: 40%;
        left: -40%;
        border-radius: 2px;
        animation: indet 1.1s linear infinite;
      }
      @keyframes indet {
        from {
          left: -40%;
        }
        to {
          left: 100%;
        }
      }
      .tile {
        cursor: pointer;
      }
      .tip {
        position: absolute;
        pointer-events: none;
        background: rgba(20, 22, 26, 0.96);
        color: #eee;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        line-height: 1.4;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        max-width: 320px;
        transform: translate(8px, 8px);
        /* The pane clips at its edges, so near the right or bottom the tooltip is
           re-anchored to the opposite corner of the cursor rather than squeezed. */
      }
      .tip.flip-x {
        transform: translate(calc(-100% - 8px), 8px);
      }
      .tip.flip-y {
        transform: translate(8px, calc(-100% - 8px));
      }
      .tip.flip-x.flip-y {
        transform: translate(calc(-100% - 8px), calc(-100% - 8px));
        z-index: 10;
      }
      .tip-path {
        opacity: 0.85;
        margin-bottom: 2px;
        word-break: break-all;
      }
      .tip-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .legend {
        position: absolute;
        top: 8px;
        left: 8px;
        padding: 6px 8px;
        background: color-mix(in srgb, var(--bar-bg) 92%, transparent);
        border: 1px solid var(--border);
        border-radius: 4px;
        font-size: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        pointer-events: none;
        z-index: 5;
        line-height: 1.3;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
      }
      .legend-label {
        opacity: 0.65;
        margin-bottom: 3px;
        letter-spacing: 0.05em;
      }
      .legend-bar {
        display: flex;
        height: 8px;
        width: 140px;
        border-radius: 2px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--fg) 15%, transparent);
      }
      .legend-stop {
        flex: 1;
      }
      .legend-scale {
        display: flex;
        justify-content: space-between;
        margin-top: 2px;
        opacity: 0.7;
      }
    `,
  ],
})
export class TreemapComponent implements AfterViewInit {
  private readonly store = inject(AnalysisStore);
  private readonly ig = inject(IgnoreService);
  private readonly tabs = inject(TabsStore);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  readonly width = signal(0);
  readonly height = signal(0);
  readonly tiles = signal<TileDatum[]>([]);
  readonly legend = signal<{ stops: string[]; min: number; max: number } | null>(null);
  readonly tip = signal<{
    x: number;
    y: number;
    /** Anchor the tooltip by its right edge — set when it would overflow the pane. */
    flipX: boolean;
    flipY: boolean;
    path: string;
    loc: number;
    complexity: number;
    churn: number | null;
  } | null>(null);

  readonly emptyReason = computed<EmptyReason | null>(() => {
    if (this.tiles().length > 0) return null;
    const root = this.store.root();
    if (!root) return { kind: 'no-project' };
    const filtered = this.store.filteredRoot();
    const visibleFiles = filtered ? fileCount(filtered) : 0;
    if (visibleFiles === 0) {
      const f = this.store.filters();
      const userIgnoreCount = this.ig.userPatterns().length;
      return {
        kind: 'no-matches',
        canClearFilters: !!(f.name || f.path),
        userIgnoreCount,
      };
    }
    // We have visible files but the metric value sum is 0 (e.g. churn with no
    // churn data, or all files at LOC=0). The chip disabling already prevents
    // most of these, but it's still possible for narrow filtered subsets.
    const metric = this.store.filters().metric;
    if (metric === 'risk') {
      const r = this.store.risk();
      if (r.status === 'computing' || r.status === 'idle') return { kind: 'risk-loading' };
      if (r.status === 'error') return { kind: 'risk-error', message: r.message };
    }
    if (metric === 'churn') {
      const c = this.store.churn();
      if (c.status === 'pending') return { kind: 'churn-loading', done: 0, total: 0 };
      if (c.status === 'running') return { kind: 'churn-loading', done: c.done, total: c.total };
      if (c.status === 'error') return { kind: 'churn-error', message: c.message };
    }
    return { kind: 'no-data', metric };
  });

  clearFilters(): void {
    this.store.updateFilters({ name: '', path: '' });
  }

  constructor() {
    effect(() => {
      const root = this.store.filteredRoot();
      const metric = this.store.filters().metric;
      const w = this.width();
      const h = this.height();
      this.tiles.set(this.layout(root, metric, w, h));
    });
  }

  ngAfterViewInit(): void {
    const el = this.wrap.nativeElement;
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

  onHover(ev: MouseEvent, t: TileDatum): void {
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    this.tip.set({
      x,
      y,
      // Flip rather than let the pane squeeze the box: the widths here match the
      // tooltip's max-width and its typical height.
      flipX: x + TIP_WIDTH + TIP_GAP > rect.width,
      flipY: y + TIP_HEIGHT + TIP_GAP > rect.height,
      path: isFile(t.node) ? t.node.path : t.node.path + '/',
      loc: t.loc,
      complexity: t.complexity,
      churn: t.churn,
    });
  }

  onLeave(): void {
    this.tip.set(null);
  }

  onSelect(t: TileDatum): void {
    if (isFile(t.node)) this.store.selectPath(t.node.path);
  }

  onOpenAst(t: TileDatum): void {
    if (isFile(t.node)) this.tabs.openFile(t.node.path);
  }

  isSelected(t: TileDatum): boolean {
    return isFile(t.node) && this.store.selectedPath() === t.node.path;
  }

  private layout(root: DirNode | null, metric: DisplayMetric, w: number, h: number): TileDatum[] {
    if (!root || w <= 0 || h <= 0) {
      this.legend.set(null);
      return [];
    }

    const sumValue = (n: TreeNode): number => (isFile(n) ? Math.max(metricValue(n, metric), 0) : 0);

    const h0 = hierarchy<TreeNode>(root, (d) => (isDir(d) ? d.children : null))
      .sum(sumValue)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    if ((h0.value ?? 0) === 0) {
      this.legend.set(null);
      return [];
    }

    const tm = treemap<TreeNode>()
      .size([w, h])
      .paddingInner(1)
      .paddingTop((d) => (d.depth > 0 ? Math.min(12, Math.max(0, h * 0.01)) : 0))
      // Target tiles ~2.6:1 wide-to-tall so filenames fit on a single line. Default
      // is the golden ratio (~1.618) which yields visibly column-shaped tiles.
      .tile(treemapSquarify.ratio(2.6));

    tm(h0);

    let maxComplexity = 1;
    h0.each((n) => {
      if (isFile(n.data)) {
        const c = n.data.metrics.complexity ?? 0;
        if (c > maxComplexity) maxComplexity = c;
      }
    });
    const color = scaleSequential(interpolateYlOrRd).domain([0, maxComplexity]);

    // Publish a discretized version of the color scale for the legend.
    const stops: string[] = [];
    const STEPS = 12;
    for (let i = 0; i <= STEPS; i++) stops.push(color((i / STEPS) * maxComplexity));
    this.legend.set({ stops, min: 0, max: Math.round(maxComplexity) });

    const tiles: TileDatum[] = [];
    h0.leaves().forEach((n) => {
      const rect = n as HierarchyRectangularNode<TreeNode>;
      const width = rect.x1 - rect.x0;
      const height = rect.y1 - rect.y0;
      if (width <= 0 || height <= 0) return;
      const file = n.data;
      if (!isFile(file)) return;
      const complexity = file.metrics.complexity ?? 0;
      const loc = file.metrics.loc ?? 0;
      const fill = color(complexity);
      tiles.push({
        node: file,
        x: rect.x0,
        y: rect.y0,
        width,
        height,
        fill,
        textColor: textColorFor(fill),
        loc,
        complexity,
        churn: file.metrics.churn,
      });
    });
    return tiles;
  }
}

function textColorFor(fill: string): string {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(fill);
  if (!m) return '#000';
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#fafafa';
}
