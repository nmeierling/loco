import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { AnalysisStore } from '../../core/state/analysis.store';
import { TabsStore } from '../../core/state/tabs.store';
import { SymbolIndexService, SymbolDef } from '../../core/services/symbol-index.service';
import { ComplexityDepthService, Flow, FlowNode } from '../../core/services/complexity-depth.service';

/** How many flows to render before offering the filter as the way to see more. */
const DISPLAY_CAP = 50;

/**
 * One node of a flow's call tree. Recurses through its callees; a `repeat` node (a diamond
 * join or recursive back-edge) is a dimmed leaf and never expands.
 */
@Component({
  selector: 'loco-flow-branch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="branch">
      <div class="brow" [class.repeat]="node().repeat" [style.padding-left.px]="8 + depth() * 14">
        @if (expandable()) {
          <button type="button" class="chev" (click)="toggle()" [attr.aria-expanded]="open()">
            {{ open() ? '▾' : '▸' }}
          </button>
        } @else {
          <span class="chev spacer">{{ node().repeat ? '↻' : '' }}</span>
        }
        <button type="button" class="sym" (click)="openNode()" [title]="node().def.path">
          <span class="dot" [style.background]="color()"></span>
          <span class="name">{{ label() }}</span>
          <span class="file">{{ file() }}</span>
          <span class="cx" title="branches in this function">{{ node().complexity }}</span>
        </button>
      </div>
      @if (expandable() && open()) {
        @for (child of node().children; track $index) {
          <loco-flow-branch [node]="child" [depth]="depth() + 1" />
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .brow {
        display: flex;
        align-items: center;
        gap: 4px;
        padding-right: 10px;
      }
      .brow:hover {
        background: var(--hover);
      }
      .brow.repeat {
        opacity: 0.55;
      }
      .chev {
        width: 14px;
        flex-shrink: 0;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        font-size: 10px;
        opacity: 0.6;
        cursor: pointer;
        padding: 0;
        text-align: center;
      }
      .chev.spacer {
        cursor: default;
        opacity: 0.5;
      }
      .sym {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        font-size: 12px;
        text-align: left;
        padding: 2px 0;
        cursor: pointer;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .name {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
      }
      .file {
        font-size: 10px;
        opacity: 0.5;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cx {
        margin-left: auto;
        flex-shrink: 0;
        font-size: 10px;
        opacity: 0.6;
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `,
  ],
})
export class FlowBranchComponent {
  private readonly tabs = inject(TabsStore);

  readonly node = input.required<FlowNode>();
  readonly depth = input.required<number>();

  readonly open = signal(true);

  readonly expandable = computed(() => !this.node().repeat && this.node().children.length > 0);
  readonly label = computed(() => labelFor(this.node().def));
  readonly color = computed(() => colorFor(this.node().def));
  readonly file = computed(() => fileTag(this.node().def));

  toggle(): void {
    this.open.update((v) => !v);
  }

  openNode(): void {
    const d = this.node().def;
    this.tabs.openFileAt(d.path, {
      startRow: d.startRow,
      startCol: d.startCol,
      endRow: d.endRow,
      endCol: d.endCol,
    });
  }
}

@Component({
  selector: 'loco-complexity-depth',
  standalone: true,
  imports: [FlowBranchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="controls">
        <span class="heading">Complexity depth</span>
        <div class="spacer"></div>
        @if (ready()) {
          <div class="count">{{ shownCount() }} / {{ flows().length }} flows</div>
          <button
            type="button"
            class="copy"
            [disabled]="flows().length === 0"
            (click)="copy()"
            title="Copy the flow list below to the clipboard as text"
          >
            {{ copied() ? 'copied' : 'copy' }}
          </button>
        }
      </div>

      @if (!store.root()) {
        <div class="empty"><p>Drop a folder to analyze.</p></div>
      } @else if (progress(); as p) {
        <div class="empty">
          <p class="title">Indexing symbols…</p>
          <div class="bar"><div class="fill" [style.width.%]="(p.done / p.total) * 100"></div></div>
          <p class="hint">{{ p.done }} / {{ p.total }} files</p>
        </div>
      } @else if (!ready()) {
        <div class="empty"><p>Preparing symbol index…</p></div>
      } @else if (flows().length === 0) {
        <div class="empty">
          <p class="title">No flows found.</p>
          <p class="hint">
            A flow starts at a function nothing in the indexed code calls but which calls
            others. Available for TypeScript, TSX, JavaScript, JSX, Kotlin and Java.
          </p>
        </div>
      } @else {
        <div class="list">
          <p class="caveat">
            Entry-point functions — nothing indexed calls them — ranked by the total branching
            of everything they reach. Expand one to walk its call tree; a <span class="rep">↻</span>
            marks a call already shown (a shared or recursive path).
          </p>
          @for (f of shown(); track f.root.id) {
            <div class="group">
              <button type="button" class="group-head" (click)="toggle(f.root.id)">
                <span class="chev">{{ isOpen(f.root.id) ? '▾' : '▸' }}</span>
                <span class="dot" [style.background]="rootColor(f)"></span>
                <span class="name">{{ rootLabel(f) }}</span>
                <span class="file">{{ rootFile(f) }}</span>
                <span class="badges">
                  <span class="badge total" title="total branches across the flow"
                    >Σ {{ f.total }}</span
                  >
                  <span class="badge" title="deepest call chain">depth {{ f.depth }}</span>
                  <span class="badge" title="distinct functions in the flow"
                    >{{ f.count }} fns</span
                  >
                </span>
              </button>
              @if (isOpen(f.root.id)) {
                <div class="tree">
                  <loco-flow-branch [node]="f.tree" [depth]="0" />
                </div>
              }
            </div>
          }
          @if (flows().length > shownCount()) {
            <p class="more">
              {{ flows().length - shownCount() }} more flows — narrow with the Files filter to
              surface them.
            </p>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .wrap {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }
      .controls {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        flex: none;
      }
      .heading {
        font-size: 12px;
        font-weight: 500;
      }
      .spacer {
        flex: 1;
      }
      .count {
        font-size: 11px;
        opacity: 0.7;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .copy {
        background: transparent;
        border: 1px solid var(--border);
        color: inherit;
        border-radius: 3px;
        font: inherit;
        font-size: 11px;
        padding: 2px 8px;
        cursor: pointer;
      }
      .copy:hover:not(:disabled) {
        border-color: var(--accent);
        color: var(--accent);
      }
      .copy:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding-bottom: 16px;
      }
      .caveat {
        margin: 0;
        padding: 8px 12px;
        font-size: 11px;
        line-height: 1.5;
        opacity: 0.6;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      }
      .caveat .rep {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .group {
        border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
      }
      .group-head {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 5px 10px;
        background: transparent;
        border: none;
        color: inherit;
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .group-head:hover {
        background: var(--hover);
      }
      .chev {
        width: 10px;
        opacity: 0.5;
        font-size: 10px;
        flex-shrink: 0;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .name {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
      }
      .file {
        font-size: 10px;
        opacity: 0.5;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .badges {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .badge {
        font-size: 10px;
        opacity: 0.65;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .badge.total {
        opacity: 0.9;
        color: var(--accent);
      }
      .tree {
        padding: 2px 0 6px;
      }
      .more {
        margin: 0;
        padding: 10px 12px;
        font-size: 11px;
        opacity: 0.55;
      }
      .empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px;
        text-align: center;
        opacity: 0.85;
      }
      .empty p {
        margin: 0;
        max-width: 460px;
      }
      .empty .title {
        font-weight: 500;
      }
      .empty .hint {
        font-size: 12px;
        opacity: 0.65;
        line-height: 1.45;
      }
      .bar {
        width: 220px;
        height: 3px;
        border-radius: 2px;
        overflow: hidden;
        background: color-mix(in srgb, var(--accent) 15%, transparent);
      }
      .fill {
        height: 100%;
        background: var(--accent);
      }
    `,
  ],
})
export class ComplexityDepthComponent {
  readonly store = inject(AnalysisStore);
  private readonly index = inject(SymbolIndexService);
  private readonly depth = inject(ComplexityDepthService);

  readonly progress = this.index.building;
  readonly ready = computed(() => this.index.index() !== null);
  readonly copied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      this.store.projectId();
      if (this.store.root()) void this.index.build();
    });
  }

  readonly flows = computed<Flow[]>(() => {
    this.index.index();
    this.store.filteredPaths();
    return this.depth.flows();
  });

  readonly shown = computed<Flow[]>(() => this.flows().slice(0, DISPLAY_CAP));
  readonly shownCount = computed(() => this.shown().length);

  rootLabel(f: Flow): string {
    return labelFor(f.root);
  }
  rootColor(f: Flow): string {
    return colorFor(f.root);
  }
  rootFile(f: Flow): string {
    return fileTag(f.root);
  }

  isOpen(id: string): boolean {
    return this.expanded().has(id);
  }

  toggle(id: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  private asText(): string {
    const lines: string[] = [];
    const walk = (n: FlowNode, d: number): void => {
      const indent = '  '.repeat(d);
      lines.push(`${indent}${labelFor(n.def)} (${fileTag(n.def)}) [${n.complexity}]${n.repeat ? ' ↻' : ''}`);
      if (!n.repeat) for (const c of n.children) walk(c, d + 1);
    };
    for (const f of this.shown()) {
      lines.push(`# ${labelFor(f.root)}  Σ${f.total} · depth ${f.depth} · ${f.count} fns`);
      walk(f.tree, 1);
      lines.push('');
    }
    return lines.join('\n');
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.asText());
    } catch {
      return;
    }
    this.copied.set(true);
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(false), 1500);
  }
}

function labelFor(def: SymbolDef): string {
  return def.owner ? `${def.owner}.${def.name}` : def.name;
}

function fileTag(def: SymbolDef): string {
  const idx = def.path.lastIndexOf('/');
  const base = idx >= 0 ? def.path.slice(idx + 1) : def.path;
  return `${base}:${def.startRow + 1}`;
}

function colorFor(def: SymbolDef): string {
  switch (def.kind) {
    case 'class':
    case 'interface':
    case 'type':
    case 'enum':
      return '#3b82f6';
    case 'function':
    case 'method':
      return '#f59e0b';
    default:
      return '#10b981';
  }
}
