import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { AnalysisStore } from '../core/state/analysis.store';
import { TabsStore } from '../core/state/tabs.store';
import { AstNode, ComplexityService, HighlightToken } from '../core/services/complexity.service';
import { detectLanguage } from '../core/languages';
import { AstSelectionService } from './ast-selection.service';
import { SourceLink, SourcePanelComponent } from './source-panel.component';
import { SymbolIndexService } from '../core/services/symbol-index.service';
import { SymbolGraphComponent } from './symbol-graph.component';
import { UsagesPanelComponent } from './usages-panel.component';
import { isSymbolIndexSupported } from '../core/services/symbols';

const SPLIT_KEY = 'loco:ast-split';
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; path: string }
  | { kind: 'unsupported'; path: string; language: string | null }
  | { kind: 'error'; path: string; message: string }
  | {
      kind: 'ready';
      path: string;
      language: string;
      languageId: string;
      root: AstNode;
      text: string;
      tokens: readonly HighlightToken[];
    };

@Component({
  selector: 'loco-ast-node',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" (click)="onClick($event)" [class.has-children]="hasChildren()">
      <span class="chev" (click)="toggle($event)">{{
        hasChildren() ? (expanded() ? '▾' : '▸') : '·'
      }}</span>
      <span class="type">{{ node.type }}</span>
      <span class="pos">{{ node.startRow + 1 }}:{{ node.startCol + 1 }}</span>
      @if (node.preview) {
        <span class="preview">{{ node.preview }}</span>
      }
    </div>
    @if (expanded()) {
      <div class="children">
        @for (c of node.children; track $index) {
          <loco-ast-node [node]="c" [depth]="depth + 1" />
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 1px 6px;
        border-radius: 3px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
      }
      .row.has-children:hover {
        background: var(--hover);
      }
      .chev {
        width: 10px;
        display: inline-block;
        text-align: center;
        opacity: 0.5;
        font-size: 10px;
        flex-shrink: 0;
      }
      .type {
        color: var(--accent);
        flex-shrink: 0;
      }
      .pos {
        opacity: 0.45;
        font-size: 10px;
        flex-shrink: 0;
      }
      .preview {
        opacity: 0.75;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
      }
      .children {
        padding-left: 14px;
        position: relative;
      }
      .children::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--border);
      }
    `,
  ],
})
export class AstNodeComponent {
  private readonly selection = inject(AstSelectionService);

  @Input({ required: true }) node!: AstNode;
  @Input() depth = 0;

  private readonly _expanded = signal(true);
  readonly expanded = this._expanded.asReadonly();

  hasChildren(): boolean {
    return this.node.children.length > 0;
  }

  toggle(ev: Event): void {
    ev.stopPropagation();
    if (this.hasChildren()) this._expanded.update((v) => !v);
  }

  onClick(_ev: Event): void {
    this.selection.setRange({
      startRow: this.node.startRow,
      startCol: this.node.startCol,
      endRow: this.node.endRow,
      endCol: this.node.endCol,
    });
  }
}

@Component({
  selector: 'loco-ast-view',
  standalone: true,
  imports: [AstNodeComponent, SourcePanelComponent, SymbolGraphComponent, UsagesPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state().kind) {
      @case ('idle') {
        <div class="placeholder">
          <h2>AST view</h2>
          @if (store.root()) {
            <p>Double-click a file in the sidebar to open it in a tab.</p>
          } @else {
            <p>
              No project loaded.
              <button type="button" class="link" (click)="tabs.activateHeatmap()">
                Go to heatmap
              </button>
              to drop a folder.
            </p>
          }
        </div>
      }
      @case ('loading') {
        <div class="placeholder">Parsing {{ stateLoadingPath() }}…</div>
      }
      @case ('unsupported') {
        <div class="placeholder">
          <h3>{{ stateUnsupportedPath() }}</h3>
          <p>
            No tree-sitter grammar installed for
            <code>{{ stateUnsupportedLang() ?? 'this file type' }}</code
            >.
          </p>
          <p class="hint">
            Supported: TypeScript, TSX, JavaScript, Python, Go, Rust, Java, C/C++, C#, PHP, Ruby,
            Bash, Kotlin, Swift, Scala, Dart, Lua, Elixir.
          </p>
        </div>
      }
      @case ('error') {
        <div class="placeholder error">
          <h3>{{ stateErrorPath() }}</h3>
          <p>{{ stateErrorMessage() }}</p>
        </div>
      }
      @case ('ready') {
        <header class="head">
          <span class="path">{{ stateReadyPath() }}</span>
          <span class="lang">{{ stateReadyLang() }}</span>
          <div class="modes">
            <button
              type="button"
              class="mode"
              [class.active]="mode() === 'tree'"
              (click)="mode.set('tree')"
            >
              Tree
            </button>
            <button
              type="button"
              class="mode"
              [class.active]="mode() === 'graph'"
              [disabled]="!usagesSupported()"
              (click)="mode.set('graph')"
              [title]="
                usagesSupported()
                  ? 'Visual call/usage graph for this file or folder'
                  : 'Graph only available for TS/TSX/JS/JSX, Kotlin and Java'
              "
            >
              Graph
            </button>
            <button
              type="button"
              class="mode"
              [class.active]="mode() === 'usages'"
              [disabled]="!usagesSupported()"
              (click)="mode.set('usages')"
              [title]="
                usagesSupported()
                  ? 'Cross-file usages of the symbols in this file'
                  : 'Usages only available for TS/TSX/JS/JSX'
              "
            >
              Usages
            </button>
          </div>
          <span class="caption">{{ caption() }}</span>
        </header>
        <div class="split" #splitWrap [style.grid-template-columns]="splitTemplate()">
          @if (mode() === 'tree') {
            <div class="ast-scroll">
              @if (stateReadyRoot(); as root) {
                <loco-ast-node [node]="root" />
              }
            </div>
          } @else if (mode() === 'graph') {
            <loco-symbol-graph [path]="stateReadyPath()" [languageId]="stateReadyLangId()" />
          } @else {
            <loco-usages-panel [path]="stateReadyPath()" [languageId]="stateReadyLangId()" />
          }
          <div
            class="divider"
            role="separator"
            aria-orientation="vertical"
            (mousedown)="onDividerDown($event)"
          ></div>
          <loco-source-panel
            [text]="stateReadyText()"
            [tokensInput]="stateReadyTokens()"
            [linksInput]="sourceLinks()"
            (gotoDefinition)="gotoDefinition($event)"
          />
        </div>
      }
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        min-height: 0;
      }
      .head {
        display: flex;
        align-items: baseline;
        gap: 12px;
        padding: 8px 14px;
        border-bottom: 1px solid var(--border);
        background: var(--bar-bg);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      .path {
        font-weight: 500;
      }
      .lang {
        opacity: 0.6;
        font-size: 11px;
      }
      .split {
        flex: 1;
        display: grid;
        grid-template-columns: 45% 6px 1fr;
        min-height: 0;
        min-width: 0;
      }
      .ast-scroll {
        overflow: auto;
        padding: 8px 12px;
        min-height: 0;
        min-width: 0;
      }
      .divider {
        cursor: col-resize;
        position: relative;
        user-select: none;
        background: transparent;
      }
      .divider::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--border);
        transform: translateX(-0.5px);
      }
      .divider:hover::after,
      .divider.dragging::after {
        background: var(--accent);
        width: 2px;
        transform: translateX(-1px);
      }
      .spacer {
        flex: 1;
      }
      .caption {
        opacity: 0.6;
        font-size: 11px;
        margin-left: auto;
      }
      .modes {
        display: flex;
        gap: 2px;
        margin-left: 12px;
      }
      .mode {
        background: transparent;
        border: 1px solid var(--border);
        color: inherit;
        padding: 3px 10px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
        border-radius: 3px;
      }
      .mode:hover:not(:disabled) {
        background: var(--hover);
      }
      .mode.active {
        background: var(--accent);
        color: var(--accent-fg);
        border-color: var(--accent);
      }
      .mode:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .placeholder {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: 24px;
        text-align: center;
        opacity: 0.85;
      }
      .placeholder h2,
      .placeholder h3 {
        margin: 0 0 6px;
      }
      .placeholder.error {
        color: var(--danger);
      }
      code {
        background: var(--input-bg);
        padding: 1px 5px;
        border-radius: 3px;
      }
      .hint {
        font-size: 11px;
        opacity: 0.65;
      }
      .link {
        background: none;
        border: none;
        color: var(--accent);
        font: inherit;
        padding: 0;
        cursor: pointer;
        text-decoration: underline;
      }
    `,
  ],
})
export class AstViewComponent {
  readonly store = inject(AnalysisStore);
  readonly tabs = inject(TabsStore);
  private readonly complexity = inject(ComplexityService);
  private readonly selection = inject(AstSelectionService);
  private readonly symbols = inject(SymbolIndexService);

