import { Injectable, inject, signal } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { GitWorkerDetachedError, GitWorkerService } from './git-worker.service';
import type { GitCommitDetailWire, GitOverviewWire } from '../workers/git.worker';

export type GitOverview = GitOverviewWire;
export type GitCommitDetail = GitCommitDetailWire;

export type GitRepoState =
  | { status: 'idle' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'ready'; overview: GitOverview; limit: number }
  | { status: 'error'; message: string };

/** How many commits the graph shows, and the steps the view offers. */
export const COMMIT_LIMITS = [50, 200, 500] as const;

/**
 * Walking every commit just to print a total is unbounded work on a big history, so the
 * count stops here and the view says "20,000+" instead of lying.
 */
const COUNT_CAP = 20_000;

/**
 * Backs the Git view: repository-level facts and the newest slice of history.
 *
 * All of it comes off {@link GitWorkerService}'s interactive worker, which is separate
 * from the one running the churn walk — so opening this view during a load doesn't
 * queue behind a few thousand commits of tree diffing.
 */
@Injectable({ providedIn: 'root' })
export class GitRepoService {
  private readonly worker = inject(GitWorkerService);
  private readonly store = inject(AnalysisStore);

  readonly state = signal<GitRepoState>({ status: 'idle' });

  /** Project + limit the current `state` belongs to, so a re-open doesn't re-fetch. */
  private loadedFor: { project: number; limit: number } | null = null;
  private inFlight = 0;

  /** Fetches the overview if we don't already have it for this project and limit. */
  ensureLoaded(limit: number = COMMIT_LIMITS[0]): void {
    const project = this.store.projectId();
    if (this.loadedFor?.project === project && this.loadedFor.limit === limit) return;
    void this.reload(limit);
  }

  async reload(limit: number = COMMIT_LIMITS[0]): Promise<void> {
    const project = this.store.projectId();
    if (!this.worker.hasGitDir()) {
      this.loadedFor = null;
      this.state.set({ status: 'unavailable' });
      return;
    }

    const token = ++this.inFlight;
    this.state.set({ status: 'loading' });
    try {
      const overview = await this.worker.overview(limit, COUNT_CAP);
      // A folder swap or a newer request mid-flight wins.
      if (token !== this.inFlight || this.store.projectId() !== project) return;
      this.loadedFor = { project, limit };
      this.state.set({ status: 'ready', overview, limit });
    } catch (e) {
      if (token !== this.inFlight || this.store.projectId() !== project) return;
      this.loadedFor = null;
      // A swapped-out repository isn't an error to report — the new project's own
      // `ensureLoaded` is already on its way.
      if (e instanceof GitWorkerDetachedError) {
        this.state.set({ status: 'idle' });
        return;
      }
      this.state.set({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not read the git history.',
      });
    }
  }

  /** Changed paths for one commit. Cached, since the graph re-selects rows constantly. */
  async detail(oid: string): Promise<GitCommitDetail> {
    const hit = this.detailCache.get(oid);
    if (hit) return hit;
    const promise = this.worker.commitDetail(oid);
    this.detailCache.set(oid, promise);
    try {
      return await promise;
    } catch (e) {
      this.detailCache.delete(oid);
      throw e;
    }
  }

  private readonly detailCache = new Map<string, Promise<GitCommitDetail>>();

  /** Called when a new folder is analysed — the old oids belong to another repo. */
  reset(): void {
    this.loadedFor = null;
    this.detailCache.clear();
    this.inFlight++;
    this.state.set({ status: 'idle' });
  }
}
