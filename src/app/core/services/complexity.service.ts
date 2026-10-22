import { Injectable } from '@angular/core';
import { LANG_MAP, SUPPORTED_LANG_IDS } from './treesitter-langs';
import type {
  AstNodeWire,
  HighlightTokenWire,
  ImportScanWire,
  SymbolScanWire,
} from '../workers/ast.worker';

export type AstNode = AstNodeWire;
export type HighlightToken = HighlightTokenWire;
export type ImportScan = ImportScanWire;
export type SymbolScan = SymbolScanWire;

export interface ComplexityProvider {
  readonly id: string;
  /** How many scans can usefully be in flight at once — the size of the worker pool. */
  readonly concurrency: number;
  supports(languageId: string | null): boolean;
  /** Returns null if this provider can't compute complexity for the given language. */
  compute(text: string, languageId: string | null): Promise<number | null>;
  /** Returns a JSON-serializable AST snapshot, or null if not supported. */
  parse(text: string, languageId: string | null): Promise<AstNode | null>;
  /** Returns a flat list of leaf tokens with their positions + classified kind. */
  highlight(text: string, languageId: string | null): Promise<HighlightToken[] | null>;
  /** Import specifiers (plus JVM package/declarations), extracted without shipping the AST. */
  scanImports(text: string, languageId: string | null, jvm: boolean): Promise<ImportScan | null>;
  /** Declarations, bindings, references and per-symbol branch counts for one file. */
  scanSymbols(text: string, languageId: string | null, jvm: boolean): Promise<SymbolScan | null>;
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

  /** Safe fan-out width for whole-repo scans; 1 when there is no provider at all. */
  get concurrency(): number {
    return this.provider ? Math.max(1, this.provider.concurrency) : 1;
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

  async scanImports(
    text: string,
    languageId: string | null,
    jvm: boolean,
  ): Promise<ImportScan | null> {
    if (!this.provider) return null;
    return this.provider.scanImports(text, languageId, jvm);
  }

  async scanSymbols(
    text: string,
    languageId: string | null,
    jvm: boolean,
  ): Promise<SymbolScan | null> {
    if (!this.provider) return null;
    return this.provider.scanSymbols(text, languageId, jvm);
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
  lane: Lane;
}

interface Lane {
  worker: Worker;
  /** Requests dispatched to this worker and not yet answered. */
  inFlight: number;
}

type ScanType = 'parse' | 'compute' | 'highlight' | 'import-scan' | 'symbol-scan';

/**
 * Pool size. One core is left for the UI thread, and the grammars are loaded per
 * worker, so an unbounded pool would just trade parse time for WASM memory.
 */
function poolSize(): number {
  const hw = navigator.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(hw - 1, 6));
}

/**
 * Worker-backed provider: parses and computes complexity inside isolated workers so
 * heavy WASM work doesn't block the main thread.
 *
 * The pool matters more than it looks. A whole-repo pass is a few thousand independent
 * parses; with a single worker they serialize behind each other while the rest of the
 * machine idles. Requests go to the least-loaded lane, so one slow 1 MB file doesn't
 * stall the queue behind it.
 */
export class WorkerTreeSitterProvider implements ComplexityProvider {
  readonly id = 'tree-sitter-worker';
  readonly concurrency: number;

  private readonly grammarsPath: string;
  private lanes: Lane[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(grammarsPath = '/grammars', size = poolSize()) {
    this.grammarsPath = grammarsPath;
    this.concurrency = Math.max(1, size);
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

  async scanImports(
    text: string,
    languageId: string | null,
    jvm: boolean,
  ): Promise<ImportScan | null> {
    if (!languageId || !LANG_MAP[languageId]) return null;
    const v = await this.send('import-scan', { text, langId: languageId, jvm });
    return v ? (v as ImportScan) : null;
  }

  async scanSymbols(
    text: string,
    languageId: string | null,
    jvm: boolean,
  ): Promise<SymbolScan | null> {
    if (!languageId || !LANG_MAP[languageId]) return null;
    const v = await this.send('symbol-scan', { text, langId: languageId, jvm });
    return v ? (v as SymbolScan) : null;
  }

  private ensureLanes(): Lane[] {
    if (this.lanes.length > 0) return this.lanes;
    for (let i = 0; i < this.concurrency; i++) {
      const worker = new Worker(new URL('../workers/ast.worker.ts', import.meta.url), {
        type: 'module',
      });
      const lane: Lane = { worker, inFlight: 0 };
      worker.addEventListener('message', (ev: MessageEvent<WorkerOutMsg>) => {
        const msg = ev.data;
        if (msg.type !== 'result') return;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        p.lane.inFlight--;
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      });
      worker.postMessage({ type: 'init', grammarsPath: this.grammarsPath });
      this.lanes.push(lane);
    }
    return this.lanes;
  }

  /** Least-loaded lane, so a queued 1 MB file doesn't block the ones behind it. */
  private pickLane(): Lane {
    const lanes = this.ensureLanes();
    let best = lanes[0]!;
    for (const lane of lanes) {
      if (lane.inFlight < best.inFlight) best = lane;
    }
    return best;
  }

  private send(
    type: ScanType,
    payload: { text: string; langId: string; jvm?: boolean },
  ): Promise<unknown> {
    const lane = this.pickLane();
    const id = this.nextId++;
    lane.inFlight++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, lane });
      lane.worker.postMessage({ type, id, ...payload });
    });
  }
}
