import { Routes } from '@angular/router';
import { ShellComponent } from './shell/shell.component';
import { AstViewComponent } from './ast/ast-view.component';

export const routes: Routes = [
  { path: '', component: ShellComponent, pathMatch: 'full' },
  { path: 'ast', component: AstViewComponent },
  { path: '**', redirectTo: '' },
];
