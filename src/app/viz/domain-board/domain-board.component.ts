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
  untracked,
} from '@angular/core';
import { AnalysisStore } from '../../core/state/analysis.store';
import { SymbolDef, SymbolIndexService } from '../../core/services/symbol-index.service';
import { TabsStore } from '../../core/state/tabs.store';
import { GroupStrategy, NameInput, groupNames } from './domain-clustering';
import {
  BOARD_VERSION,
  BoardFrame,
  BoardState,
  BoardSticky,
  DomainBoardStore,
} from './domain-board-store.service';

// Board-unit geometry. Stickies and frame padding are laid out in these world units;
// pan/zoom only scales the whole world, never these numbers.
const SW = 132; // symbol sticky default/min width (actual width fits the name)
const SW_MIN = 96;
const SW_MAX = 320;
const SH = 46; // symbol sticky height
const NOTE_W = 172;
const NOTE_H = 132;
const GAP = 12;
const PAD = 16;
const HEADER = 34;
const FRAME_GAP = 40;
const ROW_WIDTH = 1180; // wrap frames past this world width during auto-layout
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
/** Keep the first auto-layout from dumping a thousand stickies onto the canvas. */
const MAX_SEED = 400;

/** Rough monospace-glyph width and fixed chrome (dot, gaps, delete button) at 11px. */
const CHAR_W = 6.7;
const STICKY_CHROME = 54;

/** Width a symbol sticky needs to show its whole label without truncating. */
function stickyWidth(label: string): number {
  return Math.max(SW_MIN, Math.min(SW_MAX, Math.ceil(label.length * CHAR_W) + STICKY_CHROME));
}

/** Frame accent hues; the theme owns saturation/lightness so both color schemes read. */
const FRAME_HUES = [210, 160, 275, 32, 340, 96, 190, 255, 12, 300];
const UNSORTED_TITLE = 'Unsorted';

