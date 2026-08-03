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
import { NgTemplateOutlet } from '@angular/common';
import { AnalysisStore } from '../core/state/analysis.store';
import { TabsStore } from '../core/state/tabs.store';
import { AstNode, ComplexityService, HighlightToken } from '../core/services/complexity.service';
import { detectLanguage, extOf } from '../core/languages';
import { AstSelectionService } from './ast-selection.service';
import { SourceLink, SourcePanelComponent } from './source-panel.component';
import { HexPanelComponent } from './hex-panel.component';
import { ImagePanelComponent } from './image-panel.component';
import { PreviewBarComponent } from './preview-bar.component';
import { FileSearchComponent } from './file-search.component';
import { SymbolIndexService } from '../core/services/symbol-index.service';
import { SymbolGraphComponent } from './symbol-graph.component';
import { UsagesPanelComponent } from './usages-panel.component';
import { isSymbolIndexSupported } from '../core/services/symbols';

const SPLIT_KEY = 'loco:ast-split';
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;

/** Files longer than this open in preview: only the first N lines / rows render. */
const PREVIEW_MAX_LINES = 1500;
/** Bytes shown in the hex view before it, too, is truncated (16 per row). */
const HEX_PREVIEW_BYTES = PREVIEW_MAX_LINES * 16;

