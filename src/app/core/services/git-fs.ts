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
    readFile(
      filepath: string,
      options?: { encoding?: string } | string,
    ): Promise<Uint8Array | string>;
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
  // Directory listings are pre-indexed, not derived on demand.
  //
  // isomorphic-git calls readdir('objects/pack') on *every* object it cannot find in
  // a loose object file — so once a repo is packed, that is once per tree and blob
  // read, which is tens of thousands of calls on a real history. Scanning every key
  // in the map to answer each one made readdir O(files) and the walk O(files ×
  // objects): a 300-commit test repo burned 6.8M key comparisons on 15k readdir
  // calls. One pass up front turns each call into a Map lookup.
  const children = new Map<string, Set<string>>([['', new Set()]]);

  const ensureDir = (dirPath: string): Set<string> => {
    let set = children.get(dirPath);
    if (set) return set;
    set = new Set<string>();
    children.set(dirPath, set);
    // Link the directory into its own parent, creating ancestors as needed.
    const slash = dirPath.lastIndexOf('/');
    const parent = slash === -1 ? '' : dirPath.slice(0, slash);
    const name = slash === -1 ? dirPath : dirPath.slice(slash + 1);
    ensureDir(parent).add(name);
    return set;
  };

  for (const path of files.keys()) {
    const slash = path.lastIndexOf('/');
    if (slash === -1) {
      children.get('')!.add(path);
    } else {
      ensureDir(path.slice(0, slash)).add(path.slice(slash + 1));
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
        const encoding = typeof options === 'string' ? options : (options?.encoding ?? null);
        if (encoding === 'utf8' || encoding === 'utf-8') {
          return new TextDecoder('utf-8').decode(buf);
        }
        return buf;
      },

      async readdir(filepath) {
        const p = normalize(filepath);
        const set = children.get(p);
        if (!set) {
          if (files.has(p)) throw notDir(filepath);
          throw enoent(filepath);
        }
        return [...set];
      },

      async stat(filepath) {
        const p = normalize(filepath);
        const file = files.get(p);
        if (file) return fileStat(file);
        if (children.has(p)) return dirStat;
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

/**
 * The subset of a dropped folder that `makeGitFs` needs: `.git/` and nothing else.
 *
 * The read-only operations we run (`log`, `walk` over `TREE({ ref })`, `listBranches`)
 * never touch the working tree, so indexing the other 100k files just to throw them
 * away on every lookup is wasted time and memory.
 */
export function gitDirSubset(files: ReadonlyMap<string, File>): Map<string, File> {
  const out = new Map<string, File>();
  for (const [path, file] of files) {
    if (path === '.git' || path.startsWith('.git/')) out.set(path, file);
  }
  return out;
}
