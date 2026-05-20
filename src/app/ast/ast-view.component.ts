import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * AST code-flow view — placeholder.
 *
 * The architecture is already in place to support this:
 *  - `core/services/complexity.service.ts` defines a `ComplexityProvider` plug-point;
 *    a future `TreeSitterComplexityProvider` will host the parser layer.
 *  - `viz/viz-registry.ts` accepts additional viz descriptors; the AST view will
 *    register itself once the parser is wired.
 *
 * Planned features:
 *  - Pick a file from the loaded tree
 *  - Parse with web-tree-sitter (grammars under `public/grammars/{lang}.wasm`)
 *  - Render call graph / control-flow diagram (e.g. dagre + svg)
 */
@Component({
  selector: 'loco-ast-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="placeholder">
      <h2>AST code flow</h2>
      <p>Planned for a future iteration. The plumbing is in place — see comments in:</p>
      <ul>
        <li><code>core/services/complexity.service.ts</code></li>
        <li><code>viz/viz-registry.ts</code></li>
      </ul>
    </div>
  `,
  styles: [
    `
      .placeholder {
        padding: 24px;
        max-width: 640px;
      }
      h2 {
        margin-top: 0;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: var(--input-bg);
        padding: 1px 5px;
        border-radius: 3px;
      }
    `,
  ],
})
export class AstViewComponent {}