  /** The file this tab shows. `null` renders the idle placeholder (hidden by the shell). */
  readonly path = input<string | null>(null);

  @ViewChild('splitWrap', { static: false }) splitWrap?: ElementRef<HTMLDivElement>;

  readonly state = signal<LoadState>({ kind: 'idle' });

  readonly splitFraction = signal<number>(loadSplitFraction());
  readonly splitTemplate = computed(() => `${(this.splitFraction() * 100).toFixed(2)}% 6px 1fr`);

  onDividerDown(ev: MouseEvent): void {
    if (!this.splitWrap) return;
    ev.preventDefault();
    const wrap = this.splitWrap.nativeElement;
    const target = ev.currentTarget as HTMLElement;
    target.classList.add('dragging');
    const onMove = (e: MouseEvent): void => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0) return;
      const x = e.clientX - rect.left;
      const f = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, x / rect.width));
      this.splitFraction.set(f);
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      target.classList.remove('dragging');
      saveSplitFraction(this.splitFraction());
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  constructor() {
    effect(() => {
      const path = this.path();
      const blobs = this.store.fileBlobs();
      this.selection.setRange(null);
      if (!path) {
        this.state.set({ kind: 'idle' });
        return;
      }
      const file = blobs.get(path);
      if (!file) {
        this.state.set({ kind: 'error', path, message: 'File not found in current load.' });
        return;
      }
      void this.load(path, file);
    });

    // Source links need the index whichever mode is showing, so opening any indexable
    // file warms it rather than waiting for the Usages tab.
    effect(() => {
      this.store.projectId();
      if (isSymbolIndexSupported(this.stateReadyLangId())) void this.symbols.build();
    });
  }

  private async load(path: string, file: File): Promise<void> {
    this.state.set({ kind: 'loading', path });
    const lang = detectLanguage(file.name);
    if (!lang || !this.complexity.supports(lang.id)) {
      this.state.set({ kind: 'unsupported', path, language: lang?.name ?? null });
      return;
    }
    try {
      const text = await file.text();
      const [root, tokens] = await Promise.all([
        this.complexity.parse(text, lang.id),
        this.complexity.highlight(text, lang.id),
      ]);
      if (!root) {
        this.state.set({
          kind: 'error',
          path,
          message: 'Parse returned no result (file may be too large).',
        });
        return;
      }
      this.state.set({
        kind: 'ready',
        path,
        language: lang.name,
        languageId: lang.id,
        root,
        text,
        tokens: tokens ?? [],
      });
      // A cross-file jump parked its target range while this file was loading.
      const pending = this.selection.takePending(path);
      if (pending) this.selection.setRange(pending);
    } catch (e) {
      this.state.set({
        kind: 'error',
        path,
        message: e instanceof Error ? e.message : 'Parse failed.',
      });
    }
  }

  stateReadyText(): string {
    const s = this.state();
    return s.kind === 'ready' ? s.text : '';
  }
  stateReadyTokens(): readonly HighlightToken[] {
    const s = this.state();
    return s.kind === 'ready' ? s.tokens : [];
  }
  stateReadyLangId(): string | null {
    const s = this.state();
    return s.kind === 'ready' ? s.languageId : null;
  }

  readonly mode = signal<'tree' | 'graph' | 'usages'>('tree');

  readonly caption = computed(() => {
    switch (this.mode()) {
      case 'tree':
        return 'Click an AST node to jump to source.';
      case 'graph':
        return 'Click a symbol to expand its callers and callees, and open it.';
      default:
        return 'Click a usage to open that file at the line.';
    }
  });

  /**
   * Resolved references in the open file, handed to the source pane so every one of
   * them becomes a go-to-definition link. Same data the usages panel lists.
   */
  readonly sourceLinks = computed<SourceLink[]>(() => {
    const s = this.state();
    if (s.kind !== 'ready') return [];
    const idx = this.symbols.index();
    if (!idx) return [];
    const out: SourceLink[] = [];
    for (const ref of idx.refsByPath.get(s.path) ?? []) {
      const def = idx.defsById.get(ref.defId);
      // Single-line references only — an identifier never wraps, and the segment
      // splitter works within one line.
      if (!def || ref.row !== ref.endRow) continue;
      out.push({
        row: ref.row,
        col: ref.col,
        endCol: ref.endCol,
        defId: def.id,
        title: `${def.owner ? def.owner + '.' : ''}${def.name} — ${def.path}:${def.startRow + 1}`,
      });
    }
    return out;
  });

  gotoDefinition(defId: string): void {
    const def = this.symbols.index()?.defsById.get(defId);
    if (!def) return;
    this.selection.jumpTo(def.path, {
      startRow: def.startRow,
      startCol: def.startCol,
      endRow: def.endRow,
      endCol: def.endCol,
    });
  }

  usagesSupported(): boolean {
    return isSymbolIndexSupported(this.stateReadyLangId());
  }

  stateLoadingPath(): string {
    const s = this.state();
    return s.kind === 'loading' ? s.path : '';
  }
  stateUnsupportedPath(): string {
    const s = this.state();
    return s.kind === 'unsupported' ? s.path : '';
  }
  stateUnsupportedLang(): string | null {
    const s = this.state();
    return s.kind === 'unsupported' ? s.language : null;
  }
  stateErrorPath(): string {
    const s = this.state();
    return s.kind === 'error' ? s.path : '';
  }
  stateErrorMessage(): string {
    const s = this.state();
    return s.kind === 'error' ? s.message : '';
  }
  stateReadyPath(): string {
    const s = this.state();
    return s.kind === 'ready' ? s.path : '';
  }
  stateReadyLang(): string {
    const s = this.state();
    return s.kind === 'ready' ? s.language : '';
  }
  stateReadyRoot(): AstNode | null {
    const s = this.state();
    return s.kind === 'ready' ? s.root : null;
  }
}

function loadSplitFraction(): number {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    if (raw) {
      const v = Number(raw);
      if (Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX) return v;
    }
  } catch {
    /* localStorage unavailable */
  }
  return 0.45;
}

function saveSplitFraction(v: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, String(v));
  } catch {
    /* ignore */
  }
}
