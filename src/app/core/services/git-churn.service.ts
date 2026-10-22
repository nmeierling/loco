import { Injectable, inject } from '@angular/core';
import { GitWorkerService } from './git-worker.service';

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
 * Tallies how often each file was changed, from the commit history in a dropped
 * folder's `.git/` directory.
 *
 * The walk itself lives in {@link GitWorkerService}'s worker — it is long and entirely
 * CPU-bound, and running it on the main thread froze the tab for the duration. The
 * caller must have `attach`ed the project to the worker first.
 */
@Injectable({ providedIn: 'root' })
export class GitChurnService {
  private readonly worker = inject(GitWorkerService);

  /**
   * Tests whether the attached file set looks like a git working tree we can mine —
   * cheap probe so callers can decide whether to even invoke the heavy walk.
   */
  hasGitDir(): boolean {
    return this.worker.hasGitDir();
  }

  async churnByPath(onProgress?: (p: ChurnProgress) => void): Promise<ChurnResult | null> {
    if (!this.hasGitDir()) return null;
    const result = await this.worker.churn(MAX_COMMITS, (done, total) =>
      onProgress?.({ done, total }),
    );
    return {
      countByPath: result.countByPath,
      lastTouchedByPath: result.lastTouchedByPath,
      commitsScanned: result.commitsScanned,
    };
  }
}
