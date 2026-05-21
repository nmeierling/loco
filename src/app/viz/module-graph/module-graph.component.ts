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
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force';
import { scaleOrdinal } from 'd3-scale';
import { schemeTableau10 } from 'd3-scale-chromatic';
import { AnalysisStore } from '../../core/state/analysis.store';
import { GraphEdge, GraphNode, ModuleGraphService } from '../../core/services/module-graph.service';

interface SimNode extends SimulationNodeDatum {
  id: string;
  data: GraphNode;
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
  color: string;
  textColor: string;
  name: string;
  path: string;
  loc: number;
  inDeg: number;
  outDeg: number;
}

interface RenderLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  highlighted: boolean;
}

@Component({
  selector: 'loco-module-graph',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      @if (status() === 'idle' || status() === 'building') {
        <div class="status-overlay">
          @if (progress(); as p) {
            <div class="msg">
              Building module graph…
              <div class="bar"><div class="fill" [style.width.%]="(p.done / p.total) * 100"></div></div>
              <div class="counts">{{ p.done }} / {{ p.total }}</div>
            </div>
          } @else {
            <div class="msg">Preparing module graph…</div>
          }
        </div>
      } @else if (status() === 'empty') {
        <div class="status-overlay">
          <div class="msg">
            No module imports found in this project. Module graph supports TS/TSX/JS/JSX and Python.
          </div>
        </div>
      } @else if (status() === 'ready' && width() > 0 && height() > 0) {
        <svg
          [attr.width]="width()"
          [attr.height]="height()"
          (wheel)="onWheel($event)"
          (mousedown)="onPanStart($event)"
        >
          <g [attr.transform]="'translate(' + tx() + ',' + ty() + ') scale(' + zoom() + ')'">
            <g class="links">
              @for (l of links(); track $index) {
                <line
                  [attr.x1]="l.x1"
                  [attr.y1]="l.y1"
                  [attr.x2]="l.x2"
                  [attr.y2]="l.y2"
                  [attr.stroke]="l.highlighted ? 'var(--accent)' : 'rgba(128,128,128,0.35)'"
                  [attr.stroke-width]="l.highlighted ? 1.5 : 0.6"
                  marker-end="url(#arrow)"
                />
              }
            </g>
            <g class="nodes">
              @for (n of nodes(); track n.id) {
                <g
                  [attr.transform]="'translate(' + n.cx + ',' + n.cy + ')'"
                  class="node"
                  [class.selected]="n.id === selectedPath()"
                  (click)="onClick(n)"
                  (dblclick)="onDblClick(n)"
                  (mouseenter)="hover.set(n.id)"
                  (mouseleave)="hover.set(null)"
                >
                  <circle
                    [attr.r]="n.r"
                    [attr.fill]="n.color"
                    [attr.stroke]="n.id === selectedPath() ? 'var(--accent)' : 'rgba(0,0,0,0.4)'"
                    [attr.stroke-width]="n.id === selectedPath() ? 2 : 0.5"
                  />
                  @if (n.r >= 6) {
                    <text
                      [attr.y]="n.r + 9"
                      text-anchor="middle"
                      font-size="9"
                      [attr.fill]="'var(--fg)'"
                      pointer-events="none"
                    >
                      {{ n.name }}
                    </text>
                  }
                </g>
              }
            </g>
          </g>
          <defs>
            <marker
              id="arrow"
              viewBox="0 -5 10 10"
              refX="10"
              refY="0"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,-3L10,0L0,3" fill="rgba(128,128,128,0.55)" />
            </marker>
          </defs>
        </svg>

        @if (minimap(); as mm) {
          <svg
            class="minimap"
            [attr.width]="mm.w"
            [attr.height]="mm.h"
            (mousedown)="onMinimapDown($event)"
          >
            <rect width="100%" height="100%" rx="4" fill="var(--bar-bg)" stroke="var(--border)" />
            <g [attr.transform]="'translate(' + mm.offX + ',' + mm.offY + ')'">
              @for (mn of mm.nodes; track mn.id) {
                <circle
                  [attr.cx]="mn.x"
                  [attr.cy]="mn.y"
                  [attr.r]="mn.r"
                  [attr.fill]="mn.fill"
                  fill-opacity="0.7"
                />
              }
            </g>
            <rect
              class="vp"
              [attr.x]="mm.vpX"
              [attr.y]="mm.vpY"
              [attr.width]="mm.vpW"
              [attr.height]="mm.vpH"
              fill="rgba(0,0,0,0)"
              stroke="var(--accent)"
              stroke-width="1.2"
              pointer-events="none"
            />
          </svg>
        }
      }

      @if (hovered(); as h) {
        <div class="tip" [style.left.px]="tipPos().x" [style.top.px]="tipPos().y">
          <div class="tip-path">{{ h.path }}</div>
          <div class="tip-row">in <strong>{{ h.inDeg }}</strong> &nbsp; out <strong>{{ h.outDeg }}</strong></div>
          <div class="tip-row">LOC <strong>{{ h.loc }}</strong></div>
        </div>
      }

      <div class="legend">
        <span>· click: select  · dbl-click: open AST  · scroll: zoom  · drag: pan</span>
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
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        cursor: grab;
      }
      .wrap:active {
        cursor: grabbing;
      }
      svg {
        display: block;
      }
      .node {
        cursor: pointer;
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
        transition: width 0.1s;
      }
      .counts {
        margin-top: 4px;
        opacity: 0.6;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
        gap: 12px;
        opacity: 0.8;
      }
      .legend {
        position: absolute;
        bottom: 6px;
        left: 8px;
        font-size: 10px;
        opacity: 0.55;
        pointer-events: none;
      }
      .minimap {
        position: absolute;
        right: 10px;
        bottom: 10px;
        border-radius: 4px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
        cursor: pointer;
        z-index: 9;
      }
      .minimap:hover .vp {
        stroke-width: 1.6;
      }
    `,
  ],
})
export class ModuleGraphComponent implements AfterViewInit {
  private readonly store = inject(AnalysisStore);
  private readonly service = inject(ModuleGraphService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  readonly width = signal(0);
  readonly height = signal(0);
  readonly tx = signal(0);
  readonly ty = signal(0);
  readonly zoom = signal(1);

  readonly nodes = signal<RenderNode[]>([]);
  readonly links = signal<RenderLink[]>([]);
  readonly status = signal<'idle' | 'building' | 'empty' | 'ready'>('idle');
  readonly progress = this.service.building;
  readonly hover = signal<string | null>(null);
  readonly selectedPath = this.store.selectedPath;

  readonly hovered = computed<RenderNode | null>(() => {
    const id = this.hover();
    if (!id) return null;
    return this.nodes().find((n) => n.id === id) ?? null;
  });
  readonly tipPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  private readonly MINIMAP_W = 200;
  private readonly MINIMAP_H = 140;
  private readonly MINIMAP_PAD = 8;

  /**
   * Bounding box of the simulation nodes only. Used both as the minimap's natural
   * extent and as the clamp box for minimap drags — so the viewport rectangle stops
   * at the border instead of pushing it outwards (which used to make the minimap
   * rescale and visually shrink).
   */
  private readonly nodeBounds = computed<
    { minX: number; minY: number; maxX: number; maxY: number } | null
  >(() => {
    const ns = this.nodes();
    if (ns.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of ns) {
      if (n.cx < minX) minX = n.cx;
      if (n.cy < minY) minY = n.cy;
      if (n.cx > maxX) maxX = n.cx;
      if (n.cy > maxY) maxY = n.cy;
    }
    return { minX, minY, maxX, maxY };
  });

  readonly minimap = computed(() => {
    const w = this.width();
    const h = this.height();
    const nodeB = this.nodeBounds();
    const ns = this.nodes();
    if (!nodeB || w === 0 || h === 0) return null;

    let { minX, minY, maxX, maxY } = nodeB;
    // Include current viewport in the bounds so the rectangle never escapes the minimap
    // — useful when the user has used main-view drag or wheel zoom to look at empty
    // space outside the graph. (Minimap drag itself is clamped to nodeBounds.)
    const z = this.zoom();
    const tx = this.tx();
    const ty = this.ty();
    const gx0 = -tx / z;
    const gy0 = -ty / z;
    const gx1 = gx0 + w / z;
    const gy1 = gy0 + h / z;
    if (gx0 < minX) minX = gx0;
    if (gy0 < minY) minY = gy0;
    if (gx1 > maxX) maxX = gx1;
    if (gy1 > maxY) maxY = gy1;

    const gw = Math.max(1, maxX - minX);
    const gh = Math.max(1, maxY - minY);
    const innerW = this.MINIMAP_W - 2 * this.MINIMAP_PAD;
    const innerH = this.MINIMAP_H - 2 * this.MINIMAP_PAD;
    const scale = Math.min(innerW / gw, innerH / gh);
    const offX = this.MINIMAP_PAD - minX * scale;
    const offY = this.MINIMAP_PAD - minY * scale;

    return {
      w: this.MINIMAP_W,
      h: this.MINIMAP_H,
      offX,
      offY,
      scale,
      nodes: ns.map((n) => ({
        id: n.id,
        x: n.cx * scale,
        y: n.cy * scale,
        r: Math.max(1, n.r * scale * 0.6),
        fill: n.color,
      })),
      vpX: gx0 * scale + offX,
      vpY: gy0 * scale + offY,
      vpW: (w / z) * scale,
      vpH: (h / z) * scale,
    };
  });

  private simulation: Simulation<SimNode, SimLink> | null = null;
  private simNodes: SimNode[] = [];
  private simLinks: SimLink[] = [];
  private rafHandle = 0;

  private fullGraph: { nodes: GraphNode[]; edges: GraphEdge[] } | null = null;

  constructor() {
    effect(() => {
      // React when project root changes — invalidate graph
      this.store.root();
      this.service.reset();
      this.fullGraph = null;
      this.nodes.set([]);
      this.links.set([]);
      this.status.set('idle');
    });

    effect(() => {
      // When width/height become available and we have a project, build (once).
      const w = this.width();
      const h = this.height();
      const root = this.store.root();
      if (root && w > 0 && h > 0 && this.status() === 'idle') {
        this.kickoff();
      }
    });

    effect(() => {
      // Re-render whenever the project-wide path/name/user-ignore filter changes.
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
      // Re-center simulation when size changes
      if (this.simulation && this.width() > 0 && this.height() > 0) {
        this.simulation.force('center', forceCenter(this.width() / 2, this.height() / 2));
        this.simulation.alpha(0.3).restart();
      }
    });
    ro.observe(el);

    this.wrap.nativeElement.addEventListener('mousemove', this.trackPointer);

    this.destroyRef.onDestroy(() => {
      ro.disconnect();
      this.wrap.nativeElement.removeEventListener('mousemove', this.trackPointer);
      this.simulation?.stop();
      cancelAnimationFrame(this.rafHandle);
    });
  }

  private async kickoff(): Promise<void> {
    this.status.set('building');
    const graph = await this.service.build();
    if (graph.nodes.length === 0) {
      this.status.set('empty');
      return;
    }
    this.fullGraph = { nodes: graph.nodes, edges: graph.edges };
    this.applyFilter(this.store.filteredPaths());
    this.status.set('ready');
  }

  private applyFilter(filtered: ReadonlySet<string>): void {
    if (!this.fullGraph) return;
    const nodes = this.fullGraph.nodes.filter((n) => filtered.has(n.path));
    const keep = new Set(nodes.map((n) => n.path));
    const edges = this.fullGraph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    if (nodes.length === 0) {
      this.simulation?.stop();
      this.nodes.set([]);
      this.links.set([]);
      return;
    }
    this.startSimulation(nodes, edges);
  }

  private startSimulation(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.simulation?.stop();
    const w = this.width();
    const h = this.height();
    const groups = Array.from(new Set(nodes.map((n) => n.group)));
    const color = scaleOrdinal<string, string>().domain(groups).range(schemeTableau10);
    const maxLoc = Math.max(1, ...nodes.map((n) => n.loc));

    this.simNodes = nodes.map((n) => ({
      id: n.path,
      data: n,
      r: Math.max(3, Math.min(18, 3 + Math.sqrt(n.loc / Math.max(1, maxLoc)) * 14)),
    }));
    this.simLinks = edges.map((e) => ({ source: e.from, target: e.to }));

    const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(this.simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(this.simLinks)
          .id((d) => d.id)
          .distance(70)
          .strength(0.5),
      )
      .force('charge', forceManyBody<SimNode>().strength(-260))
      .force('center', forceCenter(w / 2, h / 2))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => d.r + 18),
      )
      .alphaDecay(0.025);
    this.simulation = sim;

    const tick = () => {
      const nodesOut: RenderNode[] = this.simNodes.map((sn) => ({
        id: sn.id,
        cx: sn.x ?? 0,
        cy: sn.y ?? 0,
        r: sn.r,
        color: color(sn.data.group),
        textColor: 'var(--fg)',
        name: sn.data.name,
        path: sn.data.path,
        loc: sn.data.loc,
        inDeg: sn.data.inDegree,
        outDeg: sn.data.outDegree,
      }));
      const sel = this.selectedPath();
      const linksOut: RenderLink[] = this.simLinks.map((l) => {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        const highlighted = sel != null && (s.id === sel || t.id === sel);
        return { x1: s.x ?? 0, y1: s.y ?? 0, x2: t.x ?? 0, y2: t.y ?? 0, highlighted };
      });
      this.nodes.set(nodesOut);
      this.links.set(linksOut);
    };
    sim.on('tick', tick);
    sim.on('end', tick);
    tick();
  }

  private trackPointer = (e: MouseEvent) => {
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    this.tipPos.set({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  onClick(n: RenderNode): void {
    this.store.selectPath(n.id);
  }

  onDblClick(n: RenderNode): void {
    this.store.selectPath(n.id);
    this.router.navigate(['/ast']);
  }

  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const z0 = this.zoom();
    const z1 = Math.max(0.2, Math.min(5, z0 * factor));
    // Keep cursor anchored
    this.tx.set(mx - ((mx - this.tx()) * z1) / z0);
    this.ty.set(my - ((my - this.ty()) * z1) / z0);
    this.zoom.set(z1);
  }

  onMinimapDown(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    const svg = ev.currentTarget as SVGSVGElement;
    const center = (e: MouseEvent) => {
      const mm = this.minimap();
      const bounds = this.nodeBounds();
      if (!mm || !bounds) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const gx = (mx - mm.offX) / mm.scale;
      const gy = (my - mm.offY) / mm.scale;
      const z = this.zoom();
      const vw = this.width() / z;
      const vh = this.height() / z;

      // Compute target viewport top-left (cursor centers the viewport)…
      let gx0 = gx - vw / 2;
      let gy0 = gy - vh / 2;

      // …then clamp so the rectangle stops at the node bounds instead of pushing
      // the minimap to rescale. If the viewport is larger than the graph extent,
      // center the rectangle on that axis.
      const gW = bounds.maxX - bounds.minX;
      const gH = bounds.maxY - bounds.minY;
      if (vw >= gW) {
        gx0 = bounds.minX + (gW - vw) / 2;
      } else {
        gx0 = Math.max(bounds.minX, Math.min(bounds.maxX - vw, gx0));
      }
      if (vh >= gH) {
        gy0 = bounds.minY + (gH - vh) / 2;
      } else {
        gy0 = Math.max(bounds.minY, Math.min(bounds.maxY - vh, gy0));
      }

      this.tx.set(-gx0 * z);
      this.ty.set(-gy0 * z);
    };
    center(ev);
    const onMove = (e: MouseEvent) => center(e);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  onPanStart(ev: MouseEvent): void {
    if ((ev.target as Element).tagName.toLowerCase() === 'circle' || (ev.target as Element).tagName.toLowerCase() === 'text') return;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startTx = this.tx();
    const startTy = this.ty();
    const onMove = (e: MouseEvent) => {
      this.tx.set(startTx + (e.clientX - startX));
      this.ty.set(startTy + (e.clientY - startY));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
}
