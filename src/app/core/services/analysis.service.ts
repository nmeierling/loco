import { Injectable, inject } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { LoadResult } from './directory-loader.service';
import { LocInput, LocService } from './loc.service';
import { IgnoreService } from './ignore.service';
import { ComplexityService } from './complexity.service';
import { DirNode, FileNode } from '../models/tree';
import { detectLanguage, extOf } from '../languages';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private readonly store = inject(AnalysisStore);
  private readonly loc = inject(LocService);
  private readonly ig = inject(IgnoreService);
  private readonly complexity = inject(ComplexityService);

  async analyze(load: LoadResult): Promise<void> {
    this.store.status.set({ phase: 'loading', message: `Reading ${load.rootName}…` });

    const gitignorePatterns = await this.collectGitignores(load.files);
    this.ig.setGitignorePatterns(gitignorePatterns);
    const ig = this.ig.analysisIgnore();
    const accepted = load.files.filter((f) => !ig.ignores(f.path));

    const inputs: LocInput[] = accepted.map((f, i) => ({
      id: i,
      path: f.path,
      file: f.file,
      language: detectLanguage(f.file.name),
    }));

    this.store.status.set({ phase: 'counting', done: 0, total: inputs.length });
    const results = await this.loc.countAll(inputs, (done, total) => {
      this.store.status.set({ phase: 'counting', done, total });
    });

    const fileNodes: FileNode[] = inputs.map((input, idx) => {
      const r = results[idx];
      return {
        kind: 'file',
        name: input.file.name,
        path: input.path,
        size: input.file.size,
        ext: extOf(input.file.name),
        language: input.language?.name ?? null,
        metrics: {
          loc: r ? r.loc : null,
          complexity: r ? r.complexity : null,
          churn: null,
        },
      };
    });

    if (this.complexity.hasProvider()) {
      await this.refineComplexity(inputs, fileNodes);
    }

    const blobs = new Map<string, File>();
    for (const input of inputs) blobs.set(input.path, input.file);

    const root = buildTree(load.rootName, fileNodes);
    this.store.setRoot(root, load.rootName, blobs);
    this.store.status.set({ phase: 'ready' });
  }

  private async refineComplexity(inputs: LocInput[], fileNodes: FileNode[]): Promise<void> {
    const targets: number[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      if (input && input.language && this.complexity.supports(input.language.id)) {
        targets.push(i);
      }
    }
    if (targets.length === 0) return;

    this.store.status.set({ phase: 'parsing', done: 0, total: targets.length });

    let done = 0;
    for (const idx of targets) {
      const input = inputs[idx];
      const node = fileNodes[idx];
      if (!input || !node || !input.language) continue;
      try {
        const text = await input.file.text();
        const cx = await this.complexity.compute(text, input.language.id);
        if (cx !== null) {
          node.metrics = { ...node.metrics, complexity: cx };
        }
      } catch {
        // leave heuristic complexity in place
      }
      done++;
      if (done % 4 === 0 || done === targets.length) {
        this.store.status.set({ phase: 'parsing', done, total: targets.length });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  private async collectGitignores(
    files: { path: string; file: File }[],
  ): Promise<string[]> {
    const patterns: string[] = [];
    const gitignores = files.filter((f) => f.path.endsWith('.gitignore'));
    for (const gi of gitignores) {
      try {
        const text = await gi.file.text();
        const dir = gi.path.replace(/\.gitignore$/, '');
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line || line.startsWith('#')) continue;
          if (dir) {
            const negated = line.startsWith('!');
            const body = negated ? line.slice(1) : line;
            const rooted = body.startsWith('/') ? `${dir}${body.slice(1)}` : `${dir}**/${body}`;
            patterns.push((negated ? '!' : '') + rooted);
          } else {
            patterns.push(line);
          }
        }
      } catch {
        // skip unreadable .gitignore
      }
    }
    return patterns;
  }
}

function buildTree(rootName: string, files: FileNode[]): DirNode {
  const root: DirNode = { kind: 'dir', name: rootName, path: '', children: [] };
  const dirMap = new Map<string, DirNode>([['', root]]);

  for (const file of files) {
    const segments = file.path.split('/');
    const dirSegments = segments.slice(0, -1);
    let cur = root;
    let curPath = '';
    for (const seg of dirSegments) {
      curPath = curPath ? `${curPath}/${seg}` : seg;
      let next = dirMap.get(curPath);
      if (!next) {
        next = { kind: 'dir', name: seg, path: curPath, children: [] };
        dirMap.set(curPath, next);
        cur.children.push(next);
      }
      cur = next;
    }
    cur.children.push(file);
  }

  return root;
}

export function _testBuildTree(rootName: string, files: FileNode[]): DirNode {
  return buildTree(rootName, files);
}
