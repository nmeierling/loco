import { Injectable, NgZone, inject } from '@angular/core';
import type { CountRequest, CountResponse } from '../workers/loc.worker';
import { LanguageRules } from '../languages';

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

@Injectable({ providedIn: 'root' })
export class LocService {
  private readonly zone = inject(NgZone);
  private workers: Worker[] = [];
  private nextWorker = 0;

  ensureWorkers(): Worker[] {
    if (this.workers.length > 0) return this.workers;
    const hw = navigator.hardwareConcurrency ?? 4;
    const count = Math.max(1, Math.min(hw - 1, 6));
    for (let i = 0; i < count; i++) {
      this.workers.push(
        new Worker(new URL('../workers/loc.worker.ts', import.meta.url), { type: 'module' }),
      );
    }
    return this.workers;
  }

  destroy(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  async countAll(
    inputs: LocInput[],
    onProgress: (done: number, total: number) => void,
  ): Promise<LocOutput[]> {
    const workers = this.ensureWorkers();
    const results: LocOutput[] = new Array(inputs.length);
    let done = 0;

    const tasks = await Promise.all(
      inputs.map(async (input) => {
        if (input.file.size > MAX_TEXT_BYTES || input.language == null) {
          return null;
        }
        try {
          const text = await input.file.text();
          return { input, text };
        } catch {
          return null;
        }
      }),
    );

    return new Promise((resolve) => {
      const pending = new Map<number, (r: LocOutput) => void>();

      const handler = (ev: MessageEvent<CountResponse>) => {
        const r = ev.data;
        const cb = pending.get(r.id);
        if (cb) {
          pending.delete(r.id);
          cb({ id: r.id, loc: r.loc, blank: r.blank, comment: r.comment, complexity: r.complexity });
        }
      };

      for (const w of workers) w.addEventListener('message', handler);

      const cleanup = () => {
        for (const w of workers) w.removeEventListener('message', handler);
      };

      let dispatched = 0;
      for (let i = 0; i < inputs.length; i++) {
        const t = tasks[i];
        const input = inputs[i];
        if (!input) continue;

        if (!t) {
          results[i] = { id: input.id, loc: 0, blank: 0, comment: 0, complexity: 0 };
          done++;
          this.zone.run(() => onProgress(done, inputs.length));
          continue;
        }

        const w = workers[this.nextWorker % workers.length]!;
        this.nextWorker++;

        pending.set(input.id, (r) => {
          results[i] = r;
          done++;
          this.zone.run(() => onProgress(done, inputs.length));
          if (done === inputs.length) {
            cleanup();
            for (let j = 0; j < results.length; j++) {
              if (!results[j]) {
                const inp = inputs[j];
                if (inp) results[j] = { id: inp.id, loc: 0, blank: 0, comment: 0, complexity: 0 };
              }
            }
            resolve(results);
          }
        });

        const req: CountRequest = {
          type: 'count',
          id: input.id,
          path: input.path,
          text: t.text,
          lineComment: input.language?.lineComment ?? null,
          blockComment: input.language?.blockComment ?? null,
        };
        w.postMessage(req);
        dispatched++;
      }

      if (dispatched === 0) {
        cleanup();
        for (let j = 0; j < inputs.length; j++) {
          if (!results[j]) {
            const inp = inputs[j];
            if (inp) results[j] = { id: inp.id, loc: 0, blank: 0, comment: 0, complexity: 0 };
          }
        }
        resolve(results);
      }
    });
  }
}
