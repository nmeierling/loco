import { Injectable, signal } from '@angular/core';

export interface AstRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

@Injectable({ providedIn: 'root' })
export class AstSelectionService {
  readonly range = signal<AstRange | null>(null);

  setRange(r: AstRange | null): void {
    this.range.set(r);
  }
}
