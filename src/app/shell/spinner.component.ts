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
            }
            @if (progressPct() !== null) {
              <div class="bar"><div class="fill" [style.width.%]="progressPct()"></div></div>
            } @else if (visible()) {
              <div class="bar indeterminate"><div class="fill-indet"></div></div>
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
      .bar.indeterminate {
        position: relative;
        overflow: hidden;
      }
      .fill-indet {
        position: absolute;
        top: 0;
        bottom: 0;
        left: -40%;
        width: 40%;
        background: var(--accent);
        border-radius: 2px;
        animation: indet 1.1s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      @keyframes indet {
        from { left: -40%; }
        to { left: 100%; }
      }
    `,
  ],
})
export class SpinnerComponent {
  private readonly store = inject(AnalysisStore);

  readonly status = this.store.status;

  readonly visible = computed(() => {
    const p = this.status().phase;
    return (
      p === 'reading' ||
      p === 'loading' ||
      p === 'counting' ||
      p === 'parsing' ||
      p === 'churn'
    );
  });

  readonly headline = computed(() => {
    const s = this.status();
    switch (s.phase) {
      case 'reading':
        return 'Reading folder…';
      case 'loading':
        return s.message;
      case 'counting':
        return 'Counting lines…';
      case 'parsing':
        return 'Parsing ASTs…';
      case 'churn':
        return 'Walking git history…';
      default:
        return '';
    }
  });

  readonly progressText = computed(() => {
    const s = this.status();
    if (s.phase === 'reading') {
      if (s.done === 0) return null;
      const n = s.done.toLocaleString();
      return `${n} ${s.done === 1 ? 'file' : 'files'} discovered`;
    }
    if (s.phase === 'churn') {
      if (s.total === 0) return null;
      return `${s.done.toLocaleString()} / ${s.total.toLocaleString()} commits`;
    }
    if (s.phase !== 'counting' && s.phase !== 'parsing') return null;
    return `${s.done.toLocaleString()} / ${s.total.toLocaleString()}`;
  });

  readonly progressPct = computed(() => {
    const s = this.status();
    if (s.phase === 'reading') return null;
    if (s.phase === 'churn') {
      if (s.total === 0) return null;
      return Math.min(100, Math.round((s.done / s.total) * 100));
    }
    if ((s.phase !== 'counting' && s.phase !== 'parsing') || s.total === 0) return 0;
    return Math.min(100, Math.round((s.done / s.total) * 100));
  });
}
