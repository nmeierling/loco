import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { VizRegistry } from './viz-registry';

@Component({
  selector: 'loco-viz-host',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (current()) {
      <ng-container *ngComponentOutlet="current()!.component" />
    } @else {
      <div class="empty">No visualization registered.</div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .empty {
        padding: 1rem;
        opacity: 0.6;
      }
    `,
  ],
})
export class VizHostComponent {
  private readonly registry = inject(VizRegistry);
  readonly current = computed(() => {
    this.registry.selectedId();
    return this.registry.current();
  });
}
