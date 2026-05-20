import { ChangeDetectionStrategy, Component } from '@angular/core';
import { VizHostComponent } from './viz-host.component';

@Component({
  selector: 'loco-heatmap-panel',
  standalone: true,
  imports: [VizHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<loco-viz-host />`,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }
    `,
  ],
})
export class HeatmapPanelComponent {}
