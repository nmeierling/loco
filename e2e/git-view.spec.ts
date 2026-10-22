import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FIXTURE_DIR, resetApp, selectViz } from './fixtures';

/**
 * A repo with the shapes the Git view has to draw: a second branch, an annotated tag,
 * a remote, and a real merge commit (so the lane graph has to fan out and rejoin).
 *
 *   main:  init → a → b ──────── merge ← HEAD
 *   side:            └→ side1 ──┘
 */
function buildRepoFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loco-gitview-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Loco Test',
    GIT_AUTHOR_EMAIL: 'test@loco.dev',
    GIT_COMMITTER_NAME: 'Loco Test',
    GIT_COMMITTER_EMAIL: 'test@loco.dev',
    GIT_AUTHOR_DATE: '2026-01-01T12:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T12:00:00Z',
  };
  const run = (cmd: string) => execSync(cmd, { cwd: dir, env, stdio: 'pipe' });
  const write = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);

  run('git init -q -b main');
  run('git config user.email "test@loco.dev"');
  run('git config user.name "Loco Test"');
  run('git config commit.gpgsign false');
  run('git remote add origin https://example.invalid/loco.git');

  write('foo.ts', 'export const a = 1;\n');
  run('git add -A');
  run('git commit -q -m "add foo"');

  write('bar.ts', 'export const b = 2;\n');
  run('git add -A');
  run('git commit -q -m "add bar"');
  run('git tag -a v1.0.0 -m "first release"');

  // A side branch that touches a file of its own, so the merge is always clean.
  run('git checkout -q -b side');
  write('side.ts', 'export const c = 3;\n');
  run('git add -A');
  run('git commit -q -m "add side"');

  run('git checkout -q main');
  write('foo.ts', 'export const a = 11;\n');
  run('git add -A');
  run('git commit -q -m "touch foo on main"');
  run('git merge -q --no-ff -m "Merge branch \'side\'" side');

  return dir;
}

async function openGitView(page: import('@playwright/test').Page, dir: string): Promise<void> {
  await resetApp(page);
  await page.locator('loco-drop-zone input[type="file"]').setInputFiles(dir);
  await page.waitForSelector('loco-treemap svg');
  await page.waitForSelector('loco-spinner .overlay', { state: 'hidden' }).catch(() => undefined);
  await selectViz(page, 'Git');
  await page.waitForSelector('loco-git-view');
}

