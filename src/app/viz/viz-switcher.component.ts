import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VizRegistry } from './viz-registry';

/**
 * The visualization picker for the Overview tab — a segmented tab row that swaps the viz
 * shown in the main area (treemap, list, sunburst, module graph, dep matrix). Lives in the
 * main area rather than a global toolbar, so it only appears alongside the Overview.
 */
@Component({
  selector: 'loco-viz-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
  `,
  styles: [
    `
      :host {
        display: block;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
      }
      .tabs {
        display: flex;
        gap: 2px;
        padding: 6px 10px;
        overflow-x: auto;
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
  readonly vizList = this.registry.all;
  readonly selectedId = this.registry.selectedId;

  select(id: string): void {
    this.registry.select(id);
  }
}
