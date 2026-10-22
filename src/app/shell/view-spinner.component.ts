import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * In-view loading overlay. The app-level {@link SpinnerComponent} covers the whole
 * window during analysis; this one sits inside a single pane while that pane builds
 * its own layout (treemap tiles, matrix cells, the symbol index…), so the rest of the
 * UI stays usable.
 *
 * The parent element must be positioned — the host fills it with `inset: 0`.
 */
@Component({
  selector: 'loco-view-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card" role="status" aria-live="polite">
      <div class="ring" aria-hidden="true"></div>
      <div class="text">
        <div class="line">{{ label() }}</div>
        @if (detail(); as d) {
          <div class="sub">{{ d }}</div>
        }
        @if (pct(); as p) {
          <div class="bar"><div class="fill" [style.width.%]="p"></div></div>
        } @else {
          <div class="bar indeterminate"><div class="fill-indet"></div></div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--bg) 62%, transparent);
        backdrop-filter: blur(1px);
      }
      .card {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--bar-bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 12px 16px;
        min-width: 240px;
        max-width: 80%;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      }
      .ring {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
        border-top-color: var(--accent);
        animation: view-spin 0.85s linear infinite;
        flex-shrink: 0;
      }
      .text {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        flex: 1;
      }
      .line {
        font-size: 12.5px;
        font-weight: 500;
      }
      .sub {
        font-size: 11px;
        opacity: 0.68;
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
      }
      .fill-indet {
        position: absolute;
        top: 0;
        bottom: 0;
        left: -40%;
        width: 40%;
        background: var(--accent);
        border-radius: 2px;
        animation: view-indet 1.1s linear infinite;
      }
      @keyframes view-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @keyframes view-indet {
        from {
          left: -40%;
        }
        to {
          left: 100%;
        }
      }
    `,
  ],
})
export class ViewSpinnerComponent {
  readonly label = input('Loading…');
  /** Secondary line — a count, a file name, whatever the view knows. */
  readonly detail = input<string | null>(null);
  /** Supply both to get a determinate bar; leave `total` at 0 for the indeterminate one. */
  readonly done = input(0);
  readonly total = input(0);

  readonly pct = computed(() => {
    const total = this.total();
    if (total <= 0) return null;
    return Math.max(1, Math.min(100, Math.round((this.done() / total) * 100)));
  });
}
