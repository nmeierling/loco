import { Injectable } from '@angular/core';
import { LANG_MAP, SUPPORTED_LANG_IDS } from './treesitter-langs';
import type { AstNodeWire, HighlightTokenWire } from '../workers/ast.worker';

export type AstNode = AstNodeWire;
export type HighlightToken = HighlightTokenWire;

export interface ComplexityProvider {
  readonly id: string;
  supports(languageId: string | null): boolean;
  /** Returns null if this provider can't compute complexity for the given language. */
  compute(text: string, languageId: string | null): Promise<number | null>;
  /** Returns a JSON-serializable AST snapshot, or null if not supported. */
  parse(text: string, languageId: string | null): Promise<AstNode | null>;
  /** Returns a flat list of leaf tokens with their positions + classified kind. */
  highlight(text: string, languageId: string | null): Promise<HighlightToken[] | null>;
}

@Injectable({ providedIn: 'root' })
export class ComplexityService {
  private provider: ComplexityProvider | null = null;

  setProvider(p: ComplexityProvider | null): void {
    this.provider = p;
  }

  hasProvider(): boolean {
    return this.provider !== null;
  }

  supports(languageId: string | null): boolean {
    return this.provider ? this.provider.supports(languageId) : false;
  }

  async compute(text: string, languageId: string | null): Promise<number | null> {
    if (!this.provider) return null;
    return this.provider.compute(text, languageId);
  }

  async parse(text: string, languageId: string | null): Promise<AstNode | null> {
    if (!this.provider) return null;
    return this.provider.parse(text, languageId);
  }

  async highlight(text: string, languageId: string | null): Promise<HighlightToken[] | null> {
    if (!this.provider) return null;
    return this.provider.highlight(text, languageId);
  }
}

interface WorkerResultMsg {
  type: 'result';
  id: number;
  result?: unknown;
  error?: string;
}
interface WorkerInitDoneMsg {
  type: 'init-done';
}
type WorkerOutMsg = WorkerResultMsg | WorkerInitDoneMsg;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * Worker-backed provider: parses and computes complexity inside an isolated worker
 * so heavy WASM work doesn't block the main thread.
 *
 * Single-worker pool for v1; can be expanded to a pool when needed.
 */
export class WorkerTreeSitterProvider implements ComplexityProvider {
  readonly id = 'tree-sitter-worker';
  private worker: Worker | null = null;
  private readonly grammarsPath: string;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(grammarsPath = '/grammars') {
    this.grammarsPath = grammarsPath;
  }

  supports(languageId: string | null): boolean {
    return languageId !== null && SUPPORTED_LANG_IDS.has(languageId);
  }

  async compute(text: string, languageId: string | null): Promise<number | null> {
    if (!languageId || !LANG_MAP[languageId]) return null;
    const v = await this.send('compute', { text, langId: languageId });
    return typeof v === 'number' ? v : null;
  }

  async parse(text: string, languageId: string | null): Promise<AstNode | null> {
    if (!languageId || !LANG_MAP[languageId]) return null;
    const v = await this.send('parse', { text, langId: languageId });
    return v ? (v as AstNode) : null;
  }

  async highlight(text: string, languageId: string | null): Promise<HighlightToken[] | null> {
    if (!languageId || !LANG_MAP[languageId]) return null;
    const v = await this.send('highlight', { text, langId: languageId });
    return Array.isArray(v) ? (v as HighlightToken[]) : null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../workers/ast.worker.ts', import.meta.url), { type: 'module' });
    w.addEventListener('message', (ev: MessageEvent<WorkerOutMsg>) => {
      const msg = ev.data;
      if (msg.type !== 'result') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    });
    w.postMessage({ type: 'init', grammarsPath: this.grammarsPath });
    this.worker = w;
    return w;
  }

  private send(
    type: 'parse' | 'compute' | 'highlight',
    payload: { text: string; langId: string },
  ): Promise<unknown> {
    const w = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ type, id, ...payload });
    });
  }
}
