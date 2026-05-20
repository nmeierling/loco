import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AstSelectionService } from './ast-selection.service';

@Component({
  selector: 'loco-source-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      <pre class="code"><code>@for (line of lines(); track $index) {
<span class="row"
       [attr.id]="'L' + ($index + 1)"
       [class.highlighted]="isHighlighted($index + 1)"
       [class.start]="isStart($index + 1)"
       [class.end]="isEnd($index + 1)"
><span class="num">{{ $index + 1 }}</span><span class="text">{{ line }}</span></span>
}</code></pre>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: var(--input-bg);
      }
      .wrap {
        height: 100%;
        overflow: auto;
      }
      .code {
        margin: 0;
        padding: 8px 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.45;
      }
      .row {
        display: grid;
        grid-template-columns: 48px 1fr;
        padding: 0 8px;
      }
      .row.highlighted {
        background: color-mix(in srgb, var(--accent) 14%, transparent);
      }
      .row.highlighted.start {
        box-shadow: inset 0 1px 0 var(--accent);
      }
      .row.highlighted.end {
        box-shadow: inset 0 -1px 0 var(--accent);
      }
      .row.highlighted.start.end {
        box-shadow: inset 0 1px 0 var(--accent), inset 0 -1px 0 var(--accent);
      }
      .num {
        color: color-mix(in srgb, var(--fg) 35%, transparent);
        text-align: right;
        padding-right: 10px;
        user-select: none;
      }
      .text {
        white-space: pre;
      }
    `,
  ],
})
export class SourcePanelComponent implements AfterViewInit {
  private readonly selection = inject(AstSelectionService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  private _text = '';
  readonly lines = signal<string[]>([]);
  readonly range = this.selection.range;

  @Input({ required: true }) set text(value: string) {
    this._text = value;
    this.lines.set(value.length === 0 ? [] : value.split(/\r\n|\n|\r/));
    queueMicrotask(() => this.wrap?.nativeElement.scrollTo({ top: 0 }));
  }

  constructor() {
    effect(() => {
      const r = this.range();
      if (!r) return;
      queueMicrotask(() => this.scrollTo(r.startRow + 1));
    });
  }

  ngAfterViewInit(): void {
    this.destroyRef.onDestroy(() => this.selection.setRange(null));
  }

  isHighlighted(line: number): boolean {
    const r = this.range();
    if (!r) return false;
    return line >= r.startRow + 1 && line <= r.endRow + 1;
  }
  isStart(line: number): boolean {
    const r = this.range();
    return !!r && line === r.startRow + 1;
  }
  isEnd(line: number): boolean {
    const r = this.range();
    return !!r && line === r.endRow + 1;
  }

  private scrollTo(line: number): void {
    const el = this.wrap?.nativeElement.querySelector<HTMLElement>(`#L${line}`);
    if (!el) return;
    const wrap = this.wrap.nativeElement;
    const top = el.offsetTop - wrap.clientHeight / 3;
    wrap.scrollTo({ top, behavior: 'smooth' });
  }
}