test.describe('Git view', () => {
  test('draws the history as a lane graph with refs, and summarises the repo', async ({ page }) => {
    const repo = buildRepoFixture();
    try {
      await openGitView(page, repo);

      const view = page.locator('loco-git-view');
      await expect(view.locator('.row').first()).toBeVisible();

      // 5 commits: init, bar, side, touch-foo, merge.
      await expect(view.locator('.row')).toHaveCount(5);
      // One dot per commit, and at least one lane segment per gap between them.
      await expect(view.locator('svg.lanes circle')).toHaveCount(5);
      expect(await view.locator('svg.lanes path').count()).toBeGreaterThanOrEqual(4);

      // The merge is HEAD of main; the side branch and the tag get their own badges.
      await expect(view.locator('.branch')).toHaveText('main');
      await expect(view.locator('.row .ref', { hasText: 'main' }).first()).toBeVisible();
      await expect(view.locator('.row .ref', { hasText: 'side' }).first()).toBeVisible();
      await expect(view.locator('.row .ref', { hasText: 'v1.0.0' }).first()).toBeVisible();

      // A merge puts two commits in different lanes, so the graph is at least 2 wide.
      const lanes = await view
        .locator('svg.lanes')
        .evaluate((el) => Number(el.getAttribute('width')));
      expect(lanes).toBeGreaterThan(22);

      // Side panel: repo facts and the .git size breakdown.
      const side = view.locator('.side');
      await expect(side).toContainText('Repository');
      await expect(side).toContainText('5 commits');
      await expect(side).toContainText('Local branches');
      await expect(side).toContainText('Tags');
      await expect(side.locator('.legend li', { hasText: 'Loose objects' })).toBeVisible();
      await expect(side).toContainText('example.invalid');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('selecting a commit lists the files it changed, and they open in a tab', async ({
    page,
  }) => {
    const repo = buildRepoFixture();
    try {
      await openGitView(page, repo);
      const view = page.locator('loco-git-view');

      // "touch foo on main" changed exactly one file.
      await view.locator('.row', { hasText: 'touch foo on main' }).click();
      const side = view.locator('.side');
      await expect(side.locator('.changes li')).toHaveCount(1);
      await expect(side.locator('.changes li')).toContainText('foo.ts');
      await expect(side.locator('.changes .status')).toHaveText('M');

      // The root commit adds its file rather than modifying it.
      await view.locator('.row', { hasText: 'add foo' }).click();
      await expect(side).toContainText('root commit');
      await expect(side.locator('.changes .status')).toHaveText('A');

      // A changed file that is part of the analysis opens as an AST tab.
      await side.locator('.changes .link', { hasText: 'foo.ts' }).click();
      await expect(page.locator('loco-ast-view')).toBeVisible();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('counts a commit once even when a merge makes it reachable twice', async ({ page }) => {
    // In this fixture `bar.ts` is touched by exactly one commit, which sits before the
    // branch point — so both of the merge's parents reach it. `isomorphic-git`'s `log`
    // yields such a commit once per path, which used to count the file twice.
    const repo = buildRepoFixture();
    try {
      await resetApp(page);
      await page.locator('loco-drop-zone input[type="file"]').setInputFiles(repo);
      await page.waitForSelector('loco-treemap svg');
      await page
        .waitForSelector('loco-spinner .overlay', { state: 'hidden' })
        .catch(() => undefined);

      /** Hovers every tile and reads path → churn out of the tooltip. */
      const readChurn = async (): Promise<Record<string, number>> => {
        const found: Record<string, number> = {};
        const rects = page.locator('loco-treemap svg rect');
        for (let i = 0; i < (await rects.count()); i++) {
          await rects.nth(i).hover();
          const text = (await page.locator('loco-treemap .tip').textContent()) ?? '';
          const m = /^(.*?)LOC.*?Churn\s*(\d+)/s.exec(text);
          if (m) found[m[1]!.trim()] = Number(m[2]);
        }
        return found;
      };

      // The walk lands in the background, so wait for the numbers to show up at all.
      await expect
        .poll(async () => Object.keys(await readChurn()).length, {
          timeout: 20_000,
        })
        .toBeGreaterThanOrEqual(3);

      // One commit touched bar.ts; two touched foo.ts; one touched side.ts.
      const churn = await readChurn();
      expect(churn['bar.ts']).toBe(1);
      expect(churn['foo.ts']).toBe(2);
      expect(churn['side.ts']).toBe(1);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('explains itself when the dropped folder has no .git/', async ({ page }) => {
    // The checked-in fixture has no .git/ inside.
    await resetApp(page);
    await page.locator('loco-drop-zone input[type="file"]').setInputFiles(FIXTURE_DIR);
    await page.waitForSelector('loco-treemap svg');
    await page.waitForSelector('loco-spinner .overlay', { state: 'hidden' }).catch(() => undefined);
    await selectViz(page, 'Git');

    const view = page.locator('loco-git-view');
    await expect(view).toContainText('No git history in this folder');
    await expect(view.locator('.row')).toHaveCount(0);
  });

  test('does not block the main thread while the history is read', async ({ page }) => {
    const repo = buildRepoFixture();
    try {
      await resetApp(page);
      await page.evaluate(() => {
        (window as unknown as { __blocking: number }).__blocking = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            (window as unknown as { __blocking: number }).__blocking += Math.max(
              0,
              e.duration - 50,
            );
          }
        }).observe({ entryTypes: ['longtask'] });
      });

      await page.locator('loco-drop-zone input[type="file"]').setInputFiles(repo);
      await page.waitForSelector('loco-treemap svg');
      await selectViz(page, 'Git');
      await page.waitForSelector('loco-git-view .row');

      // The git work happens in a worker, so the main thread stays essentially free.
      // This is a smoke test for "it is off the main thread", not a tight budget.
      const blocking = await page.evaluate(
        () => (window as unknown as { __blocking: number }).__blocking,
      );
      expect(blocking).toBeLessThan(2000);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
