/// <reference lib="webworker" />
/**
 * All `isomorphic-git` work happens in here.
 *
 * Two reasons it is a worker rather than a service:
 *
 * 1. **It blocks.** Walking a history is a long chain of inflate + SHA-1 over
 *    megabytes of packfile. On the main thread that is a multi-second freeze with no
 *    frame in between, which is what pushed Interaction-to-Next-Paint into the tens of
 *    seconds on Chrome. `File` objects are structured-cloneable *by reference*, so
 *    handing the `.git/` map to a worker costs nothing — the bytes are never copied.
 * 2. **The cache has to be shared.** Every top-level isomorphic-git call defaults
 *    `cache` to a fresh `{}`, and the parsed pack index plus the packfile bytes live in
 *    that cache. Calling `walk()` once per commit without passing one re-read and
 *    re-SHA-1-verified the entire packfile for every single commit. Owning one cache
 *    for the worker's lifetime is what makes the walk linear instead of quadratic.
 */
import { makeGitFs, type GitFs } from '../services/git-fs';

export interface GitRefBadge {
  name: string;
  kind: 'head' | 'branch' | 'remote' | 'tag';
}

export interface GitCommitWire {
  oid: string;
  parents: readonly string[];
  subject: string;
  body: string;
  author: string;
  email: string;
  /** Epoch seconds. */
  timestamp: number;
  refs: readonly GitRefBadge[];
}

export interface GitSizeBreakdown {
  /** Every byte under `.git/` that reached us. */
  total: number;
  packs: number;
  packCount: number;
  packIndexes: number;
  looseObjects: number;
  looseCount: number;
  refs: number;
  other: number;
  fileCount: number;
}

export interface GitAuthorStat {
  name: string;
  email: string;
  commits: number;
}

export interface GitOverviewWire {
  head: { ref: string | null; oid: string | null; detached: boolean };
  branches: readonly string[];
  remoteBranches: readonly string[];
  tags: readonly string[];
  remotes: readonly { name: string; url: string }[];
  /** Commits reachable from HEAD, counted up to `countCap`. */
  commitCount: number;
  commitCountCapped: boolean;
  commits: readonly GitCommitWire[];
  size: GitSizeBreakdown;
  authors: readonly GitAuthorStat[];
  /** Commits per ISO week over the counted window, oldest first. */
  activity: readonly { weekStart: number; commits: number }[];
  firstCommit: number | null;
  lastCommit: number | null;
}

export interface GitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface GitCommitDetailWire {
  oid: string;
  changes: readonly GitFileChange[];
  /** True when the diff was skipped because the commit is a merge with >1 parent. */
  merge: boolean;
}

export interface GitChurnWire {
  countByPath: ReadonlyMap<string, number>;
  lastTouchedByPath: ReadonlyMap<string, number>;
  commitsScanned: number;
}

export type GitRequest =
  | { type: 'attach'; id: number; files: ReadonlyMap<string, File> }
  | { type: 'overview'; id: number; limit: number; countCap: number }
  | { type: 'churn'; id: number; maxCommits: number }
  | { type: 'commit-detail'; id: number; oid: string };

export type GitResponse =
  | { type: 'attached'; id: number }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id: number; message: string };

type Git = typeof import('isomorphic-git');

/** One cache for the worker's lifetime — see the file header. */
const cache: Record<string, unknown> = {};
let fs: GitFs | null = null;
let gitFiles: ReadonlyMap<string, File> = new Map();
let gitModule: Git | null = null;

const DIR = '/';
const GITDIR = '/.git';

async function loadGit(): Promise<Git> {
  if (gitModule) return gitModule;
  // isomorphic-git is Node-style code that expects a global `Buffer`.
  if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
    const buffer = await import('buffer');
    (globalThis as { Buffer?: unknown }).Buffer = buffer.Buffer;
  }
  gitModule = await import('isomorphic-git');
  return gitModule;
}

function requireFs(): GitFs {
  if (!fs) throw new Error('git worker: no repository attached');
  return fs;
}

/** `.git` byte accounting, straight off the dropped file sizes — no git calls needed. */
function measure(files: ReadonlyMap<string, File>): GitSizeBreakdown {
  const out: GitSizeBreakdown = {
    total: 0,
    packs: 0,
    packCount: 0,
    packIndexes: 0,
    looseObjects: 0,
    looseCount: 0,
    refs: 0,
    other: 0,
    fileCount: 0,
  };
  for (const [path, file] of files) {
    const size = file.size;
    out.total += size;
    out.fileCount++;
    if (path.endsWith('.pack')) {
      out.packs += size;
      out.packCount++;
    } else if (path.endsWith('.idx')) {
      out.packIndexes += size;
    } else if (/^\.git\/objects\/[0-9a-f]{2}\//.test(path)) {
      out.looseObjects += size;
      out.looseCount++;
    } else if (path.startsWith('.git/refs/') || path === '.git/packed-refs') {
      out.refs += size;
    } else {
      out.other += size;
    }
  }
  return out;
}

