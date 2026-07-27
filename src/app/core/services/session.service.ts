import { Injectable, inject, signal } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { IgnoreService } from './ignore.service';
import {
  MAX_SESSION_BYTES,
  SESSION_SCHEMA_VERSION,
  SessionMeta,
  SessionStoreService,
} from './session-store.service';
import { TreeNode, isFile, walk } from '../models/tree';

/** Debounce for the small metadata writes that follow filter/selection changes. */
const META_DEBOUNCE_MS = 400;

/**
 * Keeps the analysed project in the browser cache so a reload resumes where the user
 * left off, and puts it back on start-up.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly store = inject(AnalysisStore);
  private readonly ig = inject(IgnoreService);
  private readonly db = inject(SessionStoreService);

  /** True while start-up is still deciding whether there is a session to restore. */
  readonly restoring = signal(true);
  /** When the cached snapshot was taken — its contents are a copy, not a live view. */
  readonly savedAt = signal<number | null>(null);
  /** Set when the project deliberately was not cached, with the reason. */
  readonly notCached = signal<string | null>(null);

  private vizId: string | null = null;
  private metaTimer: ReturnType<typeof setTimeout> | null = null;

  /** Reads any cached project back into the store. Resolves to the restored viz id. */
  async restore(): Promise<string | null> {
    this.restoring.set(true);
    try {
      const session = await this.db.load((done, total) => {
        this.store.status.set({ phase: 'restoring', done, total });
      });
      if (!session || session.files.size === 0) {
        this.store.status.set({ phase: 'idle' });
        return null;
      }
      const { meta, files } = session;

      this.ig.clearUserPatterns();
      for (const p of meta.ignorePatterns) this.ig.addUserPattern(p);

      this.store.setRoot(meta.tree, meta.rootName, files);
      this.store.filters.set(meta.filters);
      this.store.selectPath(meta.selectedPath);
      // Churn cannot be recomputed after a restore — `.git/` is not cached — so a walk
      // that had not finished when the snapshot was taken stays unavailable.
      this.store.churn.set(
        meta.churn.status === 'ready' || meta.churn.status === 'error'
          ? meta.churn
          : { status: 'unavailable' },
      );
      this.store.status.set({ phase: 'ready' });
      this.savedAt.set(meta.savedAt);
      this.vizId = meta.vizId;
      return meta.vizId;
    } catch (e) {
      console.warn('[loco] session restore failed', e);
      this.store.status.set({ phase: 'idle' });
      return null;
    } finally {
      this.restoring.set(false);
    }
  }

  /** Caches the freshly analysed project, file contents included. */
  async saveProject(): Promise<void> {
    const meta = this.buildMeta();
    if (!meta) return;
    const files = this.store.fileBlobs();
    if (meta.totalBytes > MAX_SESSION_BYTES) {
      this.notCached.set(
        `Project is larger than ${Math.round(MAX_SESSION_BYTES / 1024 / 1024)} MB, so it is not kept for the next reload.`,
      );
      this.savedAt.set(null);
      await this.db.clear();
      return;
    }
    const ok = await this.db.saveFull(meta, files);
    this.notCached.set(
      ok
        ? null
        : 'Browser storage refused the write, so this project is not kept for the next reload.',
    );
    this.savedAt.set(ok ? meta.savedAt : null);
  }

  /** Records the current viz so a reload comes back to the same visualization. */
  setViz(id: string | null): void {
    if (this.vizId === id) return;
    this.vizId = id;
    this.queueMeta();
  }

  /** Persists filters, selection and ignore patterns without rewriting the file cache. */
  queueMeta(): void {
    if (this.savedAt() === null) return;
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null;
      void this.db.saveMeta({
        filters: this.store.filters(),
        selectedPath: this.store.selectedPath(),
        vizId: this.vizId,
        ignorePatterns: [...this.ig.userPatterns()],
      });
    }, META_DEBOUNCE_MS);
  }

  /** Rewrites the tree — used once the background churn walk folds its numbers in. */
  async saveTree(): Promise<void> {
    if (this.savedAt() === null) return;
    const root = this.store.root();
    if (!root) return;
    await this.db.saveMeta({ tree: root, churn: this.store.churn() });
  }

  async discard(): Promise<void> {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.metaTimer = null;
    this.savedAt.set(null);
    this.notCached.set(null);
    this.vizId = null;
    await this.db.clear();
  }

  private buildMeta(): SessionMeta | null {
    const root = this.store.root();
    if (!root) return null;
    let fileCount = 0;
    let totalBytes = 0;
    walk(root, (n: TreeNode) => {
      if (isFile(n)) {
        fileCount++;
        totalBytes += n.size;
      }
    });
    return {
      version: SESSION_SCHEMA_VERSION,
      rootName: this.store.rootName(),
      savedAt: Date.now(),
      tree: root,
      filters: this.store.filters(),
      selectedPath: this.store.selectedPath(),
      vizId: this.vizId,
      ignorePatterns: [...this.ig.userPatterns()],
      churn: this.store.churn(),
      fileCount,
      totalBytes,
    };
  }
}
