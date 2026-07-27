import { Injectable, inject, signal } from '@angular/core';
import { AnalysisStore } from '../core/state/analysis.store';

export interface AstRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

@Injectable({ providedIn: 'root' })
export class AstSelectionService {
  private readonly store = inject(AnalysisStore);

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

  /** Opens `path` in the AST view and highlights `range` once it is parsed. */
  jumpTo(path: string, range: AstRange): void {
    if (this.store.selectedPath() === path) {
      this.range.set(range);
      return;
    }
    this.pending.set({ path, range });
    this.store.selectPath(path);
  }

  /** Consumes a pending jump for `path`, if one is waiting. */
  takePending(path: string): AstRange | null {
    const p = this.pending();
    if (!p || p.path !== path) return null;
    this.pending.set(null);
    return p.range;
  }
}
