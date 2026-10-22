/**
 * Turns a flat list of symbol names into recommended "domains". The core idea: a codebase
 * that names things `UserCard`, `UserService`, `ProfileForm` has an implicit *User* domain
 * — the shared significant term is the signal, the role suffix (`Card`, `Service`) is
 * noise. This is deliberately a naming heuristic, not a dependency analysis: it reads the
 * style guide the team already follows in its names.
 *
 * Three grouping strategies are offered (see {@link GroupStrategy}):
 *   - `term`     one dominant shared term per domain (`User`, `Order`).
 *   - `compound` a domain plus a strong secondary term (`User · Profile`), so a big domain
 *                splits into finer, multi-term groups where the names justify it.
 *   - `folder`   group by source directory — often the truest domain boundary.
 *
 * Everything here is pure and deterministic (no clock, no randomness) so the board's
 * first-open suggestion is stable and the logic is unit-testable in isolation.
 */

export type GroupStrategy = 'term' | 'compound' | 'folder';

/** One name to be placed on the board — a de-duplicated symbol declaration. */
export interface NameInput {
  /** Stable identity, the {@link SymbolDef.id} (`path#Name`). */
  id: string;
  name: string;
  path: string;
  kind: string;
  exported: boolean;
}

export interface DomainCluster {
  /** The shared term(s) the cluster formed around (lowercase, e.g. `user` or `user profile`). */
  term: string;
  /** Display title — the term(s), capitalized (`User`, `User · Profile`). */
  title: string;
  members: NameInput[];
}

export interface ClusterResult {
  clusters: DomainCluster[];
  /** Names that share no term strong enough to seed a domain. */
  unassigned: NameInput[];
}

export interface ClusterOptions {
  /** A term must appear in at least this many names to be a domain candidate. */
  minSupport?: number;
  /** Clusters smaller than this are dissolved back into `unassigned`. */
  minClusterSize?: number;
  /** Cap on the number of domains; the largest win, the rest spill to `unassigned`. */
  maxDomains?: number;
}

const DEFAULTS: Required<ClusterOptions> = {
  minSupport: 2,
  minClusterSize: 2,
  maxDomains: 16,
};

/**
 * Architectural-role and glue terms. These describe *what a thing is* (a service, a
 * component) or are too generic to name a domain — never *which part of the business it
 * belongs to* — so they are stripped before clustering. Kept lowercase.
 */
const STOP_TERMS = new Set<string>([
  // structural / role suffixes
  'component',
  'service',
  'controller',
  'repository',
  'repo',
  'module',
  'model',
  'models',
  'dto',
  'entity',
  'entities',
  'factory',
  'provider',
  'manager',
  'handler',
  'helper',
  'helpers',
  'util',
  'utils',
  'utility',
  'impl',
  'base',
  'abstract',
  'interface',
  'type',
  'types',
  'enum',
  'config',
  'configuration',
  'constant',
  'constants',
  'const',
  'test',
  'tests',
  'spec',
  'mock',
  'mocks',
  'stub',
  'fixture',
  'view',
  'page',
  'pages',
  'screen',
  'container',
  'wrapper',
  'hook',
  'hooks',
  'context',
  'store',
  'state',
  'reducer',
  'action',
  'actions',
  'selector',
  'api',
  'client',
  'server',
  'request',
  'response',
  'error',
  'errors',
  'exception',
  'event',
  'events',
  'listener',
  'mapper',
  'adapter',
  'builder',
  'validator',
  'guard',
  'pipe',
  'directive',
  'resolver',
  'middleware',
  'decorator',
  'annotation',
  'bean',
  'dao',
  'facade',
  'gateway',
  'proxy',
  'registry',
  'router',
  'route',
  'routes',
  'schema',
  'schemas',
  // generic verbs / glue words
  'get',
  'set',
  'is',
  'has',
  'create',
  'update',
  'delete',
  'remove',
  'add',
  'fetch',
  'load',
  'save',
  'find',
  'list',
  'new',
  'the',
  'and',
  'for',
  'from',
  'with',
  'data',
  'item',
  'items',
  'info',
  'main',
  'app',
  'index',
  'default',
  'common',
  'shared',
  'core',
  'global',
  'static',
  'value',
  'values',
  'name',
  'names',
  'id',
  'ids',
  'key',
  'keys',
  'result',
  'results',
  'options',
  'option',
  'props',
  'params',
  'args',
  'callback',
  'fn',
  'func',
  'function',
  'method',
  'class',
  'obj',
  'object',
]);

/**
 * Splits an identifier into lowercase word tokens, handling camelCase, PascalCase,
 * acronym runs (`HTTPServer` → `http`, `server`), and snake / kebab / dot separators.
 */
