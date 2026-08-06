import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnalysisStore } from '../core/state/analysis.store';
import { RiskService } from '../core/services/risk.service';
import { DisplayMetric } from '../core/models/tree';
import { DirectoryTreeComponent } from './directory-tree.component';

interface MetricOption {
  id: DisplayMetric;
  label: string;
}

/**
 * The expanded contents of the left "Files" sidebar: a header (title, filter toggle, the
 * displayed-metric picker, collapse), an optional name/path filter that expands on demand,
 * and the file tree. It owns the name/path filters and the displayed metric that used to
 * live in the removed global filter bar.
 */
@Component({
  selector: 'loco-file-browser',
  standalone: true,
  imports: [FormsModule, DirectoryTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="panel-head">
      <span class="panel-title">Files</span>
      <button
        type="button"
        class="icon-btn"
        [class.active]="filtersActive()"
        (click)="toggleFilters()"
        [disabled]="hasFilterText()"
        [title]="hasFilterText() ? 'Filters are active — clear them to hide' : 'Filter files'"
        aria-label="Filter files"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M1.5 2.5h13l-5 6.2v4l-3-1v-3l-5-6.2z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <span class="spacer"></span>

      <label class="metric" [title]="metricTitle(metric()) || 'Value shown next to each file/folder'">
        <select [ngModel]="metric()" (ngModelChange)="setMetric($event)">
          @for (m of metrics; track m.id) {
            <option [value]="m.id" [disabled]="isMetricDisabled(m.id)" [title]="metricTitle(m.id)">
              {{ m.label }}
            </option>
          }
        </select>
        @if (metricComputing()) {
          <span class="dot" aria-label="computing"></span>
        }
      </label>

      <button
        class="icon-btn collapse"
        type="button"
        (click)="collapse.emit()"
        title="Collapse"
        aria-label="Collapse files sidebar"
      >
        ‹
      </button>
    </header>

    @if (filtersOpen()) {
      <div class="filters">
        <div class="filter-row">
          <input
            class="input"
            type="search"
            placeholder="filter by name…"
            [ngModel]="filters().name"
            (ngModelChange)="setName($event)"
          />
          @if (filters().name) {
            <button class="clear" type="button" (click)="setName('')" title="Clear name filter">
              ×
            </button>
          }
        </div>
        <div class="filter-row">
          <input
            class="input"
            type="search"
            placeholder="filter by path…"
            [ngModel]="filters().path"
            (ngModelChange)="setPath($event)"
          />
          @if (filters().path) {
            <button class="clear" type="button" (click)="setPath('')" title="Clear path filter">
              ×
            </button>
          }
        </div>
      </div>
    }

    <loco-directory-tree />
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .panel-head {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        flex-shrink: 0;
      }
      .panel-title {
        font-weight: 600;
        font-size: 12px;
      }
      .spacer {
        flex: 1;
      }
      .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 3px;
        width: 22px;
        height: 22px;
        padding: 0;
        line-height: 1;
        font-size: 14px;
        cursor: pointer;
        opacity: 0.75;
        flex-shrink: 0;
      }
      .icon-btn:hover:not(:disabled) {
        opacity: 1;
        background: var(--hover);
      }
      .icon-btn:disabled {
        cursor: default;
      }
      .icon-btn.active {
        opacity: 1;
        color: var(--accent);
        border-color: var(--accent);
      }
      .metric {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .metric select {
        background: var(--input-bg);
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 2px 4px;
        font-size: 11px;
        font-family: inherit;
        max-width: 104px;
      }
      .metric select:focus {
        outline: none;
        border-color: var(--accent);
      }
      .dot {
        display: inline-block;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--accent);
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
      .filters {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        flex-shrink: 0;
      }
      .filter-row {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .input {
        flex: 1;
        min-width: 0;
        background: var(--input-bg);
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 12px;
        font-family: inherit;
      }
      .input:focus {
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
        flex-shrink: 0;
      }
      .clear:hover {
        opacity: 1;
        border-color: var(--accent);
        color: var(--accent);
      }
      loco-directory-tree {
        flex: 1;
        min-height: 0;
      }
    `,
  ],
})
export class FileBrowserComponent {
  private readonly store = inject(AnalysisStore);
  private readonly risk = inject(RiskService);

  /** Asks the shell to collapse this sidebar. */
  readonly collapse = output<void>();

  readonly filters = this.store.filters;
  readonly metric = computed<DisplayMetric>(() => this.store.filters().metric);

  readonly metrics: MetricOption[] = [
    { id: 'count', label: 'File count' },
    { id: 'loc', label: 'LOC' },
    { id: 'complexity', label: 'Complexity' },
    { id: 'churn', label: 'Churn' },
    { id: 'risk', label: 'Risk' },
  ];

  private readonly userOpen = signal(false);
  /** A filter that is set forces the row open — it can't be hidden while filtering. */
  readonly hasFilterText = computed(() => !!(this.filters().name || this.filters().path));
  readonly filtersOpen = computed(() => this.userOpen() || this.hasFilterText());
  readonly filtersActive = computed(() => this.filtersOpen());

  private readonly churnPending = this.store.churnPending;
  private readonly riskPending = computed(() => this.store.risk().status === 'computing');

  /** The metric shown next to files is still being computed (churn walk / risk scoring). */
  readonly metricComputing = computed(() => {
    const m = this.metric();
    return (m === 'churn' && this.churnPending()) || (m === 'risk' && this.riskPending());
  });

  toggleFilters(): void {
    if (this.hasFilterText()) return; // pinned open while filtering
    this.userOpen.update((v) => !v);
  }

  isMetricDisabled(id: DisplayMetric): boolean {
    if (id === 'risk') return this.store.risk().status === 'error';
    // Offerable as soon as a .git/ is detected; the viz shows its own progress until then.
    if (id === 'churn') return !this.store.churnOffered();
    return false;
  }

  /** Explains churn/risk availability and how they are measured; empty for plain metrics. */
  metricTitle(id: DisplayMetric): string {
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
    if (!this.store.hasChurnData()) {
      return (
        'No git churn data for this folder. To enable, drop a folder that contains a ' +
        '.git/ directory. Works in Chromium-based browsers (Chrome, Edge, Brave). ' +
        'Safari and Firefox strip hidden files from folder uploads, so .git/ is not ' +
        'accessible there — open the project in Chrome to see churn.'
      );
    }
    return '';
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

  setMetric(metric: DisplayMetric): void {
    this.store.updateFilters({ metric });
    // Risk needs the module graph, too costly to build up front — compute on first use.
    if (metric === 'risk') void this.risk.ensure();
  }

  setName(name: string): void {
    this.store.updateFilters({ name });
  }
  setPath(path: string): void {
    this.store.updateFilters({ path });
  }
}
