import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface HexRow {
  offset: string;
  hex: string;
  ascii: string;
}

/**
 * Read-only hex dump for binary files: an offset column, 16 bytes per row rendered as
 * hex pairs, and an ASCII gutter (non-printable bytes shown as `.`). The bytes handed in
 * are already capped for preview by the AST view, so there is no virtualization here.
 */
@Component({
  selector: 'loco-hex-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="dump">
        @for (row of rows(); track $index) {
          <div class="row">
            <span class="off">{{ row.offset }}</span
            ><span class="hex">{{ row.hex }}</span
            ><span class="ascii">{{ row.ascii }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: var(--input-bg);
      }
      .wrap {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .dump {
        padding: 8px 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.4;
        white-space: pre;
      }
      .row {
        display: flex;
        gap: 16px;
      }
      .off {
        color: color-mix(in srgb, var(--fg) 40%, transparent);
        user-select: none;
      }
      .hex {
        color: var(--tok-number);
      }
      .ascii {
        color: color-mix(in srgb, var(--fg) 75%, transparent);
      }
    `,
  ],
})
export class HexPanelComponent {
  readonly bytes = input<Uint8Array>(new Uint8Array());
  /** Byte offset of the first shown byte within the whole file (for paged previews). */
  readonly baseOffset = input<number>(0);

  readonly rows = computed<HexRow[]>(() => {
    const b = this.bytes();
    const base = this.baseOffset();
    const out: HexRow[] = [];
    for (let o = 0; o < b.length; o += 16) {
      let hex = '';
      let ascii = '';
      for (let i = 0; i < 16; i++) {
        if (o + i < b.length) {
          const v = b[o + i];
          hex += v.toString(16).padStart(2, '0');
          ascii += v >= 32 && v < 127 ? String.fromCharCode(v) : '.';
        } else {
          hex += '  ';
          ascii += ' ';
        }
        // Extra gap after the 8th byte splits the row into two readable halves.
        hex += i === 15 ? '' : i === 7 ? '  ' : ' ';
      }
      out.push({ offset: (base + o).toString(16).padStart(8, '0'), hex, ascii });
    }
    return out;
  });
}
