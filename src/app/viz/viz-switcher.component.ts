import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { VizRegistry } from './viz-registry';
import { AnalysisStore } from '../core/state/analysis.store';
import { fileCount, formatSize, metricValue } from '../core/models/tree';

/**
 * The visualization picker for the Overview tab — a segmented tab row that swaps the viz
 * shown in the main area (treemap, list, sunburst, module graph, dep matrix). Lives in the
 * main area rather than a global toolbar, so it only appears alongside the Overview.
 *
 * The right side carries whole-project stats (files, LOC, size). These are deliberately
 * unfiltered — they summarise the entire analysed folder, not whatever the name/path/ignore
 * filters currently narrow the vizzes down to.
 */
@Component({
  selector: 'loco-viz-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <div class="tabs" role="tablist">
        @for (v of vizList(); track v.id) {
          <button
            type="button"
            role="tab"
            class="tab"
            [class.active]="selectedId() === v.id"
            [attr.aria-selected]="selectedId() === v.id"
            (click)="select(v.id)"
          >
            {{ v.label }}
          </button>
        }
      </div>
      @if (stats(); as s) {
        <div class="stats" title="Whole-folder totals, ignoring the active filters">
          <span class="stat"><strong>{{ s.files }}</strong> files</span>
          <span class="sep">·</span>
          <span class="stat"><strong>{{ s.loc }}</strong> LOC</span>
          <span class="sep">·</span>
          <span class="stat"><strong>{{ s.size }}</strong></span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 10px;
      }
      .tabs {
        display: flex;
        gap: 2px;
        min-width: 0;
        overflow-x: auto;
      }
      .stats {
        margin-left: auto;
        flex-shrink: 0;
        display: flex;
        align-items: baseline;
        gap: 6px;
        font-size: 11px;
        opacity: 0.7;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .stats .stat strong {
        font-weight: 600;
        opacity: 1;
      }
      .stats .sep {
        opacity: 0.4;
      }
      .tab {
        background: transparent;
        border: 1px solid transparent;
        color: inherit;
        font: inherit;
        font-size: 12px;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
        opacity: 0.7;
      }
      .tab:hover:not(.active) {
        opacity: 1;
        background: var(--hover);
      }
      .tab.active {
        opacity: 1;
        background: var(--accent);
        color: var(--accent-fg);
        border-color: var(--accent);
      }
    `,
  ],
})
export class VizSwitcherComponent {
  private readonly registry = inject(VizRegistry);
  private readonly store = inject(AnalysisStore);
  readonly vizList = this.registry.all;
  readonly selectedId = this.registry.selectedId;

  /** Whole-folder totals — computed from the unfiltered root, so filters don't move them. */
  readonly stats = computed<{ files: string; loc: string; size: string } | null>(() => {
    const root = this.store.root();
    if (!root) return null;
    return {
      files: fileCount(root).toLocaleString(),
      loc: metricValue(root, 'loc').toLocaleString(),
      size: formatSize(metricValue(root, 'size')),
    };
  });

  select(id: string): void {
    this.registry.select(id);
  }
}
