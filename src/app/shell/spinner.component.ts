import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AnalysisStore } from '../core/state/analysis.store';

@Component({
  selector: 'loco-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="overlay" role="status" aria-live="polite">
        <div class="card">
          <div class="ring" aria-hidden="true"></div>
          <div class="text">
            <div class="line">{{ headline() }}</div>
            @if (progressText(); as p) {
              <div class="sub">{{ p }}</div>
              <div class="bar"><div class="fill" [style.width.%]="progressPct()"></div></div>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 50;
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--bg) 75%, transparent);
        backdrop-filter: blur(2px);
        pointer-events: auto;
      }
      .card {
        display: flex;
        align-items: center;
        gap: 14px;
        background: var(--bar-bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 14px 18px;
        min-width: 280px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      }
      .ring {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
        border-top-color: var(--accent);
        animation: spin 0.85s linear infinite;
        flex-shrink: 0;
      }
      .text {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        flex: 1;
      }
      .line {
        font-size: 13px;
        font-weight: 500;
      }
      .sub {
        font-size: 11px;
        opacity: 0.7;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .bar {
        margin-top: 2px;
        height: 3px;
        background: color-mix(in srgb, var(--accent) 15%, transparent);
        border-radius: 2px;
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: var(--accent);
        transition: width 0.15s ease-out;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class SpinnerComponent {
  private readonly store = inject(AnalysisStore);

  readonly status = this.store.status;

  readonly visible = computed(() => {
    const p = this.status().phase;
    return p === 'loading' || p === 'counting' || p === 'parsing';
  });

  readonly headline = computed(() => {
    const s = this.status();
    switch (s.phase) {
      case 'loading':
        return s.message;
      case 'counting':
        return 'Counting lines…';
      case 'parsing':
        return 'Parsing ASTs…';
      default:
        return '';
    }
  });

  readonly progressText = computed(() => {
    const s = this.status();
    if (s.phase !== 'counting' && s.phase !== 'parsing') return null;
    return `${s.done.toLocaleString()} / ${s.total.toLocaleString()}`;
  });

  readonly progressPct = computed(() => {
    const s = this.status();
    if ((s.phase !== 'counting' && s.phase !== 'parsing') || s.total === 0) return 0;
    return Math.min(100, Math.round((s.done / s.total) * 100));
  });
}
