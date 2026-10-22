import { Injectable } from '@angular/core';
import type { CountRequest, CountResponse } from '../workers/loc.worker';
import { LanguageRules } from '../languages';
import { mapPool, throttleProgress } from '../perf/pool';

export interface LocInput {
  id: number;
  path: string;
  file: File;
  language: LanguageRules | null;
}

export interface LocOutput {
  id: number;
  loc: number;
  blank: number;
  comment: number;
  complexity: number;
}

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

interface Lane {
  worker: Worker;
  inFlight: number;
}

@Injectable({ providedIn: 'root' })
export class LocService {
  private lanes: Lane[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, (r: CountResponse) => void>();

  ensureWorkers(): Worker[] {
    if (this.lanes.length === 0) {
      const hw = navigator.hardwareConcurrency ?? 4;
      const count = Math.max(1, Math.min(hw - 1, 6));
      for (let i = 0; i < count; i++) this.lanes.push(this.spawn());
    }
    return this.lanes.map((l) => l.worker);
  }

  destroy(): void {
    for (const lane of this.lanes) lane.worker.terminate();
    this.lanes = [];
    this.pending.clear();
  }

  /**
   * Counts lines for every input, `concurrency` files at a time.
   *
   * The bound is the point of this method. Reading every file up front and posting all
   * of them to the workers at once means the whole repo's source sits in memory twice —
   * once as the JS strings and once as the structured clones in flight — which on a
   * large project is where the tab starts swapping instead of working. Keeping a couple
   * of files per worker in flight is just as fast and has a flat memory profile.
   */
  async countAll(
    inputs: LocInput[],
    onProgress: (done: number, total: number) => void,
  ): Promise<LocOutput[]> {
    const lanes = this.ensureWorkers().length;
    const report = throttleProgress(onProgress);
    report(0, inputs.length);

    const counted = await mapPool(
      inputs,
      // Two per worker: one being counted, one already transferred and queued.
      lanes * 2,
      async (input) => {
        // Binaries and very large files are skipped rather than read into memory.
        if (input.file.size > MAX_TEXT_BYTES || input.language === null) return null;
        const text = await input.file.text();
        return this.count({
          type: 'count',
          id: 0,
          path: input.path,
          text,
          lineComment: input.language.lineComment ?? null,
          blockComment: input.language.blockComment ?? null,
        });
      },
      report,
    );

    return inputs.map((input, i) => {
      const r = counted[i];
      if (!r) return { id: input.id, loc: 0, blank: 0, comment: 0, complexity: 0 };
      return {
        id: input.id,
        loc: r.loc,
        blank: r.blank,
        comment: r.comment,
        complexity: r.complexity,
      };
    });
  }

  private spawn(): Lane {
    const worker = new Worker(new URL('../workers/loc.worker.ts', import.meta.url), {
      type: 'module',
    });
    const lane: Lane = { worker, inFlight: 0 };
    worker.addEventListener('message', (ev: MessageEvent<CountResponse>) => {
      const r = ev.data;
      const resolve = this.pending.get(r.id);
      if (!resolve) return;
      this.pending.delete(r.id);
      lane.inFlight--;
      resolve(r);
    });
    return lane;
  }

  private count(req: Omit<CountRequest, 'id'> & { id: number }): Promise<CountResponse> {
    let lane = this.lanes[0]!;
    for (const candidate of this.lanes) {
      if (candidate.inFlight < lane.inFlight) lane = candidate;
    }
    const id = this.nextId++;
    lane.inFlight++;
    return new Promise<CountResponse>((resolve) => {
      this.pending.set(id, resolve);
      lane.worker.postMessage({ ...req, id });
    });
  }
}
