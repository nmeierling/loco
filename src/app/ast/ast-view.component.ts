import {
  ChangeDetectionStrategy,
  Component,
  Input,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalysisStore } from '../core/state/analysis.store';
import { AstNode, ComplexityService } from '../core/services/complexity.service';
import { detectLanguage } from '../core/languages';
import { AstSelectionService } from './ast-selection.service';
import { SourcePanelComponent } from './source-panel.component';
import { CallGraphComponent } from './call-graph.component';
import { isCallGraphSupported } from '../core/services/call-graph';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; path: string }
  | { kind: 'unsupported'; path: string; language: string | null }
  | { kind: 'error'; path: string; message: string }
  | { kind: 'ready'; path: string; language: string; languageId: string; root: AstNode; text: string };

@Component({
  selector: 'loco-ast-node',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" (click)="onClick($event)" [class.has-children]="hasChildren()">
      <span class="chev" (click)="toggle($event)">{{ hasChildren() ? (expanded() ? '▾' : '▸') : '·' }}</span>
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
  imports: [AstNodeComponent, RouterLink, SourcePanelComponent, CallGraphComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state().kind) {
      @case ('idle') {
        <div class="placeholder">
          <h2>AST view</h2>
          @if (store.root()) {
            <p>Select a file in the sidebar (double-click to open here).</p>
          } @else {
            <p>No project loaded. <a routerLink="/">Go to heatmap</a> to drop a folder.</p>
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
            <code>{{ stateUnsupportedLang() ?? 'this file type' }}</code>.
          </p>
          <p class="hint">Supported: TypeScript, TSX, JavaScript, Python, Go, Rust, Java, C/C++, C#, PHP, Ruby, Bash, Kotlin, Swift, Scala, Dart, Lua, Elixir.</p>
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
            >Tree</button>
            <button
              type="button"
              class="mode"
              [class.active]="mode() === 'calls'"
              [disabled]="!callsSupported()"
              (click)="mode.set('calls')"
              [title]="callsSupported() ? 'Function call graph' : 'Call graph only available for TS/JS'"
            >Calls</button>
          </div>
          <span class="caption">{{ mode() === 'tree' ? 'Click an AST node to jump to source.' : 'Click a function to jump to source.' }}</span>
        </header>
        <div class="split">
          @if (mode() === 'tree') {
            <div class="ast-scroll">
              @if (stateReadyRoot(); as root) {
                <loco-ast-node [node]="root" />
              }
            </div>
          } @else {
            <div class="ast-scroll">
              <loco-call-graph [ast]="stateReadyRoot()" [languageId]="stateReadyLangId()" />
            </div>
          }
          <loco-source-panel [text]="stateReadyText()" />
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
        grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.2fr);
        min-height: 0;
      }
      .ast-scroll {
        overflow: auto;
        padding: 8px 12px;
        border-right: 1px solid var(--border);
        min-height: 0;
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
    `,
  ],
})
export class AstViewComponent {
  readonly store = inject(AnalysisStore);
  private readonly complexity = inject(ComplexityService);
  private readonly selection = inject(AstSelectionService);

  readonly state = signal<LoadState>({ kind: 'idle' });

  constructor() {
    effect(() => {
      const path = this.store.selectedPath();
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
      const root = await this.complexity.parse(text, lang.id);
      if (!root) {
        this.state.set({
          kind: 'error',
          path,
          message: 'Parse returned no result (file may be too large).',
        });
        return;
      }
      this.state.set({ kind: 'ready', path, language: lang.name, languageId: lang.id, root, text });
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
  stateReadyLangId(): string | null {
    const s = this.state();
    return s.kind === 'ready' ? s.languageId : null;
  }

  readonly mode = signal<'tree' | 'calls'>('tree');

  callsSupported(): boolean {
    const id = this.stateReadyLangId();
    return isCallGraphSupported(id);
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