export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/** The domain-bearing tokens of a name: unique, ≥3 chars, not a role/glue term or a pure number. */
export function domainTerms(name: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(name)) {
    if (t.length < 3) continue;
    if (/^\d+$/.test(t)) continue;
    if (STOP_TERMS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function capitalize(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function parentFolder(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

/** Entry point: group names by the chosen strategy. */
export function groupNames(
  names: readonly NameInput[],
  strategy: GroupStrategy,
  options?: ClusterOptions,
): ClusterResult {
  const opts = { ...DEFAULTS, ...options };
  if (strategy === 'folder') return groupByFolder(names, opts);
  if (strategy === 'compound') return groupByCompound(names, opts);
  return clusterNames(names, opts);
}

interface PrimaryAssignment {
  buckets: Map<string, NameInput[]>;
  unassigned: NameInput[];
  support: Map<string, number>;
  termsByName: Map<string, string[]>;
}

/**
 * Assigns each name to the strongest term it shares. Each name joins the domain of its
 * highest-support candidate term; ties break toward the leftmost term in the name, since
 * the leading word (`User` in `UserProfileCard`) is usually the subject.
 */
function assignPrimary(names: readonly NameInput[], opts: Required<ClusterOptions>): PrimaryAssignment {
  const termsByName = new Map<string, string[]>();
  const support = new Map<string, number>();
  for (const n of names) {
    const terms = domainTerms(n.name);
    termsByName.set(n.id, terms);
    for (const t of terms) support.set(t, (support.get(t) ?? 0) + 1);
  }
  const isCandidate = (term: string): boolean => (support.get(term) ?? 0) >= opts.minSupport;

  const buckets = new Map<string, NameInput[]>();
  const unassigned: NameInput[] = [];
  for (const n of names) {
    const terms = termsByName.get(n.id) ?? [];
    let best: string | null = null;
    let bestSupport = -1;
    for (const t of terms) {
      if (!isCandidate(t)) continue;
      const s = support.get(t) ?? 0;
      if (s > bestSupport) {
        best = t;
        bestSupport = s;
      }
    }
    if (best === null) {
      unassigned.push(n);
      continue;
    }
    const list = buckets.get(best) ?? [];
    list.push(n);
    buckets.set(best, list);
  }
  return { buckets, unassigned, support, termsByName };
}

/**
 * Ranks domains by size, applies the size floor and the domain cap, and returns the
 * survivors plus everything that fell through (in the caller's input order).
 */
function finalize(
  clusters: DomainCluster[],
  unassigned: NameInput[],
  names: readonly NameInput[],
  opts: Required<ClusterOptions>,
): ClusterResult {
  const spilled = [...unassigned];
  const ranked = [...clusters].sort(
    (a, b) => b.members.length - a.members.length || a.term.localeCompare(b.term),
  );
  const kept: DomainCluster[] = [];
  for (const c of ranked) {
    if (c.members.length < opts.minClusterSize || kept.length >= opts.maxDomains) {
      spilled.push(...c.members);
      continue;
    }
    kept.push(c);
  }
  const order = new Map<string, number>();
  names.forEach((n, i) => order.set(n.id, i));
  spilled.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { clusters: kept, unassigned: spilled };
}

/** Single-term domains — the default strategy. */
export function clusterNames(names: readonly NameInput[], options?: ClusterOptions): ClusterResult {
  const opts = { ...DEFAULTS, ...options };
  const { buckets, unassigned } = assignPrimary(names, opts);
  const clusters: DomainCluster[] = [...buckets.entries()].map(([term, members]) => ({
    term,
    title: capitalize(term),
    members,
  }));
  return finalize(clusters, unassigned, names, opts);
}

/**
 * Two-level domains: first the dominant term, then a strong secondary term *within* that
 * domain. A `User` domain with many `UserProfile*` names yields a `User · Profile`
 * sub-domain, while the rest stay under `User`. Secondary groups too small to stand on
 * their own fold back into the primary domain rather than fragmenting the board.
 */
function groupByCompound(names: readonly NameInput[], opts: Required<ClusterOptions>): ClusterResult {
  const { buckets, unassigned, termsByName } = assignPrimary(names, opts);
  const clusters: DomainCluster[] = [];

  for (const [term, members] of buckets) {
    // How common each secondary term is *inside this domain*.
    const secCount = new Map<string, number>();
    for (const m of members) {
      for (const t of termsByName.get(m.id) ?? []) {
        if (t !== term) secCount.set(t, (secCount.get(t) ?? 0) + 1);
      }
    }
    // Assign each member to its strongest qualifying secondary term (or none).
    const groups = new Map<string, NameInput[]>();
    for (const m of members) {
      let best: string | null = null;
      let bestCount = -1;
      for (const t of termsByName.get(m.id) ?? []) {
        if (t === term) continue;
        const c = secCount.get(t) ?? 0;
        if (c >= opts.minClusterSize && c > bestCount) {
          best = t;
          bestCount = c;
        }
      }
      const key = best ?? '';
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    }
    // Dissolve tiny secondary groups back into the primary-only bucket.
    const primaryOnly = groups.get('') ?? [];
    for (const [k, ms] of [...groups]) {
      if (k !== '' && ms.length < opts.minClusterSize) {
        primaryOnly.push(...ms);
        groups.delete(k);
      }
    }
    if (primaryOnly.length) groups.set('', primaryOnly);

    for (const [k, ms] of groups) {
      clusters.push({
        term: k ? `${term} ${k}` : term,
        title: k ? `${capitalize(term)} · ${capitalize(k)}` : capitalize(term),
        members: ms,
      });
    }
  }
  return finalize(clusters, unassigned, names, opts);
}

/** Group by the directory each name is declared in. */
function groupByFolder(names: readonly NameInput[], opts: Required<ClusterOptions>): ClusterResult {
  const buckets = new Map<string, NameInput[]>();
  for (const n of names) {
    const folder = parentFolder(n.path);
    const list = buckets.get(folder) ?? [];
    list.push(n);
    buckets.set(folder, list);
  }
  const clusters: DomainCluster[] = [...buckets.entries()].map(([folder, members]) => ({
    term: folder,
    title: folder ? (folder.split('/').pop() ?? folder) : '(root)',
    members,
  }));
  // A single-file folder is still a real boundary, so don't apply the size floor here.
  return finalize(clusters, [], names, { ...opts, minClusterSize: 1 });
}
