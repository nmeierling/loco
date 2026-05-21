import { Injectable, inject } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { LoadResult } from './directory-loader.service';
import { LocInput, LocService } from './loc.service';
import { IgnoreService } from './ignore.service';
import { ComplexityService } from './complexity.service';
import { GitChurnService } from './git-churn.service';
import { DirNode, FileNode } from '../models/tree';
import { detectLanguage, extOf } from '../languages';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private readonly store = inject(AnalysisStore);
  private readonly loc = inject(LocService);
  private readonly ig = inject(IgnoreService);
  private readonly complexity = inject(ComplexityService);
  private readonly churn = inject(GitChurnService);

  async analyze(load: LoadResult): Promise<void> {
    this.store.status.set({ phase: 'loading', message: `Reading ${load.rootName}…` });

    // Build a quick map of ALL loaded files (including `.git/`) so git-churn can mine
    // commit history. Analysis filters happen separately below and leave `.git/` out
    // of the tree the user sees.
    const allFilesMap = new Map<string, File>();
    for (const f of load.files) allFilesMap.set(f.path, f.file);

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

    this.logGitDetection(allFilesMap);
    if (this.churn.hasGitDir(allFilesMap)) {
      await this.refineChurn(allFilesMap, fileNodes);
    }

    const blobs = new Map<string, File>();
    for (const input of inputs) blobs.set(input.path, input.file);

    const root = buildTree(load.rootName, fileNodes);
    this.store.setRoot(root, load.rootName, blobs);
    this.store.status.set({ phase: 'ready' });
  }

  private async refineChurn(
    allFiles: ReadonlyMap<string, File>,
    fileNodes: FileNode[],
  ): Promise<void> {
    this.store.status.set({ phase: 'churn', done: 0, total: 0 });
    try {
      console.info('[loco] churn: walking git history…');
      const result = await this.churn.churnByPath(allFiles, (p) => {
        this.store.status.set({ phase: 'churn', done: p.done, total: p.total });
      });
      if (!result) {
        console.warn('[loco] churn: service returned no result (no .git/HEAD?)');
        return;
      }
      console.info(
        '[loco] churn: scanned %d commits, %d files have churn data',
        result.commitsScanned,
        result.countByPath.size,
      );
      const byPath = result.countByPath;
      let matched = 0;
      for (const node of fileNodes) {
        const c = byPath.get(node.path);
        if (c !== undefined) {
          node.metrics = { ...node.metrics, churn: c };
          matched++;
        }
      }
      console.info(
        '[loco] churn: %d of %d tree files matched a git path; sample git paths: %o',
        matched,
        fileNodes.length,
        [...byPath.keys()].slice(0, 5),
      );
    } catch (e) {
      // Don't fail the whole analysis if git parsing breaks — just leave churn null.
      console.warn('[loco] git churn computation failed', e);
    }
  }

  /**
   * Logs to the browser console where (if anywhere) we found a `.git/` directory in
   * the dropped folder. Helps debug "I dropped a repo but churn didn't appear" cases
   * (typical culprits: hidden files excluded by drag-drop, or the dropped folder is a
   * parent of the actual repo).
   */
  private logGitDetection(files: ReadonlyMap<string, File>): void {
    const gitFiles = [...files.keys()].filter((p) => p.includes('.git/'));
    if (gitFiles.length === 0) {
      console.info(
        '[loco] git churn: no .git/ files in the dropped folder — Churn chip will stay hidden. ' +
          'Make sure you dropped the project root (the folder that contains .git/) and that your ' +
          'browser includes hidden files in folder uploads.',
      );
      return;
    }
    const heads = gitFiles.filter((p) => /(^|\/)\.git\/HEAD$/.test(p));
    console.info(
      '[loco] git churn: found %d .git/* files in the upload, %d of them are HEAD files. ' +
        'Sample paths: %o',
      gitFiles.length,
      heads.length,
      gitFiles.slice(0, 5),
    );
    if (heads.length === 0) {
      console.warn(
        '[loco] git churn: no .git/HEAD found in the upload despite other .git files being present. ' +
          'Some browsers strip hidden top-level files from drag-drop — try using the “choose a folder” picker.',
      );
    } else if (!files.has('.git/HEAD')) {
      const nested = heads[0]?.replace(/\.git\/HEAD$/, '');
      console.warn(
        '[loco] git churn: .git/HEAD is nested under "%s". Currently we only mine churn for repos where ' +
          '.git/ is at the dropped folder root. Drop %s instead, or we can teach the service to handle nested repos.',
        nested,
        nested,
      );
    }
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
