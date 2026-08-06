import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AnalysisService } from '../core/services/analysis.service';
import { AnalysisStore } from '../core/state/analysis.store';
import { TabsStore } from '../core/state/tabs.store';
import { SessionService } from '../core/services/session.service';
import { IgnoreService } from '../core/services/ignore.service';
import { VizRegistry } from '../viz/viz-registry';
import { LoadResult } from '../core/services/directory-loader.service';
import { FilterBarComponent } from '../filters/filter-bar.component';
import { DropZoneComponent } from './drop-zone.component';
import { SpinnerComponent } from './spinner.component';
import { DirectoryTreeComponent } from './directory-tree.component';
import { IgnorePanelComponent } from './ignore-panel.component';
import { MetricsHelpComponent } from './metrics-help.component';
import { HeatmapPanelComponent } from '../viz/heatmap-panel.component';
import { AstViewComponent } from '../ast/ast-view.component';

type Side = 'left' | 'right';

interface PanelState {
  width: number;
  collapsed: boolean;
}

const DEFAULT_WIDTH = 280;
const COLLAPSED_WIDTH = 28;
const MIN_WIDTH = 180;
const MAX_WIDTH = 560;
const STORAGE_KEY = 'loco.panels.v1';

@Component({
  selector: 'loco-shell',
  standalone: true,
  imports: [
    FilterBarComponent,
    DropZoneComponent,
    SpinnerComponent,
    DirectoryTreeComponent,
    IgnorePanelComponent,
    MetricsHelpComponent,
    HeatmapPanelComponent,
    AstViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <div class="brand">
        <span class="logo">loco</span>
        <span class="tag">lines of code, visualized</span>
      </div>
      <nav class="nav">
        <button
          type="button"
          class="tab"
          [class.active]="!tabs.isAstActive()"
          (click)="tabs.activateHeatmap()"
        >
          heatmap
        </button>
        @for (path of tabs.astTabs(); track path) {
          <button
            type="button"
            class="tab file"
            [class.active]="tabs.activePath() === path"
            [class.closing]="shiftHeld()"
            (click)="onTabClick($event, path)"
            [title]="shiftHeld() ? 'Click to close' : path"
          >
            <span class="tab-name">{{ tabLabel(path) }}</span>
            <span
              class="tab-close"
              role="button"
              aria-label="Close tab"
              (click)="closeTab($event, path)"
              >×</span
            >
          </button>
        }
      </nav>
      @if (store.root(); as r) {
        <div class="root">
          <button
            type="button"
            class="help"
            (click)="helpOpen.set(true)"
            title="How churn and risk are measured"
            aria-label="How churn and risk are measured"
          >
            ?
          </button>
          @if (cacheNote(); as note) {
            <span class="cache" [class.warn]="note.warn" [title]="note.title">{{
              note.label
            }}</span>
          }
          <span class="root-name" [title]="store.rootName()">{{ store.rootName() }}</span>
          <button class="ghost" type="button" (click)="reset()">change folder</button>
        </div>
      }
    </header>

    @if (session.restoring()) {
      <section class="welcome">
        <div class="restoring">Restoring the last project…</div>
      </section>
    } @else if (!store.root()) {
      <section class="welcome">
        <loco-drop-zone
          (started)="onReadingStarted()"
          (progress)="onReadingProgress($event)"
          (loaded)="onLoaded($event)"
          (error)="onError($event)"
          (canceled)="onPickerCanceled()"
        />
        @if (errorMessage()) {
          <div class="err">{{ errorMessage() }}</div>
        }
      </section>
    } @else {
      <loco-filter-bar />
      <div class="body">
        <aside
          class="sidebar left"
          [class.collapsed]="left().collapsed"
          [style.width.px]="left().collapsed ? collapsedWidth : left().width"
        >
          @if (left().collapsed) {
            <button class="open-btn" type="button" (click)="toggle('left')" title="Show file tree">
              <span class="open-icon">›</span>
              <span class="open-label">Files</span>
            </button>
          } @else {
            <header class="panel-head">
              <span class="panel-title">Files</span>
              <button class="collapse-btn" type="button" (click)="toggle('left')" title="Collapse">
                ‹
              </button>
            </header>
            <loco-directory-tree />
            <div
              class="resizer right"
              (mousedown)="startResize('left', $event)"
              role="separator"
              aria-orientation="vertical"
            ></div>
          }
        </aside>

        <main class="viz-area">
          <loco-heatmap-panel [style.display]="tabs.isAstActive() ? 'none' : 'block'" />
          <!-- One view per open tab, kept alive so each remembers its own state (mode,
               page, search, scroll); only the active one is shown. -->
          @for (path of tabs.astTabs(); track path) {
            <loco-ast-view
              [path]="path"
              [style.display]="tabs.activePath() === path ? 'flex' : 'none'"
            />
          }
        </main>

        <aside
          class="sidebar right"
          [class.collapsed]="right().collapsed"
          [style.width.px]="right().collapsed ? collapsedWidth : right().width"
        >
          @if (right().collapsed) {
            <button
              class="open-btn"
              type="button"
              (click)="toggle('right')"
              title="Show ignore list"
            >
              <span class="open-icon">‹</span>
              <span class="open-label">Ignore</span>
            </button>
          } @else {
            <div
              class="resizer left"
              (mousedown)="startResize('right', $event)"
              role="separator"
              aria-orientation="vertical"
            ></div>
            <header class="panel-head">
              <button class="collapse-btn" type="button" (click)="toggle('right')" title="Collapse">
                ›
              </button>
              <span class="panel-title">Ignore</span>
            </header>
            <loco-ignore-panel />
          }
        </aside>
      </div>
    }

    @if (statusLine(); as s) {
      <footer class="status">{{ s }}</footer>
    }

    <loco-spinner />

    @if (helpOpen()) {
      <loco-metrics-help (closed)="helpOpen.set(false)" />
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
      }
      .brand {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .logo {
        font-weight: 700;
        font-size: 16px;
      }
      .tag {
        opacity: 0.5;
        font-size: 11px;
      }
      .nav {
        display: flex;
        gap: 4px;
        align-items: center;
        min-width: 0;
        overflow-x: auto;
      }
      .tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: inherit;
        background: transparent;
        border: 1px solid transparent;
        font-family: inherit;
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 3px;
        opacity: 0.7;
        cursor: pointer;
        white-space: nowrap;
        max-width: 360px;
      }
      .tab:hover {
        opacity: 1;
        background: var(--hover);
      }
      .tab.active {
        opacity: 1;
        background: var(--hover);
        border-color: var(--border);
      }
      .tab .tab-name {
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .tab-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 15px;
        height: 15px;
        border-radius: 3px;
        opacity: 0.55;
        font-size: 13px;
        line-height: 1;
        flex-shrink: 0;
      }
      .tab-close:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--danger) 30%, transparent);
      }
      /* While Shift is held, a click anywhere on a tab closes it — signal that with an
         X cursor and a red tint. */
      .tab.file.closing {
        cursor:
          url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><line x1="4" y1="4" x2="14" y2="14" stroke="%23e5484d" stroke-width="2.5" stroke-linecap="round"/><line x1="14" y1="4" x2="4" y2="14" stroke="%23e5484d" stroke-width="2.5" stroke-linecap="round"/></svg>')
            9 9,
          pointer;
      }
      .tab.file.closing:hover {
        background: color-mix(in srgb, var(--danger) 22%, transparent);
      }
      .tab.file.closing .tab-close {
        opacity: 1;
        color: var(--danger);
      }
      .root {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .root-name {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ghost {
        border: 1px solid var(--border);
        background: transparent;
        color: inherit;
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      .ghost:hover {
        background: var(--hover);
      }
      .welcome {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 12px;
        padding: 24px;
        max-width: 640px;
        margin: 0 auto;
        width: 100%;
      }
      .welcome > loco-drop-zone {
        width: 100%;
      }
      .err {
        color: var(--danger);
        font-size: 12px;
      }
      .restoring {
        opacity: 0.7;
        font-size: 13px;
      }
      .help {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 1px solid var(--border);
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 11px;
        line-height: 1;
        padding: 0;
        cursor: pointer;
        opacity: 0.55;
        flex-shrink: 0;
      }
      .help:hover {
        opacity: 1;
        border-color: var(--accent);
        color: var(--accent);
      }
      .cache {
        font-size: 10px;
        opacity: 0.5;
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 1px 6px;
        white-space: nowrap;
        cursor: default;
      }
      .cache.warn {
        color: var(--danger);
        border-color: color-mix(in srgb, var(--danger) 40%, transparent);
        opacity: 0.8;
      }
      .body {
        flex: 1;
        display: flex;
        min-height: 0;
        position: relative;
      }
      .sidebar {
        flex-shrink: 0;
        background: var(--bar-bg);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
      }
      .sidebar.left {
        border-right: 1px solid var(--border);
      }
      .sidebar.right {
        border-left: 1px solid var(--border);
      }
      .sidebar.collapsed {
        cursor: pointer;
      }
      .sidebar > loco-directory-tree,
      .sidebar > loco-ignore-panel {
        flex: 1;
        min-height: 0;
      }
      .panel-head {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        flex-shrink: 0;
      }
      .panel-title {
        flex: 1;
        font-weight: 600;
        font-size: 12px;
      }
      .collapse-btn {
        background: transparent;
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 3px;
        width: 22px;
        height: 22px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        font-size: 14px;
        opacity: 0.75;
      }
      .collapse-btn:hover {
        opacity: 1;
        background: var(--hover);
      }
      .open-btn {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 10px 0;
        opacity: 0.7;
        font-family: inherit;
      }
      .open-btn:hover {
        background: var(--hover);
        opacity: 1;
      }
      .open-icon {
        font-size: 14px;
      }
      .open-label {
        writing-mode: vertical-rl;
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        opacity: 0.7;
      }
      .resizer {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 6px;
        cursor: col-resize;
        z-index: 4;
        background: transparent;
      }
      .resizer.right {
        right: 0;
      }
      .resizer.left {
        left: 0;
      }
      .resizer:hover,
      .resizer.dragging {
        background: color-mix(in srgb, var(--accent) 45%, transparent);
      }
      .viz-area {
        flex: 1;
        min-height: 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        /* Confine the AST view's sticky, z-indexed tab row to its own stacking context so
           it can't paint over the neighbouring Ignore sidebar. */
        isolation: isolate;
      }
      .status {
        border-top: 1px solid var(--border);
        padding: 4px 12px;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: var(--bar-bg);
        opacity: 0.85;
      }
    `,
  ],
})
export class ShellComponent {
  readonly store = inject(AnalysisStore);
  readonly tabs = inject(TabsStore);
  readonly session = inject(SessionService);
  private readonly analysis = inject(AnalysisService);
  private readonly ig = inject(IgnoreService);
  private readonly registry = inject(VizRegistry);
  private readonly destroyRef = inject(DestroyRef);
  readonly errorMessage = signal<string | null>(null);
  readonly helpOpen = signal(false);
  /** True while Shift is held — turns a tab click into "close this tab". */
  readonly shiftHeld = signal(false);

  readonly collapsedWidth = COLLAPSED_WIDTH;

  private readonly persisted = this.loadPersisted();
  readonly left = signal<PanelState>(this.persisted.left);
  readonly right = signal<PanelState>(this.persisted.right);

  private dragging: { side: Side; startX: number; startWidth: number } | null = null;

  /** Tells the user whether what they are looking at is a cached copy, and how old. */
  readonly cacheNote = computed<{ label: string; title: string; warn: boolean } | null>(() => {
    const skipped = this.session.notCached();
    if (skipped) return { label: 'not cached', title: skipped, warn: true };
    const savedAt = this.session.savedAt();
    if (savedAt === null) return null;
    return {
      label: `cached ${relativeTime(savedAt, this.now())}`,
      title:
        'This project is kept in browser storage so a reload resumes here. It is a snapshot ' +
        'from when it was analysed — re-pick the folder to see changes made since.',
      warn: false,
    };
  });

  /** Coarse clock so the cached-at label ages without a per-second re-render. */
  private readonly now = signal(Date.now());

  readonly statusLine = computed(() => {
    const s = this.store.status();
    switch (s.phase) {
      case 'restoring':
        return s.total > 0 ? `Restoring ${s.done}/${s.total} files…` : 'Restoring last project…';
      case 'reading':
        return `Reading ${s.done.toLocaleString()} files…`;
      case 'loading':
        return s.message;
      case 'counting':
        return `Counting ${s.done}/${s.total}…`;
      case 'parsing':
        return `Parsing ${s.done}/${s.total}…`;
      case 'error':
        return `Error: ${s.message}`;
      default:
        return this.churnLine();
    }
  });

  /** Background churn progress lives in the status bar, not behind the modal spinner. */
  private readonly churnLine = computed(() => {
    const c = this.store.churn();
    switch (c.status) {
      case 'pending':
        return 'Walking git history…';
      case 'running':
        return c.total > 0
          ? `Walking git history ${c.done}/${c.total} commits…`
          : 'Walking git history…';
      case 'error':
        return `Churn unavailable: ${c.message}`;
      default:
        return null;
    }
  });

  onReadingStarted(): void {
    this.errorMessage.set(null);
    this.store.status.set({ phase: 'reading', done: 0 });
  }

  onReadingProgress(done: number): void {
    this.store.status.set({ phase: 'reading', done });
  }

  onPickerCanceled(): void {
    // User dismissed the OS picker; rewind the spinner.
    if (this.store.status().phase === 'reading') {
      this.store.status.set({ phase: 'idle' });
    }
  }

  constructor() {
    void this.restoreSession();

    // Filters, selection, ignore patterns and the active viz are cheap to rewrite, so
    // they follow the user rather than waiting for the next analysis.
    effect(() => {
      this.store.filters();
      this.store.selectedPath();
      this.ig.userPatterns();
      this.tabs.astTabs();
      this.tabs.activePath();
      this.session.queueMeta();
    });
    effect(() => {
      this.session.setViz(this.registry.selectedId());
    });

    const tick = setInterval(() => this.now.set(Date.now()), 60_000);
    this.destroyRef.onDestroy(() => clearInterval(tick));

    // Track Shift so the tab bar can switch to "click to close" mode.
    const onShift = (e: KeyboardEvent) => this.shiftHeld.set(e.shiftKey);
    const clearShift = () => this.shiftHeld.set(false);
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);
    window.addEventListener('blur', clearShift);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
      window.removeEventListener('blur', clearShift);
    });

    effect(() => {
      const data = { left: this.left(), right: this.right() };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        // ignore quota / private mode errors
      }
    });
  }

  toggle(side: Side): void {
    const sig = side === 'left' ? this.left : this.right;
    sig.update((s) => ({ ...s, collapsed: !s.collapsed }));
  }

  startResize(side: Side, ev: MouseEvent): void {
    ev.preventDefault();
    const sig = side === 'left' ? this.left : this.right;
    this.dragging = { side, startX: ev.clientX, startWidth: sig().width };
    const handle = ev.currentTarget as HTMLElement | null;
    handle?.classList.add('dragging');

    const onMove = (e: MouseEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragging.startX;
      const raw =
        this.dragging.side === 'left'
          ? this.dragging.startWidth + dx
          : this.dragging.startWidth - dx;
      const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
      sig.update((s) => ({ ...s, width }));
    };
    const onUp = () => {
      this.dragging = null;
      handle?.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    this.destroyRef.onDestroy(onUp);
  }

  private loadPersisted(): { left: PanelState; right: PanelState } {
    const fallback = {
      left: { width: DEFAULT_WIDTH, collapsed: false },
      right: { width: DEFAULT_WIDTH, collapsed: false },
    };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<{ left: PanelState; right: PanelState }>;
      return {
        left: clampState(parsed.left) ?? fallback.left,
        right: clampState(parsed.right) ?? fallback.right,
      };
    } catch {
      return fallback;
    }
  }

  async onLoaded(result: LoadResult): Promise<void> {
    this.errorMessage.set(null);
    this.tabs.clear();
    try {
      await this.analysis.analyze(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Analysis failed.';
      this.store.status.set({ phase: 'error', message: msg });
      this.errorMessage.set(msg);
    }
  }

  onError(message: string): void {
    this.errorMessage.set(message);
  }

  reset(): void {
    this.store.clear();
    this.tabs.clear();
    this.ig.clearUserPatterns();
    this.errorMessage.set(null);
    void this.session.discard();
  }

  /** Shift-click closes the tab; a plain click just activates it. */
  onTabClick(ev: MouseEvent, path: string): void {
    if (ev.shiftKey) {
      this.tabs.close(path);
    } else {
      this.tabs.activate(path);
    }
  }

  closeTab(ev: Event, path: string): void {
    ev.stopPropagation();
    this.tabs.close(path);
  }

  basename(path: string): string {
    const i = path.lastIndexOf('/');
    return i === -1 ? path : path.slice(i + 1);
  }

  /**
   * Tab caption: the file's base name, kept whole up to 40 chars and otherwise
   * middle-elided (first 10 + "…" + last 27) so the extension stays visible.
   */
  tabLabel(path: string): string {
    const name = this.basename(path);
    if (name.length <= 40) return name;
    return name.slice(0, 10) + '...' + name.slice(-27);
  }

  private async restoreSession(): Promise<void> {
    const vizId = await this.session.restore();
    if (vizId) this.registry.select(vizId);
  }
}

function relativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function clampState(s: PanelState | undefined): PanelState | null {
  if (!s || typeof s.width !== 'number') return null;
  return {
    width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.width)),
    collapsed: Boolean(s.collapsed),
  };
}