interface WalkedCommit {
  oid: string;
  parents: readonly string[];
  /** Committer time — what the ordering uses, matching `git log`. */
  committed: number;
  authored: number;
  author: string;
  email: string;
  message: string;
}

/**
 * Reverse-chronological history walk from `start`, each commit visited exactly once.
 *
 * `git.log()` cannot be used for this: it yields a commit once per path that reaches
 * it, so on any merge it returns duplicates — a five-commit history with one merge
 * comes back as seven entries. For the graph that means repeated rows; for churn it
 * silently multiplied every file's commit count by the number of merge paths that
 * reached the commit, which is why busy repos read as churnier than they are.
 *
 * The walk is the same frontier-by-newest-first one git uses, so a commit is emitted
 * before its parents and the order matches `git log`.
 */
async function walkHistory(git: Git, start: string, cap: number): Promise<WalkedCommit[]> {
  const fsp = requireFs();
  const seen = new Set<string>();
  /** Pending commits, newest first. Frontiers stay small, so a sorted array wins. */
  const frontier: WalkedCommit[] = [];

  const push = async (oid: string): Promise<void> => {
    if (seen.has(oid)) return;
    seen.add(oid);
    let entry: WalkedCommit;
    try {
      const { commit } = await git.readCommit({ fs: fsp, gitdir: GITDIR, oid, cache });
      entry = {
        oid,
        parents: commit.parent ?? [],
        committed: commit.committer?.timestamp ?? commit.author.timestamp,
        authored: commit.author.timestamp,
        author: commit.author.name,
        email: commit.author.email,
        message: commit.message ?? '',
      };
    } catch {
      // A shallow clone's boundary parents are genuinely absent; stop at them.
      return;
    }
    let lo = 0;
    let hi = frontier.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frontier[mid]!.committed >= entry.committed) lo = mid + 1;
      else hi = mid;
    }
    frontier.splice(lo, 0, entry);
  };

  await push(start);

  const out: WalkedCommit[] = [];
  while (frontier.length > 0 && out.length < cap) {
    const next = frontier.shift()!;
    out.push(next);
    for (const parent of next.parents) await push(parent);
  }
  return out;
}

/** Annotated tags point at a tag object; peel it so the badge lands on the commit. */
async function peel(git: Git, oid: string): Promise<string> {
  let current = oid;
  for (let hops = 0; hops < 10; hops++) {
    const { type, object } = await git.readObject({
      fs: requireFs(),
      gitdir: GITDIR,
      oid: current,
      cache,
    });
    if (type !== 'tag') return current;
    // `readObject` hands back the parsed tag for format 'parsed'; be defensive about both.
    const target = (object as { object?: string })?.object;
    if (!target) return current;
    current = target;
  }
  return current;
}

