import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

/**
 * Sticky pagination bar shown above the editor/hex pane when a file is too big to render
 * at once. Pages through the file in fixed windows (1500 lines, or the hex byte window),
 * and the Last button jumps straight to the tail of the file.
 */
@Component({
  selector: 'loco-preview-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <span class="label">
        Preview — {{ unit }} {{ from.toLocaleString() }}–{{ to.toLocaleString() }} of
        {{ total.toLocaleString() }}
      </span>
      <span class="nav">
        <button type="button" (click)="first.emit()" [disabled]="page === 0" title="First page">
          « First
        </button>
        <button type="button" (click)="prev.emit()" [disabled]="page === 0" title="Previous page">
          ‹ Prev
        </button>
        <span class="page">{{ page + 1 }} / {{ pageCount }}</span>
        <button
          type="button"
          (click)="next.emit()"
          [disabled]="page >= pageCount - 1"
          title="Next page"
        >
          Next ›
        </button>
        <button
          type="button"
          (click)="last.emit()"
          [disabled]="page >= pageCount - 1"
          [title]="'Show the last ' + unit"
        >
          Last »
        </button>
      </span>
    </div>
  `,
  styles: [
    `
      :host {
        flex: none;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 500;
        background: #ffe066;
        color: #5c4400;
        border-bottom: 1px solid #eab308;
      }
      .label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .nav {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .page {
        font-variant-numeric: tabular-nums;
        padding: 0 4px;
        opacity: 0.85;
      }
      button {
        font: inherit;
        font-weight: 600;
        color: #5c4400;
        background: color-mix(in srgb, #eab308 20%, transparent);
        border: 1px solid #eab308;
        border-radius: 3px;
        padding: 1px 7px;
        cursor: pointer;
        white-space: nowrap;
      }
      button:hover:not(:disabled) {
        background: color-mix(in srgb, #eab308 40%, transparent);
      }
      button:disabled {
        opacity: 0.4;
        cursor: default;
      }
    `,
  ],
})
export class PreviewBarComponent {
  /** "lines" or "bytes". */
  @Input() unit = 'lines';
  @Input() from = 0;
  @Input() to = 0;
  @Input() total = 0;
  /** 0-based current page. */
  @Input() page = 0;
  @Input() pageCount = 1;

  @Output() readonly first = new EventEmitter<void>();
  @Output() readonly prev = new EventEmitter<void>();
  @Output() readonly next = new EventEmitter<void>();
  @Output() readonly last = new EventEmitter<void>();
}
