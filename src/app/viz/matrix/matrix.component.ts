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
import { AnalysisStore } from '../../core/state/analysis.store';
import { ModuleGraphService } from '../../core/services/module-graph.service';

interface Cell {
  ri: number;
  ci: number;
  x: number;
  y: number;
  size: number;
}

@Component({
  selector: 'loco-dependency-matrix',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      @if (status() === 'idle' || status() === 'building') {
        <div class="status-overlay">
          @if (progress(); as p) {
            <div class="msg">
              Building dependency matrix…
              <div class="bar"><div class="fill" [style.width.%]="(p.done / p.total) * 100"></div></div>
              <div class="counts">{{ p.done }} / {{ p.total }}</div>
            </div>
          } @else {
            <div class="msg">Preparing matrix…</div>
          }
        </div>
      } @else if (status() === 'empty') {
        <div class="status-overlay">
          <div class="msg">No imports found. Matrix supports TS/TSX/JS/JSX and Python.</div>
        </div>
      } @else if (status() === 'ready') {
        <svg [attr.width]="width()" [attr.height]="height()">
          <g [attr.transform]="'translate(' + leftPad + ',' + topPad + ')'">
            <!-- background grid -->
            <rect
              [attr.width]="gridSize()"
              [attr.height]="gridSize()"
              fill="var(--input-bg)"
              stroke="var(--border)"
            />
            <!-- cells -->
            @for (cell of cells(); track cell.ri * 10000 + cell.ci) {
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
            <!-- highlight row/col -->
            @if (hoverCell(); as hc) {
              <rect
                [attr.x]="0"
                [attr.y]="hc.ri * cellSize()"
                [attr.width]="gridSize()"
                [attr.height]="cellSize()"
                fill="color-mix(in srgb, var(--accent) 12%, transparent)"
                pointer-events="none"
              />
              <rect
                [attr.x]="hc.ci * cellSize()"
                [attr.y]="0"
                [attr.width]="cellSize()"
                [attr.height]="gridSize()"
                fill="color-mix(in srgb, var(--accent) 12%, transparent)"
                pointer-events="none"
              />
            }
          </g>

          <!-- row labels -->
          <g [attr.transform]="'translate(' + (leftPad - 4) + ',' + topPad + ')'">
            @for (name of names(); track $index) {
              <text
                [attr.y]="$index * cellSize() + cellSize() / 2 + 3"
                text-anchor="end"
                font-size="9"
                fill="var(--fg)"
                [attr.opacity]="hoverCell()?.ri === $index ? 1 : 0.7"
              >
                {{ name }}
              </text>
            }
          </g>

          <!-- column labels -->
          <g [attr.transform]="'translate(' + leftPad + ',' + (topPad - 4) + ')'">
            @for (name of names(); track $index) {
              <text
                [attr.transform]="'translate(' + ($index * cellSize() + cellSize() / 2 + 3) + ',0) rotate(-60)'"
                text-anchor="start"
                font-size="9"
                fill="var(--fg)"
                [attr.opacity]="hoverCell()?.ci === $index ? 1 : 0.7"
              >
                {{ name }}
              </text>
            }
          </g>
        </svg>

        @if (hoverCell(); as hc) {
          <div class="tip">
            <div class="row"><span>row</span> <code>{{ paths()[hc.ri] }}</code></div>
            <div class="row"><span>col</span> <code>{{ paths()[hc.ci] }}</code></div>
            <div class="row">
              <span>edge</span>
              @if (hasEdge(hc.ri, hc.ci)) {
                <strong>row imports col</strong>
              } @else {
                <em>no</em>
              }
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
        overflow: auto;
      }
      .status-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
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
      .tip code {
        word-break: break-all;
      }
    `,
  ],
})
export class DependencyMatrixComponent implements AfterViewInit {
  private readonly store = inject(AnalysisStore);
  private readonly service = inject(ModuleGraphService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  readonly width = signal(0);
  readonly height = signal(0);
  readonly status = signal<'idle' | 'building' | 'empty' | 'ready'>('idle');
  readonly progress = this.service.building;
  readonly hoverCell = signal<{ ri: number; ci: number } | null>(null);

  readonly paths = signal<string[]>([]);
  readonly names = signal<string[]>([]);
  private adjacency = new Set<number>();

  readonly leftPad = 220;
  readonly topPad = 120;

  readonly cellSize = computed(() => {
    const n = this.paths().length;
    if (n === 0) return 0;
    const wAvail = Math.max(120, this.width() - this.leftPad - 12);
    const hAvail = Math.max(120, this.height() - this.topPad - 12);
    return Math.max(6, Math.min(24, Math.floor(Math.min(wAvail, hAvail) / n)));
  });

  readonly gridSize = computed(() => this.paths().length * this.cellSize());

  readonly cells = computed<Cell[]>(() => {
    const n = this.paths().length;
    const s = this.cellSize();
    if (n === 0 || s === 0) return [];
    const out: Cell[] = [];
    for (let ri = 0; ri < n; ri++) {
      for (let ci = 0; ci < n; ci++) {
        out.push({ ri, ci, x: ci * s, y: ri * s, size: s });
      }
    }
    return out;
  });

  private fullGraph: { nodes: { path: string }[]; edges: { from: string; to: string }[] } | null = null;

  constructor() {
    effect(() => {
      this.store.root();
      this.service.reset();
      this.fullGraph = null;
      this.paths.set([]);
      this.names.set([]);
      this.adjacency = new Set();
      this.status.set('idle');
    });

    effect(() => {
      const w = this.width();
      const h = this.height();
      const root = this.store.root();
      if (root && w > 0 && h > 0 && this.status() === 'idle') {
        this.kickoff();
      }
    });

    effect(() => {
      const filtered = this.store.filteredPaths();
      if (this.fullGraph && this.status() === 'ready') {
        this.applyFilter(filtered);
      }
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

  private async kickoff(): Promise<void> {
    this.status.set('building');
    const graph = await this.service.build();
    if (graph.nodes.length === 0) {
      this.status.set('empty');
      return;
    }
    this.fullGraph = { nodes: graph.nodes.map((n) => ({ path: n.path })), edges: graph.edges };
    this.applyFilter(this.store.filteredPaths());
    this.status.set('ready');
  }

  private applyFilter(filtered: ReadonlySet<string>): void {
    if (!this.fullGraph) return;
    const sorted = this.fullGraph.nodes
      .map((n) => n.path)
      .filter((p) => filtered.has(p))
      .sort((a, b) => a.localeCompare(b));
    const indexOf = new Map<string, number>();
    sorted.forEach((p, i) => indexOf.set(p, i));
    const n = sorted.length;
    const set = new Set<number>();
    for (const e of this.fullGraph.edges) {
      const ri = indexOf.get(e.from);
      const ci = indexOf.get(e.to);
      if (ri !== undefined && ci !== undefined) set.add(ri * n + ci);
    }
    this.adjacency = set;
    this.paths.set(sorted);
    this.names.set(sorted.map((p) => p.split('/').pop() ?? p));
  }

  cellFill(cell: Cell): string {
    if (cell.ri === cell.ci) return 'color-mix(in srgb, var(--fg) 18%, transparent)';
    const n = this.paths().length;
    if (this.adjacency.has(cell.ri * n + cell.ci)) return 'var(--accent)';
    return 'transparent';
  }

  hasEdge(ri: number, ci: number): boolean {
    return this.adjacency.has(ri * this.paths().length + ci);
  }

  onCellClick(cell: Cell): void {
    const path = this.paths()[cell.ri];
    if (path) this.store.selectPath(path);
  }
}
