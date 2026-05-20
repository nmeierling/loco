import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force';
import { AstNode } from '../core/services/complexity.service';
import {
  CallGraph,
  CallGraphFunc,
  extractCallGraph,
  isCallGraphSupported,
} from '../core/services/call-graph';
import { AstSelectionService } from './ast-selection.service';

interface SimNode extends SimulationNodeDatum {
  id: string;
  data: CallGraphFunc;
  r: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}
interface RenderNode {
  id: string;
  cx: number;
  cy: number;
  r: number;
  fill: string;
  name: string;
  kind: CallGraphFunc['kind'];
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  inDeg: number;
  outDeg: number;
}
interface RenderLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

@Component({
  selector: 'loco-call-graph',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      @if (status() === 'unsupported') {
        <div class="placeholder">Call graph is available for TS/TSX/JS/JSX.</div>
      } @else if (status() === 'empty') {
        <div class="placeholder">No function declarations found in this file.</div>
      } @else if (status() === 'ready' && width() > 0 && height() > 0) {
        <svg [attr.width]="width()" [attr.height]="height()">
          <g>
            <g class="links">
              @for (l of links(); track $index) {
                <line
                  [attr.x1]="l.x1"
                  [attr.y1]="l.y1"
                  [attr.x2]="l.x2"
                  [attr.y2]="l.y2"
                  stroke="rgba(128,128,128,0.45)"
                  stroke-width="0.8"
                  marker-end="url(#cg-arrow)"
                />
              }
            </g>
            <g class="nodes">
              @for (n of nodes(); track n.id) {
                <g
                  [attr.transform]="'translate(' + n.cx + ',' + n.cy + ')'"
                  class="node"
                  (click)="onClick(n)"
                >
                  <circle
                    [attr.r]="n.r"
                    [attr.fill]="n.fill"
                    stroke="rgba(0,0,0,0.4)"
                    stroke-width="0.6"
                  />
                  <text
                    [attr.y]="n.r + 9"
                    text-anchor="middle"
                    font-size="10"
                    fill="var(--fg)"
                    pointer-events="none"
                  >
                    {{ n.name }}
                  </text>
                </g>
              }
            </g>
          </g>
          <defs>
            <marker
              id="cg-arrow"
              viewBox="0 -5 10 10"
              refX="10"
              refY="0"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,-3L10,0L0,3" fill="rgba(128,128,128,0.6)" />
            </marker>
          </defs>
        </svg>

        <div class="legend">
          <span class="dot" style="background:#3b82f6"></span>function
          &nbsp;
          <span class="dot" style="background:#f59e0b"></span>method
          &nbsp;
          <span class="dot" style="background:#10b981"></span>arrow
          &nbsp;
          <span class="dot" style="background:#9ca3af"></span>module
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
        min-height: 0;
      }
      .wrap {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      svg {
        display: block;
      }
      .node {
        cursor: pointer;
      }
      .placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.6;
        text-align: center;
        padding: 16px;
      }
      .legend {
        position: absolute;
        bottom: 6px;
        left: 8px;
        font-size: 11px;
        opacity: 0.7;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .legend .dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
    `,
  ],
})
export class CallGraphComponent implements AfterViewInit {
  private readonly selection = inject(AstSelectionService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  @Input({ required: true }) set ast(value: AstNode | null) {
    this._ast = value;
    this.updateGraph();
  }
  @Input({ required: true }) set languageId(value: string | null) {
    this._lang = value;
    this.updateGraph();
  }

  private _ast: AstNode | null = null;
  private _lang: string | null = null;
  private cgraph: CallGraph = { functions: [], edges: [] };

  readonly width = signal(0);
  readonly height = signal(0);
  readonly nodes = signal<RenderNode[]>([]);
  readonly links = signal<RenderLink[]>([]);
  readonly status = signal<'unsupported' | 'empty' | 'ready'>('unsupported');

  private sim: Simulation<SimNode, SimLink> | null = null;
  private simNodes: SimNode[] = [];
  private simLinks: SimLink[] = [];

  constructor() {
    effect(() => {
      const w = this.width();
      const h = this.height();
      if (w > 0 && h > 0 && this.status() === 'ready' && this.sim) {
        this.sim.force('center', forceCenter(w / 2, h / 2));
        this.sim.alpha(0.3).restart();
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
    this.destroyRef.onDestroy(() => {
      ro.disconnect();
      this.sim?.stop();
    });
  }

  private updateGraph(): void {
    if (!this._ast || !this._lang) {
      this.status.set('unsupported');
      return;
    }
    if (!isCallGraphSupported(this._lang)) {
      this.status.set('unsupported');
      return;
    }
    const cg = extractCallGraph(this._ast, this._lang);
    this.cgraph = cg;
    if (cg.functions.length === 0) {
      this.status.set('empty');
      return;
    }
    this.startSimulation(cg);
    this.status.set('ready');
  }

  private startSimulation(cg: CallGraph): void {
    this.sim?.stop();
    const w = Math.max(this.width(), 200);
    const h = Math.max(this.height(), 200);
    const maxDeg = Math.max(1, ...cg.functions.map((f) => f.inDegree + f.outDegree));
    this.simNodes = cg.functions.map((f) => ({
      id: f.id,
      data: f,
      r: 4 + Math.min(14, ((f.inDegree + f.outDegree) / maxDeg) * 10),
    }));
    this.simLinks = cg.edges.map((e) => ({ source: e.from, target: e.to }));

    const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(this.simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(this.simLinks)
          .id((d) => d.id)
          .distance(70)
          .strength(0.5),
      )
      .force('charge', forceManyBody<SimNode>().strength(-200))
      .force('center', forceCenter(w / 2, h / 2))
      .force('collide', forceCollide<SimNode>().radius((d) => d.r + 14))
      .alphaDecay(0.04);
    this.sim = sim;

    const tick = (): void => {
      const out: RenderNode[] = this.simNodes.map((sn) => ({
        id: sn.id,
        cx: sn.x ?? 0,
        cy: sn.y ?? 0,
        r: sn.r,
        fill: colorFor(sn.data.kind),
        name: sn.data.name,
        kind: sn.data.kind,
        startRow: sn.data.startRow,
        endRow: sn.data.endRow,
        startCol: sn.data.startCol,
        endCol: sn.data.endCol,
        inDeg: sn.data.inDegree,
        outDeg: sn.data.outDegree,
      }));
      const links: RenderLink[] = this.simLinks.map((l) => {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        return { x1: s.x ?? 0, y1: s.y ?? 0, x2: t.x ?? 0, y2: t.y ?? 0 };
      });
      this.nodes.set(out);
      this.links.set(links);
    };
    sim.on('tick', tick);
    sim.on('end', tick);
    tick();
  }

  onClick(n: RenderNode): void {
    this.selection.setRange({
      startRow: n.startRow,
      startCol: n.startCol,
      endRow: n.endRow,
      endCol: n.endCol,
    });
  }
}

function colorFor(kind: CallGraphFunc['kind']): string {
  switch (kind) {
    case 'function': return '#3b82f6';
    case 'method': return '#f59e0b';
    case 'arrow': return '#10b981';
    case 'module': return '#9ca3af';
  }
}
