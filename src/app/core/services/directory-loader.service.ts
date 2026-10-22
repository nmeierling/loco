import { Injectable } from '@angular/core';
import { mapPool } from '../perf/pool';

export interface LoadedFile {
  path: string;
  file: File;
}

export interface LoadResult {
  rootName: string;
  files: LoadedFile[];
}

export type ProgressCallback = (count: number) => void;

interface FSDirHandle {
  kind: 'directory';
  name: string;
  entries(): AsyncIterable<[string, FSDirHandle | FSFileHandle]>;
}
interface FSFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
type AnyFSHandle = FSDirHandle | FSFileHandle;

interface PickerWindow {
  showDirectoryPicker?: () => Promise<FSDirHandle>;
}

interface DTItemWithHandle extends DataTransferItem {
  getAsFileSystemHandle?: () => Promise<AnyFSHandle | null>;
}

interface FSEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}
interface FSFileEntry extends FSEntry {
  file(onSuccess: (f: File) => void, onError?: (e: unknown) => void): void;
}
interface FSDirEntry extends FSEntry {
  createReader(): {
    readEntries(cb: (entries: FSEntry[]) => void, errCb?: (e: unknown) => void): void;
  };
}

const isDirHandle = (h: AnyFSHandle): h is FSDirHandle => h.kind === 'directory';
const isFileEntry = (e: FSEntry): e is FSFileEntry => e.isFile;
const isDirEntry = (e: FSEntry): e is FSDirEntry => e.isDirectory;

const PROGRESS_BATCH = 50;

/**
 * How many file handles to resolve at once.
 *
 * `getFile()` / `entry.file()` each cross into the browser's file backend, so awaiting
 * them one at a time makes the load latency-bound: a repo whose `.git/` holds 40k loose
 * objects spent most of the load waiting on round-trips with the CPU idle. The handles
 * are cheap (no bytes are read until something calls `.text()`/`.arrayBuffer()`), so a
 * wide pool is safe.
 */
const HANDLE_CONCURRENCY = 32;

/**
 * Parts of `.git/` that never get read, and are routinely the biggest things in it.
 *
 * We mine history with `log` and `walk(TREE)`, which need `HEAD`, `refs/`,
 * `packed-refs`, `config` and `objects/`. Everything matched here is either local state
 * (`index` is commonly tens of MB on a big checkout), append-only logs, or files that
 * only matter to a writing client. Skipping them during the walk avoids both the handle
 * round-trip and the memory.
 */
const GIT_SKIP_DIRS = new Set(['logs', 'hooks', 'lfs', 'modules', 'worktrees']);
const GIT_SKIP_FILES = new Set([
  'index',
  'COMMIT_EDITMSG',
  'FETCH_HEAD',
  'ORIG_HEAD',
  'MERGE_HEAD',
  'MERGE_MSG',
  'AUTO_MERGE',
  'REBASE_HEAD',
  'CHERRY_PICK_HEAD',
  'BISECT_LOG',
]);

/**
 * True for a path inside `.git/` that git itself needs but we never will.
 *
 * Matches on the first segment below `.git/`, so it holds for both the directory and
 * everything under it — `.git/logs` and `.git/logs/refs/heads/main` are both skipped.
 */
export function skipInGitDir(path: string): boolean {
  if (!path.startsWith('.git/')) return false;
  const rest = path.slice('.git/'.length);
  const slash = rest.indexOf('/');
  const head = slash === -1 ? rest : rest.slice(0, slash);
  if (GIT_SKIP_DIRS.has(head)) return true;
  if (head === 'rebase-merge' || head === 'rebase-apply') return true;
  if (slash === -1 && GIT_SKIP_FILES.has(head)) return true;
  return rest.endsWith('.lock');
}

@Injectable({ providedIn: 'root' })
export class DirectoryLoaderService {
  hasFsAccessApi(): boolean {
    return typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function';
  }

  async pickDirectory(onProgress?: ProgressCallback): Promise<LoadResult | null> {
    const picker = (window as unknown as PickerWindow).showDirectoryPicker;
    if (!picker) return null;
    const handle = await picker();
    return this.fromDirHandle(handle, onProgress);
  }