let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.round(performance.now())}`;
}

interface FrameStyle {
  bg: string;
  border: string;
  header: string;
}

@Component({
  selector: 'loco-domain-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      <div class="toolbar">
        <span class="title">Domain board</span>
        @if (ready()) {
          <button type="button" (click)="autoGroup()" [disabled]="pendingCount() === 0" [title]="autoTitle()">
            ✦ Auto-group@if (pendingCount() > 0) { <span class="pill">{{ pendingCount() }}</span> }
          </button>
          <select
            class="strategy"
            [value]="strategy()"
            (change)="setStrategy($event)"
            title="How Auto-group chunks names into domains"
          >
            <option value="term">by term</option>
            <option value="compound">by term + subterm</option>
            <option value="folder">by folder</option>
          </select>
          <button type="button" (click)="addFrame()" title="Add an empty domain">+ Domain</button>
          <button type="button" (click)="addNote()" title="Add an empty reminder note">+ Note</button>
          <span class="zoom">
            <button type="button" (click)="zoomBy(1 / 1.2)" title="Zoom out">−</button>
            <button type="button" (click)="fitView()" title="Fit everything in view">Fit</button>
            <button type="button" (click)="zoomBy(1.2)" title="Zoom in">+</button>
          </span>
          <span class="spacer"></span>
          <span class="hint">{{ symbolCount() }} names · {{ frames().length }} domains</span>
          <button type="button" class="danger" (click)="reset()" title="Clear the board and regenerate">Reset</button>
        }
      </div>

      @if (!store.root()) {
        <div class="placeholder"><p>Drop a folder to analyze, then group its names into domains.</p></div>
      } @else if (progress(); as p) {
        <div class="placeholder">
          <p class="title">Reading names…</p>
          <div class="bar"><div class="fill" [style.width.%]="(p.done / p.total) * 100"></div></div>
          <p class="sub">{{ p.done }} / {{ p.total }} files</p>
        </div>
      } @else if (!ready()) {
        <div class="placeholder"><p>Preparing the name index…</p></div>
      } @else {
        <div
          class="board"
          [class.grabbing]="panning()"
          (mousedown)="onPanStart($event)"
          (wheel)="onWheel($event)"
        >
          <div class="world" [style.transform]="worldTransform()">
            @for (f of frames(); track f.id) {
              <div
                class="frame"
                [style.left.px]="f.x"
                [style.top.px]="f.y"
                [style.width.px]="f.w"
                [style.height.px]="f.h"
                [style.background]="frameStyle(f).bg"
                [style.borderColor]="frameStyle(f).border"
              >
                <div class="frame-head" [style.background]="frameStyle(f).header" (mousedown)="onFrameDown($event, f)">
                  <input
                    class="frame-title"
                    [value]="f.title"
                    (input)="renameFrame(f, $event)"
                    (mousedown)="$event.stopPropagation()"
                    spellcheck="false"
                  />
                  <span class="frame-count">{{ membersOf(f.id).length }}</span>
                  <button class="swatch" type="button" (click)="cycleColor(f)" (mousedown)="$event.stopPropagation()" title="Change color"></button>
                  <button class="x" type="button" (click)="removeFrame(f)" (mousedown)="$event.stopPropagation()" title="Delete domain (keeps its notes)">×</button>
                </div>
                <div class="resize" (mousedown)="onResizeDown($event, f)" title="Resize"></div>
              </div>
            }

            @for (s of stickies(); track s.id) {
              @if (s.kind === 'symbol') {
                <div
                  class="sticky symbol"
                  [class.loose]="s.frameId === null"
                  [style.left.px]="s.x"
                  [style.top.px]="s.y"
                  [style.width.px]="s.w ?? symW"
                  (mousedown)="onStickyDown($event, s)"
                  (click)="openSymbol(s)"
                  [title]="s.path"
                >
                  <span class="dot" [style.background]="kindColor(s.symbolKind)"></span>
                  <span class="label">{{ s.label }}</span>
                  <button class="x" type="button" (click)="removeSticky(s, $event)" (mousedown)="$event.stopPropagation()" title="Remove">×</button>
                </div>
              } @else {
                <div
                  class="sticky note"
                  [style.left.px]="s.x"
                  [style.top.px]="s.y"
                  [style.width.px]="noteW"
                  [style.height.px]="noteH"
                >
                  <div class="note-bar" (mousedown)="onStickyDown($event, s)">
                    <span class="grip">⠿</span>
                    <button class="x" type="button" (click)="removeSticky(s, $event)" (mousedown)="$event.stopPropagation()" title="Remove note">×</button>
                  </div>
                  <textarea
                    class="note-text"
                    [value]="s.text ?? ''"
                    (input)="editNote(s, $event)"
                    (mousedown)="$event.stopPropagation()"
                    placeholder="Write a reminder…"
                    spellcheck="false"
                  ></textarea>
                </div>
              }
            }
          </div>

          @if (frames().length === 0 && stickies().length === 0) {
            <div class="placeholder overlay">
              <p class="title">Empty board</p>
              <p class="sub">Hit <b>✦ Auto-group</b> to chunk your names into domains, or drop a <b>+ Note</b>.</p>
            </div>
          }
          <div class="legend">drag stickies · drag a domain header to move it · two-finger scroll to pan · ⌘/pinch to zoom</div>
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
        min-width: 0;
      }
      .wrap {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        flex: none;
        z-index: 2;
      }
      .toolbar .title {
        font-size: 12px;
        font-weight: 600;
        margin-right: 4px;
      }
      .toolbar button {
        background: transparent;
        border: 1px solid var(--border);
        color: inherit;
        border-radius: 4px;
        font: inherit;
        font-size: 11px;
        padding: 3px 8px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .toolbar button:hover:not(:disabled) {
        border-color: var(--accent);
        color: var(--accent);
      }
      .toolbar button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .toolbar button.danger:hover {
        border-color: var(--danger);
        color: var(--danger);
      }
      .strategy {
        background: transparent;
        border: 1px solid var(--border);
        color: inherit;
        border-radius: 4px;
        font: inherit;
        font-size: 11px;
        padding: 3px 4px;
        cursor: pointer;
      }
      .zoom {
        display: inline-flex;
      }
      .zoom button {
        border-radius: 0;
        min-width: 24px;
        justify-content: center;
      }
      .zoom button:first-child {
        border-radius: 4px 0 0 4px;
      }
      .zoom button:last-child {
        border-radius: 0 4px 4px 0;
      }
      .zoom button + button {
        border-left: none;
      }
      .pill {
        background: var(--accent);
        color: var(--accent-fg);
        border-radius: 999px;
        font-size: 9px;
        padding: 0 5px;
        line-height: 14px;
      }
      .spacer {
        flex: 1;
      }
      .hint {
        font-size: 11px;
        opacity: 0.6;
      }
      .board {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        cursor: grab;
        background:
          radial-gradient(circle, color-mix(in srgb, var(--fg) 12%, transparent) 1px, transparent 1px);
        background-size: 22px 22px;
      }
      .board.grabbing {
        cursor: grabbing;
      }
      .world {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: 0 0;
        will-change: transform;
      }
      .frame {
        position: absolute;
        border: 1px solid;
        border-radius: 10px;
        box-sizing: border-box;
      }
      .frame-head {
        display: flex;
        align-items: center;
        gap: 6px;
        height: ${HEADER}px;
        padding: 0 6px 0 10px;
        cursor: grab;
        border-radius: 9px 9px 0 0;
      }
      .frame-head:active {
        cursor: grabbing;
      }
      .frame-title {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 2px 2px;
        border-radius: 3px;
      }
      .frame-title:focus {
        outline: 1px solid var(--accent);
        background: color-mix(in srgb, var(--bg) 60%, transparent);
      }
      .frame-count {
        font-size: 10px;
        opacity: 0.6;
        font-variant-numeric: tabular-nums;
      }
      .swatch {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid var(--border) !important;
        padding: 0 !important;
        background: currentColor;
        opacity: 0.7;
        cursor: pointer;
      }
      .frame .x,
      .sticky .x {
        background: transparent;
        border: none;
        color: inherit;
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        opacity: 0.4;
        padding: 0 2px;
      }
      .frame .x:hover,
      .sticky .x:hover {
        opacity: 1;
        color: var(--danger);
      }
      .resize {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
        background: linear-gradient(
          135deg,
          transparent 50%,
          color-mix(in srgb, var(--fg) 30%, transparent) 50%
        );
        border-radius: 0 0 9px 0;
      }
      .sticky {
        position: absolute;
        box-sizing: border-box;
        user-select: none;
      }
      .sticky.symbol {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: ${SH}px;
        padding: 4px 6px 4px 8px;
        background: var(--bar-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
        cursor: grab;
        font-size: 11px;
      }
      .sticky.symbol:hover {
        border-color: var(--accent);
      }
      .sticky.symbol:active {
        cursor: grabbing;
      }
      .sticky.symbol.loose {
        border-style: dashed;
        opacity: 0.9;
      }
      .sticky.symbol .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
      }
      .sticky.symbol .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .sticky.note {
        display: flex;
        flex-direction: column;
        background: #fde68a;
        color: #3a2f05;
        border-radius: 4px;
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.28);
        transform: rotate(-1deg);
      }
      .note-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 18px;
        padding: 0 4px;
        cursor: grab;
        color: #6b5a12;
      }
      .note-bar:active {
        cursor: grabbing;
      }
      .note-bar .grip {
        font-size: 11px;
        opacity: 0.6;
      }
      .note-bar .x {
        color: #6b5a12;
      }
      .note-text {
        flex: 1;
        border: none;
        background: transparent;
        resize: none;
        outline: none;
        color: inherit;
        font: inherit;
        font-size: 12px;
        line-height: 1.35;
        padding: 2px 8px 8px;
      }
      .note-text::placeholder {
        color: #93800f;
      }
      .placeholder {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px;
        text-align: center;
        opacity: 0.85;
      }
      .placeholder.overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .placeholder p {
        margin: 0;
        max-width: 460px;
      }
      .placeholder .title {
        font-weight: 600;
      }
      .placeholder .sub {
        font-size: 12px;
        opacity: 0.7;
      }
      .bar {
        width: 220px;
        height: 3px;
        border-radius: 2px;
        overflow: hidden;
        background: color-mix(in srgb, var(--accent) 15%, transparent);
      }
      .fill {
        height: 100%;
        background: var(--accent);
      }
      .legend {
        position: absolute;
        left: 10px;
        bottom: 8px;
        font-size: 11px;
        opacity: 0.5;
        pointer-events: none;
      }
    `,
  ],
})
export class DomainBoardComponent implements AfterViewInit {
  readonly store = inject(AnalysisStore);
  private readonly index = inject(SymbolIndexService);
  private readonly tabs = inject(TabsStore);
  private readonly persist = inject(DomainBoardStore);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  // Exposed to the template for [style.width] bindings.
  readonly symW = SW;
  readonly noteW = NOTE_W;
  readonly noteH = NOTE_H;

