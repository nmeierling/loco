import { Injectable } from '@angular/core';
import ignore, { Ignore } from 'ignore';

const DEFAULT_IGNORES = [
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  'target/',
  '.next/',
  '.nuxt/',
  '.angular/',
  '.cache/',
  '.parcel-cache/',
  '.turbo/',
  '.vite/',
  '.svelte-kit/',
  '.idea/',
  '.vscode/',
  '.DS_Store',
  '*.lock',
  '*.log',
  'coverage/',
];

@Injectable({ providedIn: 'root' })
export class IgnoreService {
  build(extraPatterns: string[] = []): Ignore {
    const ig = ignore();
    ig.add(DEFAULT_IGNORES);
    if (extraPatterns.length) ig.add(extraPatterns);
    return ig;
  }

  filter<T extends { path: string }>(items: T[], ig: Ignore): T[] {
    return items.filter((it) => !ig.ignores(it.path));
  }
}