  async loadFromInput(fileList: FileList, onProgress?: ProgressCallback): Promise<LoadResult> {
    const files: LoadedFile[] = [];
    let rootName = 'root';
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList.item(i);
      if (!f) continue;
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
      const parts = rel.split('/');
      if (parts.length > 1 && parts[0]) rootName = parts[0];
      const path = parts.length > 1 ? parts.slice(1).join('/') : f.name;
      if (skipInGitDir(path)) continue;
      files.push({ path, file: f });
      if (files.length % PROGRESS_BATCH === 0) {
        onProgress?.(files.length);
        // Yield so the spinner can repaint
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.(files.length);
    return { rootName, files };
  }

  async loadFromDrop(event: DragEvent, onProgress?: ProgressCallback): Promise<LoadResult | null> {
    const dt = event.dataTransfer;
    if (!dt) return null;
    const items = Array.from(dt.items) as DTItemWithHandle[];

    // PREFER webkitGetAsEntry: Chromium's FS Access iterator silently strips dotfiles
    // (so .git/, .gitignore, .env, etc. never reach us), and we need those for
    // git churn + .gitignore handling. The legacy entry API includes them.
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.() as unknown as FSEntry | null;
      if (entry && isDirEntry(entry)) {
        const files = await this.collectFsDirEntries(entry, onProgress);
        onProgress?.(files.length);
        return { rootName: entry.name, files };
      }
    }

    // Only fall back to FS Access handles if the entry API isn't available
    // (some non-Chromium browsers). Dotfiles will be missing in that case.
    for (const item of items) {
      if (item.kind !== 'file') continue;
      if (item.getAsFileSystemHandle) {
        const handle = await item.getAsFileSystemHandle();
        if (handle && isDirHandle(handle)) {
          return this.fromDirHandle(handle, onProgress);
        }
      }
    }

    return null;
  }

  private async fromDirHandle(
    handle: FSDirHandle,
    onProgress?: ProgressCallback,
  ): Promise<LoadResult> {
    const handles: { path: string; handle: FSFileHandle }[] = [];
    await this.walkDirHandle(handle, '', handles);
    const files = await resolveAll(handles, (h) => h.handle.getFile(), onProgress);
    onProgress?.(files.length);
    return { rootName: handle.name, files };
  }

  /** Enumerates the tree without touching file contents; handles are resolved after. */
  private async walkDirHandle(
    dir: FSDirHandle,
    prefix: string,
    out: { path: string; handle: FSFileHandle }[],
  ): Promise<void> {
    for await (const [name, child] of dir.entries()) {
      const childPath = prefix ? `${prefix}/${name}` : name;
      const dirChild = isDirHandle(child);
      if (skipInGitDir(childPath)) continue;
      if (dirChild) {
        await this.walkDirHandle(child, childPath, out);
      } else {
        out.push({ path: childPath, handle: child });
      }
    }
  }

  private async collectFsDirEntries(
    root: FSDirEntry,
    onProgress?: ProgressCallback,
  ): Promise<LoadedFile[]> {
    const entries: { path: string; entry: FSFileEntry }[] = [];
    await this.walkFsDirChildren(root, '', entries);
    return resolveAll(
      entries,
      (e) => new Promise<File>((resolve, reject) => e.entry.file(resolve, reject)),
      onProgress,
    );
  }

  private async walkFsDirChildren(
    dir: FSDirEntry,
    prefix: string,
    out: { path: string; entry: FSFileEntry }[],
  ): Promise<void> {
    const reader = dir.createReader();
    const collected: FSEntry[] = [];
    let batch: FSEntry[] = [];
    do {
      batch = await new Promise<FSEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      collected.push(...batch);
    } while (batch.length > 0);

    const subdirs: { path: string; entry: FSDirEntry }[] = [];
    for (const child of collected) {
      const childPath = prefix ? `${prefix}/${child.name}` : child.name;
      if (skipInGitDir(childPath)) continue;
      if (isFileEntry(child)) out.push({ path: childPath, entry: child });
      else if (isDirEntry(child)) subdirs.push({ path: childPath, entry: child });
    }

    // Sibling directories are read concurrently: `readEntries` is another round-trip
    // per 100 entries, and `.git/objects/` alone is 256 shards of them.
    await mapPool(subdirs, HANDLE_CONCURRENCY, (sub) =>
      this.walkFsDirChildren(sub.entry, sub.path, out).then(() => null),
    );
  }
}

/**
 * Turns enumerated handles into `File` objects, `HANDLE_CONCURRENCY` at a time, keeping
 * the enumeration order. Entries that fail to resolve are dropped rather than failing
 * the load — one unreadable file should not cost the user the whole folder.
 */
async function resolveAll<T extends { path: string }>(
  items: readonly T[],
  toFile: (item: T) => Promise<File>,
  onProgress?: ProgressCallback,
): Promise<LoadedFile[]> {
  let resolved = 0;
  const files = await mapPool(items, HANDLE_CONCURRENCY, async (item) => {
    const file = await toFile(item);
    resolved++;
    if (resolved % PROGRESS_BATCH === 0) onProgress?.(resolved);
    return file;
  });

  const out: LoadedFile[] = [];
  for (let i = 0; i < items.length; i++) {
    const file = files[i];
    if (file) out.push({ path: items[i]!.path, file });
  }
  return out;
}