  readonly frames = signal<BoardFrame[]>([]);
  readonly stickies = signal<BoardSticky[]>([]);

  readonly tx = signal(0);
  readonly ty = signal(0);
  readonly zoom = signal(1);
  readonly panning = signal(false);
  readonly strategy = signal<GroupStrategy>('term');

  readonly progress = this.index.building;
  readonly ready = computed(() => this.index.index() !== null);
  readonly symbolCount = computed(() => this.stickies().filter((s) => s.kind === 'symbol').length);

  readonly worldTransform = computed(
    () => `translate(${this.tx()}px, ${this.ty()}px) scale(${this.zoom()})`,
  );

  /** All top-level, filter-visible names, de-duplicated — the pool auto-group draws from. */
  private readonly nameInputs = computed<SeedName[]>(() => {
    const idx = this.index.index();
    if (!idx) return [];
    const visible = this.store.filteredPaths();
    const byName = new Map<string, SeedName>();
    for (const def of idx.defsById.values()) {
      if (def.owner !== null) continue; // top-level declarations only — these are the "components"
      if (!visible.has(def.path)) continue;
      const existing = byName.get(def.name);
      // One sticky per distinct name; prefer an exported representative.
      if (existing && !(def.exported && !existing.exported)) continue;
      byName.set(def.name, {
        id: def.id,
        name: def.name,
        path: def.path,
        kind: def.kind,
        exported: def.exported,
        def, // carried so the sticky can open the source location
      });
    }
    // Bound the initial pool: exported names first, then alphabetical, capped.
    return [...byName.values()]
      .sort((a, b) => Number(b.exported) - Number(a.exported) || a.name.localeCompare(b.name))
      .slice(0, MAX_SEED);
  });

