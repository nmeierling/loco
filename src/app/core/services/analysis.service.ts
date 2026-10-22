import { Injectable, inject } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { LoadResult } from './directory-loader.service';
import { LocInput, LocService } from './loc.service';
import { IgnoreService } from './ignore.service';
import { ComplexityService } from './complexity.service';
import { GitChurnService } from './git-churn.service';
import { GitWorkerDetachedError, GitWorkerService } from './git-worker.service';
import { GitRepoService } from './git-repo.service';
import { SessionService } from './session.service';
import { DirNode, FileNode } from '../models/tree';
import { mapPool, throttleProgress } from '../perf/pool';
import { detectLanguage, extOf } from '../languages';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private readonly store = inject(AnalysisStore);
  private readonly loc = inject(LocService);
  private readonly ig = inject(IgnoreService);
  private readonly complexity = inject(ComplexityService);
  private readonly churn = inject(GitChurnService);
  private readonly gitWorker = inject(GitWorkerService);
  private readonly gitRepo = inject(GitRepoService);
  private readonly session = inject(SessionService);

  async analyze(load: LoadResult): Promise<void> {
    this.store.status.set({ phase: 'loading', message: `Reading ${load.rootName}…` });

    // Build a quick map of ALL loaded files (including `.git/`) so git-churn can mine
    // commit history. Analysis filters happen separately below and leave `.git/` out
    // of the tree the user sees.
    const allFilesMap = new Map<string, File>();
    for (const f of load.files) allFilesMap.set(f.path, f.file);

    // Hand `.git/` to the git worker before anything else, so the Git view and the
    // churn walk can both start from it.
    this.gitWorker.attach(allFilesMap);
    this.gitRepo.reset();

    const gitignorePatterns = await this.collectGitignores(load.files);
    this.ig.setGitignorePatterns(gitignorePatterns);
    const ig = this.ig.analysisIgnore();
    // `.git/` is ignored by the very first default pattern, but `ignore` still runs the
    // path through every compiled pattern to find that out. On a packed repo `.git/`
    // can be the majority of the dropped files, so testing them is most of the work
    // this filter does — and the answer is known from the prefix alone.
    const accepted = load.files.filter((f) => !isGitInternal(f.path) && !ig.ignores(f.path));

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
          risk: null,
        },
      };
    });

    if (this.complexity.hasProvider()) {
      await this.refineComplexity(inputs, fileNodes);
    }

    const blobs = new Map<string, File>();
    for (const input of inputs) blobs.set(input.path, input.file);

    this.logGitDetection(allFilesMap);
    const hasGit = this.churn.hasGitDir();
    this.store.churn.set(hasGit ? { status: 'pending' } : { status: 'unavailable' });

    const root = buildTree(load.rootName, fileNodes);
    this.store.setRoot(root, load.rootName, blobs);
    this.store.status.set({ phase: 'ready' });

    // Cache the analysed project so a reload skips the folder pick. Off the critical
    // path — the tree is already on screen.
    void this.session.saveProject();

    // Walking history is the slowest part of the analysis and nothing on screen
    // depends on it, so it runs after the tree is up and folds its results in later.
    if (hasGit) {
      const forProject = this.store.projectId();
      void this.refineChurn(forProject);
    }
  }

  private async refineChurn(forProject: number): Promise<void> {
    /** The user may swap folders mid-walk; results from the old project are dropped. */
    const stale = (): boolean => this.store.projectId() !== forProject;

    this.store.churn.set({ status: 'running', done: 0, total: 0 });
    try {
      console.info('[loco] churn: walking git history…');
      const result = await this.churn.churnByPath((p) => {
        if (!stale()) this.store.churn.set({ status: 'running', done: p.done, total: p.total });
      });
      if (stale()) return;
      if (!result) {
        console.warn('[loco] churn: service returned no result (no .git/HEAD?)');
        this.store.churn.set({ status: 'error', message: 'No readable git history.' });
        return;
      }
      const matched = this.store.applyChurn(result.countByPath);
      this.store.churn.set({
        status: 'ready',
        filesWithChurn: matched,
        commitsScanned: result.commitsScanned,
      });
      // The cached tree predates these numbers, and `.git/` is not cached, so a
      // restored session can never recompute them — rewrite the tree now.
      void this.session.saveTree();
      console.info(
        '[loco] churn: scanned %d commits, %d files matched a git path; sample git paths: %o',
        result.commitsScanned,
        matched,
        [...result.countByPath.keys()].slice(0, 5),
      );
    } catch (e) {
      // A folder swap tears the worker down mid-walk. Nobody wants this result any
      // more, and the new analysis has already set its own churn state.
      if (e instanceof GitWorkerDetachedError) return;
      // Don't fail the whole analysis if git parsing breaks — just leave churn null.
      console.warn('[loco] git churn computation failed', e);
      if (!stale()) {
        this.store.churn.set({
          status: 'error',
          message: e instanceof Error ? e.message : 'Git history walk failed.',
        });
      }
    }
  }

  /**
   * Logs to the browser console where (if anywhere) we found a `.git/` directory in
   * the dropped folder. Helps debug "I dropped a repo but churn didn't appear" cases
   * (typical culprits: hidden files excluded by drag-drop, or the dropped folder is a
   * parent of the actual repo).
   */
  private logGitDetection(files: ReadonlyMap<string, File>): void {
    // One pass, keeping only a handful of samples — on a packed repo `.git/` is tens of
    // thousands of entries and materialising them all just to log five is wasteful.
    let gitFileCount = 0;
    const gitFiles: string[] = [];
    const heads: string[] = [];
    for (const p of files.keys()) {
      if (!p.includes('.git/')) continue;
      gitFileCount++;
      if (gitFiles.length < 5) gitFiles.push(p);
      if (/(^|\/)\.git\/HEAD$/.test(p)) heads.push(p);
    }
    if (gitFileCount === 0) {
      console.info(
        '[loco] git churn: no .git/ files in the dropped folder — Churn chip will stay hidden. ' +
          'Make sure you dropped the project root (the folder that contains .git/) and that your ' +
          'browser includes hidden files in folder uploads.',
      );
      return;
    }
    console.info(
      '[loco] git churn: found %d .git/* files in the upload, %d of them are HEAD files. ' +
        'Sample paths: %o',
      gitFileCount,
      heads.length,
      gitFiles,
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

  /**
   * Replaces the regex heuristic with a real tree-sitter branch count, for the files
   * whose language we have a grammar for.
   *
   * This runs across the whole worker pool: the parses are independent, and doing them
   * one-at-a-time left every core but one idle through the longest phase of the load.
   * Progress is throttled — the user cannot read 3000 counter updates, but Angular
   * would happily schedule 3000 change-detection passes for them.
   */
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
    const onProgress = throttleProgress((done, total) =>
      this.store.status.set({ phase: 'parsing', done, total }),
    );

    await mapPool(
      targets,
      this.complexity.concurrency,
      async (idx) => {
        const input = inputs[idx];
        const node = fileNodes[idx];
        if (!input || !node || !input.language) return null;
        const text = await input.file.text();
        const cx = await this.complexity.compute(text, input.language.id);
        // A failed parse leaves the heuristic complexity in place.
        if (cx !== null) node.metrics = { ...node.metrics, complexity: cx };
        return null;
      },
      onProgress,
    );
  }

  private async collectGitignores(files: { path: string; file: File }[]): Promise<string[]> {
    const patterns: string[] = [];
    const gitignores = files.filter((f) => f.path.endsWith('.gitignore'));
    const texts = await Promise.all(gitignores.map((gi) => gi.file.text().catch(() => null)));
    for (let i = 0; i < gitignores.length; i++) {
      const gi = gitignores[i]!;
      try {
        const text = texts[i];
        if (text === null || text === undefined) continue;
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

/** Git's own object store — mined for history, never shown as source. */
function isGitInternal(path: string): boolean {
  return path.startsWith('.git/');
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
