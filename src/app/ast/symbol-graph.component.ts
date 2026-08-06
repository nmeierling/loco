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
  input,
  signal,
} from '@angular/core';
import {
  Simulation,
  SimulationNodeDatum,
  forceCollide,
  forceManyBody,
  forceSimulation,
  forceY,
} from 'd3-force';
import {
  SymbolDef,
  SymbolGraph,
  SymbolIndexService,
  parentFolder,
} from '../core/services/symbol-index.service';
import { isSymbolIndexSupported } from '../core/services/symbols';
import { AstSelectionService } from './ast-selection.service';

interface SimNode extends SimulationNodeDatum {
  id: string;
  def: SymbolDef;
  r: number;
}
interface RenderNode {
  id: string;
  cx: number;
  cy: number;
  r: number;
  fill: string;
  label: string;
  current: boolean;
  focused: boolean;
}
interface RenderLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Cap on drawn nodes — a folder seed on a hot module can fan out fast. */
const MAX_NODES = 400;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const MINIMAP_W = 190;
const MINIMAP_H = 130;
const MINIMAP_PAD = 8;

@Component({
  selector: 'loco-symbol-graph',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Graph scope">
          <button type="button" [class.on]="scope() === 'file'" (click)="scope.set('file')">
            File
          </button>
          <button type="button" [class.on]="scope() === 'folder'" (click)="scope.set('folder')">
            Folder
          </button>
        </div>
        @if (status() === 'ready') {
          <div class="seg zoomctl" role="group" aria-label="Zoom">
            <button type="button" (click)="zoomBy(1 / 1.2)" title="Zoom out">−</button>
            <button type="button" (click)="fitView()" title="Fit graph to view">Fit</button>
            <button type="button" (click)="zoomBy(1.2)" title="Zoom in">+</button>
          </div>
          <span class="hint">{{ nodes().length }} symbols · click to expand · drag to move</span>
        }
      </div>

      @if (status() === 'unsupported') {
        <div class="placeholder">
          The usage graph is available for TypeScript, TSX, JavaScript, JSX, Kotlin and Java files.
        </div>
      } @else if (status() === 'building') {
        <div class="placeholder">Indexing symbols across the repo…</div>
      } @else if (status() === 'empty') {
        <div class="placeholder">No calls or usages involve the symbols in this {{ scope() }}.</div>
      } @else if (status() === 'ready' && width() > 0 && height() > 0) {
        <svg
          [attr.width]="width()"
          [attr.height]="height()"
          [class.grabbing]="panning()"
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
                  stroke="rgba(128,128,128,0.4)"
                  stroke-width="0.9"
                  marker-end="url(#sg-arrow)"
                />
              }
            </g>
            <g class="nodes">
              @for (n of nodes(); track n.id) {
                <g
                  [attr.transform]="'translate(' + n.cx + ',' + n.cy + ')'"
                  class="node"
                  (mousedown)="onNodeDown($event, n)"
                  (click)="onClick(n)"
                >
                  <circle
                    [attr.r]="n.r"
                    [attr.fill]="n.fill"
                    [attr.stroke]="n.current ? 'var(--fg)' : 'rgba(0,0,0,0.4)'"
                    [attr.stroke-width]="n.current ? 1.6 : 0.6"
                    [attr.opacity]="n.focused ? 1 : 0.85"
                  />
                  <text
                    [attr.y]="n.r + 9"
                    text-anchor="middle"
                    font-size="10"
                    fill="var(--fg)"
                    pointer-events="none"
                  >
                    {{ n.label }}
                  </text>
                </g>
              }
            </g>
          </g>
          <defs>
            <marker
              id="sg-arrow"
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

        @if (minimap(); as mm) {
          <svg class="minimap" [attr.width]="mm.w" [attr.height]="mm.h" (mousedown)="onMinimapDown($event)">
            <rect width="100%" height="100%" rx="4" fill="var(--bar-bg)" stroke="var(--border)" />
            <g [attr.transform]="'translate(' + mm.offX + ',' + mm.offY + ')'">
              @for (mn of mm.nodes; track mn.id) {
                <circle [attr.cx]="mn.x" [attr.cy]="mn.y" [attr.r]="mn.r" [attr.fill]="mn.fill" fill-opacity="0.7" />
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

        <div class="legend">
          <span class="dot" style="background:#3b82f6"></span>type &nbsp;
          <span class="dot" style="background:#f59e0b"></span>function/method &nbsp;
          <span class="dot" style="background:#10b981"></span>value &nbsp;
          <span class="ring"></span>this file
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
      .toolbar {
        position: absolute;
        top: 6px;
        left: 8px;
        right: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 1;
      }
      .seg {
        display: inline-flex;
        border: 1px solid var(--border, rgba(128, 128, 128, 0.35));
        border-radius: 6px;
        overflow: hidden;
        background: var(--bar-bg);
      }
      .seg button {
        border: 0;
        background: transparent;
        color: var(--fg);
        font: inherit;
        font-size: 11px;
        padding: 2px 10px;
        cursor: pointer;
      }
      .seg button + button {
        border-left: 1px solid var(--border, rgba(128, 128, 128, 0.35));
      }
      .seg button.on {
        background: var(--accent, #3b82f6);
        color: #fff;
      }
      .seg button:hover:not(.on) {
        background: var(--hover);
      }
      .zoomctl button {
        min-width: 26px;
        font-variant-numeric: tabular-nums;
      }
      .hint {
        font-size: 11px;
        opacity: 0.6;
      }
      svg {
        display: block;
      }
      svg:not(.minimap) {
        cursor: grab;
      }
      svg.grabbing {
        cursor: grabbing;
      }
      .node {
        cursor: grab;
      }
      .node:active {
        cursor: grabbing;
      }
      .minimap {
        position: absolute;
        right: 8px;
        bottom: 8px;
        cursor: crosshair;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.2);
        border-radius: 4px;
      }
      .placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.6;
        text-align: center;
        padding: 24px 16px 16px;
      }
      .legend {
        position: absolute;
        bottom: 6px;
        left: 8px;
        font-size: 11px;
        opacity: 0.75;
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
      .legend .ring {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        border: 1.6px solid var(--fg);
        margin-left: 6px;
      }
    `,
  ],
})
export class SymbolGraphComponent implements AfterViewInit {
  private readonly index = inject(SymbolIndexService);
  private readonly selection = inject(AstSelectionService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  readonly path = input.required<string>();
  readonly languageId = input.required<string | null>();

  readonly scope = signal<'file' | 'folder'>('file');
  /** Symbols whose neighbourhood is shown; grows as the user clicks nodes. */
  private readonly focused = signal<ReadonlySet<string>>(new Set());

  readonly width = signal(0);
  readonly height = signal(0);
  readonly nodes = signal<RenderNode[]>([]);
  readonly links = signal<RenderLink[]>([]);

  // Viewport transform for pan/zoom.
  readonly tx = signal(0);
  readonly ty = signal(0);
  readonly zoom = signal(1);
  readonly panning = signal(false);

  readonly supported = computed(() => isSymbolIndexSupported(this.languageId()));
  private readonly ready = computed(() => this.index.index() !== null);

  /** The subgraph for the current focus set; recomputed when focus or the index changes. */
  private readonly graph = computed<SymbolGraph>(() => {
    if (!this.ready()) return { nodes: [], edges: [] };
    return this.index.subgraph(this.focused());
  });

  readonly status = computed<'unsupported' | 'building' | 'empty' | 'ready'>(() => {
    if (!this.supported()) return 'unsupported';
    if (!this.ready() || this.index.building()) return 'building';
    return this.graph().nodes.length === 0 ? 'empty' : 'ready';
  });

  private sim: Simulation<SimNode, undefined> | null = null;
  private simNodes: SimNode[] = [];
  private simEdges: { from: string; to: string }[] = [];
  /** Prior node positions, so an expansion doesn't scramble the existing layout. */
  private lastPos = new Map<string, { x: number; y: number }>();
  /** Positions the user dragged a node to — kept pinned across re-layouts. */
  private pinned = new Map<string, { x: number; y: number }>();
  /** Fit the view once after the next reseed settles (not on incremental expansion). */
  private pendingFit = false;
  /** Set when a mousedown turned into a drag, so the trailing click doesn't expand. */
  private justDragged = false;

  private readonly nodeBounds = computed(() => {
    const ns = this.nodes();
    if (ns.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of ns) {
      minX = Math.min(minX, n.cx - n.r);
      minY = Math.min(minY, n.cy - n.r);
      maxX = Math.max(maxX, n.cx + n.r);
      maxY = Math.max(maxY, n.cy + n.r);
    }
    return { minX, minY, maxX, maxY };
  });

  readonly minimap = computed(() => {
    const w = this.width();
    const h = this.height();
    const nodeB = this.nodeBounds();
    const ns = this.nodes();
    if (!nodeB || w === 0 || h === 0 || ns.length < 2) return null;

    let { minX, minY, maxX, maxY } = nodeB;
    // Grow the extent to include the current viewport so its rectangle never escapes.
    const z = this.zoom();
    const gx0 = -this.tx() / z;
    const gy0 = -this.ty() / z;
    const gx1 = gx0 + w / z;
    const gy1 = gy0 + h / z;
    minX = Math.min(minX, gx0);
    minY = Math.min(minY, gy0);
    maxX = Math.max(maxX, gx1);
    maxY = Math.max(maxY, gy1);

    const gw = Math.max(1, maxX - minX);
    const gh = Math.max(1, maxY - minY);
    const innerW = MINIMAP_W - 2 * MINIMAP_PAD;
    const innerH = MINIMAP_H - 2 * MINIMAP_PAD;
    const scale = Math.min(innerW / gw, innerH / gh);
    const offX = MINIMAP_PAD - minX * scale;
    const offY = MINIMAP_PAD - minY * scale;

    return {
      w: MINIMAP_W,
      h: MINIMAP_H,
      offX,
      offY,
      scale,
      nodes: ns.map((n) => ({
        id: n.id,
        x: n.cx * scale,
        y: n.cy * scale,
        r: Math.max(1, n.r * scale * 0.7),
        fill: n.fill,
      })),
      vpX: gx0 * scale + offX,
      vpY: gy0 * scale + offY,
      vpW: (w / z) * scale,
      vpH: (h / z) * scale,
    };
  });

  constructor() {
    // Build the index lazily, and rebuild when a new project loads.
    effect(() => {
      this.path();
      if (this.supported()) void this.index.build();
    });

    // Reseed when the file, scope, or index changes. Reads none of `focused`, so it
    // does not fight the user's expansion clicks.
    effect(() => {
      const idx = this.index.index();
      const path = this.path();
      const scope = this.scope();
      if (!idx || !this.supported()) return;
      const paths =
        scope === 'file'
          ? [path]
          : [...idx.defsByPath.keys()].filter((p) => parentFolder(p) === parentFolder(path));
      this.lastPos.clear();
      this.pinned.clear();
      this.pendingFit = true;
      this.focused.set(new Set(this.index.seed(paths)));
    });

    // (Re)build the layered layout whenever the drawn graph or the pane size changes.
    effect(() => {
      const g = this.graph();
      const w = this.width();
      const h = this.height();
      if (this.status() === 'ready' && w > 0 && h > 0) this.startSimulation(g);
      else this.stopSim();
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

  private stopSim(): void {
    this.sim?.stop();
    this.sim = null;
    this.nodes.set([]);
    this.links.set([]);
  }

  private startSimulation(graph: SymbolGraph): void {
    this.sim?.stop();
    // Remember where nodes were before we rebuild, so an expansion keeps rows steady.
    for (const sn of this.simNodes) {
      if (sn.y != null) this.lastPos.set(sn.id, { x: sn.x ?? 0, y: sn.y });
    }

    const drawn = graph.nodes.slice(0, MAX_NODES);
    const visible = new Set(drawn.map((d) => d.id));
    const edges = graph.edges.filter((e) => visible.has(e.from) && visible.has(e.to));
    const focused = this.focused();
    const here = this.path();
    const w = Math.max(this.width(), 200);
    const h = Math.max(this.height(), 200);

    // Layer nodes into columns by call depth (longest path), so callers sit to the left
    // of what they call. Bounded relaxation terminates even if a mutual-call cycle slips
    // through. This is what makes the layout read linearly rather than as a blob.
    const layer = new Map<string, number>();
    for (const d of drawn) layer.set(d.id, 0);
    for (let i = 0; i < drawn.length; i++) {
      let changed = false;
      for (const e of edges) {
        const next = (layer.get(e.from) ?? 0) + 1;
        if (next > (layer.get(e.to) ?? 0)) {
          layer.set(e.to, next);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const maxLayer = Math.max(0, ...layer.values());
    const marginX = 64;
    const colX = (l: number): number =>
      maxLayer === 0 ? w / 2 : marginX + (l * (w - 2 * marginX)) / maxLayer;

    const deg = new Map<string, number>();
    for (const e of edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
    }
    const maxDeg = Math.max(1, ...deg.values());
    const layerCounts = new Map<number, number>();
    for (const d of drawn) {
      const l = layer.get(d.id) ?? 0;
      layerCounts.set(l, (layerCounts.get(l) ?? 0) + 1);
    }

    // x is pinned to the node's column (fx); only y is free, so columns stay crisp — unless
    // the user dragged the node, in which case both axes stay wherever they dropped it.
    const seenInLayer = new Map<number, number>();
    this.simNodes = drawn.map((def) => {
      const l = layer.get(def.id) ?? 0;
      const rank = seenInLayer.get(l) ?? 0;
      seenInLayer.set(l, rank + 1);
      const pin = this.pinned.get(def.id);
      if (pin) {
        return { id: def.id, def, r: nodeRadius(deg.get(def.id) ?? 0, maxDeg), fx: pin.x, fy: pin.y, x: pin.x, y: pin.y };
      }
      const x = colX(l);
      const prev = this.lastPos.get(def.id);
      return {
        id: def.id,
        def,
        r: nodeRadius(deg.get(def.id) ?? 0, maxDeg),
        fx: x,
        x,
        y: prev?.y ?? (h * (rank + 1)) / ((layerCounts.get(l) ?? 1) + 1),
      };
    });
    this.simEdges = edges;
    const nodeById = new Map(this.simNodes.map((n) => [n.id, n]));

    const sim = forceSimulation<SimNode>(this.simNodes)
      .force('y', forceY<SimNode>(h / 2).strength(0.03))
      .force('charge', forceManyBody<SimNode>().strength(-80))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => d.r + 16),
      )
      .alphaDecay(0.06);
    this.sim = sim;

    const tick = (): void => {
      this.nodes.set(
        this.simNodes.map((sn) => ({
          id: sn.id,
          cx: sn.x ?? 0,
          cy: sn.y ?? 0,
          r: sn.r,
          fill: colorFor(sn.def),
          label: labelFor(sn.def),
          current: sn.def.path === here,
          focused: focused.has(sn.id),
        })),
      );
      this.links.set(
        this.simEdges.map((e) => {
          const s = nodeById.get(e.from);
          const t = nodeById.get(e.to);
          return { x1: s?.x ?? 0, y1: s?.y ?? 0, x2: t?.x ?? 0, y2: t?.y ?? 0 };
        }),
      );
    };
    sim.on('tick', tick);
    sim.on('end', () => {
      tick();
      if (this.pendingFit) {
        this.pendingFit = false;
        this.fitView();
      }
    });
    tick();
  }

  onClick(n: RenderNode): void {
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }
    const def = this.index.index()?.defsById.get(n.id);
    if (!def) return;
    // Expand this node's neighbourhood…
    const next = new Set(this.focused());
    next.add(n.id);
    this.focused.set(next);
    // …and walk to it. A jump to another file reseeds the graph there; a same-file jump
    // just highlights the definition and the expansion above stands.
    this.selection.jumpTo(def.path, {
      startRow: def.startRow,
      startCol: def.startCol,
      endRow: def.endRow,
      endCol: def.endCol,
    });
  }

  // --- Node dragging ------------------------------------------------------------------

  onNodeDown(ev: MouseEvent, n: RenderNode): void {
    const sn = this.simNodes.find((s) => s.id === n.id);
    if (!sn) return;
    ev.stopPropagation(); // don't also start a background pan
    ev.preventDefault();
    this.justDragged = false;

    const rect = this.wrap.nativeElement.getBoundingClientRect();
    const startX = ev.clientX;
    const startY = ev.clientY;
    let dragging = false;

    const toGraph = (e: MouseEvent) => ({
      x: (e.clientX - rect.left - this.tx()) / this.zoom(),
      y: (e.clientY - rect.top - this.ty()) / this.zoom(),
    });

    const onMove = (e: MouseEvent): void => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 3) return;
      if (!dragging) {
        dragging = true;
        this.sim?.alphaTarget(0.2).restart();
      }
      const g = toGraph(e);
      sn.fx = g.x;
      sn.fy = g.y;
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this.sim?.alphaTarget(0);
      if (dragging) {
        // Pin it where dropped so re-layouts leave it there; suppress the trailing click.
        this.pinned.set(sn.id, { x: sn.fx ?? sn.x ?? 0, y: sn.fy ?? sn.y ?? 0 });
        this.justDragged = true;
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // --- Pan / zoom ---------------------------------------------------------------------

  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    this.zoomAround(mx, my, factor);
  }

  zoomBy(factor: number): void {
    this.zoomAround(this.width() / 2, this.height() / 2, factor);
  }

  private zoomAround(mx: number, my: number, factor: number): void {
    const z0 = this.zoom();
    const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z0 * factor));
    if (z1 === z0) return;
    this.tx.set(mx - ((mx - this.tx()) * z1) / z0);
    this.ty.set(my - ((my - this.ty()) * z1) / z0);
    this.zoom.set(z1);
  }

  onPanStart(ev: MouseEvent): void {
    const tag = (ev.target as Element).tagName.toLowerCase();
    if (tag === 'circle' || tag === 'text') return; // node interactions handle themselves
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startTx = this.tx();
    const startTy = this.ty();
    this.panning.set(true);
    const onMove = (e: MouseEvent): void => {
      this.tx.set(startTx + (e.clientX - startX));
      this.ty.set(startTy + (e.clientY - startY));
    };
    const onUp = (): void => {
      this.panning.set(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  onMinimapDown(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    const svg = ev.currentTarget as SVGSVGElement;
    const center = (e: MouseEvent): void => {
      const mm = this.minimap();
      if (!mm) return;
      const rect = svg.getBoundingClientRect();
      const gx = (e.clientX - rect.left - mm.offX) / mm.scale;
      const gy = (e.clientY - rect.top - mm.offY) / mm.scale;
      const z = this.zoom();
      this.tx.set(this.width() / 2 - gx * z);
      this.ty.set(this.height() / 2 - gy * z);
    };
    center(ev);
    const onMove = (e: MouseEvent): void => center(e);
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** Frames every node in the viewport with a little padding. */
  fitView(): void {
    const b = this.nodeBounds();
    const w = this.width();
    const h = this.height();
    if (!b || w === 0 || h === 0) return;
    const pad = 36;
    const gw = Math.max(1, b.maxX - b.minX);
    const gh = Math.max(1, b.maxY - b.minY);
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((w - 2 * pad) / gw, (h - 2 * pad) / gh)));
    this.zoom.set(k);
    this.tx.set((w - k * (b.minX + b.maxX)) / 2);
    this.ty.set((h - k * (b.minY + b.maxY)) / 2);
  }
}

function nodeRadius(degree: number, maxDeg: number): number {
  return 4 + Math.min(14, (degree / maxDeg) * 10);
}

function labelFor(def: SymbolDef): string {
  return def.owner ? `${def.owner}.${def.name}` : def.name;
}

function colorFor(def: SymbolDef): string {
  switch (def.kind) {
    case 'class':
    case 'interface':
    case 'type':
    case 'enum':
      return '#3b82f6';
    case 'function':
    case 'method':
      return '#f59e0b';
    default:
      return '#10b981';
  }
}