  /** Names not yet represented on the board — what Auto-group would pull in. */
  readonly pendingCount = computed(() => {
    const present = new Set(this.stickies().map((s) => s.symbolId).filter(Boolean));
    return this.nameInputs().filter((n) => !present.has(n.id)).length;
  });

  readonly autoTitle = computed(() =>
    this.pendingCount() === 0
      ? 'Every name is already on the board'
      : `Add ${this.pendingCount()} new name(s), grouped ${this.strategyLabel()}`,
  );

  private strategyLabel(): string {
    const s = this.strategy();
    return s === 'folder' ? 'by folder' : s === 'compound' ? 'by term + subterm' : 'by shared term';
  }

  private width = 0;
  private height = 0;
  private currentKey = '';
  private loaded = false;
  private wantAuto = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private justDragged = false;

  constructor() {
    // Build (and rebuild) the symbol index for the loaded project.
    effect(() => {
      this.store.projectId();
      if (this.store.root()) void this.index.build();
    });

    // Load the persisted board when the project changes; auto-group a fresh one once the
    // index is ready. Reads projectId/rootName only — never the board signals it writes.
    effect(() => {
      const project = this.store.projectId();
      const name = this.store.rootName();
      void project;
      if (name !== this.currentKey) {
        this.flushSave();
        this.currentKey = name;
        this.loaded = false;
        this.wantAuto = false;
        this.frames.set([]);
        this.stickies.set([]);
        if (name) void this.loadBoard(name);
      }
    });

    // First-open auto-suggestion: once names are indexed and the load found nothing saved.
    // Depends only on the index — the board-emptiness check is untracked so a later drag
    // (which mutates the sticky list) doesn't re-run this.
    effect(() => {
      const idx = this.index.index();
      if (!idx || !this.loaded || !this.wantAuto) return;
      untracked(() => {
        if (this.frames().length === 0 && this.stickies().length === 0) {
          this.wantAuto = false;
          this.autoGroup(true);
        }
      });
    });
  }

