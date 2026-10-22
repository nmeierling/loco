// Generates a synthetic TypeScript project for perf measurement:
// ~3000 files / ~320k LOC, with real import edges so the module graph and symbol
// index have something to resolve. Written outside the repo so it is never analysed
// by the app's own tooling.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? '/tmp/bigproj';
const FILES = Number(process.argv[3] ?? 3000);
const LINES_PER_FILE = Number(process.argv[4] ?? 105);
const FEATURES = 60;

rmSync(OUT, { recursive: true, force: true });

const pathFor = (i) => {
  const feature = `feature${String(i % FEATURES).padStart(2, '0')}`;
  const layer = ['services', 'components', 'models', 'utils'][Math.floor(i / FEATURES) % 4];
  return join('src', feature, layer, `mod${i}.ts`);
};

const relImport = (from, to) => {
  const a = pathFor(from).split('/').slice(0, -1);
  const b = pathFor(to).split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  const down = b.slice(i).join('/').replace(/\.ts$/, '');
  return (up === 0 ? './' : '../'.repeat(up)) + down;
};

for (let i = 0; i < FILES; i++) {
  const p = join(OUT, pathFor(i));
  mkdirSync(join(OUT, pathFor(i).split('/').slice(0, -1).join('/')), { recursive: true });

  const deps = [(i + 7) % FILES, (i + 101) % FILES, (i + 913) % FILES].filter((d) => d !== i);
  const lines = [
    `import { Injectable } from '@angular/core';`,
    ...deps.map((d) => `import { thing${d} } from '${relImport(i, d)}';`),
    ``,
    `/** Synthetic module ${i} — generated for perf measurement. */`,
    `export interface Shape${i} {`,
    `  id: string;`,
    `  value: number;`,
    `  tags: string[];`,
    `}`,
    ``,
    `export const thing${i} = '${i}';`,
    ``,
    `@Injectable({ providedIn: 'root' })`,
    `export class Service${i} {`,
  ];

  // Pad out to the target line count with branchy methods, so complexity and the
  // per-symbol branch counts have real work to do.
  let n = 0;
  while (lines.length < LINES_PER_FILE - 2) {
    lines.push(
      `  method${n}(input: Shape${i} | null): number {`,
      `    if (!input) return 0;`,
      `    let total = 0;`,
      `    for (const tag of input.tags) {`,
      `      if (tag.length > 3 && tag !== 'skip') {`,
      `        total += tag.length;`,
      `      } else if (tag.startsWith('x')) {`,
      `        total -= 1;`,
      `      }`,
      `    }`,
      `    return total > 0 ? total : ${n};`,
      `  }`,
      ``,
    );
    n++;
  }
  lines.push(`}`, ``);
  writeFileSync(p, lines.join('\n'));
}

console.log(`wrote ${FILES} files to ${OUT}`);
