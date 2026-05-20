import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { ComplexityService, TreeSitterComplexityProvider } from './core/services/complexity.service';
import { VizRegistry } from './viz/viz-registry';
import { TreemapComponent } from './viz/treemap/treemap.component';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(() => {
      const cs = inject(ComplexityService);
      cs.setProvider(new TreeSitterComplexityProvider('/grammars'));

      const registry = inject(VizRegistry);
      registry.register({
        id: 'treemap',
        label: 'Treemap',
        description: 'Nested rectangles sized by metric, colored by complexity.',
        component: TreemapComponent,
      });
    }),
  ],
};
