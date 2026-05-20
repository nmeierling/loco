import { Injectable } from '@angular/core';

export interface LoadedFile {
  path: string;
  file: File;
}

export interface LoadResult {
  rootName: string;
  files: LoadedFile[];
}

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
  createReader(): { readEntries(cb: (entries: FSEntry[]) => void, errCb?: (e: unknown) => void): void };
}

const isDirHandle = (h: AnyFSHandle): h is FSDirHandle => h.kind === 'directory';
const isFileEntry = (e: FSEntry): e is FSFileEntry => e.isFile;
const isDirEntry = (e: FSEntry): e is FSDirEntry => e.isDirectory;

@Injectable({ providedIn: 'root' })
export class DirectoryLoaderService {
  hasFsAccessApi(): boolean {
    return typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function';
  }

  async pickDirectory(): Promise<LoadResult | null> {
    const picker = (window as unknown as PickerWindow).showDirectoryPicker;
    if (!picker) return null;
    const handle = await picker();
    return this.fromDirHandle(handle);
  }

  async loadFromInput(fileList: FileList): Promise<LoadResult> {
    const files: LoadedFile[] = [];
    let rootName = 'root';
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList.item(i);
      if (!f) continue;
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
      const parts = rel.split('/');
      if (parts.length > 1 && parts[0]) rootName = parts[0];
      const path = parts.length > 1 ? parts.slice(1).join('/') : f.name;
      files.push({ path, file: f });
    }
    return { rootName, files };
  }

  async loadFromDrop(event: DragEvent): Promise<LoadResult | null> {
    const dt = event.dataTransfer;
    if (!dt) return null;
    const items = Array.from(dt.items) as DTItemWithHandle[];

    for (const item of items) {
      if (item.kind !== 'file') continue;
      if (item.getAsFileSystemHandle) {
        const handle = await item.getAsFileSystemHandle();
        if (handle && isDirHandle(handle)) {
          return this.fromDirHandle(handle);
        }
      }
    }

    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.() as unknown as FSEntry | null;
      if (entry && isDirEntry(entry)) {
        const files: LoadedFile[] = [];
        await this.walkFsDirChildren(entry, '', files);
        return { rootName: entry.name, files };
      }
    }

    return null;
  }

  private async fromDirHandle(handle: FSDirHandle): Promise<LoadResult> {
    const files: LoadedFile[] = [];
    await this.walkDirHandle(handle, '', files);
    return { rootName: handle.name, files };
  }

  private async walkDirHandle(dir: FSDirHandle, prefix: string, out: LoadedFile[]): Promise<void> {
    for await (const [name, child] of dir.entries()) {
      const childPath = prefix ? `${prefix}/${name}` : name;
      if (isDirHandle(child)) {
        await this.walkDirHandle(child, childPath, out);
      } else {
        const file = await child.getFile();
        out.push({ path: childPath, file });
      }
    }
  }

  private async walkFsDirChildren(dir: FSDirEntry, prefix: string, out: LoadedFile[]): Promise<void> {
    const reader = dir.createReader();
    const collected: FSEntry[] = [];
    let batch: FSEntry[] = [];
    do {
      batch = await new Promise<FSEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      collected.push(...batch);
    } while (batch.length > 0);

    for (const child of collected) {
      const childPath = prefix ? `${prefix}/${child.name}` : child.name;
      if (isFileEntry(child)) {
        const file = await new Promise<File>((resolve, reject) => child.file(resolve, reject));
        out.push({ path: childPath, file });
      } else if (isDirEntry(child)) {
        await this.walkFsDirChildren(child, childPath, out);
      }
    }
  }
}
