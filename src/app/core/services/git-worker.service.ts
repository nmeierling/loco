import { Injectable } from '@angular/core';
import { gitDirSubset } from './git-fs';
import type {
  GitChurnWire,
  GitCommitDetailWire,
  GitOverviewWire,
  GitRequest,
  GitResponse,
} from '../workers/git.worker';

/**
 * Which worker a request runs on.
 *
 * The churn walk takes minutes on a large history, and the Git view's queries take
 * well under a second — putting both on one worker means opening the Git view during a
 * load sits behind 2000 commits of tree diffing. Two workers cost one extra pack-index
 * parse and buy an always-responsive view.
 */
type Lane = 'background' | 'interactive';

/**
 * Thrown into every in-flight request when the repository is swapped out.
 *
 * It means "nobody wants this answer any more", not "git is broken" — callers should
 * drop the result silently rather than showing the user a failure.
 */
export class GitWorkerDetachedError extends Error {
  constructor() {
    super('The repository was replaced while this git request was running.');
    this.name = 'GitWorkerDetachedError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (done: number, total: number) => void;
}

interface LaneState {
  worker: Worker;
  /** Which `attach` generation this worker has been given. */
  generation: number;
  /** Resolves once the current generation's repo is attached. */
  ready: Promise<void> | null;
}

@Injectable({ providedIn: 'root' })
export class GitWorkerService {
  private readonly lanes = new Map<Lane, LaneState>();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  /** The `.git/` subset of the current project, and a counter that invalidates workers. */
  private files: ReadonlyMap<string, File> = new Map();
  private generation = 0;

  /**
   * Points the workers at a newly loaded project.
   *
   * Only `.git/` is handed over — the read-only operations never touch the working
   * tree, so indexing the other files would be pure overhead. `File` objects clone by
   * reference, so this does not copy any bytes.
   */
  attach(allFiles: ReadonlyMap<string, File>): void {
    this.files = gitDirSubset(allFiles);
    this.generation++;
    // Drop the existing workers: their caches belong to the previous repo.
    this.dispose();
  }

  /**
   * Forgets the current repository.
   *
   * A restored session has no `.git/` — it isn't cached — so without this the Git view
   * would keep answering from whichever repo was analysed earlier in the same page.
   */
  detach(): void {
    this.attach(new Map());
  }

  hasGitDir(): boolean {
    return this.files.has('.git/HEAD');
  }

  overview(limit: number, countCap: number): Promise<GitOverviewWire> {
    return this.send('interactive', (id) => ({ type: 'overview', id, limit, countCap }));
  }

  commitDetail(oid: string): Promise<GitCommitDetailWire> {
    return this.send('interactive', (id) => ({ type: 'commit-detail', id, oid }));
  }

  churn(
    maxCommits: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<GitChurnWire> {
    return this.send('background', (id) => ({ type: 'churn', id, maxCommits }), onProgress);
  }

  dispose(): void {
    for (const lane of this.lanes.values()) lane.worker.terminate();
    this.lanes.clear();
    const abandoned = [...this.pending.values()];
    this.pending.clear();
    for (const p of abandoned) p.reject(new GitWorkerDetachedError());
  }

  private async send<T>(
    lane: Lane,
    build: (id: number) => GitRequest,
    onProgress?: (done: number, total: number) => void,
  ): Promise<T> {
    const state = await this.ensureAttached(lane);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      state.worker.postMessage(build(id));
    });
  }

  private async ensureAttached(lane: Lane): Promise<LaneState> {
    let state = this.lanes.get(lane);
    if (state && state.generation === this.generation) {
      if (state.ready) await state.ready;
      return state;
    }
    if (state) state.worker.terminate();

    const worker = new Worker(new URL('../workers/git.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (ev: MessageEvent<GitResponse>) => this.onMessage(ev.data));
    state = { worker, generation: this.generation, ready: null };
    this.lanes.set(lane, state);

    const id = this.nextId++;
    state.ready = new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
      });
      worker.postMessage({ type: 'attach', id, files: this.files } satisfies GitRequest);
    });
    await state.ready;
    return state;
  }

  private onMessage(msg: GitResponse): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    switch (msg.type) {
      case 'progress':
        entry.onProgress?.(msg.done, msg.total);
        return;
      case 'attached':
        this.pending.delete(msg.id);
        entry.resolve(undefined);
        return;
      case 'result':
        this.pending.delete(msg.id);
        entry.resolve(msg.result);
        return;
      case 'error':
        this.pending.delete(msg.id);
        entry.reject(new Error(msg.message));
        return;
    }
  }
}
