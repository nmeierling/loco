import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalysisStore } from '../core/state/analysis.store';
import { MetricKind, fileCount, metricValue } from '../core/models/tree';
import { VizRegistry } from '../viz/viz-registry';

interface MetricOption {
  id: MetricKind;
  label: string;
  hidden?: boolean;
}

@Component({
  selector: 'loco-filter-bar',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <input
        class="search"
        type="search"
        placeholder="filter by name…"
        [ngModel]="filters().name"
        (ngModelChange)="updateName($event)"
      />
      <input
        class="search path"
        type="search"
        placeholder="filter by path… (click the funnel next to a folder)"
        [ngModel]="filters().path"
        (ngModelChange)="updatePath($event)"
      />
      @if (filters().path) {
        <button class="clear" type="button" (click)="updatePath('')" title="Clear path filter">×</button>
      }

      <div class="group">
        <span class="label">metric</span>
        @for (m of metrics; track m.id) {
          @if (!m.hidden) {
            <button
              type="button"
              class="chip"
              [class.active]="filters().metric === m.id"
              (click)="setMetric(m.id)"
            >
              {{ m.label }}
            </button>
          }
        }
      </div>

      <div class="group">
        <span class="label">viz</span>
        @for (v of vizList(); track v.id) {
          <button
            type="button"
            class="chip"
            [class.active]="selectedViz() === v.id"
            (click)="setViz(v.id)"
          >
            {{ v.label }}
          </button>
        }
      </div>

      <div class="spacer"></div>

      <div class="stats">
        <span>{{ filesCount() }} files</span>
        <span>·</span>
        <span>{{ totalLoc() | number }} LOC</span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        border-bottom: 1px solid var(--border);
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--bar-bg);
      }
      .search {
        background: var(--input-bg);
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        font-family: inherit;
        min-width: 140px;
      }
      .search.path {
        min-width: 440px;
        flex: 1 1 440px;
      }
      .search:focus {
        outline: none;
        border-color: var(--accent);
      }
      .clear {
        background: transparent;
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 4px;
        width: 22px;
        height: 22px;
        padding: 0;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        opacity: 0.6;
        margin-left: -4px;
      }
      .clear:hover {
        opacity: 1;
        border-color: var(--accent);
        color: var(--accent);
      }
      .group {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .label {
        font-size: 11px;
        opacity: 0.55;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-right: 2px;
      }
      .chip {
        border: 1px solid var(--border);
        background: transparent;
        color: inherit;
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      .chip.active {
        background: var(--accent);
        color: var(--accent-fg);
        border-color: var(--accent);
      }
      .chip:hover:not(.active) {
        background: var(--hover);
      }
      .spacer {
        flex: 1;
      }
      .stats {
        font-size: 11px;
        opacity: 0.7;
        display: flex;
        gap: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `,
  ],
})
export class FilterBarComponent {
  private readonly store = inject(AnalysisStore);
  private readonly registry = inject(VizRegistry);

  readonly filters = this.store.filters;

  readonly metrics: MetricOption[] = [
    { id: 'loc', label: 'LOC' },
    { id: 'complexity', label: 'Complexity' },
    { id: 'churn', label: 'Churn', hidden: true },
  ];

  readonly vizList = this.registry.all;
  readonly selectedViz = this.registry.selectedId;

  readonly filesCount = computed(() => {
    const r = this.store.filteredRoot();
    return r ? fileCount(r) : 0;
  });

  readonly totalLoc = computed(() => {
    const r = this.store.filteredRoot();
    return r ? metricValue(r, 'loc') : 0;
  });

  updateName(name: string): void {
    this.store.updateFilters({ name });
  }
  updatePath(path: string): void {
    this.store.updateFilters({ path });
  }
  setMetric(metric: MetricKind): void {
    this.store.updateFilters({ metric });
  }
  setViz(id: string): void {
    this.registry.select(id);
  }
}
