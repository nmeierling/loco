import { Injectable, inject, signal } from '@angular/core';
import { TabsStore } from '../core/state/tabs.store';

export interface AstRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Holds the highlighted range for one AST view. It is provided per AST view (not in root),
 * so every open tab keeps its own selection; cross-file jumps hand the range to the target
 * tab through {@link TabsStore.openFileAt} rather than a shared signal.
 */
@Injectable()
export class AstSelectionService {
  private readonly tabs = inject(TabsStore);

  readonly range = signal<AstRange | null>(null);

  setRange(r: AstRange | null): void {
    this.range.set(r);
  }

  /** Reveals `range`: in place if it targets the active file, else in that file's tab. */
  jumpTo(path: string, range: AstRange): void {
    if (this.tabs.activePath() === path) {
      this.range.set(range);
      return;
    }
    this.tabs.openFileAt(path, range);
  }
}
