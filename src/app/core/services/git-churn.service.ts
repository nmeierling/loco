import { Injectable } from '@angular/core';
import { makeGitFs } from './git-fs';

export interface ChurnProgress {
  done: number;
  total: number;
}

export interface ChurnResult {
  /** path → number of commits that touched the file. */
  countByPath: ReadonlyMap<string, number>;
  /** Last commit timestamp per file (epoch seconds). */
  lastTouchedByPath: ReadonlyMap<string, number>;
  /** Total commits walked (capped at MAX_COMMITS). */
  commitsScanned: number;
}

const MAX_COMMITS = 2000;

/**
 * Walks the commit history of a dropped folder's `.git/` directory and tallies how
 * often each file was changed. Backed by `isomorphic-git` over an in-memory fs.
 *
 * The dropped folder must include the `.git/` directory (we don't fetch from a remote).
 */
@Injectable({ providedIn: 'root' })
export class GitChurnService {
  /**
   * Tests whether the given file set looks like a git working tree we can mine —
   * cheap probe so callers can decide whether to even invoke the heavy walk.
   */
  hasGitDir(files: ReadonlyMap<string, File>): boolean {
    return files.has('.git/HEAD');
  }

  async churnByPath(
    files: ReadonlyMap<string, File>,
    onProgress?: (p: ChurnProgress) => void,
  ): Promise<ChurnResult | null> {
    if (!this.hasGitDir(files)) return null;

    // isomorphic-git expects a global `Buffer` (it's Node-style code). Polyfill
    // on-demand so the buffer module isn't pulled into the main bundle.
    if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
      const buffer = await import('buffer');
      (globalThis as { Buffer?: unknown }).Buffer = buffer.Buffer;
    }

    // Dynamic import so isomorphic-git (~400 KB) only loads when the user
    // actually drops a repo with a .git/ directory.
    const git = await import('isomorphic-git');
    const fs = makeGitFs(files);
    const dir = '/';
    const gitdir = '/.git';

    const log = await git.log({ fs, dir, gitdir, depth: MAX_COMMITS });
    const total = log.length;

    const count = new Map<string, number>();
    const lastTouched = new Map<string, number>();

    const bump = (path: string, timestamp: number): void => {
      count.set(path, (count.get(path) ?? 0) + 1);
      const prev = lastTouched.get(path) ?? 0;
      if (timestamp > prev) lastTouched.set(path, timestamp);
    };

    for (let i = 0; i < log.length; i++) {
      const entry = log[i]!;
      const oid = entry.oid;
      const parents = entry.commit.parent ?? [];
      const ts = entry.commit.author.timestamp;

      if (parents.length === 0) {
        // Initial commit — every blob in its tree is "changed".
        await git.walk({
          fs,
          dir,
          gitdir,
          trees: [git.TREE({ ref: oid })],
          map: async (filepath, entries) => {
            if (filepath === '.') return undefined;
            const a = entries?.[0];
            if (!a) return undefined;
            if ((await a.type()) !== 'blob') return undefined;
            bump(filepath, ts);
            return undefined;
          },
        });
      } else {
        // Diff against the first parent only (skip merge double-counting).
        const parentOid = parents[0]!;
        await git.walk({
          fs,
          dir,
          gitdir,
          trees: [git.TREE({ ref: parentOid }), git.TREE({ ref: oid })],
          map: async (filepath, entries) => {
            if (filepath === '.') return undefined;
            const a = entries?.[0] ?? null;
            const b = entries?.[1] ?? null;
            const aType = a ? await a.type() : null;
            const bType = b ? await b.type() : null;
            const aBlob = aType === 'blob' ? a : null;
            const bBlob = bType === 'blob' ? b : null;
            if (!aBlob && !bBlob) return undefined;
            const aOid = aBlob ? await aBlob.oid() : null;
            const bOid = bBlob ? await bBlob.oid() : null;
            if (aOid !== bOid) bump(filepath, ts);
            return undefined;
          },
        });
      }

      if (i % 5 === 0 || i === log.length - 1) {
        onProgress?.({ done: i + 1, total });
        // Yield so the spinner can repaint
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    return { countByPath: count, lastTouchedByPath: lastTouched, commitsScanned: total };
  }
}
