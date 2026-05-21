import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AstSelectionService } from './ast-selection.service';
import { HighlightToken } from '../core/services/complexity.service';

interface Segment {
  kind: string;
  text: string;
}

@Component({
  selector: 'loco-source-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" #wrap>
      <div class="code">
        @for (segs of lineSegments(); track $index) {
          <div
            class="row"
            [attr.id]="'L' + ($index + 1)"
            [class.highlighted]="isHighlighted($index + 1)"
            [class.start]="isStart($index + 1)"
            [class.end]="isEnd($index + 1)"
          ><span class="num">{{ $index + 1 }}</span><span class="text">@for (seg of segs; track $index) {<span [class]="seg.kind ? 'tok tok-' + seg.kind : 'tok'">{{ seg.text }}</span>}</span></div>
        }
      </div>
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
        line-height: 1.35;
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
      .tok {
        white-space: pre;
      }
      .tok-comment {
        color: var(--tok-comment);
        font-style: italic;
      }
      .tok-keyword {
        color: var(--tok-keyword);
      }
      .tok-string {
        color: var(--tok-string);
      }
      .tok-number {
        color: var(--tok-number);
      }
      .tok-ident {
        color: var(--tok-ident);
      }
    `,
  ],
})
export class SourcePanelComponent implements AfterViewInit {
  private readonly selection = inject(AstSelectionService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wrap', { static: true }) wrap!: ElementRef<HTMLDivElement>;

  private readonly lines = signal<string[]>([]);
  private readonly tokens = signal<readonly HighlightToken[]>([]);
  readonly range = this.selection.range;
  readonly lineSegments = computed<Segment[][]>(() => buildSegments(this.lines(), this.tokens()));

  @Input({ required: true }) set text(value: string) {
    this.lines.set(value.length === 0 ? [] : value.split(/\r\n|\n|\r/));
    queueMicrotask(() => this.wrap?.nativeElement.scrollTo({ top: 0 }));
  }

  @Input() set tokensInput(value: readonly HighlightToken[] | null) {
    this.tokens.set(value ?? []);
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

function buildSegments(lines: readonly string[], tokens: readonly HighlightToken[]): Segment[][] {
  const out: Segment[][] = [];
  if (lines.length === 0) return out;
  if (tokens.length === 0) {
    for (const line of lines) out.push([{ kind: '', text: line }]);
    return out;
  }
  // Bucket tokens by line, slicing multi-line spans (e.g. block comments).
  const perLine: { start: number; end: number; kind: string }[][] = lines.map(() => []);
  for (const t of tokens) {
    const startRow = Math.max(0, t.startRow);
    const endRow = Math.min(lines.length - 1, t.endRow);
    for (let r = startRow; r <= endRow; r++) {
      const lineLen = lines[r].length;
      const sc = r === t.startRow ? Math.max(0, t.startCol) : 0;
      const ec = r === t.endRow ? Math.min(lineLen, t.endCol) : lineLen;
      if (ec > sc) perLine[r].push({ start: sc, end: ec, kind: t.kind });
    }
  }
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    const spans = perLine[r].sort((a, b) => a.start - b.start || b.end - a.end);
    const segs: Segment[] = [];
    let cursor = 0;
    for (const s of spans) {
      // Skip spans that start before our cursor — they're already covered by an
      // earlier (wider) span. Anonymous keyword/punctuation can nest under a
      // named identifier's range in some grammars; we keep the outer one.
      if (s.start < cursor) continue;
      if (s.start > cursor) segs.push({ kind: '', text: line.slice(cursor, s.start) });
      segs.push({ kind: s.kind, text: line.slice(s.start, s.end) });
      cursor = s.end;
    }
    if (cursor < line.length) segs.push({ kind: '', text: line.slice(cursor) });
    if (segs.length === 0) segs.push({ kind: '', text: line });
    out.push(segs);
  }
  return out;
}
