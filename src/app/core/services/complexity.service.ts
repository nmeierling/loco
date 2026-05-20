import { Injectable } from '@angular/core';

export interface ComplexityProvider {
  readonly id: string;
  /** Returns null if this provider can't compute complexity for the given language. */
  compute(text: string, languageId: string | null): Promise<number | null>;
}

@Injectable({ providedIn: 'root' })
export class ComplexityService {
  private provider: ComplexityProvider | null = null;

  setProvider(p: ComplexityProvider | null): void {
    this.provider = p;
  }

  hasProvider(): boolean {
    return this.provider !== null;
  }

  async compute(text: string, languageId: string | null): Promise<number | null> {
    if (!this.provider) return null;
    return this.provider.compute(text, languageId);
  }
}

/**
 * Architecture placeholder for tree-sitter-backed complexity.
 *
 * To activate:
 *  - Ship `web-tree-sitter.wasm` and per-language grammar wasms under `public/grammars/`
 *  - Implement `compute` to parse with `web-tree-sitter` and count branch nodes
 *  - Register at bootstrap via `ComplexityService.setProvider(new TreeSitterComplexityProvider())`
 *
 * This also doubles as the parser layer for the planned AST code-flow view.
 */
export class TreeSitterComplexityProvider implements ComplexityProvider {
  readonly id = 'tree-sitter';
  async compute(_text: string, _languageId: string | null): Promise<number | null> {
    return null;
  }
}
