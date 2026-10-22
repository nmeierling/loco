import { Injectable } from '@angular/core';

/**
 * A domain frame — a labelled region of the board that owns the stickies dropped inside
 * it. Coordinates and sizes are in board ("world") units, independent of pan/zoom.
 */
export interface BoardFrame {
  id: string;
  title: string;
  /** Palette index (see the component's FRAME_COLORS), so the theme owns the actual hue. */
  colorIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardSticky {
  id: string;
  kind: 'symbol' | 'note';
  /** The frame it currently belongs to, or null when loose on the canvas. */
  frameId: string | null;
  x: number;
  y: number;
  /** Symbol stickies: width sized to fit the full name. Notes use a fixed size. */
  w?: number;
  /** Symbol stickies: the {@link SymbolDef.id} they mirror, so re-runs don't duplicate them. */
  symbolId?: string;
  /** Symbol stickies: display name and where to open it. Note stickies: unused. */
  label?: string;
  path?: string;
  symbolKind?: string;
  startRow?: number;
  startCol?: number;
  endRow?: number;
  endCol?: number;
  /** Note stickies: the editable reminder text. */
  text?: string;
}

/** The full persisted board for one project. */
export interface BoardState {
  version: number;
  frames: BoardFrame[];
  stickies: BoardSticky[];
  /** Saved viewport, so a revisit lands where the user left off. */
  tx: number;
  ty: number;
  zoom: number;
  savedAt: number;
}

export const BOARD_VERSION = 1;

const DB_NAME = 'loco-domain-board';
const DB_VERSION = 1;
const STORE = 'boards';

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
 * Persists domain boards in their own IndexedDB database, keyed by project name. A board
 * is a long-lived artifact the user curates and revisits, so it lives apart from the
 * throwaway analysis session cache — reloading the same folder brings its board back, and
 * boards for different projects coexist. Degrades to a no-op (returning null) in private
 * mode or when IndexedDB is unavailable, exactly like the session cache.
 */
@Injectable({ providedIn: 'root' })
export class DomainBoardStore {
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
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return this.db;
  }

  /** The persistence key for a project. Falls back so an unnamed root still saves. */
  private key(projectName: string): string {
    return projectName.trim() || '(unnamed)';
  }

  async load(projectName: string): Promise<BoardState | null> {
    const db = await this.open();
    if (!db) return null;
    try {
      const tx = db.transaction(STORE, 'readonly');
      const state = await request<BoardState | undefined>(tx.objectStore(STORE).get(this.key(projectName)));
      if (!state || state.version !== BOARD_VERSION) return null;
      return state;
    } catch (e) {
      console.warn('[loco] domain board read failed', e);
      return null;
    }
  }

  async save(projectName: string, state: BoardState): Promise<void> {
    const db = await this.open();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, this.key(projectName));
      await done(tx);
    } catch (e) {
      // A dropped write just means the next mutation retries; nothing to surface.
      console.warn('[loco] domain board write failed', e);
    }
  }

  async remove(projectName: string): Promise<void> {
    const db = await this.open();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(this.key(projectName));
      await done(tx);
    } catch {
      // Ignore — a stale board is harmless and overwritten on the next save.
    }
  }
}
