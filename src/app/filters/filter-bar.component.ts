import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalysisStore } from '../core/state/analysis.store';
import { TabsStore } from '../core/state/tabs.store';
import { MetricKind, fileCount, metricValue } from '../core/models/tree';
import { VizRegistry } from '../viz/viz-registry';
import { RiskService } from '../core/services/risk.service';

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
        <button class="clear" type="button" (click)="updatePath('')" title="Clear path filter">
          ×
        </button>
      }

      <div class="group">
        <span class="label">metric</span>
        @for (m of metrics; track m.id) {
          <button
            type="button"
            class="chip"
            [class.active]="filters().metric === m.id"
            [disabled]="isMetricDisabled(m.id)"
            [title]="metricTitle(m.id)"
            (click)="setMetric(m.id)"
          >
            {{ m.label }}
            @if ((m.id === 'churn' && churnPending()) || (m.id === 'risk' && riskPending())) {
              <span class="dot" aria-label="computing"></span>
            }
          </button>
        }
      </div>

      @if (showVizSwitcher()) {
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
      }

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
        /* Fixed-width so removing the VIZ chips on /ast doesn't let the input
           flex-grow into the freed space. The trailing spacer div soaks up the
           remaining row width instead. */
        width: 440px;
        flex: none;
        min-width: 0;
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
      .chip:hover:not(.active):not(:disabled) {
        background: var(--hover);
      }
      .chip:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        background: transparent;
      }
      .dot {
        display: inline-block;
        width: 5px;
        height: 5px;
        margin-left: 5px;
        border-radius: 50%;
        background: currentColor;
        vertical-align: middle;
        animation: pulse 1.1s ease-in-out infinite;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 0.25;
        }
        50% {
          opacity: 1;
        }
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
  private readonly risk = inject(RiskService);

  readonly filters = this.store.filters;

  readonly metrics: MetricOption[] = [
    { id: 'loc', label: 'LOC' },
    { id: 'complexity', label: 'Complexity' },
    { id: 'churn', label: 'Churn' },
    { id: 'risk', label: 'Risk' },
  ];

  readonly hasChurnData = this.store.hasChurnData;
  readonly churnPending = this.store.churnPending;
  readonly riskPending = computed(() => this.store.risk().status === 'computing');

  isMetricDisabled(id: MetricKind): boolean {
    if (id === 'risk') return this.store.risk().status === 'error';
    // Selectable as soon as we know a .git/ is there — the viz shows its own
    // progress state until the history walk lands.
    if (id === 'churn') return !this.store.churnOffered();
    return false;
  }

  metricTitle(id: MetricKind): string {
    if (id === 'risk') return this.riskTitle();
    if (id !== 'churn') return '';
    const c = this.store.churn();
    if (c.status === 'running') {
      return c.total > 0
        ? `Walking git history — ${c.done}/${c.total} commits`
        : 'Walking git history…';
    }
    if (c.status === 'pending') return 'Walking git history…';
    if (c.status === 'error') return `Churn unavailable: ${c.message}`;
    if (!this.hasChurnData()) {
      return (
        'No git churn data for this folder. To enable, drop a folder that contains a ' +
        '.git/ directory. Works in Chromium-based browsers (Chrome, Edge, Brave). ' +
        'Safari and Firefox strip hidden files from folder uploads, so .git/ is not ' +
        'accessible there — open the project in Chrome to see churn.'
      );
    }
    return '';
  }

  readonly vizList = this.registry.all;
  readonly selectedViz = this.registry.selectedId;
  private readonly tabs = inject(TabsStore);
  readonly showVizSwitcher = computed(() => !this.tabs.isAstActive());

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
    // Risk needs the module graph, which is too expensive to build up front — so the
    // first time it is asked for, it is computed.
    if (metric === 'risk') void this.risk.ensure();
  }

  private riskTitle(): string {
    const r = this.store.risk();
    if (r.status === 'computing') return 'Building the dependency graph to score risk…';
    if (r.status === 'error') return `Risk unavailable: ${r.message}`;
    if (r.status === 'ready') {
      const parts = ['complexity'];
      if (r.usedFanIn) parts.push('how many files import it');
      if (r.usedChurn) parts.push('how often it changes');
      return `0-100 score combining ${parts.join(', ')}.`;
    }
    return 'Combines complexity, fan-in and churn into one 0-100 score. Click to compute.';
  }
  setViz(id: string): void {
    this.registry.select(id);
  }
}
