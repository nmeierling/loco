import { Injectable, computed, inject, signal } from '@angular/core';
import { AnalysisStore } from './analysis.store';
import type { AstRange } from '../../ast/ast-selection.service';

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

  /**
   * A cross-file jump target. Each tab keeps its own selection, so a jump can't hand the
   * range to the destination directly — it parks it here for that tab's AST view to claim,
   * whether the tab is brand new or already open.
   */
  readonly pendingRange = signal<{ path: string; range: AstRange } | null>(null);

  /** Opens `path` in a new tab, or focuses its existing tab. */
  openFile(path: string): void {
    if (!this.astTabs().includes(path)) this.astTabs.update((t) => [...t, path]);
    this.activePath.set(path);
    this.store.selectPath(path);
  }

  /** Opens (or focuses) a tab for `path` and asks its AST view to reveal `range`. */
  openFileAt(path: string, range: AstRange): void {
    this.pendingRange.set({ path, range });
    this.openFile(path);
  }

  /** Called by an AST view once it has applied the pending jump. */
  consumePending(): void {
    this.pendingRange.set(null);
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
    this.pendingRange.set(null);
  }

  /** Restores persisted tabs on session reload. `active` is honoured only if still open. */
  restoreOpen(paths: readonly string[], active: string | null): void {
    this.astTabs.set([...paths]);
    this.activePath.set(active && paths.includes(active) ? active : null);
  }
}
