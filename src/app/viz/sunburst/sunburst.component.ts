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
import { Router } from '@angular/router';
import {
  HierarchyRectangularNode,
  hierarchy,
  partition,
} from 'd3-hierarchy';
import { arc as d3arc } from 'd3-shape';
import { scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';
import { AnalysisStore } from '../../core/state/analysis.store';
import {
  DirNode,
  MetricKind,
  TreeNode,
  isDir,
  isFile,
  metricValue,
} from '../../core/models/tree';

interface Segment {
  path: string;
  d: string;
  fill: string;
  name: string;
  loc: number;
  isFile: boolean;
  midX: number;
  midY: number;
  showLabel: boolean;
}

@Component({
  selector: 'loco-sunburst',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      @if (segments().length === 0) {
        <div class="empty">No data to chart.</div>
      } @else {
        <svg [attr.width]="width()" [attr.height]="height()">
          <g [attr.transform]="'translate(' + width() / 2 + ',' + height() / 2 + ')'">
            @for (s of segments(); track s.path) {
              <path
                [attr.d]="s.d"
                [attr.fill]="s.fill"
                [attr.stroke]="selectedPath() === s.path ? 'var(--accent)' : 'rgba(0,0,0,0.3)'"
                [attr.stroke-width]="selectedPath() === s.path ? 1.6 : 0.4"
                (click)="onClick(s)"
                (dblclick)="onDblClick(s)"
                (mouseenter)="hover.set(s.path)"
                (mouseleave)="hover.set(null)"
                (mousemove)="onMove($event)"
              />
              @if (s.showLabel) {
                <text
                  [attr.x]="s.midX"
                  [attr.y]="s.midY"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  font-size="9"
                  fill="rgba(0,0,0,0.65)"
                  pointer-events="none"
                >
                  {{ s.name }}
                </text>
              }
            }
          </g>
        </svg>

        @if (hovered(); as h) {
          <div class="tip" [style.left.px]="tipPos().x" [style.top.px]="tipPos().y">
            <div class="tip-path">{{ h.path || '(root)' }}</div>
            <div class="tip-row">LOC <strong>{{ h.loc }}</strong></div>
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
      path {
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
        opacity: 0.8;
      }
    `,
  ],
})
export class SunburstComponent implements AfterViewInit {
  private readonly store = inject(AnalysisStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  readonly width = signal(0);
  readonly height = signal(0);
  readonly segments = signal<Segment[]>([]);
  readonly selectedPath = this.store.selectedPath;
  readonly hover = signal<string | null>(null);
  readonly tipPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  readonly hovered = computed<Segment | null>(() => {
    const id = this.hover();
    if (!id) return null;
    return this.segments().find((s) => s.path === id) ?? null;
  });

  constructor() {
    effect(() => {
      const root = this.store.filteredRoot();
      const metric = this.store.filters().metric;
      const w = this.width();
      const h = this.height();
      this.segments.set(this.layout(root, metric, w, h));
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

  onClick(s: Segment): void {
    if (s.isFile) this.store.selectPath(s.path);
  }

  onDblClick(s: Segment): void {
    if (s.isFile) {
      this.store.selectPath(s.path);
      this.router.navigate(['/ast']);
    }
  }

  onMove(ev: MouseEvent): void {
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    this.tipPos.set({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
  }

  private layout(
    root: DirNode | null,
    metric: MetricKind,
    w: number,
    h: number,
  ): Segment[] {
    if (!root || w <= 0 || h <= 0) return [];

    const sumValue = (n: TreeNode): number =>
      isFile(n) ? Math.max(metricValue(n, metric), 0) : 0;

    const h0 = hierarchy<TreeNode>(root, (d) =>
      isDir(d) ? d.children : null,
    )
      .sum(sumValue)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    if ((h0.value ?? 0) === 0) return [];

    const radius = Math.min(w, h) / 2 - 4;
    const part = partition<TreeNode>().size([2 * Math.PI, radius]);
    part(h0);

    const groups = new Set<string>();
    h0.each((n) => {
      const parent = parentDirOf(n.data.path);
      groups.add(parent);
    });
    const color = scaleOrdinal<string, string>()
      .domain([...groups])
      .range(schemeTableau10);

    const arcGen = d3arc<HierarchyRectangularNode<TreeNode>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => Math.max(d.y0, d.y1 - 1))
      .padAngle(0.002)
      .padRadius(radius / 2);

    const segments: Segment[] = [];
    h0.each((n) => {
      const rect = n as HierarchyRectangularNode<TreeNode>;
      if (rect.depth === 0) return;
      const d = arcGen(rect);
      if (!d) return;
      const arcWidth = rect.x1 - rect.x0;
      const ringWidth = rect.y1 - rect.y0;
      const showLabel = arcWidth > 0.08 && ringWidth > 14;
      const midAngle = (rect.x0 + rect.x1) / 2 - Math.PI / 2;
      const midRadius = (rect.y0 + rect.y1) / 2;
      segments.push({
        path: rect.data.path || '(root)',
        d,
        fill: color(parentDirOf(rect.data.path)),
        name: rect.data.name,
        loc: metricValue(rect.data, 'loc'),
        isFile: isFile(rect.data),
        midX: Math.cos(midAngle) * midRadius,
        midY: Math.sin(midAngle) * midRadius,
        showLabel,
      });
    });
    return segments;
  }
}

function parentDirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '(root)';
}
