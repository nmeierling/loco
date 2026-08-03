import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Seg {
  text: string;
  hit: boolean;
}
interface CtxLine {
  num: number;
  segs: Seg[];
  isMatch: boolean;
}
interface HitView {
  line: number;
  ctx: CtxLine[];
  canUp: boolean;
  canDown: boolean;
}

const PAGE_SIZE = 50;
const EXPAND_STEP = 5;

/**
 * Whole-file search shown under the preview bar. Lists the first 20 matching lines (paged),
 * with just enough context: a scalar match shows its one line, a match on an array/object
 * field name shows the opener plus up to 3 following lines, and each hit can grow ±5 lines.
 */
@Component({
  selector: 'loco-file-search',
  standalone: true,
  imports: [FormsModule],
  host: { '[class.active]': 'query().trim().length > 0' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="searchbar">
      <input
        type="text"
        placeholder="Search in file…"
        [ngModel]="query()"
        (ngModelChange)="onQuery($event)"
      />
      @if (query().trim()) {
        <button type="button" class="clear" (click)="clear()" title="Clear search">×</button>
      }
    </div>

    @if (query().trim() && total() > 0) {
      <div class="pagerbar">
        <span class="total">{{ total().toLocaleString() }} {{ total() === 1 ? 'hit' : 'hits' }}</span>
        <span class="stats">{{ resultLabel() }}</span>
        <span class="grow"></span>
        <span class="pager">
          <button type="button" (click)="prevPage()" [disabled]="page() === 0" title="Newer hits">
            ‹
          </button>
          <button
            type="button"
            (click)="nextPage()"
            [disabled]="page() >= pageCount() - 1"
            title="More hits"
          >
            ›
          </button>
        </span>
      </div>
    }

    @if (query().trim()) {
      <div class="results">
        @for (hit of rendered(); track hit.line) {
          <div class="hit">
            @for (l of hit.ctx; track l.num; let first = $first; let last = $last) {
              <div class="ctx" [class.match]="l.isMatch" (click)="jump(hit.line)" title="Open at this line">
                <span class="num">
                  <span class="num-text">{{ l.num }}</span>
                  @if ((first && hit.canUp) || (last && hit.canDown)) {
                    <span class="exp-overlay">
                      @if (first && hit.canUp) {
                        <button
                          type="button"
                          class="exp"
                          title="Show 5 more lines above"
                          (click)="expandUp($event, hit.line)"
                        >
                          ↑5
                        </button>
                      }
                      @if (last && hit.canDown) {
                        <button
                          type="button"
                          class="exp"
                          title="Show 5 more lines below"
                          (click)="expandDown($event, hit.line)"
                        >
                          ↓5
                        </button>
                      }
                    </span>
                  }
                </span
                ><span class="text">
                  @for (s of l.segs; track $index) {
                    <span [class.mark]="s.hit">{{ s.text }}</span>
                  }
                </span>
              </div>
            }
          </div>
        } @empty {
          <div class="empty">No matches for “{{ query().trim() }}”.</div>
        }
        @if (moreCount() > 0) {
          <div class="more" (click)="nextPage()" title="Show the next page of hits">
            + {{ moreCount().toLocaleString() }} more
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: none;
      }
      :host.active {
        flex: 1;
      }
      .searchbar {
        flex: none;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
      }
      .searchbar input {
        flex: 1;
        min-width: 0;
        background: var(--input-bg);
        border: 1px solid var(--border);
        border-radius: 3px;
        color: inherit;
        font: inherit;
        font-size: 12px;
        padding: 3px 8px;
      }
      .pagerbar {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 3px 8px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .total {
        font-weight: 600;
      }
      .stats {
        opacity: 0.65;
      }
      .grow {
        flex: 1;
      }
      .pager {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      button {
        font: inherit;
        font-size: 11px;
        color: inherit;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 1px 6px;
        cursor: pointer;
        line-height: 1.4;
      }
      button:hover:not(:disabled) {
        background: var(--hover);
      }
      button:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .clear {
        border: none;
        font-size: 14px;
        padding: 0 4px;
      }
      .results {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 6px;
      }
      .hit {
        border: 1px solid var(--border);
        border-radius: 4px;
        margin-bottom: 6px;
        overflow: hidden;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.5;
      }
      .ctx {
        display: flex;
        gap: 8px;
        padding: 0 6px;
        white-space: pre;
        cursor: pointer;
      }
      .ctx:hover {
        background: var(--hover);
      }
      .ctx.match {
        background: color-mix(in srgb, var(--accent) 12%, transparent);
      }
      .num {
        position: relative;
        color: color-mix(in srgb, var(--fg) 35%, transparent);
        text-align: right;
        min-width: 46px;
        user-select: none;
        flex-shrink: 0;
      }
      /* The expand controls live in the number cell, revealed on hover of the first/last
         line of a hit — clicking a control grows the context rather than opening the file. */
      .exp-overlay {
        position: absolute;
        inset: 0;
        display: none;
      }
      .num:hover .exp-overlay {
        display: flex;
      }
      .exp {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 10px;
        line-height: 1;
        cursor: pointer;
        color: #5c4400;
        background: #ffe066;
        border: 1px solid #eab308;
      }
      .exp:hover {
        background: #ffd11a;
      }
      .text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mark {
        background: #ffe066;
        color: #5c4400;
        border-radius: 2px;
      }
      .empty {
        opacity: 0.6;
        font-size: 12px;
        padding: 10px 6px;
      }
      .more {
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        padding: 6px;
        cursor: pointer;
        border: 1px dashed var(--border);
        border-radius: 4px;
        opacity: 0.8;
      }
      .more:hover {
        opacity: 1;
        background: var(--hover);
      }
    `,
  ],
})
export class FileSearchComponent {
  readonly lines = input<readonly string[]>([]);

  /** Emits the 0-based line to open in the editor. */
  @Output() readonly gotoLine = new EventEmitter<number>();
  /** Emits whether a query is active, so the host can hide the editor behind the results. */
  @Output() readonly activeChange = new EventEmitter<boolean>();

  readonly query = signal('');
  readonly page = signal(0);
  /** Per-hit extra context, keyed by the hit's line index. */
  private readonly expansions = signal<ReadonlyMap<number, { up: number; down: number }>>(new Map());

  constructor() {
    // A new file (new lines) resets the search entirely.
    effect(() => {
      this.lines();
      this.reset();
    });
  }

  readonly allHits = computed<number[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return [];
    const lines = this.lines();
    const out: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) out.push(i);
    }
    return out;
  });

  readonly total = computed(() => this.allHits().length);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  /** Hits beyond the current page — drives the "+ N more" row. */
  readonly moreCount = computed(() =>
    Math.max(0, this.total() - (this.page() + 1) * PAGE_SIZE),
  );

  readonly rendered = computed<HitView[]>(() => {
    const q = this.query().trim();
    const lines = this.lines();
    const exp = this.expansions();
    const start = this.page() * PAGE_SIZE;
    return this.allHits()
      .slice(start, start + PAGE_SIZE)
      .map((line) => {
        const baseEnd = contextEnd(lines, line);
        const e = exp.get(line) ?? { up: 0, down: 0 };
        const from = Math.max(0, line - e.up);
        const to = Math.min(lines.length - 1, baseEnd + e.down);
        const ctx: CtxLine[] = [];
        for (let i = from; i <= to; i++) {
          ctx.push({ num: i + 1, isMatch: i === line, segs: highlight(lines[i], q) });
        }
        return { line, ctx, canUp: from > 0, canDown: to < lines.length - 1 };
      });
  });

  resultLabel(): string {
    const total = this.allHits().length;
    if (total === 0) return '0 hits';
    const start = this.page() * PAGE_SIZE;
    return `${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`;
  }

  onQuery(value: string): void {
    this.query.set(value);
    this.page.set(0);
    this.expansions.set(new Map());
    this.activeChange.emit(value.trim().length > 0);
  }

  prevPage(): void {
    this.page.update((p) => Math.max(0, p - 1));
  }
  nextPage(): void {
    this.page.update((p) => Math.min(this.pageCount() - 1, p + 1));
  }

  expandUp(ev: Event, line: number): void {
    ev.stopPropagation();
    this.bump(line, EXPAND_STEP, 0);
  }
  expandDown(ev: Event, line: number): void {
    ev.stopPropagation();
    this.bump(line, 0, EXPAND_STEP);
  }

  private bump(line: number, up: number, down: number): void {
    const next = new Map(this.expansions());
    const cur = next.get(line) ?? { up: 0, down: 0 };
    next.set(line, { up: cur.up + up, down: cur.down + down });
    this.expansions.set(next);
  }

  jump(line: number): void {
    this.gotoLine.emit(line);
    this.clear();
  }

  clear(): void {
    this.reset();
    this.activeChange.emit(false);
  }

  private reset(): void {
    this.query.set('');
    this.page.set(0);
    this.expansions.set(new Map());
  }
}

/**
 * How many trailing lines to show for a hit. A line that opens an array or object (ends
 * with `[` or `{`) shows up to three following lines; anything else is a single value line.
 */
function contextEnd(lines: readonly string[], idx: number): number {
  const trimmed = lines[idx].replace(/\s+$/, '');
  const opensBlock = /[[{]$/.test(trimmed);
  return opensBlock ? Math.min(idx + 3, lines.length - 1) : idx;
}

/** Splits a line into plain and matched segments so the query can be highlighted. */
function highlight(line: string, query: string): Seg[] {
  const q = query.trim();
  if (!q) return [{ text: line, hit: false }];
  const lower = line.toLowerCase();
  const ql = q.toLowerCase();
  const segs: Seg[] = [];
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(ql, i);
    if (idx < 0) {
      if (i < line.length) segs.push({ text: line.slice(i), hit: false });
      break;
    }
    if (idx > i) segs.push({ text: line.slice(i, idx), hit: false });
    segs.push({ text: line.slice(idx, idx + q.length), hit: true });
    i = idx + q.length;
  }
  return segs;
}
