import { Injectable, signal } from '@angular/core';
import { VizDescriptor } from './viz.types';

@Injectable({ providedIn: 'root' })
export class VizRegistry {
  private readonly _all = signal<VizDescriptor[]>([]);
  readonly all = this._all.asReadonly();
  readonly selectedId = signal<string | null>(null);

  register(desc: VizDescriptor): void {
    this._all.update((list) => {
      if (list.some((d) => d.id === desc.id)) return list;
      const next = [...list, desc];
      if (this.selectedId() === null) this.selectedId.set(desc.id);
      return next;
    });
  }

  select(id: string): void {
    if (this._all().some((d) => d.id === id)) this.selectedId.set(id);
  }

  current(): VizDescriptor | null {
    const id = this.selectedId();
    if (!id) return null;
    return this._all().find((d) => d.id === id) ?? null;
  }
}