async function buildOverview(limit: number, countCap: number): Promise<GitOverviewWire> {
  const git = await loadGit();
  const fsp = requireFs();
  const branches = await git.listBranches({ fs: fsp, gitdir: GITDIR }).catch(() => []);
  const tags = await git.listTags({ fs: fsp, gitdir: GITDIR }).catch(() => []);
  const remotes = await git.listRemotes({ fs: fsp, gitdir: GITDIR }).catch(() => []);

  const remoteBranches: string[] = [];
  for (const remote of remotes) {
    const list = await git
      .listBranches({ fs: fsp, gitdir: GITDIR, remote: remote.remote })
      .catch(() => []);
    for (const b of list) remoteBranches.push(`${remote.remote}/${b}`);
  }

  const headRef = await git
    .currentBranch({ fs: fsp, dir: DIR, gitdir: GITDIR, fullname: false })
    .catch(() => undefined);
  const headOid = await git.resolveRef({ fs: fsp, gitdir: GITDIR, ref: 'HEAD' }).catch(() => null);

  // oid → badges, so the graph can label the commits that a ref points at.
  const badges = new Map<string, GitRefBadge[]>();
  const addBadge = (oid: string | null, badge: GitRefBadge): void => {
    if (!oid) return;
    const list = badges.get(oid);
    if (list) list.push(badge);
    else badges.set(oid, [badge]);
  };
  for (const name of branches) {
    const oid = await git
      .resolveRef({ fs: fsp, gitdir: GITDIR, ref: `refs/heads/${name}` })
      .catch(() => null);
    addBadge(oid, { name, kind: name === headRef ? 'head' : 'branch' });
  }
  for (const name of remoteBranches) {
    const oid = await git
      .resolveRef({ fs: fsp, gitdir: GITDIR, ref: `refs/remotes/${name}` })
      .catch(() => null);
    addBadge(oid, { name, kind: 'remote' });
  }
  for (const name of tags) {
    const raw = await git
      .resolveRef({ fs: fsp, gitdir: GITDIR, ref: `refs/tags/${name}` })
      .catch(() => null);
    addBadge(raw ? await peel(git, raw).catch(() => raw) : null, { name, kind: 'tag' });
  }

  // One walk serves both the graph rows and the commit count. Commit objects are
  // small and the cache is warm, but an unbounded walk on a 500k-commit history is
  // still minutes of work, so the count is explicitly capped and labelled as such.
  const log = headOid ? await walkHistory(git, headOid, countCap).catch(() => []) : [];

  const commits: GitCommitWire[] = [];
  const authorByKey = new Map<string, GitAuthorStat>();
  const weeks = new Map<number, number>();
  let first: number | null = null;
  let last: number | null = null;

  for (let i = 0; i < log.length; i++) {
    const entry = log[i]!;
    const ts = entry.authored;
    if (last === null || ts > last) last = ts;
    if (first === null || ts < first) first = ts;

    // NUL-separated, since a display name can perfectly well contain a space.
    const key = `${entry.author}\0${entry.email}`;
    const stat = authorByKey.get(key);
    if (stat) stat.commits++;
    else authorByKey.set(key, { name: entry.author, email: entry.email, commits: 1 });

    // Bucket to the start of the UTC week (Monday) for the activity strip.
    const day = Math.floor(ts / 86400);
    const weekStart = (day - ((day + 3) % 7)) * 86400;
    weeks.set(weekStart, (weeks.get(weekStart) ?? 0) + 1);

    if (i < limit) {
      const nl = entry.message.indexOf('\n');
      commits.push({
        oid: entry.oid,
        parents: entry.parents,
        subject: (nl === -1 ? entry.message : entry.message.slice(0, nl)).trim(),
        body: (nl === -1 ? '' : entry.message.slice(nl + 1)).trim(),
        author: entry.author,
        email: entry.email,
        timestamp: ts,
        refs: badges.get(entry.oid) ?? [],
      });
    }
  }

  const authors = [...authorByKey.values()].sort((a, b) => b.commits - a.commits);
  // Quiet weeks are emitted as zeroes rather than skipped — otherwise the strip
  // silently closes the gaps and a dormant year reads like a busy one.
  const activity: { weekStart: number; commits: number }[] = [];
  const weekKeys = [...weeks.keys()].sort((a, b) => a - b);
  const firstWeek = weekKeys[0];
  const lastWeek = weekKeys[weekKeys.length - 1];
  if (firstWeek !== undefined && lastWeek !== undefined) {
    const WEEK = 7 * 86400;
    for (let w = firstWeek; w <= lastWeek; w += WEEK) {
      activity.push({ weekStart: w, commits: weeks.get(w) ?? 0 });
    }
  }

  return {
    head: {
      ref: headRef ?? null,
      oid: headOid,
      detached: !headRef && headOid !== null,
    },
    branches,
    remoteBranches,
    tags,
    remotes: remotes.map((r) => ({ name: r.remote, url: r.url })),
    commitCount: log.length,
    commitCountCapped: log.length >= countCap,
    commits,
    size: measure(gitFiles),
    authors,
    activity,
    firstCommit: first,
    lastCommit: last,
  };
}

