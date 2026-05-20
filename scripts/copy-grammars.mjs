import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'public', 'grammars');
mkdirSync(outDir, { recursive: true });

// Patch web-tree-sitter's `require("fs")`/`require("path")`/`require("module")` calls.
// They live behind an `if (ENVIRONMENT_IS_NODE)` branch that never executes in the browser,
// but esbuild still tries to statically resolve the specifiers and fails.
const wtsRuntime = join(root, 'node_modules/web-tree-sitter/tree-sitter.js');
if (existsSync(wtsRuntime)) {
  const original = readFileSync(wtsRuntime, 'utf8');
  let patched = original
    .replace(/require\("fs"\)/g, '({})')
    .replace(/require\("path"\)/g, '({})')
    .replace(/require\("module"\)/g, '({})');
  if (patched !== original) {
    writeFileSync(wtsRuntime, patched, 'utf8');
    console.log('copy-grammars: patched web-tree-sitter Node-only requires');
  }
}

const candidateRuntimes = [
  ['node_modules/web-tree-sitter/tree-sitter.wasm', 'tree-sitter.wasm'],
  ['node_modules/web-tree-sitter/web-tree-sitter.wasm', 'web-tree-sitter.wasm'],
];
for (const [src, name] of candidateRuntimes) {
  const full = join(root, src);
  if (existsSync(full)) {
    copyFileSync(full, join(outDir, name));
  }
}

const grammarsDir = join(root, 'node_modules/tree-sitter-wasms/out');
let copied = 0;
if (existsSync(grammarsDir)) {
  for (const f of readdirSync(grammarsDir)) {
    if (f.endsWith('.wasm')) {
      copyFileSync(join(grammarsDir, f), join(outDir, f));
      copied++;
    }
  }
}

console.log(`copy-grammars: runtime + ${copied} grammar(s) -> public/grammars/`);
