import { Injectable, inject } from '@angular/core';
import { AnalysisStore } from '../state/analysis.store';
import { ModuleGraphService } from './module-graph.service';
import { TreeNode, isFile, walk } from '../models/tree';

/**
 * Combines the three things loco already knows about a file into one 0-100 score:
 * how tangled it is, how many files depend on it, and how often it changes. Files
 * that score high on all three are where defects concentrate — a simple file that
 * changes constantly is fine, and so is a hairy one nobody imports.
 *
 * Fan-in comes from the module graph, which is expensive to build, so the score is
 * computed the first time the metric is asked for rather than during analysis.
 */
@Injectable({ providedIn: 'root' })
export class RiskService {
  private readonly store = inject(AnalysisStore);
  private readonly graph = inject(ModuleGraphService);

  private inFlight: Promise<void> | null = null;

  /** Computes and applies the score, unless it is already current for this project. */
  async ensure(): Promise<void> {
    const state = this.store.risk();
    if (state.status === 'ready' && state.projectId === this.store.projectId()) return;
    if (this.inFlight) return this.inFlight;
    const run = this.compute().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async compute(): Promise<void> {
    const project = this.store.projectId();
    const root = this.store.root();
    if (!root) return;

    this.store.risk.set({ status: 'computing' });
    try {
      const graph = await this.graph.build();
      if (this.store.projectId() !== project) return;

      const fanIn = new Map<string, number>();
      for (const node of graph.nodes) fanIn.set(node.path, node.inDegree);

      let maxComplexity = 0;
      let maxFanIn = 0;
      let maxChurn = 0;
      walk(root, (n: TreeNode) => {
        if (!isFile(n)) return;
        maxComplexity = Math.max(maxComplexity, n.metrics.complexity ?? 0);
        maxChurn = Math.max(maxChurn, n.metrics.churn ?? 0);
        maxFanIn = Math.max(maxFanIn, fanIn.get(n.path) ?? 0);
      });

      const byPath = new Map<string, number>();
      walk(root, (n: TreeNode) => {
        if (!isFile(n)) return;
        const complexity = n.metrics.complexity ?? 0;
        // Each factor is scaled to its repo-wide maximum, then combined as a geometric
        // mean so no single dimension can carry a file on its own. Fan-in and churn are
        // offset by one so a zero there dampens rather than annihilates the score;
        // complexity is not, because a file with no branching carries no risk.
        const c = maxComplexity > 0 ? complexity / maxComplexity : 0;
        const f = (1 + (fanIn.get(n.path) ?? 0)) / (1 + maxFanIn);
        const h = (1 + (n.metrics.churn ?? 0)) / (1 + maxChurn);
        byPath.set(n.path, Math.round(100 * Math.cbrt(c * f * h)));
      });

      this.store.applyRisk(byPath);
      this.store.risk.set({
        status: 'ready',
        projectId: project,
        usedChurn: maxChurn > 0,
        usedFanIn: maxFanIn > 0,
      });
    } catch (e) {
      console.warn('[loco] risk computation failed', e);
      this.store.risk.set({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not build the dependency graph.',
      });
    }
  }
}
