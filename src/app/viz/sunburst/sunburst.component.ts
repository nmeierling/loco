import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TabsStore } from '../../core/state/tabs.store';
import { HierarchyRectangularNode, hierarchy, partition } from 'd3-hierarchy';
import { arc as d3arc } from 'd3-shape';
import { scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';
import { AnalysisStore } from '../../core/state/analysis.store';
import { deferredLayout } from '../../core/perf/deferred';
import { createSizeTracker } from '../../core/perf/schedule';
import { ViewSpinnerComponent } from '../../shell/view-spinner.component';
import {
  DirNode,
  DisplayMetric,
  TreeNode,
  fileCount,
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
  imports: [ViewSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      @if (building()) {
        <loco-view-spinner label="Laying out sunburst…" [detail]="buildingDetail()" />
      }
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
            <div class="tip-row">
              LOC <strong>{{ h.loc }}</strong>
            </div>
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
  private readonly tabs = inject(TabsStore);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  private readonly size = createSizeTracker();
  readonly width = this.size.width;
  readonly height = this.size.height;
  readonly selectedPath = this.store.selectedPath;

  /** Ring geometry — one arc path string per node, so it is well worth deferring. */
  private readonly view = deferredLayout({
    inputs: () => ({
      root: this.store.filteredRoot(),
      metric: this.store.metric(),
      w: this.size.settledWidth(),
      h: this.size.settledHeight(),
    }),
    build: ({ root, metric, w, h }) => this.layout(root, metric, w, h),
    initial: [] as Segment[],
    weight: ({ root }) => (root ? fileCount(root) : 0),
  });

  readonly segments = this.view.value;
  readonly building = this.view.building;
  readonly buildingDetail = computed(() => {
    const root = this.store.filteredRoot();
    const n = root ? fileCount(root) : 0;
    return n > 0 ? `${n.toLocaleString()} files` : null;
  });
  readonly hover = signal<string | null>(null);
  readonly tipPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  readonly hovered = computed<Segment | null>(() => {
    const id = this.hover();
    if (!id) return null;
    return this.segments().find((s) => s.path === id) ?? null;
  });

  ngAfterViewInit(): void {
    this.size.attach(this.wrap.nativeElement, this.destroyRef);
  }

  onClick(s: Segment): void {
    if (s.isFile) this.store.selectPath(s.path);
  }

  onDblClick(s: Segment): void {
    if (s.isFile) this.tabs.openFile(s.path);
  }

  onMove(ev: MouseEvent): void {
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    this.tipPos.set({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
  }

  private layout(root: DirNode | null, metric: DisplayMetric, w: number, h: number): Segment[] {
    if (!root || w <= 0 || h <= 0) return [];

    const sumValue = (n: TreeNode): number => (isFile(n) ? Math.max(metricValue(n, metric), 0) : 0);

    const h0 = hierarchy<TreeNode>(root, (d) => (isDir(d) ? d.children : null))
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
