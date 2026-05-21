import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AnalysisService } from '../core/services/analysis.service';
import { AnalysisStore } from '../core/state/analysis.store';
import { LoadResult } from '../core/services/directory-loader.service';
import { FilterBarComponent } from '../filters/filter-bar.component';
import { DropZoneComponent } from './drop-zone.component';
import { SpinnerComponent } from './spinner.component';
import { DirectoryTreeComponent } from './directory-tree.component';
import { IgnorePanelComponent } from './ignore-panel.component';

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
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <div class="brand">
        <span class="logo">loco</span>
        <span class="tag">lines of code, visualized</span>
      </div>
      <nav class="nav">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">heatmap</a>
        <a routerLink="/ast" routerLinkActive="active">ast</a>
      </nav>
      @if (store.root(); as r) {
        <div class="root">
          <span class="root-name" [title]="store.rootName()">{{ store.rootName() }}</span>
          <button class="ghost" type="button" (click)="reset()">change folder</button>
        </div>
      }
    </header>

    @if (!store.root()) {
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
              <button class="collapse-btn" type="button" (click)="toggle('left')" title="Collapse">‹</button>
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
          <router-outlet />
        </main>

        <aside
          class="sidebar right"
          [class.collapsed]="right().collapsed"
          [style.width.px]="right().collapsed ? collapsedWidth : right().width"
        >
          @if (right().collapsed) {
            <button class="open-btn" type="button" (click)="toggle('right')" title="Show ignore list">
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
              <button class="collapse-btn" type="button" (click)="toggle('right')" title="Collapse">›</button>
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
      }
      .nav a {
        color: inherit;
        text-decoration: none;
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 3px;
        opacity: 0.7;
      }
      .nav a.active {
        opacity: 1;
        background: var(--hover);
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
  private readonly analysis = inject(AnalysisService);
  private readonly destroyRef = inject(DestroyRef);
  readonly errorMessage = signal<string | null>(null);

  readonly collapsedWidth = COLLAPSED_WIDTH;

  private readonly persisted = this.loadPersisted();
  readonly left = signal<PanelState>(this.persisted.left);
  readonly right = signal<PanelState>(this.persisted.right);

  private dragging: { side: Side; startX: number; startWidth: number } | null = null;

  readonly statusLine = computed(() => {
    const s = this.store.status();
    switch (s.phase) {
      case 'reading':
        return `Reading ${s.done.toLocaleString()} files…`;
      case 'loading':
        return s.message;
      case 'counting':
        return `Counting ${s.done}/${s.total}…`;
      case 'parsing':
        return `Parsing ${s.done}/${s.total}…`;
      case 'churn':
        return s.total > 0 ? `Walking history ${s.done}/${s.total}…` : 'Walking git history…';
      case 'error':
        return `Error: ${s.message}`;
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
      const raw = this.dragging.side === 'left'
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
    this.errorMessage.set(null);
  }
}

function clampState(s: PanelState | undefined): PanelState | null {
  if (!s || typeof s.width !== 'number') return null;
  return {
    width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.width)),
    collapsed: Boolean(s.collapsed),
  };
}
