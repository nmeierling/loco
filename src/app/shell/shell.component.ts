import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AnalysisService } from '../core/services/analysis.service';
import { AnalysisStore } from '../core/state/analysis.store';
import { LoadResult } from '../core/services/directory-loader.service';
import { FilterBarComponent } from '../filters/filter-bar.component';
import { DropZoneComponent } from './drop-zone.component';
import { SpinnerComponent } from './spinner.component';
import { DirectoryTreeComponent } from './directory-tree.component';

@Component({
  selector: 'loco-shell',
  standalone: true,
  imports: [
    FilterBarComponent,
    DropZoneComponent,
    SpinnerComponent,
    DirectoryTreeComponent,
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
        <loco-drop-zone (loaded)="onLoaded($event)" (error)="onError($event)" />
        @if (errorMessage()) {
          <div class="err">{{ errorMessage() }}</div>
        }
      </section>
    } @else {
      <loco-filter-bar />
      <div class="body">
        <aside class="sidebar">
          <loco-directory-tree />
        </aside>
        <main class="viz-area">
          <router-outlet />
        </main>
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
      }
      .sidebar {
        width: 280px;
        flex-shrink: 0;
        border-right: 1px solid var(--border);
        background: var(--bar-bg);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .sidebar > loco-directory-tree {
        flex: 1;
        min-height: 0;
      }
      .viz-area {
        flex: 1;
        min-height: 0;
        min-width: 0;
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
  readonly errorMessage = signal<string | null>(null);

  readonly statusLine = computed(() => {
    const s = this.store.status();
    switch (s.phase) {
      case 'loading':
        return s.message;
      case 'counting':
        return `Counting ${s.done}/${s.total}…`;
      case 'parsing':
        return `Parsing ${s.done}/${s.total}…`;
      case 'error':
        return `Error: ${s.message}`;
      default:
        return null;
    }
  });

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
