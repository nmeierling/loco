import { Injectable } from '@angular/core';
import { DirNode } from '../models/tree';
import { Filters } from '../models/filters';
import { ChurnState } from '../models/analysis';

const DB_NAME = 'loco-session';
const DB_VERSION = 1;
const META_STORE = 'meta';
const FILE_STORE = 'files';
const META_KEY = 'current';
const SCHEMA_VERSION = 1;

/**
 * Above this the write itself becomes the slow part of an analysis and the payoff —
 * skipping one folder pick — is not worth it. Oversized projects simply aren't cached.
 */
export const MAX_SESSION_BYTES = 200 * 1024 * 1024;

/** Everything needed to put the app back exactly where it was, minus the file contents. */
export interface SessionMeta {
  version: number;
  rootName: string;
  savedAt: number;
  tree: DirNode;
  filters: Filters;
  selectedPath: string | null;
  /** Open AST tabs (file paths) and which one is active — restored on reload. */
  openTabs?: readonly string[];
  activeTab?: string | null;
  vizId: string | null;
  ignorePatterns: readonly string[];
  churn: ChurnState;
  fileCount: number;
  totalBytes: number;
}

export interface RestoredSession {
  meta: SessionMeta;
  files: Map<string, File>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Caches the analysed project in IndexedDB so a page reload lands back on the
 * visualisation instead of the folder picker.
 *
 * The file blobs are cached alongside the tree because the AST view, module graph and
 * symbol index all re-read file text on demand — metadata alone would restore a
 * half-working app. `.git/` is deliberately not cached: it is large, and the churn
 * numbers it produces already live in the tree.
 */
@Injectable({ providedIn: 'root' })
export class SessionStoreService {
  private db: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    this.db = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      // Private-browsing modes and blocked upgrades both land here; caching is optional.
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return this.db;
  }

  /**
   * Writes the tree and every cached file. Returns false when the project is too big
   * to be worth caching or the browser refused the write.
   */
  async saveFull(meta: SessionMeta, files: ReadonlyMap<string, File>): Promise<boolean> {
    if (meta.totalBytes > MAX_SESSION_BYTES) {
      await this.clear();
      return false;
    }
    const db = await this.open();
    if (!db) return false;
    try {
      const tx = db.transaction([META_STORE, FILE_STORE], 'readwrite');
      const fileStore = tx.objectStore(FILE_STORE);
      fileStore.clear();
      for (const [path, file] of files) fileStore.put(file, path);
      tx.objectStore(META_STORE).put(meta, META_KEY);
      await done(tx);
      return true;
    } catch (e) {
      // Quota errors are the common case — drop the half-written session.
      console.warn('[loco] session cache write failed', e);
      await this.clear();
      return false;
    }
  }

  /** Updates the small record only — filters, selection and the like. */
  async saveMeta(patch: Partial<SessionMeta>): Promise<void> {
    const db = await this.open();
    if (!db) return;
    try {
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      const current = await request<SessionMeta | undefined>(store.get(META_KEY));
      if (!current) return;
      store.put({ ...current, ...patch }, META_KEY);
      await done(tx);
    } catch {
      // A failed metadata update is not worth surfacing; the next save retries.
    }
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<RestoredSession | null> {
    const db = await this.open();
    if (!db) return null;
    try {
      const metaTx = db.transaction(META_STORE, 'readonly');
      const meta = await request<SessionMeta | undefined>(
        metaTx.objectStore(META_STORE).get(META_KEY),
      );
      if (!meta || meta.version !== SCHEMA_VERSION || !meta.tree) {
        await this.clear();
        return null;
      }

      const tx = db.transaction(FILE_STORE, 'readonly');
      const store = tx.objectStore(FILE_STORE);
      const keys = await request<IDBValidKey[]>(store.getAllKeys());
      const values = await request<File[]>(store.getAll());
      const files = new Map<string, File>();
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = values[i];
        if (typeof key === 'string' && value) files.set(key, value);
        if (i % 200 === 0) onProgress?.(i, keys.length);
      }
      onProgress?.(keys.length, keys.length);
      return { meta, files };
    } catch (e) {
      console.warn('[loco] session cache read failed', e);
      return null;
    }
  }

  async clear(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    try {
      const tx = db.transaction([META_STORE, FILE_STORE], 'readwrite');
      tx.objectStore(META_STORE).clear();
      tx.objectStore(FILE_STORE).clear();
      await done(tx);
    } catch {
      // Nothing to do — a stale cache is discarded on the next failed read.
    }
  }
}

export const SESSION_SCHEMA_VERSION = SCHEMA_VERSION;
