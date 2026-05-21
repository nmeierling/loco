/**
 * Read-only POSIX-style fs adapter over a Map<path, File>. Implements just enough of
 * the Node fs.promises surface for `isomorphic-git` to read commit/tree/blob objects
 * out of a `.git/` directory that the user dropped in along with the working tree.
 *
 * Paths use forward slashes and are absolute from the loaded folder root (`/`).
 */
export interface FsStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  ino: number;
  mode: number;
  mtimeMs: number;
  size: number;
}

export interface GitFs {
  promises: {
    readFile(filepath: string, options?: { encoding?: string } | string): Promise<Uint8Array | string>;
    readdir(filepath: string): Promise<string[]>;
    stat(filepath: string): Promise<FsStat>;
    lstat(filepath: string): Promise<FsStat>;
    readlink(filepath: string): Promise<string>;
    // The following are required by isomorphic-git's TS surface but never called
    // for read-only operations (log/walk/readObject). They throw EROFS if invoked.
    writeFile(filepath: string, data: Uint8Array | string): Promise<void>;
    unlink(filepath: string): Promise<void>;
    mkdir(filepath: string): Promise<void>;
    rmdir(filepath: string): Promise<void>;
    symlink(target: string, filepath: string): Promise<void>;
  };
}

function erofs(): Error {
  const err = new Error('EROFS: read-only file system');
  (err as Error & { code: string }).code = 'EROFS';
  return err;
}

function enoent(filepath: string): Error {
  const err = new Error(`ENOENT: no such file or directory, '${filepath}'`);
  (err as Error & { code: string }).code = 'ENOENT';
  return err;
}

function notDir(filepath: string): Error {
  const err = new Error(`ENOTDIR: not a directory, '${filepath}'`);
  (err as Error & { code: string }).code = 'ENOTDIR';
  return err;
}

function normalize(filepath: string): string {
  let p = filepath.replace(/\\/g, '/');
  while (p.startsWith('/')) p = p.slice(1);
  if (p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function makeGitFs(files: ReadonlyMap<string, File>): GitFs {
  // Pre-compute the set of directory paths so readdir/stat can answer for dirs
  // (which never appear as keys in `files`).
  const dirs = new Set<string>(['']);
  for (const path of files.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }

  const fileStat = (file: File): FsStat => ({
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    ino: 0,
    mode: 0o100644,
    mtimeMs: file.lastModified,
    size: file.size,
  });
  const dirStat: FsStat = {
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    ino: 0,
    mode: 0o040755,
    mtimeMs: 0,
    size: 0,
  };

  return {
    promises: {
      async readFile(filepath, options) {
        const p = normalize(filepath);
        const file = files.get(p);
        if (!file) throw enoent(filepath);
        const buf = new Uint8Array(await file.arrayBuffer());
        const encoding =
          typeof options === 'string'
            ? options
            : (options?.encoding ?? null);
        if (encoding === 'utf8' || encoding === 'utf-8') {
          return new TextDecoder('utf-8').decode(buf);
        }
        return buf;
      },

      async readdir(filepath) {
        const p = normalize(filepath);
        if (!dirs.has(p)) {
          if (files.has(p)) throw notDir(filepath);
          throw enoent(filepath);
        }
        const prefix = p === '' ? '' : p + '/';
        const out = new Set<string>();
        for (const filePath of files.keys()) {
          if (filePath.startsWith(prefix)) {
            const rest = filePath.slice(prefix.length);
            const slash = rest.indexOf('/');
            out.add(slash >= 0 ? rest.slice(0, slash) : rest);
          }
        }
        for (const dirPath of dirs) {
          if (!dirPath || dirPath === p) continue;
          if (dirPath.startsWith(prefix)) {
            const rest = dirPath.slice(prefix.length);
            const slash = rest.indexOf('/');
            out.add(slash >= 0 ? rest.slice(0, slash) : rest);
          }
        }
        return [...out];
      },

      async stat(filepath) {
        const p = normalize(filepath);
        const file = files.get(p);
        if (file) return fileStat(file);
        if (dirs.has(p)) return dirStat;
        throw enoent(filepath);
      },

      async lstat(filepath) {
        return this.stat(filepath);
      },

      async readlink(filepath) {
        // We don't model symlinks — packed-refs handles ref aliasing for us, and
        // dropped folders generally don't include symlink metadata anyway.
        throw enoent(filepath);
      },

      async writeFile() {
        throw erofs();
      },
      async unlink() {
        throw erofs();
      },
      async mkdir() {
        throw erofs();
      },
      async rmdir() {
        throw erofs();
      },
      async symlink() {
        throw erofs();
      },
    },
  };
}