/** What the editor pane shows for the open file, once loaded. */
type Content =
  | {
      kind: 'code';
      language: string;
      languageId: string;
      root: AstNode;
      text: string;
      tokens: readonly HighlightToken[];
      totalLines: number;
    }
  | { kind: 'text'; language: string | null; text: string; totalLines: number }
  | { kind: 'image'; file: File }
  | { kind: 'hex'; file: File; totalBytes: number };

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; path: string }
  | { kind: 'error'; path: string; message: string }
  | { kind: 'ready'; path: string; content: Content };

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
  imports: [
    NgTemplateOutlet,
    AstNodeComponent,
    SourcePanelComponent,
    HexPanelComponent,
    ImagePanelComponent,
    PreviewBarComponent,
    FileSearchComponent,
    SymbolGraphComponent,
    UsagesPanelComponent,
  ],
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
        <div class="placeholder">Opening {{ stateLoadingPath() }}…</div>
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
          <span class="lang">{{ readyLangLabel() }}</span>
          @for (stat of fileStats(); track stat.label) {
            <span class="stat" [title]="stat.title">
              <span class="stat-label">{{ stat.label }}</span>
              <span class="stat-value">{{ stat.value }}</span>
            </span>
          }
          @if (hasAst()) {
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
          }
        </header>
        <ng-template #previewBar>
          @if (hasPreviewNav()) {
            <loco-preview-bar
              [unit]="previewUnit()"
              [from]="previewFrom()"
              [to]="previewTo()"
              [total]="totalUnits()"
              [page]="page()"
              [pageCount]="pageCount()"
              (first)="goFirst()"
              (prev)="goPrev()"
              (next)="goNext()"
              (last)="goLast()"
            />
          }
        </ng-template>

        @if (hasAst()) {
          <div class="split" #splitWrap [style.grid-template-columns]="splitTemplate()">
            <div class="editor-pane">
              @if (!searchActive()) {
                <ng-container [ngTemplateOutlet]="previewBar" />
              }
              <loco-file-search
                [lines]="allLines()"
                (gotoLine)="onGotoLine($event)"
                (activeChange)="searchActive.set($event)"
              />
              @if (!searchActive()) {
                <loco-source-panel
                  [text]="editorText()"
                  [tokensInput]="stateReadyTokens()"
                  [linksInput]="sourceLinks()"
                  [startLineInput]="editorStartLine()"
                  (gotoDefinition)="gotoDefinition($event)"
                />
              }
            </div>
            <div
              class="divider"
              role="separator"
              aria-orientation="vertical"
              (mousedown)="onDividerDown($event)"
            ></div>
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
          </div>
        } @else if (isImage()) {
          <loco-image-panel [file]="imageFile()" />
        } @else {
          <div class="editor-pane">
            @if (isHex()) {
              <ng-container [ngTemplateOutlet]="previewBar" />
              <loco-hex-panel [bytes]="hexBytes()" [baseOffset]="hexBase()" />
            } @else {
              @if (!searchActive()) {
                <ng-container [ngTemplateOutlet]="previewBar" />
              }
              <loco-file-search
                [lines]="allLines()"
                (gotoLine)="onGotoLine($event)"
                (activeChange)="searchActive.set($event)"
              />
              @if (!searchActive()) {
                <loco-source-panel
                  [text]="editorText()"
                  [startLineInput]="editorStartLine()"
                  (gotoDefinition)="gotoDefinition($event)"
                />
              }
            }
          </div>
        }
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
      .stat {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        font-size: 11px;
        padding: 1px 6px;
        border: 1px solid var(--border);
        border-radius: 3px;
        white-space: nowrap;
      }
      .stat-label {
        opacity: 0.55;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        font-size: 10px;
      }
      .stat-value {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .split {
        flex: 1;
        display: grid;
        grid-template-columns: 45% 6px 1fr;
        min-height: 0;
        min-width: 0;
      }
      /* Wraps the editor with its sticky preview bar; fills its grid cell or the pane. */
      .editor-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
      }
      .editor-pane > loco-source-panel,
      .editor-pane > loco-hex-panel {
        flex: 1;
        min-height: 0;
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

  /** 0-based preview page. Files longer than one window paginate rather than truncate. */
  readonly page = signal(0);
  /** The current hex page's bytes, read from disk on demand. */
  private readonly hexBytesSig = signal<Uint8Array>(new Uint8Array());

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

    // Hex pages are read from disk on demand — only the visible window is in memory.
    effect(() => {
      const c = this.content();
      const page = this.page();
      if (!c || c.kind !== 'hex') return;
      const start = page * HEX_PREVIEW_BYTES;
      const end = Math.min(start + HEX_PREVIEW_BYTES, c.totalBytes);
      void c.file
        .slice(start, end)
        .arrayBuffer()
        .then((buf) => {
          // Ignore a slice that resolved after the user moved on.
          if (this.content() === c && this.page() === page) {
            this.hexBytesSig.set(new Uint8Array(buf));
          }
        });
    });

    // Follow the selection across page boundaries: clicking an AST node or a go-to-def
    // link on line 5,000 pages the editor to wherever that line lives.
    effect(() => {
      const r = this.selection.range();
      const c = this.content();
      if (!r || !c || c.kind === 'hex' || c.kind === 'image') return;
      const target = Math.floor(r.startRow / PREVIEW_MAX_LINES);
      if (target !== this.page() && target < this.pageCount()) this.page.set(target);
    });
  }

  /** Whether the whole-file search bar applies — text we can scan line by line. */
  canSearch(): boolean {
    const k = this.content()?.kind;
    return k === 'code' || k === 'text';
  }

  /** True while the search results are shown in place of the editor. */
  readonly searchActive = signal(false);

  /** Opens `line` (0-based) in the editor; the range effect pages and scrolls to it. */
  onGotoLine(line: number): void {
    const len = this.allLines()[line]?.length ?? 0;
    this.selection.setRange({ startRow: line, startCol: 0, endRow: line, endCol: len });
  }

  /** File-level metrics shown in the header, in the order they read most naturally. */
  readonly fileStats = computed<{ label: string; value: string; title: string }[]>(() => {
    const node = this.store.nodeByPath().get(this.path() ?? '');
    if (!node) return [];
    const out: { label: string; value: string; title: string }[] = [];
    const m = node.metrics;
    if (m.loc != null) out.push({ label: 'LOC', value: m.loc.toLocaleString(), title: 'Lines of code' });
    if (m.complexity != null)
      out.push({ label: 'Cx', value: m.complexity.toLocaleString(), title: 'Cyclomatic complexity' });
    if (m.churn != null)
      out.push({ label: 'Churn', value: m.churn.toLocaleString(), title: 'Commits touching this file' });
    if (m.risk != null) out.push({ label: 'Risk', value: String(m.risk), title: 'Risk score (0–100)' });
    out.push({ label: 'Size', value: formatBytes(node.size), title: 'File size on disk' });
    return out;
  });

  private async load(path: string, file: File): Promise<void> {
    this.page.set(0);
    this.searchActive.set(false);
    this.state.set({ kind: 'loading', path });
    try {
      // Pictures render as images regardless of their bytes.
      if (IMAGE_EXTENSIONS.has(extOf(file.name))) {
        this.setReady(path, { kind: 'image', file });
        return;
      }

      // Sniff the head for binary content; that same slice seeds the first hex page.
      const head = new Uint8Array(await file.slice(0, HEX_PREVIEW_BYTES).arrayBuffer());
      if (isBinary(head, file.name)) {
        this.hexBytesSig.set(head);
        this.setReady(path, { kind: 'hex', file, totalBytes: file.size });
        return;
      }

      const text = await file.text();
      const lang = detectLanguage(file.name);
      if (lang && this.complexity.supports(lang.id)) {
        try {
          const [root, tokens] = await Promise.all([
            this.complexity.parse(text, lang.id),
            this.complexity.highlight(text, lang.id),
          ]);
          if (root) {
            this.setReady(path, {
              kind: 'code',
              language: lang.name,
              languageId: lang.id,
              root,
              text,
              tokens: tokens ?? [],
              totalLines: countLines(text),
            });
            // Cross-file usages are the most useful first look, so open that mode by
            // default where the symbol index supports it; otherwise fall back to the tree.
            this.mode.set(isSymbolIndexSupported(lang.id) ? 'usages' : 'tree');
            return;
          }
        } catch {
          // A grammar that fails to load or parse must not blank the file — fall through
          // to the plain-text preview below.
        }
      }

      // Every other file — Markdown, JSON, config, or anything without a working grammar —
      // opens as a plain-text preview rather than a dead end.
      this.setReady(path, { kind: 'text', language: lang?.name ?? null, text, totalLines: countLines(text) });
    } catch (e) {
      this.state.set({
        kind: 'error',
        path,
        message: e instanceof Error ? e.message : 'Could not open this file.',
      });
    }
  }

  private setReady(path: string, content: Content): void {
    this.state.set({ kind: 'ready', path, content });
    // A cross-file jump parked its target range while this file was loading.
    const pending = this.selection.takePending(path);
    if (pending) this.selection.setRange(pending);
  }

  readonly mode = signal<'tree' | 'graph' | 'usages'>('usages');

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

  private content(): Content | null {
    const s = this.state();
    return s.kind === 'ready' ? s.content : null;
  }

  hasAst(): boolean {
    return this.content()?.kind === 'code';
  }
  isHex(): boolean {
    return this.content()?.kind === 'hex';
  }
  isImage(): boolean {
    return this.content()?.kind === 'image';
  }
  imageFile(): File | null {
    const c = this.content();
    return c?.kind === 'image' ? c.file : null;
  }

  /** The open text file split into lines once, so paging never re-splits it. */
  readonly allLines = computed<string[]>(() => {
    const c = this.content();
    if (!c || c.kind === 'hex' || c.kind === 'image') return [];
    return c.text.length === 0 ? [] : c.text.split(/\r\n|\n|\r/);
  });

  /** Source text handed to the editor: the current 1500-line window of the file. */
  readonly editorText = computed<string>(() => {
    const lines = this.allLines();
    if (lines.length <= PREVIEW_MAX_LINES) return this.contentText();
    const from = this.page() * PREVIEW_MAX_LINES;
    return lines.slice(from, from + PREVIEW_MAX_LINES).join('\n');
  });

  private contentText(): string {
    const c = this.content();
    return c && (c.kind === 'text' || c.kind === 'code') ? c.text : '';
  }

  /** Absolute file line of the first rendered editor line, so line numbers stay true when paged. */
  editorStartLine(): number {
    const c = this.content();
    return c && (c.kind === 'code' || c.kind === 'text') ? this.page() * PREVIEW_MAX_LINES : 0;
  }

  hexBytes(): Uint8Array {
    return this.isHex() ? this.hexBytesSig() : new Uint8Array();
  }

  /** Byte offset of the first shown hex byte, so later pages number correctly. */
  hexBase(): number {
    return this.page() * HEX_PREVIEW_BYTES;
  }

  // --- Preview pagination -------------------------------------------------------------

  private readonly pageSize = computed(() =>
    this.content()?.kind === 'hex' ? HEX_PREVIEW_BYTES : PREVIEW_MAX_LINES,
  );

  readonly totalUnits = computed(() => {
    const c = this.content();
    if (!c) return 0;
    if (c.kind === 'hex') return c.totalBytes;
    if (c.kind === 'image') return 0;
    return this.allLines().length;
  });

  readonly pageCount = computed(() => {
    const total = this.totalUnits();
    return total > 0 ? Math.ceil(total / this.pageSize()) : 1;
  });

  /** The preview bar only appears once a file spills past a single window. */
  hasPreviewNav(): boolean {
    const c = this.content();
    return !!c && c.kind !== 'image' && this.pageCount() > 1;
  }

  previewUnit(): string {
    return this.content()?.kind === 'hex' ? 'bytes' : 'lines';
  }
  previewFrom(): number {
    return this.page() * this.pageSize() + 1;
  }
  previewTo(): number {
    return Math.min((this.page() + 1) * this.pageSize(), this.totalUnits());
  }

  goFirst(): void {
    this.page.set(0);
  }
  goPrev(): void {
    this.page.update((p) => Math.max(0, p - 1));
  }
  goNext(): void {
    this.page.update((p) => Math.min(this.pageCount() - 1, p + 1));
  }
  goLast(): void {
    this.page.set(this.pageCount() - 1);
  }

  /**
   * Resolved references in the open file, handed to the source pane so every one of
   * them becomes a go-to-definition link. Same data the usages panel lists.
   */
  readonly sourceLinks = computed<SourceLink[]>(() => {
    const s = this.state();
    if (s.kind !== 'ready' || s.content.kind !== 'code') return [];
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

  stateReadyTokens(): readonly HighlightToken[] {
    const c = this.content();
    return c?.kind === 'code' ? c.tokens : [];
  }
  stateReadyLangId(): string | null {
    const c = this.content();
    return c?.kind === 'code' ? c.languageId : null;
  }
  stateReadyRoot(): AstNode | null {
    const c = this.content();
    return c?.kind === 'code' ? c.root : null;
  }
  readyLangLabel(): string {
    const c = this.content();
    if (!c) return '';
    if (c.kind === 'code') return c.language;
    if (c.kind === 'hex') return 'Binary';
    if (c.kind === 'image') return 'Image';
    return c.language ?? (extOf(this.stateReadyPath()).toUpperCase() || 'Text');
  }

  stateLoadingPath(): string {
    const s = this.state();
    return s.kind === 'loading' ? s.path : '';
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
  // Editor is the left, primary pane now, so it gets the larger default share.
  return 0.55;
}

function saveSplitFraction(v: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, String(v));
  } catch {
    /* ignore */
  }
}

/** Compact human-readable byte size for the header stat. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Counts lines by newline, so it stays cheap on very large files. */
function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Picture formats browsers can render — these open as an image preview, not hex. */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'ico', 'avif', 'apng', 'svg',
]);

/** Extensions that are binary regardless of their byte content. */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'avif', 'tiff', 'psd', 'ai',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tgz', 'tar', 'rar', '7z', 'bz2', 'xz', 'zst',
  'mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'wasm', 'class', 'o', 'so', 'dll', 'exe', 'dylib', 'a', 'lib', 'bin', 'dat',
  'sqlite', 'db',
]);

/**
 * A file is binary if its extension says so, if it contains a NUL byte, or if the head is
 * dense with other control characters. Text encodings never contain NUL, so it is the
 * strongest single signal.
 */
function isBinary(bytes: Uint8Array, name: string): boolean {
  if (BINARY_EXTENSIONS.has(extOf(name))) return true;
  const n = Math.min(bytes.length, 8000);
  if (n === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    // Control chars other than tab, LF, FF, CR and ESC read as binary noise.
    if (b < 32 && b !== 9 && b !== 10 && b !== 12 && b !== 13 && b !== 27) suspicious++;
  }
  return suspicious / n > 0.3;
}
