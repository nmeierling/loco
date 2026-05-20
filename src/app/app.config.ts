import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { ComplexityService, WorkerTreeSitterProvider } from './core/services/complexity.service';
import { VizRegistry } from './viz/viz-registry';
import { TreemapComponent } from './viz/treemap/treemap.component';
import { ModuleGraphComponent } from './viz/module-graph/module-graph.component';
import { SunburstComponent } from './viz/sunburst/sunburst.component';
import { DependencyMatrixComponent } from './viz/matrix/matrix.component';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(() => {
      const cs = inject(ComplexityService);
      cs.setProvider(new WorkerTreeSitterProvider('/grammars'));

      const registry = inject(VizRegistry);
      registry.register({
        id: 'treemap',
        label: 'Treemap',
        description: 'Nested rectangles sized by metric, colored by complexity.',
        component: TreemapComponent,
      });
      registry.register({
        id: 'sunburst',
        label: 'Sunburst',
        description: 'Radial hierarchy. Concentric rings of folders and files.',
        component: SunburstComponent,
      });
      registry.register({
        id: 'module-graph',
        label: 'Module graph',
        description: 'File-level import dependencies (TS/JS/TSX/JSX, Python).',
        component: ModuleGraphComponent,
      });
      registry.register({
        id: 'matrix',
        label: 'Dep matrix',
        description: 'Adjacency matrix of file-to-file imports.',
        component: DependencyMatrixComponent,
      });
    }),
  ],
};