  ngAfterViewInit(): void {
    const el = this.wrap.nativeElement;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        this.width = Math.max(0, Math.floor(e.contentRect.width));
        this.height = Math.max(0, Math.floor(e.contentRect.height));
      }
    });
    ro.observe(el);
    this.destroyRef.onDestroy(() => {
      ro.disconnect();
      this.flushSave();
    });
  }

  // --- Persistence --------------------------------------------------------------------

  private async loadBoard(name: string): Promise<void> {
    const state = await this.persist.load(name);
    // A late project switch could land here for the wrong project; ignore stale loads.
    if (name !== this.currentKey) return;
    if (state) {
      this.frames.set(state.frames);
      this.stickies.set(state.stickies);
      this.tx.set(state.tx);
      this.ty.set(state.ty);
      this.zoom.set(state.zoom);
      this.loaded = true;
    } else {
      this.loaded = true;
      this.wantAuto = true;
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 500);
  }

  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.currentKey || !this.loaded) return;
    const state: BoardState = {
      version: BOARD_VERSION,
      frames: this.frames(),
      stickies: this.stickies(),
      tx: this.tx(),
      ty: this.ty(),
      zoom: this.zoom(),
      savedAt: Date.now(),
    };
    void this.persist.save(this.currentKey, state);
  }

  // --- Auto-group ---------------------------------------------------------------------

  /**
   * Places every name not already on the board, grouped by shared term. A cluster whose
   * title matches an existing frame is merged into it (and that frame re-flowed);
   * otherwise a new frame is packed into empty space below the current content. Leftover
   * names collect in an "Unsorted" frame. Existing stickies and frames are never moved
   * unless they receive new members, so manual arrangement survives a refresh.
   */
  autoGroup(fresh = false): void {
    const present = new Set(this.stickies().map((s) => s.symbolId).filter(Boolean));
    const pool = this.nameInputs().filter((n) => fresh || !present.has(n.id));
    if (pool.length === 0) return;

    const { clusters, unassigned } = groupNames(pool, this.strategy());
    const frames = [...this.frames()];
    const stickies = [...this.stickies()];
    const frameByTitle = new Map(frames.map((f) => [f.title.toLowerCase(), f] as const));
    const touched = new Set<string>();

    const groups: { title: string; members: NameInput[] }[] = clusters.map((c) => ({
      title: c.title,
      members: c.members,
    }));
    if (unassigned.length) groups.push({ title: UNSORTED_TITLE, members: unassigned });

    let colorSeed = frames.length;
    for (const g of groups) {
      let frame = frameByTitle.get(g.title.toLowerCase());
      if (!frame) {
        frame = {
          id: uid('frame'),
          title: g.title,
          colorIndex: g.title === UNSORTED_TITLE ? -1 : colorSeed++ % FRAME_HUES.length,
          x: 0,
          y: 0,
          w: 200,
          h: 120,
        };
        frames.push(frame);
        frameByTitle.set(g.title.toLowerCase(), frame);
      }
      for (const m of g.members) {
        stickies.push({
          id: uid('sym'),
          kind: 'symbol',
          frameId: frame.id,
          x: 0,
          y: 0,
          w: stickyWidth(m.name),
          symbolId: m.id,
          label: m.name,
          path: m.path,
          symbolKind: m.kind,
          ...locationOf(m),
        });
      }
      touched.add(frame.id);
    }

    // Position any brand-new frames below the existing content, then re-flow every frame
    // that changed so its stickies grid neatly inside it.
    this.packNewFrames(frames, stickies, touched);
    for (const id of touched) this.reflowFrame(id, frames, stickies);

    this.frames.set(frames);
    this.stickies.set(stickies);
    if (fresh) queueMicrotask(() => this.fitView());
    this.scheduleSave();
  }

  /** Assigns positions to frames still at the origin, packing them in rows below the board. */
  private packNewFrames(frames: BoardFrame[], stickies: BoardSticky[], touched: Set<string>): void {
    const placed = frames.filter((f) => !(f.x === 0 && f.y === 0));
    const startX = 40;
    let baseY = 40;
    for (const f of placed) baseY = Math.max(baseY, f.y + f.h + FRAME_GAP);

    let cx = startX;
    let cy = baseY;
    let rowH = 0;
    for (const f of frames) {
      if (!(f.x === 0 && f.y === 0) || !touched.has(f.id)) continue;
      const { w, h } = flowLayout(memberWidths(stickies, f.id));
      f.w = w;
      f.h = h;
      if (cx > startX && cx + w > startX + ROW_WIDTH) {
        cx = startX;
        cy += rowH + FRAME_GAP;
        rowH = 0;
      }
      f.x = cx;
      f.y = cy;
      cx += w + FRAME_GAP;
      rowH = Math.max(rowH, h);
    }
  }

  /**
   * Flows a frame's stickies into wrapped rows (each sized to its own text) and resizes the
   * frame to fit. Members keep their current array order, so a drop that reorders them (see
   * {@link reorderByPosition}) lands the sticky at the slot it was dropped and realigns the rest.
   */
  private reflowFrame(frameId: string, frames: BoardFrame[], stickies: BoardSticky[]): void {
    const frame = frames.find((f) => f.id === frameId);
    if (!frame) return;
    const members = stickies.filter((s) => s.frameId === frameId);
    const { offsets, w, h } = flowLayout(members.map((s) => s.w ?? SW));
    frame.w = w;
    frame.h = h;
    members.forEach((s, i) => {
      const idx = stickies.indexOf(s);
      stickies[idx] = {
        ...s,
        x: frame.x + PAD + offsets[i].dx,
        y: frame.y + HEADER + PAD + offsets[i].dy,
      };
    });
  }

  /**
   * Reorders a frame's members into reading order (top-to-bottom, left-to-right) by their
   * current positions, so a just-dropped sticky sits where the user let go. The reordered
   * members move to the end of the flat array; a following {@link reflowFrame} lays them out.
   */
  private reorderByPosition(
    stickies: BoardSticky[],
    frames: BoardFrame[],
    frameId: string,
  ): BoardSticky[] {
    const frame = frames.find((f) => f.id === frameId);
    if (!frame) return stickies;
    const top = frame.y + HEADER + PAD;
    const band = (s: BoardSticky): number => Math.round((s.y - top) / (SH + GAP));
    const members = stickies
      .filter((s) => s.frameId === frameId)
      .sort((a, b) => band(a) - band(b) || a.x - b.x);
    const rest = stickies.filter((s) => s.frameId !== frameId);
    return [...rest, ...members];
  }

  reset(): void {
    if (!confirm('Clear the board and regenerate domains from names? Notes will be lost.')) return;
    this.frames.set([]);
    this.stickies.set([]);
    this.autoGroup(true);
  }

  /** Switch the grouping strategy and re-chunk the symbol names; reminder notes are kept. */
  setStrategy(ev: Event): void {
    this.strategy.set((ev.target as HTMLSelectElement).value as GroupStrategy);
    const notes = this.stickies().filter((s) => s.kind === 'note');
    this.frames.set([]);
    this.stickies.set(notes);
    this.autoGroup(true);
  }

  // --- Adding / editing ---------------------------------------------------------------

  private viewportCenterWorld(): { x: number; y: number } {
    return {
      x: (this.width / 2 - this.tx()) / this.zoom(),
      y: (this.height / 2 - this.ty()) / this.zoom(),
    };
  }

  addFrame(): void {
    const c = this.viewportCenterWorld();
    this.frames.update((fs) => [
      ...fs,
      {
        id: uid('frame'),
        title: 'New domain',
        colorIndex: fs.length % FRAME_HUES.length,
        x: Math.round(c.x - 120),
        y: Math.round(c.y - 70),
        w: 240,
        h: 140,
      },
    ]);
    this.scheduleSave();
  }

  addNote(): void {
    const c = this.viewportCenterWorld();
    this.stickies.update((ss) => [
      ...ss,
      {
        id: uid('note'),
        kind: 'note',
        frameId: null,
        x: Math.round(c.x - NOTE_W / 2),
        y: Math.round(c.y - NOTE_H / 2),
        text: '',
      },
    ]);
    this.scheduleSave();
  }

  renameFrame(frame: BoardFrame, ev: Event): void {
    const title = (ev.target as HTMLInputElement).value;
    this.frames.update((fs) => fs.map((f) => (f.id === frame.id ? { ...f, title } : f)));
    this.scheduleSave();
  }

  cycleColor(frame: BoardFrame): void {
    this.frames.update((fs) =>
      fs.map((f) =>
        f.id === frame.id ? { ...f, colorIndex: (f.colorIndex + 1) % FRAME_HUES.length } : f,
      ),
    );
    this.scheduleSave();
  }

  removeFrame(frame: BoardFrame): void {
    // Keep the stickies — just release them from the deleted frame.
    this.stickies.update((ss) => ss.map((s) => (s.frameId === frame.id ? { ...s, frameId: null } : s)));
    this.frames.update((fs) => fs.filter((f) => f.id !== frame.id));
    this.scheduleSave();
  }

  editNote(sticky: BoardSticky, ev: Event): void {
    const text = (ev.target as HTMLTextAreaElement).value;
    this.stickies.update((ss) => ss.map((s) => (s.id === sticky.id ? { ...s, text } : s)));
    this.scheduleSave();
  }

  removeSticky(sticky: BoardSticky, ev: Event): void {
    ev.stopPropagation();
    this.stickies.update((ss) => ss.filter((s) => s.id !== sticky.id));
    this.scheduleSave();
  }

  membersOf(frameId: string): BoardSticky[] {
    return this.stickies().filter((s) => s.frameId === frameId);
  }

  openSymbol(sticky: BoardSticky): void {
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }
    if (sticky.kind !== 'symbol' || !sticky.path) return;
    this.tabs.openFileAt(sticky.path, {
      startRow: sticky.startRow ?? 0,
      startCol: sticky.startCol ?? 0,
      endRow: sticky.endRow ?? sticky.startRow ?? 0,
      endCol: sticky.endCol ?? sticky.startCol ?? 0,
    });
  }

  // --- Dragging -----------------------------------------------------------------------

  onStickyDown(ev: MouseEvent, sticky: BoardSticky): void {
    ev.stopPropagation(); // never let a sticky interaction start a canvas pan
    const target = ev.target as HTMLElement;
    if (isInteractive(target)) return; // typing in a note / hitting its × handles itself
    ev.preventDefault();
    this.justDragged = false;

    const z = this.zoom();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const baseX = sticky.x;
    const baseY = sticky.y;
    const oldFrameId = sticky.frameId;
    let dragging = false;

    const onMove = (e: MouseEvent): void => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 3) return;
      dragging = true;
      const nx = Math.round(baseX + (e.clientX - startX) / z);
      const ny = Math.round(baseY + (e.clientY - startY) / z);
      this.stickies.update((ss) => ss.map((s) => (s.id === sticky.id ? { ...s, x: nx, y: ny } : s)));
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!dragging) return;
      this.justDragged = true;
      this.handleDrop(sticky.id, oldFrameId);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /**
   * Settles a dropped sticky: a symbol sticky joins whichever frame its center lands in
   * (topmost wins), snaps into the grid slot it was dropped at, and both the new and old
   * frames re-flow so the surrounding stickies realign. Notes float freely and never join
   * a frame — they are freeform reminders.
   */
  private handleDrop(stickyId: string, oldFrameId: string | null): void {
    const dropped = this.stickies().find((s) => s.id === stickyId);
    if (!dropped || dropped.kind !== 'symbol') {
      this.scheduleSave();
      return;
    }
    const w = dropped.w ?? SW;
    const cx = dropped.x + w / 2;
    const cy = dropped.y + SH / 2;
    const frames = [...this.frames()];
    let hit: string | null = null;
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h) {
        hit = f.id;
        break;
      }
    }

    let stickies = this.stickies().map((s) => (s.id === stickyId ? { ...s, frameId: hit } : s));
    if (hit) {
      stickies = this.reorderByPosition(stickies, frames, hit);
      this.reflowFrame(hit, frames, stickies);
    }
    // A sticky that left a frame leaves a gap behind; close it.
    if (oldFrameId && oldFrameId !== hit && frames.some((f) => f.id === oldFrameId)) {
      this.reflowFrame(oldFrameId, frames, stickies);
    }
    this.frames.set(frames);
    this.stickies.set(stickies);
    this.scheduleSave();
  }

  onFrameDown(ev: MouseEvent, frame: BoardFrame): void {
    ev.stopPropagation();
    if (isInteractive(ev.target as HTMLElement)) return; // title input / buttons
    ev.preventDefault();

    const z = this.zoom();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const baseFrame = { x: frame.x, y: frame.y };
    // Snapshot member positions so the frame carries its stickies rigidly.
    const members = this.stickies()
      .filter((s) => s.frameId === frame.id)
      .map((s) => ({ id: s.id, x: s.x, y: s.y }));
    const memberBase = new Map(members.map((m) => [m.id, m]));
    let dragging = false;

    const onMove = (e: MouseEvent): void => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 3) return;
      dragging = true;
      const dx = Math.round((e.clientX - startX) / z);
      const dy = Math.round((e.clientY - startY) / z);
      this.frames.update((fs) =>
        fs.map((f) => (f.id === frame.id ? { ...f, x: baseFrame.x + dx, y: baseFrame.y + dy } : f)),
      );
      this.stickies.update((ss) =>
        ss.map((s) => {
          const b = memberBase.get(s.id);
          return b ? { ...s, x: b.x + dx, y: b.y + dy } : s;
        }),
      );
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragging) this.scheduleSave();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  onResizeDown(ev: MouseEvent, frame: BoardFrame): void {
    ev.stopPropagation();
    ev.preventDefault();
    const z = this.zoom();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const baseW = frame.w;
    const baseH = frame.h;

    const onMove = (e: MouseEvent): void => {
      const w = Math.max(160, Math.round(baseW + (e.clientX - startX) / z));
      const h = Math.max(100, Math.round(baseH + (e.clientY - startY) / z));
      this.frames.update((fs) => fs.map((f) => (f.id === frame.id ? { ...f, w, h } : f)));
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this.scheduleSave();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // --- Pan / zoom ---------------------------------------------------------------------

  onPanStart(ev: MouseEvent): void {
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const baseTx = this.tx();
    const baseTy = this.ty();
    this.panning.set(true);
    const onMove = (e: MouseEvent): void => {
      this.tx.set(baseTx + (e.clientX - startX));
      this.ty.set(baseTy + (e.clientY - startY));
    };
    const onUp = (): void => {
      this.panning.set(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this.scheduleSave();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /**
   * Trackpad-friendly wheel handling, the way Figma/Excalidraw do it: a plain two-finger
   * scroll pans (following the finger, including horizontally), while a pinch — which the
   * OS delivers as a ⌘/ctrl-modified wheel — zooms toward the cursor. This is what makes
   * Mac-touchpad navigation feel smooth instead of ratcheting the zoom on every tick. A
   * regular mouse wheel pans; hold ⌘/ctrl, or use the toolbar ± buttons, to zoom.
   */
  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    // deltaMode 1 (lines) reports tiny deltas; scale them up so they move a comparable amount.
    const unit = ev.deltaMode === 1 ? 16 : 1;
    if (ev.ctrlKey || ev.metaKey) {
      const rect = this.wrap.nativeElement.getBoundingClientRect();
      // Clamp the per-event delta so a coarse mouse notch can't jump the zoom too far.
      const dy = Math.max(-40, Math.min(40, ev.deltaY * unit));
      this.zoomAround(ev.clientX - rect.left, ev.clientY - rect.top, Math.exp(-dy * 0.01));
    } else {
      this.tx.update((v) => v - ev.deltaX * unit);
      this.ty.update((v) => v - ev.deltaY * unit);
    }
    this.scheduleSave();
  }

  zoomBy(factor: number): void {
    this.zoomAround(this.width / 2, this.height / 2, factor);
    this.scheduleSave();
  }

  /** Scales around a viewport point, keeping that point fixed on screen. */
  private zoomAround(mx: number, my: number, factor: number): void {
    const z0 = this.zoom();
    const z1 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z0 * factor));
    if (z1 === z0) return;
    this.tx.set(mx - ((mx - this.tx()) * z1) / z0);
    this.ty.set(my - ((my - this.ty()) * z1) / z0);
    this.zoom.set(z1);
  }

  fitView(): void {
    const b = this.contentBounds();
    if (!b || this.width === 0 || this.height === 0) return;
    const pad = 48;
    const gw = Math.max(1, b.maxX - b.minX);
    const gh = Math.max(1, b.maxY - b.minY);
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((this.width - 2 * pad) / gw, (this.height - 2 * pad) / gh)));
    this.zoom.set(k);
    this.tx.set((this.width - k * (b.minX + b.maxX)) / 2);
    this.ty.set((this.height - k * (b.minY + b.maxY)) / 2);
    this.scheduleSave();
  }

  private contentBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const grow = (x: number, y: number, w: number, h: number): void => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    };
    for (const f of this.frames()) grow(f.x, f.y, f.w, f.h);
    for (const s of this.stickies()) {
      const [w, h] = s.kind === 'note' ? [NOTE_W, NOTE_H] : [s.w ?? SW, SH];
      grow(s.x, s.y, w, h);
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }

  // --- Presentation helpers -----------------------------------------------------------

  frameStyle(frame: BoardFrame): FrameStyle {
    if (frame.colorIndex < 0) {
      return {
        bg: 'color-mix(in srgb, var(--fg) 4%, transparent)',
        border: 'var(--border)',
        header: 'color-mix(in srgb, var(--fg) 8%, transparent)',
      };
    }
    const h = FRAME_HUES[frame.colorIndex % FRAME_HUES.length];
    return {
      bg: `hsl(${h} 60% 50% / 0.07)`,
      border: `hsl(${h} 60% 50% / 0.4)`,
      header: `hsl(${h} 60% 50% / 0.16)`,
    };
  }

  kindColor(kind: string | undefined): string {
    switch (kind) {
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
}

/**
 * Wraps a row of variable-width stickies into a roughly square block. Returns each
 * sticky's offset from the frame's content origin plus the frame box size that holds them.
 * The target inner width aims for √n rows so a domain reads as a compact cluster rather
 * than one long line or a tall column.
 */
function flowLayout(widths: number[]): { offsets: { dx: number; dy: number }[]; w: number; h: number } {
  const n = widths.length;
  if (n === 0) return { offsets: [], w: PAD * 2 + SW, h: HEADER + PAD * 2 + SH };
  const widest = Math.max(...widths);
  const total = widths.reduce((sum, w) => sum + w + GAP, 0);
  const innerW = Math.max(widest, Math.ceil(total / Math.max(1, Math.sqrt(n))));

  const offsets: { dx: number; dy: number }[] = [];
  let x = 0;
  let y = 0;
  let usedW = 0;
  for (const w of widths) {
    if (x > 0 && x + w > innerW) {
      x = 0;
      y += SH + GAP;
    }
    offsets.push({ dx: x, dy: y });
    x += w + GAP;
    usedW = Math.max(usedW, x - GAP);
  }
  return { offsets, w: PAD * 2 + usedW, h: HEADER + PAD * 2 + y + SH };
}

/** The widths of a frame's current members, in array order. */
function memberWidths(stickies: BoardSticky[], frameId: string): number[] {
  return stickies.filter((s) => s.frameId === frameId).map((s) => s.w ?? SW);
}

function isInteractive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'a';
}

/** A name plus the declaration it came from, so a placed sticky can open the source. */
interface SeedName extends NameInput {
  def: SymbolDef;
}

/** Pulls the source-location fields off a seed name for the sticky it becomes. */
function locationOf(input: NameInput): Pick<BoardSticky, 'startRow' | 'startCol' | 'endRow' | 'endCol'> {
  const def = (input as SeedName).def;
  return {
    startRow: def?.startRow ?? 0,
    startCol: def?.startCol ?? 0,
    endRow: def?.endRow ?? 0,
    endCol: def?.endCol ?? 0,
  };
}