/** Changed paths for one commit, diffed against its first parent. */
async function commitDetail(oid: string): Promise<GitCommitDetailWire> {
  const git = await loadGit();
  const fsp = requireFs();
  const base = { fs: fsp, dir: DIR, gitdir: GITDIR, cache } as const;

  const { commit } = await git.readCommit({ fs: fsp, gitdir: GITDIR, oid, cache });
  const parents = commit.parent ?? [];
  const changes: GitFileChange[] = [];

  if (parents.length === 0) {
    await git.walk({
      ...base,
      trees: [git.TREE({ ref: oid })],
      map: async (filepath, entries) => {
        if (filepath === '.') return undefined;
        const a = entries?.[0];
        if (!a || (await a.type()) !== 'blob') return undefined;
        changes.push({ path: filepath, status: 'added' });
        return undefined;
      },
    });
  } else {
    await git.walk({
      ...base,
      trees: [git.TREE({ ref: parents[0]! }), git.TREE({ ref: oid })],
      map: async (filepath, entries) => {
        if (filepath === '.') return undefined;
        const a = entries?.[0] ?? null;
        const b = entries?.[1] ?? null;
        const aBlob = a && (await a.type()) === 'blob' ? a : null;
        const bBlob = b && (await b.type()) === 'blob' ? b : null;
        if (!aBlob && !bBlob) return undefined;
        if (!aBlob) changes.push({ path: filepath, status: 'added' });
        else if (!bBlob) changes.push({ path: filepath, status: 'deleted' });
        else if ((await aBlob.oid()) !== (await bBlob.oid())) {
          changes.push({ path: filepath, status: 'modified' });
        }
        return undefined;
      },
    });
  }

  changes.sort((x, y) => x.path.localeCompare(y.path));
  return { oid, changes, merge: parents.length > 1 };
}

async function churn(
  maxCommits: number,
  onProgress: (done: number, total: number) => void,
): Promise<GitChurnWire> {
  const git = await loadGit();
  const fsp = requireFs();
  const base = { fs: fsp, dir: DIR, gitdir: GITDIR, cache } as const;

  const head = await git.resolveRef({ fs: fsp, gitdir: GITDIR, ref: 'HEAD' });
  // Deduplicated walk — see walkHistory. With `git.log` a commit reachable through
  // two merge paths was diffed twice, inflating every file it touched.
  const log = await walkHistory(git, head, maxCommits);
  const total = log.length;

  const count = new Map<string, number>();
  const lastTouched = new Map<string, number>();
  const bump = (path: string, timestamp: number): void => {
    count.set(path, (count.get(path) ?? 0) + 1);
    const prev = lastTouched.get(path) ?? 0;
    if (timestamp > prev) lastTouched.set(path, timestamp);
  };

  for (let i = 0; i < total; i++) {
    const entry = log[i]!;
    const oid = entry.oid;
    const parents = entry.parents;
    const ts = entry.authored;

    // Every parent is walked, not just the first.
    //
    // A merge's tree differs from its first parent by everything the other branch
    // contributed, so diffing against only that parent counted each merged-in change a
    // second time — `git log -- <path>` reports one commit for such a file, we reported
    // two. A path counts as touched by this commit only if it differs from *all* of its
    // parents, which is the same rule git's history simplification uses.
    const trees = [...parents.map((p) => git.TREE({ ref: p })), git.TREE({ ref: oid })];
    const self = parents.length;

    await git.walk({
      ...base,
      trees,
      map: async (filepath, entries) => {
        if (filepath === '.') return undefined;
        const blobOid = async (i: number): Promise<string | null> => {
          const e = entries?.[i] ?? null;
          if (!e) return null;
          return (await e.type()) === 'blob' ? await e.oid() : null;
        };
        const mine = await blobOid(self);
        let changed = false;
        if (parents.length === 0) {
          // Root commit — every blob in its tree is "changed".
          changed = mine !== null;
        } else {
          changed = true;
          for (let p = 0; p < parents.length; p++) {
            if ((await blobOid(p)) === mine) {
              changed = false;
              break;
            }
          }
        }
        if (changed) bump(filepath, ts);
        return undefined;
      },
    });

    // Progress is for the UI thread's benefit; posting one message per commit on a
    // 2000-commit history is 2000 change-detection passes for a number nobody can
    // read that fast.
    if (i % 25 === 0 || i === total - 1) onProgress(i + 1, total);
  }

  return { countByPath: count, lastTouchedByPath: lastTouched, commitsScanned: total };
}

self.addEventListener('message', (ev: MessageEvent<GitRequest>) => {
  const req = ev.data;
  const post = (msg: GitResponse): void => self.postMessage(msg);
  const fail = (e: unknown): void =>
    post({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });

  switch (req.type) {
    case 'attach':
      gitFiles = req.files;
      fs = makeGitFs(req.files);
      post({ type: 'attached', id: req.id });
      return;
    case 'overview':
      buildOverview(req.limit, req.countCap)
        .then((result) => post({ type: 'result', id: req.id, result }))
        .catch(fail);
      return;
    case 'commit-detail':
      commitDetail(req.oid)
        .then((result) => post({ type: 'result', id: req.id, result }))
        .catch(fail);
      return;
    case 'churn':
      churn(req.maxCommits, (done, total) => post({ type: 'progress', id: req.id, done, total }))
        .then((result) => post({ type: 'result', id: req.id, result }))
        .catch(fail);
      return;
  }
});
