import { Injectable, computed, inject, signal } from '@angular/core';
import { DirNode, TreeNode, isDir, isFile } from '../models/tree';
import { AnalysisPhase } from '../models/analysis';
import { DEFAULT_FILTERS, Filters } from '../models/filters';
import { IgnoreService } from '../services/ignore.service';

@Injectable({ providedIn: 'root' })
export class AnalysisStore {
  private readonly ig = inject(IgnoreService);

  readonly root = signal<DirNode | null>(null);
  readonly rootName = signal<string>('');
  readonly status = signal<AnalysisPhase>({ phase: 'idle' });
  readonly filters = signal<Filters>(DEFAULT_FILTERS);
  readonly selectedPath = signal<string | null>(null);
  /** Path → File for files that survived ignore filters. Lets per-file views (AST) re-read text on demand. */
  readonly fileBlobs = signal<ReadonlyMap<string, File>>(new Map());

  readonly filteredRoot = computed<DirNode | null>(() => {
    const root = this.root();
    if (!root) return null;
    const { name, path } = this.filters();
    const userPatterns = this.ig.userPatterns();
    const userIg = userPatterns.length > 0 ? this.ig.userIgnore() : null;
    if (!name && !path && !userIg) return root;
    const matcher = userIg ? (p: string) => userIg.ignores(p) : null;
    const filtered = applyFilters(root, name.toLowerCase(), path.toLowerCase(), matcher);
    return filtered && isDir(filtered) ? filtered : root;
  });

  setRoot(root: DirNode, rootName: string, blobs: ReadonlyMap<string, File>): void {
    this.root.set(root);
    this.rootName.set(rootName);
    this.fileBlobs.set(blobs);
  }

  updateFilters(patch: Partial<Filters>): void {
    this.filters.update((f) => ({ ...f, ...patch }));
  }

  selectPath(path: string | null): void {
    this.selectedPath.set(path);
  }

  clear(): void {
    this.root.set(null);
    this.rootName.set('');
    this.status.set({ phase: 'idle' });
    this.filters.set(DEFAULT_FILTERS);
    this.selectedPath.set(null);
    this.fileBlobs.set(new Map());
  }
}

function applyFilters(
  node: TreeNode,
  nameQ: string,
  pathQ: string,
  userIgnored: ((path: string) => boolean) | null,
): TreeNode | null {
  if (isFile(node)) {
    if (userIgnored && userIgnored(node.path)) return null;
    const nameOk = !nameQ || node.name.toLowerCase().includes(nameQ);
    const pathOk = !pathQ || node.path.toLowerCase().includes(pathQ);
    return nameOk && pathOk ? node : null;
  }
  if (userIgnored && node.path && userIgnored(node.path + '/')) return null;
  const dirPathOk = !pathQ || node.path.toLowerCase().includes(pathQ);
  const kept: TreeNode[] = [];
  for (const child of node.children) {
    const k = applyFilters(child, nameQ, dirPathOk ? '' : pathQ, userIgnored);
    if (k) kept.push(k);
  }
  if (kept.length === 0) return null;
  return { ...node, children: kept };
}
