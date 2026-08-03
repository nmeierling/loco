import { Injectable, inject, signal } from '@angular/core';
import { TabsStore } from '../core/state/tabs.store';

export interface AstRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

@Injectable({ providedIn: 'root' })
export class AstSelectionService {
  private readonly tabs = inject(TabsStore);

  readonly range = signal<AstRange | null>(null);

  /**
   * Range to apply once a cross-file jump finishes loading. The AST view clears the
   * selection whenever the open file changes, so a jump has to hand the range over
   * rather than set it directly.
   */
  readonly pending = signal<{ path: string; range: AstRange } | null>(null);

  setRange(r: AstRange | null): void {
    this.range.set(r);
  }

  /** Opens (or focuses) a tab for `path` and highlights `range` once it is parsed. */
  jumpTo(path: string, range: AstRange): void {
    if (this.tabs.activePath() === path) {
      this.range.set(range);
      return;
    }
    this.pending.set({ path, range });
    this.tabs.openFile(path);
  }

  /** Consumes a pending jump for `path`, if one is waiting. */
  takePending(path: string): AstRange | null {
    const p = this.pending();
    if (!p || p.path !== path) return null;
    this.pending.set(null);
    return p.range;
  }
}
