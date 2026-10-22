import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { AnalysisStore } from '../core/state/analysis.store';
import { TabsStore } from '../core/state/tabs.store';
import { TreeNode, formatMetricValue, isDir, isFile, metricValue } from '../core/models/tree';
import { createSizeTracker } from '../core/perf/schedule';

/** One rendered line of the tree, pre-flattened out of the nested node structure. */
interface TreeRow {
  path: string;
  name: string;
  /** Nesting level, turned into left padding. */
  depth: number;
  isDir: boolean;
  expanded: boolean;
  /** The formatted metric shown on the right. */
  display: string;
  title: string;
}

interface RowWindow {
  rows: TreeRow[];
  padTop: number;
  padBottom: number;
}

/** Must match the `.row` height in the stylesheet — the virtual window does the maths. */
const ROW_H = 20;
const OVERSCAN = 10;
/** Folders this deep and shallower start expanded on a freshly loaded project. */
const DEFAULT_OPEN_DEPTH = 2;

/**
 * The Files sidebar tree.
 *
 * This used to be one component per node, recursing through the tree. That is the natural
 * shape for a tree, but it means a 3000-file project instantiates 3000 components with
 * their own signal graphs — and typing in the name filter force-expands everything, so
 * every keystroke rebuilt all of them. Flattening to a row list and rendering only the
 * slice in view keeps the cost proportional to the sidebar's height rather than the
 * project's size, which is why the expansion state lives here now instead of per node.
 */
@Component({
  selector: 'loco-directory-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(scroll)': 'onScroll()' },
  template: `
    @if (rows().length > 0) {
      <div class="tree">
        <div [style.height.px]="window().padTop"></div>
        @for (row of window().rows; track row.path) {
          <div
            class="row"
            [class.dir]="row.isDir"
            [class.file]="!row.isDir"
            [class.root]="row.depth === 0"
            [class.selected]="!row.isDir && selectedPath() === row.path"
            [style.padding-left.px]="4 + row.depth * indent"
            [title]="row.title"
            (click)="onRowClick(row)"
            (dblclick)="onRowDblClick(row)"
          >
            <span class="chev">{{ row.isDir ? (row.expanded ? '▾' : '▸') : '' }}</span>
            <span class="icon">{{ row.isDir ? (row.expanded ? '📂' : '📁') : '📄' }}</span>
            <span class="name">{{ row.name }}</span>
            @if (row.isDir && row.path) {
              <button
                class="filter-btn"
                type="button"
                (click)="setPathFilter($event, row.path)"
                [title]="'Filter by path: ' + row.path"
                aria-label="Filter by this directory"
              >
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                  <path
                    d="M1.5 2.5h13l-5 6.2v4l-3-1v-3l-5-6.2z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            }
            <span class="meta">{{ row.display }}</span>
          </div>
        }
        <div [style.height.px]="window().padBottom"></div>
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
      .row {
        display: flex;
        align-items: center;
        gap: 4px;
        /* Fixed height: the virtual window turns a scroll offset into a row index. */
        height: 20px;
        padding-right: 4px;
        box-sizing: border-box;
        font-size: 12px;
        line-height: 1;
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
        flex-shrink: 0;
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
    `,
  ],
})
export class DirectoryTreeComponent implements AfterViewInit {
  private readonly store = inject(AnalysisStore);
  private readonly tabs = inject(TabsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly indent = 8;
  readonly selectedPath = this.store.selectedPath;

  /** Paths of the folders the user has open. The root folder is the empty path. */
  private readonly open = signal<ReadonlySet<string>>(new Set());
  private readonly scrollTop = signal(0);
  private readonly size = createSizeTracker();

  /**
   * Every visible line, in display order.
   *
   * Every file is openable (code → AST view, anything else → text/hex preview), so the
   * tree always shows the whole project rather than pruning to AST-supported files.
   */
  readonly rows = computed<TreeRow[]>(() => {
    const root = this.store.filteredRoot();
    if (!root) return [];
    const metric = this.store.metric();
    // A name filter force-expands everything: a match deep in the tree would otherwise
    // be invisible behind a collapsed folder. The path filter is usually set from the
    // funnel icon on a folder already in view, so it leaves expansion alone.
    const forceOpen = this.store.nameFilterActive();
    const open = this.open();
    const rootName = this.store.rootName();

    const out: TreeRow[] = [];
    const visit = (node: TreeNode, depth: number): void => {
      const dir = isDir(node);
      const expanded = dir && (forceOpen || open.has(node.path));
      out.push({
        path: node.path,
        name: depth === 0 ? node.name || rootName : node.name,
        depth,
        isDir: dir,
        expanded,
        display: formatMetricValue(metricValue(node, metric), metric),
        title: dir ? node.path || rootName : node.path,
      });
      if (dir && expanded) {
        for (const child of sortChildren(node.children)) visit(child, depth + 1);
      }
    };
    visit(root, 0);
    return out;
  });

  /** Only the slice the sidebar can actually show, plus spacer heights. */
  readonly window = computed<RowWindow>(() => {
    const rows = this.rows();
    const start = Math.max(0, Math.floor(this.scrollTop() / ROW_H) - OVERSCAN);
    const count = Math.ceil(Math.max(this.size.height(), ROW_H) / ROW_H) + OVERSCAN * 2;
    const end = Math.min(rows.length, start + count);
    return {
      rows: rows.slice(start, end),
      padTop: start * ROW_H,
      padBottom: Math.max(0, (rows.length - end) * ROW_H),
    };
  });

  constructor() {
    // A freshly loaded project opens down to DEFAULT_OPEN_DEPTH. Keyed on projectId so a
    // background churn update, which replaces the root node, doesn't collapse the tree.
    effect(() => {
      this.store.projectId();
      const root = this.store.root();
      untracked(() => {
        const open = new Set<string>();
        if (root) collectOpenByDefault(root, 0, open);
        this.open.set(open);
        this.scrollTop.set(0);
        this.host.nativeElement.scrollTop = 0;
      });
    });
  }

  ngAfterViewInit(): void {
    this.size.attach(this.host.nativeElement, this.destroyRef);
  }

  onScroll(): void {
    this.scrollTop.set(this.host.nativeElement.scrollTop);
  }

  onRowClick(row: TreeRow): void {
    if (row.isDir) {
      // While a name filter forces everything open, a toggle would only mutate state the
      // user cannot see — so it is ignored, exactly as it was before.
      if (this.store.nameFilterActive()) return;
      this.open.update((prev) => {
        const next = new Set(prev);
        if (!next.delete(row.path)) next.add(row.path);
        return next;
      });
      return;
    }
    this.store.selectPath(row.path);
  }

  onRowDblClick(row: TreeRow): void {
    if (!row.isDir) this.tabs.openFile(row.path);
  }

  setPathFilter(ev: Event, path: string): void {
    ev.stopPropagation();
    this.store.updateFilters({ path });
  }
}

/** Folders first, then files, each alphabetical. */
function sortChildren(children: readonly TreeNode[]): TreeNode[] {
  return [...children].sort((a, b) => {
    if (isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function collectOpenByDefault(node: TreeNode, depth: number, into: Set<string>): void {
  if (isFile(node) || depth >= DEFAULT_OPEN_DEPTH) return;
  into.add(node.path);
  for (const child of node.children) collectOpenByDefault(child, depth + 1, into);
}
