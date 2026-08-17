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
import { FormsModule } from '@angular/forms';
import { interpolateYlOrRd } from 'd3-scale-chromatic';
import { scaleSequential } from 'd3-scale';
import { HierarchyRectangularNode, hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { AnalysisStore } from '../../core/state/analysis.store';
import { TabsStore } from '../../core/state/tabs.store';
import { IgnoreService } from '../../core/services/ignore.service';
import { RiskService } from '../../core/services/risk.service';
import { ModuleGraphService } from '../../core/services/module-graph.service';
import {
  DirNode,
  DisplayMetric,
  FileNode,
  TreeNode,
  fileCount,
  formatMetricValue,
  isDir,
  isFile,
  metricValue,
} from '../../core/models/tree';

/** Tooltip box metrics, kept in step with the .tip rule below. */
const TIP_WIDTH = 300;
const TIP_HEIGHT = 90;
const TIP_GAP = 8;

/** Isometric projection: 2:1 tiles → a ground step in y is half a step in x on screen. */
const ISO_KY = 0.5;

/** World-unit geometry. Everything is laid out in these units, then fit to the pane. */
const CELL = 10; // grid cell for one building in the districts layout
const FOOT_MIN = 3; // smallest building footprint side (world units)
const HEIGHT_FLOOR = 1.2; // shortest building, so zero-metric files are still visible
const HEIGHT_MAX = 34; // tallest building (world units) at the metric maximum
const PLATE_PAD = 2; // margin between a district's buildings and its plate edge
const PLATE_GAP = 6; // gap between district plates when packing
const CITY_EXTENT = 120; // world size the city (treemap) layout is packed into

/** Above this many visible files we render the tallest CAP and note the rest. */
const CAP = 2500;

/** Wheel-zoom sensitivity per normalized pixel of scroll. Small = gentle trackpad zoom. */
const ZOOM_SENSITIVITY = 0.0015;

/** On-screen width (px) a building/plate must exceed before its label is drawn. */
const LABEL_MIN_PX = 52;
const PLATE_LABEL_MIN_PX = 72;

/** Target on-screen font size (px) for labels; counter-scaled against the zoom transform. */
const LABEL_FONT_PX = 10;
const PLATE_FONT_PX = 11;

/** The metrics offered on each axis, in menu order (mirrors the Files sidebar picker). */
const METRICS: { value: DisplayMetric; label: string }[] = [
  { value: 'loc', label: 'LOC' },
  { value: 'complexity', label: 'Complexity' },
  { value: 'churn', label: 'Churn' },
  { value: 'risk', label: 'Risk' },
  { value: 'count', label: 'File count' },
  { value: 'size', label: 'File size' },
];

function metricLabel(m: DisplayMetric): string {
  return METRICS.find((x) => x.value === m)?.label ?? m;
}

type Layout = 'districts' | 'nested' | 'city';

type EmptyReason =
  | { kind: 'no-project' }
  | { kind: 'no-matches'; canClearFilters: boolean; userIgnoreCount: number }
  | { kind: 'churn-loading'; done: number; total: number }
  | { kind: 'churn-error'; message: string }
  | { kind: 'risk-loading' }
  | { kind: 'risk-error'; message: string }
  | { kind: 'no-data'; metric: DisplayMetric };

/** A building in world units: ground rect [x0,y0]→[x1,y1] extruded to height `h`. */
interface WorldBox {
  node: FileNode;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
  color: string;
}

/** A district's flat ground plate (districts layouts only). `depth` tints nested plates. */
interface WorldPlate {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  depth: number;
  name: string;
}

/** A projected building: three face polygons plus label anchor + on-screen width. */
interface BoxView {
  node: FileNode;
  top: string;
  left: string;
  right: string;
  fillTop: string;
  fillLeft: string;
  fillRight: string;
  labelX: number;
  labelY: number;
  /** Top-face on-screen width at zoom 1; label shows once `baseWidth * zoom > LABEL_MIN_PX`. */
  baseWidth: number;
  textColor: string;
}

interface PlateView {
  points: string;
  fill: string;
  name: string;
  labelX: number;
  labelY: number;
  /** Plate on-screen width at zoom 1, for the label-visibility threshold. */
  baseWidth: number;
}

/** An import edge, drawn as a road between two buildings' ground centers. */
interface WorldRoad {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface RoadView {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Scene {
  plates: PlateView[];
  roads: RoadView[];
  boxes: BoxView[]; // already sorted back-to-front
  shown: number;
  total: number;
}

@Component({
  selector: 'loco-isometric',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      <div class="controls">
        <label class="pick">
          <span class="cap">layout</span>
          <select [ngModel]="layout()" (ngModelChange)="layout.set($event)">
            <option value="districts">Flat districts</option>
            <option value="nested">Nested districts</option>
            <option value="city">City</option>
          </select>
        </label>
        <label class="pick">
          <span class="cap">height</span>
          <select [ngModel]="heightMetric()" (ngModelChange)="setMetric('height', $event)">
            @for (m of metrics; track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
        </label>
        <label class="pick">
          <span class="cap">footprint</span>
          <select [ngModel]="footprintMetric()" (ngModelChange)="setMetric('footprint', $event)">
            @for (m of metrics; track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
        </label>
        <label class="pick">
          <span class="cap">color</span>
          <select [ngModel]="colorMetric()" (ngModelChange)="setMetric('color', $event)">
            @for (m of metrics; track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
        </label>
        <label class="pick toggle">
          <input type="checkbox" [ngModel]="roads()" (ngModelChange)="setRoads($event)" />
          <span class="cap">roads</span>
          @if (linking()) {
            <span class="dot"></span>
          }
        </label>
        @if (zoomed()) {
          <button type="button" class="reset" (click)="resetView()">reset view</button>
        }
        <div class="spacer"></div>
        @if (scene(); as s) {
          @if (s.shown < s.total) {
            <div class="note">showing tallest {{ s.shown }} of {{ s.total }} files</div>
          }
        }
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
                Filters are applied across the Overview, sidebar, and other vizzes.
                @if (e.userIgnoreCount > 0) {
                  {{ e.userIgnoreCount }} custom ignore
                  {{ e.userIgnoreCount === 1 ? 'pattern is' : 'patterns are' }} active.
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
                Churn is computed in the background. Buildings appear once the walk finishes —
                other metrics are usable in the meantime.
              </p>
              <div class="progress" role="progressbar">
                @if (e.total > 0) {
                  <div class="progress-fill" [style.width.%]="(e.done / e.total) * 100"></div>
                } @else {
                  <div class="progress-fill indeterminate"></div>
                }
              </div>
            }
            @case ('churn-error') {
              <p class="empty-title">Churn is unavailable.</p>
              <p class="empty-hint">{{ e.message }}</p>
            }
            @case ('risk-loading') {
              <p class="empty-title">Scoring risk…</p>
              <p class="empty-hint">
                Risk needs the import graph, so it is built the first time the metric is used.
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
              <p class="empty-hint">Try another metric on the axes above.</p>
            }
          }
        </div>
      } @else if (scene(); as s) {
        <svg
          [attr.width]="width()"
          [attr.height]="height()"
          (wheel)="onWheel($event)"
          (mousedown)="onPanStart($event)"
          (mousemove)="onPanMove($event)"
          (mouseup)="onPanEnd()"
          (mouseleave)="onPanEnd(); onLeave()"
          [class.panning]="panning()"
        >
          <g [attr.transform]="'translate(' + panX() + ',' + panY() + ') scale(' + zoom() + ')'">
            @for (p of s.plates; track $index) {
              <polygon [attr.points]="p.points" class="plate" [style.fill]="p.fill" />
            }
            <!-- Import roads on the ground, under the buildings. -->
            @for (r of s.roads; track $index) {
              <line class="road" [attr.x1]="r.x1" [attr.y1]="r.y1" [attr.x2]="r.x2" [attr.y2]="r.y2" />
            }
            @for (b of s.boxes; track b.node.path) {
              <g
                class="bldg"
                (mousemove)="onHover($event, b)"
                (click)="onSelect(b)"
                (dblclick)="onOpenAst(b)"
              >
                <polygon [attr.points]="b.left" [attr.fill]="b.fillLeft" />
                <polygon [attr.points]="b.right" [attr.fill]="b.fillRight" />
                <polygon
                  [attr.points]="b.top"
                  [attr.fill]="b.fillTop"
                  [attr.stroke]="isSelected(b) ? 'var(--accent)' : 'rgba(0,0,0,0.28)'"
                  [attr.stroke-width]="isSelected(b) ? 2 : 0.4"
                />
                @if (b.baseWidth * zoom() > labelMin) {
                  <text
                    [attr.x]="b.labelX"
                    [attr.y]="b.labelY"
                    [attr.fill]="b.textColor"
                    [attr.font-size]="buildingFont()"
                    text-anchor="middle"
                    dominant-baseline="central"
                    font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
                    pointer-events="none"
                  >
                    {{ b.node.name }}
                  </text>
                }
              </g>
            }
            <!-- District labels last so they stay legible above the buildings. -->
            @for (p of s.plates; track $index) {
              @if (p.name && p.baseWidth * zoom() > plateLabelMin) {
                <text
                  class="plate-label"
                  [attr.x]="p.labelX"
                  [attr.y]="p.labelY"
                  [attr.font-size]="districtFont()"
                  text-anchor="middle"
                  dominant-baseline="text-after-edge"
                  font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
                  pointer-events="none"
                >
                  {{ p.name }}
                </text>
              }
            }
          </g>
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
          <div class="tip-name">{{ t.name }}</div>
          @if (t.dir) {
            <div class="tip-path">{{ t.dir }}</div>
          }
          <div class="tip-row">
            {{ heightLabel() }} <strong>{{ t.height }}</strong>
          </div>
          <div class="tip-row">
            {{ footprintLabel() }} <strong>{{ t.footprint }}</strong>
          </div>
          <div class="tip-row">
            {{ colorLabel() }} <strong>{{ t.color }}</strong>
          </div>
        </div>
      }

      @if (!emptyReason()) {
        <div class="legend" aria-label="Color legend">
          <div class="legend-label">color: {{ colorLabel() }}</div>
          <div class="legend-bar">
            @for (s of legendStops(); track $index) {
              <span class="legend-stop" [style.background]="s"></span>
            }
          </div>
          <div class="legend-scale">
            <span>0</span>
            <span>{{ colorMax() }}</span>
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
      svg {
        display: block;
        cursor: grab;
      }
      svg.panning {
        cursor: grabbing;
      }
      .controls {
        position: absolute;
        top: 8px;
        left: 8px;
        right: 8px;
        z-index: 6;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        pointer-events: none;
      }
      .controls > * {
        pointer-events: auto;
      }
      .pick {
        display: flex;
        align-items: center;
        gap: 4px;
        background: color-mix(in srgb, var(--bar-bg) 92%, transparent);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 11px;
      }
      .pick .cap {
        opacity: 0.6;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-size: 10px;
      }
      .pick select {
        background: transparent;
        color: inherit;
        border: 0;
        font-family: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .reset,
      .note {
        font-size: 11px;
      }
      .reset {
        background: transparent;
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 3px 8px;
        cursor: pointer;
      }
      .reset:hover {
        border-color: var(--accent);
        color: var(--accent);
      }
      .note {
        background: color-mix(in srgb, var(--bar-bg) 92%, transparent);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 3px 8px;
        opacity: 0.85;
      }
      .spacer {
        flex: 1;
      }
      .plate {
        fill: color-mix(in srgb, var(--fg) 8%, transparent);
        stroke: color-mix(in srgb, var(--fg) 14%, transparent);
        stroke-width: 0.5;
      }
      .road {
        stroke: var(--accent);
        stroke-width: 1.2px;
        opacity: 0.28;
        fill: none;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
      }
      .pick.toggle {
        gap: 5px;
      }
      .pick.toggle input {
        margin: 0;
        cursor: pointer;
      }
      .pick .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent);
        animation: pulse 1s ease-in-out infinite;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 0.35;
        }
        50% {
          opacity: 1;
        }
      }
      .bldg {
        cursor: pointer;
      }
      .plate-label {
        fill: var(--fg);
        opacity: 0.6;
        font-weight: 600;
        letter-spacing: 0.02em;
        /* A halo keeps the name readable over buildings; non-scaling so the zoom
           transform can't grow it past the counter-scaled text. */
        paint-order: stroke;
        stroke: var(--bar-bg);
        stroke-width: 3px;
        vector-effect: non-scaling-stroke;
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
        max-width: 300px;
        transform: translate(8px, 8px);
        z-index: 8;
      }
      .tip.flip-x {
        transform: translate(calc(-100% - 8px), 8px);
      }
      .tip.flip-y {
        transform: translate(8px, calc(-100% - 8px));
      }
      .tip.flip-x.flip-y {
        transform: translate(calc(-100% - 8px), calc(-100% - 8px));
      }
      .tip-name {
        font-weight: 600;
        margin-bottom: 1px;
        word-break: break-all;
      }
      .tip-path {
        opacity: 0.6;
        font-size: 10px;
        margin-bottom: 4px;
        word-break: break-all;
      }
      .tip-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .legend {
        position: absolute;
        bottom: 8px;
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
export class IsometricComponent implements AfterViewInit {
  private readonly store = inject(AnalysisStore);
  private readonly tabs = inject(TabsStore);
  private readonly ig = inject(IgnoreService);
  private readonly risk = inject(RiskService);
  private readonly moduleGraph = inject(ModuleGraphService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  readonly metrics = METRICS;

  readonly width = signal(0);
  readonly height = signal(0);

  readonly layout = signal<Layout>('districts');
  readonly heightMetric = signal<DisplayMetric>('complexity');
  readonly footprintMetric = signal<DisplayMetric>('loc');
  readonly colorMetric = signal<DisplayMetric>('complexity');
  readonly roads = signal(false);

  readonly scene = signal<Scene | null>(null);
  readonly colorMax = signal(0);
  readonly legendStops = signal<string[]>([]);

  // Camera. Fit is baked into the scene coordinates; these are the user's pan/zoom on top.
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly panning = signal(false);
  private panOrigin: { x: number; y: number; px: number; py: number } | null = null;

  readonly zoomed = computed(() => this.zoom() !== 1 || this.panX() !== 0 || this.panY() !== 0);
  /** True while roads are on but the import graph is still being computed. */
  readonly linking = computed(() => this.roads() && !!this.moduleGraph.building());

  readonly heightLabel = computed(() => metricLabel(this.heightMetric()));
  readonly footprintLabel = computed(() => metricLabel(this.footprintMetric()));
  readonly colorLabel = computed(() => metricLabel(this.colorMetric()));

  readonly labelMin = LABEL_MIN_PX;
  readonly plateLabelMin = PLATE_LABEL_MIN_PX;
  // Labels live inside the zoomed <g>, so counter-scale the font to hold a constant
  // on-screen size instead of ballooning as the user zooms in.
  readonly buildingFont = computed(() => LABEL_FONT_PX / this.zoom());
  readonly districtFont = computed(() => PLATE_FONT_PX / this.zoom());

  readonly tip = signal<{
    x: number;
    y: number;
    flipX: boolean;
    flipY: boolean;
    name: string;
    dir: string;
    height: string;
    footprint: string;
    color: string;
  } | null>(null);

  readonly emptyReason = computed<EmptyReason | null>(() => {
    const s = this.scene();
    if (s && s.boxes.length > 0) return null;
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
    // Files exist but nothing rendered: a value axis is an on-demand metric still loading.
    const used = new Set<DisplayMetric>([
      this.heightMetric(),
      this.footprintMetric(),
      this.colorMetric(),
    ]);
    if (used.has('risk')) {
      const r = this.store.risk();
      if (r.status === 'computing' || r.status === 'idle') return { kind: 'risk-loading' };
      if (r.status === 'error') return { kind: 'risk-error', message: r.message };
    }
    if (used.has('churn')) {
      const c = this.store.churn();
      if (c.status === 'pending') return { kind: 'churn-loading', done: 0, total: 0 };
      if (c.status === 'running') return { kind: 'churn-loading', done: c.done, total: c.total };
      if (c.status === 'error') return { kind: 'churn-error', message: c.message };
    }
    return { kind: 'no-data', metric: this.heightMetric() };
  });

  constructor() {
    // Seed the height axis from the sidebar's current metric so the view opens showing
    // whatever the user was already looking at; it's independent afterwards.
    const globalMetric = this.store.filters().metric;
    if (globalMetric) this.heightMetric.set(globalMetric);

    effect(() => {
      const root = this.store.filteredRoot();
      const opts = {
        layout: this.layout(),
        heightMetric: this.heightMetric(),
        footprintMetric: this.footprintMetric(),
        colorMetric: this.colorMetric(),
      };
      const w = this.width();
      const h = this.height();
      this.scene.set(this.build(root, opts, w, h));
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

  setMetric(axis: 'height' | 'footprint' | 'color', metric: DisplayMetric): void {
    if (axis === 'height') this.heightMetric.set(metric);
    else if (axis === 'footprint') this.footprintMetric.set(metric);
    else this.colorMetric.set(metric);
    // Risk needs the module graph, so it is computed on first use — same as the sidebar.
    if (metric === 'risk') void this.risk.ensure();
  }

  setRoads(on: boolean): void {
    this.roads.set(on);
    // The import graph is built lazily; kick it off so `moduleGraph.graph()` populates and
    // the scene effect re-runs with edges once ready.
    if (on && !this.moduleGraph.graph()) void this.moduleGraph.build();
  }

  clearFilters(): void {
    this.store.updateFilters({ name: '', path: '' });
  }

  resetView(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  // --- Camera interaction ---------------------------------------------------

  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const old = this.zoom();
    // Scale by the actual scroll amount so a fast Mac trackpad flick zooms smoothly
    // instead of in big fixed steps. Normalize line/page deltas to pixels first.
    let dy = ev.deltaY;
    if (ev.deltaMode === 1) dy *= 16;
    else if (ev.deltaMode === 2) dy *= rect.height || 800;
    const factor = Math.exp(-dy * ZOOM_SENSITIVITY);
    const next = Math.min(8, Math.max(0.25, old * factor));
    if (next === old) return;
    // Keep the point under the cursor stationary while zooming.
    this.panX.set(cx - ((cx - this.panX()) * next) / old);
    this.panY.set(cy - ((cy - this.panY()) * next) / old);
    this.zoom.set(next);
  }

  onPanStart(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    this.panOrigin = { x: ev.clientX, y: ev.clientY, px: this.panX(), py: this.panY() };
    this.panning.set(true);
  }

  onPanMove(ev: MouseEvent): void {
    if (!this.panOrigin) return;
    this.panX.set(this.panOrigin.px + (ev.clientX - this.panOrigin.x));
    this.panY.set(this.panOrigin.py + (ev.clientY - this.panOrigin.y));
  }

  onPanEnd(): void {
    this.panOrigin = null;
    this.panning.set(false);
  }

  // --- Building interaction -------------------------------------------------

  onHover(ev: MouseEvent, b: BoxView): void {
    ev.stopPropagation();
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    this.tip.set({
      x,
      y,
      flipX: x + TIP_WIDTH + TIP_GAP > rect.width,
      flipY: y + TIP_HEIGHT + TIP_GAP > rect.height,
      name: b.node.name,
      // Parent folder path shown small under the filename (empty for root-level files).
      dir: b.node.path.slice(0, Math.max(0, b.node.path.length - b.node.name.length - 1)),
      height: formatMetricValue(metricValue(b.node, this.heightMetric()), this.heightMetric()),
      footprint: formatMetricValue(
        metricValue(b.node, this.footprintMetric()),
        this.footprintMetric(),
      ),
      color: formatMetricValue(metricValue(b.node, this.colorMetric()), this.colorMetric()),
    });
  }

  onLeave(): void {
    this.tip.set(null);
  }

  onSelect(b: BoxView): void {
    this.store.selectPath(b.node.path);
  }

  onOpenAst(b: BoxView): void {
    this.tabs.openFile(b.node.path);
  }

  isSelected(b: BoxView): boolean {
    return this.store.selectedPath() === b.node.path;
  }

  // --- Scene construction ---------------------------------------------------

  private build(
    root: DirNode | null,
    opts: {
      layout: Layout;
      heightMetric: DisplayMetric;
      footprintMetric: DisplayMetric;
      colorMetric: DisplayMetric;
    },
    w: number,
    h: number,
  ): Scene | null {
    if (!root || w <= 0 || h <= 0) return null;

    const files: FileNode[] = [];
    collectFiles(root, files);
    if (files.length === 0) return null;

    // Height and color scales are shared across the whole scene.
    const maxHeight = Math.max(...files.map((f) => metricValue(f, opts.heightMetric)), 0);
    const maxColor = Math.max(...files.map((f) => metricValue(f, opts.colorMetric)), 0);
    const color = scaleSequential(interpolateYlOrRd).domain([0, maxColor || 1]);
    this.colorMax.set(Math.round(maxColor));
    const stops: string[] = [];
    for (let i = 0; i <= 12; i++) stops.push(color(((i / 12) * (maxColor || 1)) as number));
    this.legendStops.set(stops);

    const heightOf = (f: FileNode): number => {
      if (maxHeight <= 0) return HEIGHT_FLOOR;
      // sqrt spreads the low end so small files stay distinguishable from zero.
      const norm = Math.sqrt(Math.max(metricValue(f, opts.heightMetric), 0) / maxHeight);
      return HEIGHT_FLOOR + norm * HEIGHT_MAX;
    };
    const colorOf = (f: FileNode): string => color(Math.max(metricValue(f, opts.colorMetric), 0));

    // Cap huge trees to the tallest buildings so the SVG stays responsive.
    const total = files.length;
    let working = files;
    if (files.length > CAP) {
      working = [...files]
        .sort((a, b) => metricValue(b, opts.heightMetric) - metricValue(a, opts.heightMetric))
        .slice(0, CAP);
    }
    const keep = new Set(working);

    // Footprint is a free axis in the districts layouts: each building's side scales with
    // the footprint metric (sqrt so area reads roughly linearly), floored so it stays visible.
    const maxFoot = Math.max(...working.map((f) => metricValue(f, opts.footprintMetric)), 0);
    const footSide = (f: FileNode): number => {
      if (maxFoot <= 0) return FOOT_MIN;
      const norm = Math.sqrt(Math.max(metricValue(f, opts.footprintMetric), 0) / maxFoot);
      return FOOT_MIN + norm * (CELL - FOOT_MIN);
    };

    const worldBoxes: WorldBox[] = [];
    const worldPlates: WorldPlate[] = [];
    if (opts.layout === 'districts') {
      layoutDistricts(root, keep, footSide, heightOf, colorOf, worldBoxes, worldPlates);
    } else if (opts.layout === 'nested') {
      layoutNested(root, keep, footSide, heightOf, colorOf, worldBoxes, worldPlates);
    } else {
      layoutCity(root, opts.footprintMetric, keep, heightOf, colorOf, worldBoxes);
    }
    if (worldBoxes.length === 0) return null;

    // Roads: draw an import edge between two buildings' ground centers. Reading roads() and
    // graph() here makes the scene effect re-run when either the toggle or the graph changes.
    const worldRoads: WorldRoad[] = [];
    if (this.roads()) {
      const graph = this.moduleGraph.graph();
      if (graph) {
        const centers = new Map<string, { x: number; y: number }>();
        for (const b of worldBoxes) {
          centers.set(b.node.path, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
        }
        for (const e of graph.edges) {
          const a = centers.get(e.from);
          const c = centers.get(e.to);
          if (a && c) worldRoads.push({ x0: a.x, y0: a.y, x1: c.x, y1: c.y });
        }
      }
    }

    return this.project(worldBoxes, worldPlates, worldRoads, w, h, working.length, total);
  }

  /** Fit all world geometry into the pane, then emit projected face polygons. */
  private project(
    boxes: WorldBox[],
    plates: WorldPlate[],
    roads: WorldRoad[],
    w: number,
    h: number,
    shown: number,
    total: number,
  ): Scene {
    // Bounds in iso space (pre-scale). Include building tops (z=h) and bases (z=0).
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const track = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    for (const b of boxes) {
      for (const [x, y] of corners(b.x0, b.y0, b.x1, b.y1)) {
        track(isoX(x, y), isoY(x, y, 0));
        track(isoX(x, y), isoY(x, y, b.h));
      }
    }
    for (const p of plates) {
      for (const [x, y] of corners(p.x0, p.y0, p.x1, p.y1)) {
        track(isoX(x, y), isoY(x, y, 0));
      }
    }

    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const pad = 0.9;
    const s = pad * Math.min(w / spanX, h / spanY);
    const offX = w / 2 - (s * (minX + maxX)) / 2;
    const offY = h / 2 - (s * (minY + maxY)) / 2;
    const sx = (x: number, y: number) => offX + s * isoX(x, y);
    const sy = (x: number, y: number, z: number) => offY + s * isoY(x, y, z);

    const plateViews: PlateView[] = plates.map((p) => ({
      points: quad(
        sx(p.x0, p.y0),
        sy(p.x0, p.y0, 0),
        sx(p.x1, p.y0),
        sy(p.x1, p.y0, 0),
        sx(p.x1, p.y1),
        sy(p.x1, p.y1, 0),
        sx(p.x0, p.y1),
        sy(p.x0, p.y1, 0),
      ),
      // Deeper (more nested) plates read darker so the hierarchy is legible.
      fill: `color-mix(in srgb, var(--fg) ${Math.min(8 + p.depth * 7, 42)}%, transparent)`,
      name: p.name,
      // Anchor the name at the plate's back corner (the topmost projected vertex).
      labelX: sx(p.x0, p.y0),
      labelY: sy(p.x0, p.y0, 0),
      baseWidth: Math.abs(sx(p.x1, p.y0) - sx(p.x0, p.y1)),
    }));

    const roadViews: RoadView[] = roads.map((r) => ({
      x1: sx(r.x0, r.y0),
      y1: sy(r.x0, r.y0, 0),
      x2: sx(r.x1, r.y1),
      y2: sy(r.x1, r.y1, 0),
    }));

    // Painter's algorithm: buildings further from the viewer (smaller x0+y0) first.
    const ordered = [...boxes].sort((a, b) => a.x0 + a.y0 - (b.x0 + b.y0));
    const boxViews: BoxView[] = ordered.map((b) => {
      const { x0, y0, x1, y1, h: bh } = b;
      // Top face corners.
      const t00 = [sx(x0, y0), sy(x0, y0, bh)];
      const t10 = [sx(x1, y0), sy(x1, y0, bh)];
      const t11 = [sx(x1, y1), sy(x1, y1, bh)];
      const t01 = [sx(x0, y1), sy(x0, y1, bh)];
      // Base corners for the two visible vertical faces.
      const b10 = [sx(x1, y0), sy(x1, y0, 0)];
      const b11 = [sx(x1, y1), sy(x1, y1, 0)];
      const b01 = [sx(x0, y1), sy(x0, y1, 0)];
      const cx = (t00[0] + t11[0]) / 2;
      const cy = (t00[1] + t11[1]) / 2;
      return {
        node: b.node,
        top: `${t00[0]},${t00[1]} ${t10[0]},${t10[1]} ${t11[0]},${t11[1]} ${t01[0]},${t01[1]}`,
        right: `${t10[0]},${t10[1]} ${t11[0]},${t11[1]} ${b11[0]},${b11[1]} ${b10[0]},${b10[1]}`,
        left: `${t01[0]},${t01[1]} ${t11[0]},${t11[1]} ${b11[0]},${b11[1]} ${b01[0]},${b01[1]}`,
        fillTop: b.color,
        fillRight: shade(b.color, 0.8),
        fillLeft: shade(b.color, 0.62),
        labelX: cx,
        labelY: cy,
        // Raw top-face width; the template gates the label on baseWidth * zoom so labels
        // appear as you zoom in without needing a rebuild.
        baseWidth: Math.abs(t10[0] - t01[0]),
        textColor: textColorFor(b.color),
      };
    });

    return { plates: plateViews, roads: roadViews, boxes: boxViews, shown, total };
  }
}

// --- Layout builders (pure) -------------------------------------------------

function collectFiles(node: TreeNode, out: FileNode[]): void {
  if (isFile(node)) {
    out.push(node);
    return;
  }
  for (const c of node.children) collectFiles(c, out);
}

type FootSide = (f: FileNode) => number;
type HeightOf = (f: FileNode) => number;
type ColorOf = (f: FileNode) => string;

/** A rectangle of content (world units) that knows how to draw itself at a given origin. */
interface Block {
  w: number;
  d: number;
  render: (ox: number, oy: number) => void;
}

/** Places `files` as a near-square grid of buildings with the origin at the grid's corner. */
function emitFileGrid(
  files: FileNode[],
  ox: number,
  oy: number,
  cols: number,
  footSide: FootSide,
  heightOf: HeightOf,
  colorOf: ColorOf,
  boxes: WorldBox[],
): void {
  files.forEach((f, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = ox + col * CELL + CELL / 2;
    const cy = oy + row * CELL + CELL / 2;
    const side = footSide(f);
    boxes.push({
      node: f,
      x0: cx - side / 2,
      y0: cy - side / 2,
      x1: cx + side / 2,
      y1: cy + side / 2,
      h: heightOf(f),
      color: colorOf(f),
    });
  });
}

/** Shelf-packs blocks left-to-right into rows, wrapping past `targetRow` width. */
function shelfPack(
  blocks: Block[],
  targetRow: number,
): { w: number; d: number; items: { block: Block; x: number; y: number }[] } {
  const sorted = [...blocks].sort((a, b) => b.d - a.d);
  const items: { block: Block; x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowDepth = 0;
  let maxW = 0;
  for (const block of sorted) {
    if (x > 0 && x + block.w > targetRow) {
      x = 0;
      y += rowDepth + PLATE_GAP;
      rowDepth = 0;
    }
    items.push({ block, x, y });
    x += block.w + PLATE_GAP;
    rowDepth = Math.max(rowDepth, block.d);
    maxW = Math.max(maxW, x - PLATE_GAP);
  }
  return { w: maxW, d: y + rowDepth, items };
}

/** A folder's direct files as a single grid block (or null when it has none kept). */
function fileGridBlock(
  dir: DirNode,
  keep: Set<FileNode>,
  footSide: FootSide,
  heightOf: HeightOf,
  colorOf: ColorOf,
  boxes: WorldBox[],
): Block | null {
  const dirFiles = dir.children.filter(isFile).filter((f) => keep.has(f));
  if (dirFiles.length === 0) return null;
  const cols = Math.ceil(Math.sqrt(dirFiles.length));
  const rows = Math.ceil(dirFiles.length / cols);
  return {
    w: cols * CELL,
    d: rows * CELL,
    render: (ox, oy) => emitFileGrid(dirFiles, ox, oy, cols, footSide, heightOf, colorOf, boxes),
  };
}

/**
 * Flat districts: every folder that directly holds files becomes its own ground plate, and
 * plates are shelf-packed into rows regardless of folder nesting. A building's footprint is
 * a free axis (the footprint metric).
 */
function layoutDistricts(
  root: DirNode,
  keep: Set<FileNode>,
  footSide: FootSide,
  heightOf: HeightOf,
  colorOf: ColorOf,
  boxes: WorldBox[],
  plates: WorldPlate[],
): void {
  const districts: Block[] = [];
  walkDirs(root, (dir) => {
    const grid = fileGridBlock(dir, keep, footSide, heightOf, colorOf, boxes);
    if (!grid) return;
    // Wrap the grid in a padded plate labelled with the folder name.
    const name = dir.name || root.name;
    districts.push({
      w: grid.w + PLATE_PAD * 2,
      d: grid.d + PLATE_PAD * 2,
      render: (ox, oy) => {
        plates.push({
          x0: ox,
          y0: oy,
          x1: ox + grid.w + PLATE_PAD * 2,
          y1: oy + grid.d + PLATE_PAD * 2,
          depth: 0,
          name,
        });
        grid.render(ox + PLATE_PAD, oy + PLATE_PAD);
      },
    });
  });
  if (districts.length === 0) return;

  const targetRow = Math.sqrt(districts.reduce((s, b) => s + b.w * b.d, 0)) * 1.5;
  const packed = shelfPack(districts, targetRow);
  for (const it of packed.items) it.block.render(it.x, it.y);
}

/**
 * Nested districts: each folder's plate contains its direct files (a grid) *and* its
 * sub-folders as nested plates, recursively — so the on-disk hierarchy is visible. Deeper
 * plates are tinted darker (see `WorldPlate.depth`).
 */
function layoutNested(
  root: DirNode,
  keep: Set<FileNode>,
  footSide: FootSide,
  heightOf: HeightOf,
  colorOf: ColorOf,
  boxes: WorldBox[],
  plates: WorldPlate[],
): void {
  const rootBlock = dirBlock(root, 0, keep, footSide, heightOf, colorOf, boxes, plates);
  if (rootBlock) rootBlock.render(0, 0);
}

/** Whether a folder's subtree contains at least one kept file. */
function dirHasKept(dir: DirNode, keep: Set<FileNode>): boolean {
  for (const c of dir.children) {
    if (isFile(c)) {
      if (keep.has(c)) return true;
    } else if (dirHasKept(c, keep)) {
      return true;
    }
  }
  return false;
}

/**
 * Path-compresses a chain of pass-through folders: while a folder has no kept files of its
 * own and exactly one sub-folder that has kept content, descend into it, joining the names
 * (e.g. `src/main/java`). Multi-child containers stop the chain and stay a grouping plate.
 */
function collapseChain(dir: DirNode, keep: Set<FileNode>): { dir: DirNode; name: string } {
  let cur = dir;
  let name = dir.name;
  for (;;) {
    const hasOwnFiles = cur.children.some((c) => isFile(c) && keep.has(c));
    if (hasOwnFiles) break;
    const subdirs = cur.children.filter((c): c is DirNode => isDir(c) && dirHasKept(c, keep));
    if (subdirs.length !== 1) break;
    cur = subdirs[0];
    name = `${name}/${cur.name}`;
  }
  return { dir: cur, name };
}

/** Recursively lays out one folder as a plate wrapping its file grid + child folder plates. */
function dirBlock(
  dir: DirNode,
  depth: number,
  keep: Set<FileNode>,
  footSide: FootSide,
  heightOf: HeightOf,
  colorOf: ColorOf,
  boxes: WorldBox[],
  plates: WorldPlate[],
): Block | null {
  // Merge single-child chains so pass-through folders don't each get their own plate.
  const { dir: node, name } = collapseChain(dir, keep);

  const children: Block[] = [];
  const grid = fileGridBlock(node, keep, footSide, heightOf, colorOf, boxes);
  if (grid) children.push(grid);
  for (const c of node.children) {
    if (!isDir(c)) continue;
    const sub = dirBlock(c, depth + 1, keep, footSide, heightOf, colorOf, boxes, plates);
    if (sub) children.push(sub);
  }
  if (children.length === 0) return null;

  const area = children.reduce((s, b) => s + b.w * b.d, 0);
  const widest = Math.max(...children.map((b) => b.w));
  const targetRow = Math.max(Math.sqrt(area) * 1.3, widest);
  const packed = shelfPack(children, targetRow);
  const plateW = packed.w + PLATE_PAD * 2;
  const plateD = packed.d + PLATE_PAD * 2;
  return {
    w: plateW,
    d: plateD,
    render: (ox, oy) => {
      // Push the parent plate before recursing so outer plates paint under inner ones.
      plates.push({ x0: ox, y0: oy, x1: ox + plateW, y1: oy + plateD, depth, name });
      for (const it of packed.items) it.block.render(ox + PLATE_PAD + it.x, oy + PLATE_PAD + it.y);
    },
  };
}

/**
 * City: reuse the treemap layout so footprint AREA ∝ the footprint metric and folders
 * become nested districts (via treemap padding); each file is extruded by its height.
 */
function layoutCity(
  root: DirNode,
  footprintMetric: DisplayMetric,
  keep: Set<FileNode>,
  heightOf: (f: FileNode) => number,
  colorOf: (f: FileNode) => string,
  boxes: WorldBox[],
): void {
  const sumValue = (n: TreeNode): number =>
    isFile(n) && keep.has(n) ? Math.max(metricValue(n, footprintMetric), 0) : 0;
  const h0 = hierarchy<TreeNode>(root, (d) => (isDir(d) ? d.children : null))
    .sum(sumValue)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if ((h0.value ?? 0) === 0) return;

  const tm = treemap<TreeNode>()
    .size([CITY_EXTENT, CITY_EXTENT])
    .paddingInner(0.6)
    .paddingTop((d) => (d.depth > 0 ? 1.4 : 0))
    .tile(treemapSquarify);
  tm(h0);

  for (const leaf of h0.leaves()) {
    const rect = leaf as HierarchyRectangularNode<TreeNode>;
    const f = leaf.data;
    if (!isFile(f) || !keep.has(f)) continue;
    if (rect.x1 - rect.x0 <= 0 || rect.y1 - rect.y0 <= 0) continue;
    boxes.push({
      node: f,
      x0: rect.x0,
      y0: rect.y0,
      x1: rect.x1,
      y1: rect.y1,
      h: heightOf(f),
      color: colorOf(f),
    });
  }
}

function walkDirs(node: DirNode, visit: (d: DirNode) => void): void {
  visit(node);
  for (const c of node.children) if (isDir(c)) walkDirs(c, visit);
}

// --- Geometry helpers (pure) ------------------------------------------------

function isoX(x: number, y: number): number {
  return x - y;
}
function isoY(x: number, y: number, z: number): number {
  return (x + y) * ISO_KY - z;
}
function corners(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}
function quad(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): string {
  return `${ax},${ay} ${bx},${by} ${cx},${cy} ${dx},${dy}`;
}

function shade(fill: string, k: number): string {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(fill);
  if (!m) return fill;
  const r = Math.round(Number(m[1]) * k);
  const g = Math.round(Number(m[2]) * k);
  const b = Math.round(Number(m[3]) * k);
  return `rgb(${r}, ${g}, ${b})`;
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
