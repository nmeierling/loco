import { Injectable, inject } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { LoadResult } from './directory-loader.service';
import { LocInput, LocService } from './loc.service';
import { IgnoreService } from './ignore.service';
import { DirNode, FileNode, TreeNode } from '../models/tree';
import { detectLanguage, extOf } from '../languages';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private readonly store = inject(AnalysisStore);
  private readonly loc = inject(LocService);
  private readonly ig = inject(IgnoreService);

  async analyze(load: LoadResult): Promise<void> {
    this.store.status.set({ phase: 'loading', message: `Reading ${load.rootName}…` });

    const ignorePatterns = await this.collectGitignores(load.files);
    const ig = this.ig.build(ignorePatterns);
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

    const root = buildTree(load.rootName, fileNodes);
    this.store.setRoot(root, load.rootName);
    this.store.status.set({ phase: 'ready' });
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
