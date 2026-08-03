import { Injectable, computed, inject, signal } from '@angular/core';
import { AnalysisStore } from './analysis.store';

/**
 * Drives the shell's tab bar. The heatmap is a permanent, implicit tab (represented by
 * `activePath === null`); every other tab is an AST view of one open file, keyed by path.
 *
 * This replaced the router-based `/` vs `/ast` switching: opening a file no longer swaps
 * a single AST view, it opens (or focuses) a tab for that file.
 */
@Injectable({ providedIn: 'root' })
export class TabsStore {
  private readonly store = inject(AnalysisStore);

  /** Open AST file tabs, in the order the user opened them. */
  readonly astTabs = signal<readonly string[]>([]);

  /** `null` ⇒ the permanent heatmap tab is active; otherwise the active file path. */
  readonly activePath = signal<string | null>(null);

  readonly isAstActive = computed(() => this.activePath() !== null);

  /** Opens `path` in a new tab, or focuses its existing tab. */
  openFile(path: string): void {
    if (!this.astTabs().includes(path)) this.astTabs.update((t) => [...t, path]);
    this.activePath.set(path);
    this.store.selectPath(path);
  }

  activateHeatmap(): void {
    this.activePath.set(null);
  }

  activate(path: string): void {
    if (!this.astTabs().includes(path)) return;
    this.activePath.set(path);
    this.store.selectPath(path);
  }

  close(path: string): void {
    const tabs = this.astTabs();
    const idx = tabs.indexOf(path);
    if (idx === -1) return;
    const next = tabs.filter((p) => p !== path);
    this.astTabs.set(next);
    if (this.activePath() === path) {
      // Prefer the left neighbour, else whatever slid into this slot, else the heatmap.
      const neighbor = next[idx - 1] ?? next[idx] ?? null;
      this.activePath.set(neighbor);
      if (neighbor) this.store.selectPath(neighbor);
    }
  }

  clear(): void {
    this.astTabs.set([]);
    this.activePath.set(null);
  }

  /** Restores persisted tabs on session reload. `active` is honoured only if still open. */
  restoreOpen(paths: readonly string[], active: string | null): void {
    this.astTabs.set([...paths]);
    this.activePath.set(active && paths.includes(active) ? active : null);
  }
}
