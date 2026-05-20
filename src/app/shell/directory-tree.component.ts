import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AnalysisStore } from '../core/state/analysis.store';
import { DirNode, MetricKind, TreeNode, isDir, isFile, metricValue } from '../core/models/tree';

@Component({
  selector: 'loco-tree-node',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (asDir(); as dir) {
      <div class="row dir" (click)="toggle()" [class.root]="depth === 0">
        <span class="chev">{{ expanded() ? '▾' : '▸' }}</span>
        <span class="icon">{{ expanded() ? '📂' : '📁' }}</span>
        <span class="name" [title]="dir.path || rootName()">{{ dir.name || rootName() }}</span>
        @if (dir.path) {
          <button
            class="filter-btn"
            type="button"
            (click)="setPathFilter($event, dir.path)"
            [title]="'Filter by path: ' + dir.path"
            aria-label="Filter by this directory"
          >
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
              <path d="M1.5 2.5h13l-5 6.2v4l-3-1v-3l-5-6.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            </svg>
          </button>
        }
        <span class="meta">{{ value() | number }}</span>
      </div>
      @if (expanded()) {
        <div class="children" [style.padding-left.px]="indent">
          @for (c of sortedChildren(); track c.path) {
            <loco-tree-node [node]="c" [depth]="depth + 1" />
          }
        </div>
      }
    } @else if (asFile(); as f) {
      <div
        class="row file"
        [class.selected]="isSelected()"
        (click)="select()"
        (dblclick)="openAst()"
        [title]="f.path"
      >
        <span class="chev"></span>
        <span class="icon">📄</span>
        <span class="name">{{ f.name }}</span>
        <span class="meta">{{ value() | number }}</span>
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
        align-items: center;
        gap: 4px;
        padding: 2px 4px;
        font-size: 12px;
        cursor: pointer;
        user-select: none;
        border-radius: 3px;
        white-space: nowrap;
        overflow: hidden;
      }
      .row:hover {
        background: var(--hover);
      }
      .filter-btn {
        opacity: 0;
        background: transparent;
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 3px;
        width: 18px;
        height: 18px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
      }
      .row.dir:hover .filter-btn {
        opacity: 0.75;
      }
      .filter-btn:hover {
        opacity: 1 !important;
        color: var(--accent);
        border-color: var(--accent);
      }
      .row.selected {
        background: color-mix(in srgb, var(--accent) 22%, transparent);
      }
      .row.root {
        font-weight: 600;
      }
      .chev {
        width: 10px;
        display: inline-block;
        text-align: center;
        opacity: 0.55;
        font-size: 10px;
      }
      .icon {
        font-size: 12px;
        opacity: 0.85;
        flex-shrink: 0;
      }
      .name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .meta {
        opacity: 0.5;
        font-size: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        flex-shrink: 0;
      }
      .children {
        position: relative;
      }
    `,
  ],
})
export class TreeNodeComponent {
  private readonly store = inject(AnalysisStore);
  private readonly router = inject(Router);

  @Input({ required: true }) node!: TreeNode;
  @Input() depth = 0;

  readonly indent = 8;
  private readonly _expanded = signal(false);
  readonly expanded = this._expanded.asReadonly();

  readonly metric = computed<MetricKind>(() => this.store.filters().metric);
  readonly rootName = this.store.rootName;

  readonly asDir = computed<DirNode | null>(() => (isDir(this.node) ? this.node : null));
  readonly asFile = computed(() => (isFile(this.node) ? this.node : null));

  readonly value = computed(() => metricValue(this.node, this.metric()));

  readonly isSelected = computed(() => {
    if (!isFile(this.node)) return false;
    return this.store.selectedPath() === this.node.path;
  });

  constructor() {
    queueMicrotask(() => {
      if (this.depth < 2 && isDir(this.node)) this._expanded.set(true);
    });
  }

  sortedChildren(): TreeNode[] {
    if (!isDir(this.node)) return [];
    return [...this.node.children].sort((a, b) => {
      if (isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  toggle(): void {
    this._expanded.update((v) => !v);
  }

  select(): void {
    if (isFile(this.node)) this.store.selectPath(this.node.path);
  }

  openAst(): void {
    if (isFile(this.node)) {
      this.store.selectPath(this.node.path);
      this.router.navigate(['/ast']);
    }
  }

  setPathFilter(ev: Event, path: string): void {
    ev.stopPropagation();
    this.store.updateFilters({ path });
  }
}

@Component({
  selector: 'loco-directory-tree',
  standalone: true,
  imports: [TreeNodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (root(); as r) {
      <div class="tree">
        <loco-tree-node [node]="r" [depth]="0" />
      </div>
    } @else {
      <div class="empty">No tree loaded.</div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: auto;
        padding: 6px 8px;
      }
      .tree {
        font-size: 12px;
      }
      .empty {
        opacity: 0.5;
        padding: 12px;
      }
    `,
  ],
})
export class DirectoryTreeComponent {
  private readonly store = inject(AnalysisStore);
  readonly root = this.store.filteredRoot;
}
