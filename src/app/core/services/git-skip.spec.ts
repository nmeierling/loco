import { describe, expect, it } from 'vitest';
import { skipInGitDir } from './directory-loader.service';

describe('skipInGitDir', () => {
  it('keeps everything outside .git/', () => {
    for (const p of ['src/index.ts', '.gitignore', '.github/workflows/ci.yml', 'logs/app.log']) {
      expect(skipInGitDir(p), p).toBe(false);
    }
  });

  it('keeps what isomorphic-git actually reads', () => {
    for (const p of [
      '.git/HEAD',
      '.git/config',
      '.git/packed-refs',
      '.git/shallow',
      '.git/refs/heads/main',
      '.git/refs/tags/v1.0.0',
      '.git/objects/pack/pack-abc.pack',
      '.git/objects/pack/pack-abc.idx',
      '.git/objects/ab/cdef0123456789',
      '.git/info/exclude',
    ]) {
      expect(skipInGitDir(p), p).toBe(false);
    }
  });

  it('skips a directory we never read, and everything beneath it', () => {
    expect(skipInGitDir('.git/logs')).toBe(true);
    expect(skipInGitDir('.git/logs/HEAD')).toBe(true);
    expect(skipInGitDir('.git/logs/refs/heads/main')).toBe(true);
    expect(skipInGitDir('.git/hooks/pre-commit.sample')).toBe(true);
    expect(skipInGitDir('.git/modules/sub/HEAD')).toBe(true);
    expect(skipInGitDir('.git/lfs/objects/aa/bb/cc')).toBe(true);
    expect(skipInGitDir('.git/worktrees/wt/HEAD')).toBe(true);
    expect(skipInGitDir('.git/rebase-merge/head-name')).toBe(true);
  });

  it('skips local-state files at the top of .git/', () => {
    for (const p of ['.git/index', '.git/COMMIT_EDITMSG', '.git/FETCH_HEAD', '.git/ORIG_HEAD']) {
      expect(skipInGitDir(p), p).toBe(true);
    }
  });

  it('skips lock files anywhere in .git/', () => {
    expect(skipInGitDir('.git/index.lock')).toBe(true);
    expect(skipInGitDir('.git/refs/heads/main.lock')).toBe(true);
  });

  it('does not confuse a nested path named like a top-level state file', () => {
    // `refs/heads/index` is a branch called "index" — it must survive.
    expect(skipInGitDir('.git/refs/heads/index')).toBe(false);
  });
});
