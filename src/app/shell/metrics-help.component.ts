import { ChangeDetectionStrategy, Component, output } from '@angular/core';

/**
 * Explains the two metrics that are not self-evident. LOC and complexity are read
 * straight off the file; churn and risk are derived, computed at different times, and
 * carry caveats worth stating once in full rather than cramming into a tooltip.
 */
@Component({
  selector: 'loco-metrics-help',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metrics-help-title"
        (click)="$event.stopPropagation()"
      >
        <header>
          <h2 id="metrics-help-title">How churn and risk are measured</h2>
          <button type="button" class="close" (click)="closed.emit()" aria-label="Close">×</button>
        </header>

        <section>
          <h3>Churn</h3>
          <p>
            How many commits touched a file, mined from the <code>.git/</code> directory in the
            folder you dropped. A file with high churn is one the team keeps coming back to.
          </p>
          <ul>
            <li>
              History is walked in the background after the tree appears, so the number fills in a
              moment later. Up to 2,000 commits are scanned.
            </li>
            <li>
              Merge commits are diffed against their first parent only, so a merge does not
              double-count the work it brings in.
            </li>
            <li>
              It needs the <code>.git/</code> folder in the upload. Chromium-based browsers include
              hidden folders; Safari and Firefox strip them, so churn is unavailable there.
            </li>
            <li>
              A restored session keeps the numbers but cannot recompute them —
              <code>.git/</code> is not cached.
            </li>
          </ul>
        </section>

        <section>
          <h3>Risk</h3>
          <p>
            A 0–100 score combining three things loco already knows, to point at where defects tend
            to collect: files that are hard to follow, widely depended on, <em>and</em> constantly
            edited.
          </p>
          <ul>
            <li><strong>Complexity</strong> — branching in the file, from its syntax tree.</li>
            <li><strong>Fan-in</strong> — how many other files import it.</li>
            <li><strong>Churn</strong> — how often it changes.</li>
          </ul>
          <p>
            Each is scaled to the largest value in the project, then the three are combined as a
            geometric mean, so no single dimension can carry a file on its own. A hairy file nobody
            imports and never changes scores low, and so does a much-edited one-liner. Complexity is
            not offset: a file with no branching scores zero.
          </p>
          <p class="note">
            Fan-in needs the import graph, which is expensive to build, so the score is computed the
            first time you select the metric. If a project has no git history, churn drops out and
            the score reflects the other two.
          </p>
        </section>

        <footer>
          <button type="button" class="ghost" (click)="closed.emit()">Close</button>
        </footer>
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: color-mix(in srgb, var(--bg) 65%, transparent);
        backdrop-filter: blur(2px);
      }
      .dialog {
        background: var(--bar-bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        max-width: 620px;
        width: 100%;
        max-height: 100%;
        overflow: auto;
        padding: 0 20px 16px;
      }
      header {
        position: sticky;
        top: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 0 10px;
        background: var(--bar-bg);
        border-bottom: 1px solid var(--border);
      }
      h2 {
        margin: 0;
        font-size: 15px;
        flex: 1;
      }
      h3 {
        margin: 18px 0 6px;
        font-size: 13px;
        color: var(--accent);
      }
      p {
        margin: 0 0 8px;
        font-size: 12.5px;
        line-height: 1.55;
      }
      ul {
        margin: 0 0 8px;
        padding-left: 18px;
        font-size: 12.5px;
        line-height: 1.55;
      }
      li {
        margin-bottom: 4px;
      }
      code {
        background: var(--input-bg);
        padding: 1px 5px;
        border-radius: 3px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
      }
      .note {
        opacity: 0.7;
        font-size: 12px;
      }
      footer {
        display: flex;
        justify-content: flex-end;
        margin-top: 14px;
      }
      .close {
        background: transparent;
        border: none;
        color: inherit;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        opacity: 0.6;
        padding: 0 4px;
      }
      .close:hover {
        opacity: 1;
      }
      .ghost {
        border: 1px solid var(--border);
        background: transparent;
        color: inherit;
        padding: 4px 12px;
        border-radius: 3px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
      }
      .ghost:hover {
        background: var(--hover);
      }
    `,
  ],
})
export class MetricsHelpComponent {
  readonly closed = output<void>();
}
