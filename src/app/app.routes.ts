import { Routes } from '@angular/router';
import { ShellComponent } from './shell/shell.component';
import { HeatmapPanelComponent } from './viz/heatmap-panel.component';
import { AstViewComponent } from './ast/ast-view.component';

export const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: '', component: HeatmapPanelComponent, pathMatch: 'full' },
      { path: 'ast', component: AstViewComponent },
      { path: '**', redirectTo: '' },
    ],
  },
];
