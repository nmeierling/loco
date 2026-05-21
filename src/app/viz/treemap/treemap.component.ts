import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { HierarchyRectangularNode, hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { interpolateYlOrRd } from 'd3-scale-chromatic';
import { scaleSequential } from 'd3-scale';
import { AnalysisStore } from '../../core/state/analysis.store';
import { DirNode, MetricKind, TreeNode, isDir, isFile, metricValue } from '../../core/models/tree';

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
      @if (tiles().length === 0) {
        <div class="empty">Drop a folder to analyze.</div>
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
                [attr.stroke-width]="isSelected(t) ? 2 : (t.width > 4 && t.height > 4 ? 0.5 : 0)"
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
        <div class="tip" [style.left.px]="t.x" [style.top.px]="t.y">
          <div class="tip-path">{{ t.path }}</div>
          <div class="tip-row">LOC <strong>{{ t.loc }}</strong></div>
          <div class="tip-row">Complexity <strong>{{ t.complexity }}</strong></div>
          @if (t.churn !== null) {
            <div class="tip-row">Churn <strong>{{ t.churn }}</strong></div>
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
        padding: 1rem;
        opacity: 0.5;
        text-align: center;
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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  readonly width = signal(0);
  readonly height = signal(0);
  readonly tiles = signal<TileDatum[]>([]);
  readonly legend = signal<{ stops: string[]; min: number; max: number } | null>(null);
  readonly tip = signal<{ x: number; y: number; path: string; loc: number; complexity: number; churn: number | null } | null>(
    null,
  );

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
    this.tip.set({
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
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
    if (isFile(t.node)) {
      this.store.selectPath(t.node.path);
      this.router.navigate(['/ast']);
    }
  }

  isSelected(t: TileDatum): boolean {
    return isFile(t.node) && this.store.selectedPath() === t.node.path;
  }

  private layout(root: DirNode | null, metric: MetricKind, w: number, h: number): TileDatum[] {
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
