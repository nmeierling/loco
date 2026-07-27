import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SRC_DIR } from './fixtures';

/**
 * Builds a tiny git repo in a temporary directory:
 *   commit 1: add foo.ts
 *   commit 2: extend foo.ts
 *   commit 3: add bar.ts
 *   commit 4: extend foo.ts again
 *
 * Expected churn: foo.ts = 3, bar.ts = 1.
 *
 * `extraCommits` appends further one-line commits to foo.ts — used to make the
 * history walk slow enough to observe its loading state.
 */
function buildChurnFixture(extraCommits = 0): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loco-churn-'));
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

  run('git init -q -b main');
  run('git config user.email "test@loco.dev"');
  run('git config user.name "Loco Test"');
  run('git config commit.gpgsign false');

  fs.writeFileSync(path.join(dir, 'foo.ts'), 'export const a = 1;\n');
  run('git add foo.ts');
  run('git commit -q -m "add foo"');

  fs.appendFileSync(path.join(dir, 'foo.ts'), 'export const b = 2;\n');
  run('git add foo.ts');
  run('git commit -q -m "extend foo"');

  fs.writeFileSync(path.join(dir, 'bar.ts'), 'export const c = 3;\n');
  run('git add bar.ts');
  run('git commit -q -m "add bar"');

  fs.appendFileSync(path.join(dir, 'foo.ts'), 'export const d = 4;\n');
  run('git add foo.ts');
  run('git commit -q -m "more foo"');

  for (let i = 0; i < extraCommits; i++) {
    fs.appendFileSync(path.join(dir, 'foo.ts'), `export const e${i} = ${i};\n`);
    run('git add foo.ts');
    run(`git commit -q -m "bulk ${i}"`);
  }

  return dir;
}

test.describe('Git churn — local .git directory', () => {
  test('Churn chip is visible but disabled when the dropped folder has no .git/', async ({
    page,
  }) => {
    // Load the loco src/ folder — no .git/ inside.
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('loco-drop-zone');
    await page.locator('loco-drop-zone input[type="file"]').setInputFiles(SRC_DIR);
    await page.waitForSelector('loco-treemap svg');
    await page
      .waitForSelector('loco-spinner .overlay', { state: 'hidden', timeout: 60_000 })
      .catch(() => undefined);

    const chip = page.locator('loco-filter-bar .chip', { hasText: 'Churn' });
    await expect(chip).toBeVisible();
    await expect(chip).toBeDisabled();
    const hint = await chip.getAttribute('title');
    expect(hint ?? '').toMatch(/\.git\/|Chrome|churn/i);
  });

  test('walks history, unhides Churn chip, sizes tiles by commit count', async ({ page }) => {
    const repo = buildChurnFixture();

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('loco-drop-zone');

    await page.locator('loco-drop-zone input[type="file"]').setInputFiles(repo);
    await page.waitForSelector('loco-treemap svg', { timeout: 30_000 });
    await page
      .waitForSelector('loco-spinner .overlay', { state: 'hidden', timeout: 60_000 })
      .catch(() => undefined);

    // The Churn chip should now be visible (it stays hidden when no .git/ is present).
    const churnChip = page.locator('loco-filter-bar .chip', { hasText: 'Churn' });
    await expect(churnChip).toBeVisible();
    await expect(churnChip).toBeEnabled();

    // Hover a tile and confirm Churn is shown in the tooltip once the walk lands.
    await expect
      .poll(
        async () => {
          await page.locator('loco-treemap svg rect').first().hover();
          return (await page.locator('loco-treemap .tip').textContent()) ?? '';
        },
        { timeout: 30_000 },
      )
      .toContain('Churn');

    // Switch to Churn metric — both source files should have tiles with width>0.
    await churnChip.click();
    await page.waitForTimeout(150);
    const tiles = await page.$$eval('loco-treemap svg rect', (rs) =>
      rs.map((r) => parseFloat(r.getAttribute('width') ?? '0')),
    );
    expect(tiles.filter((w) => w > 0).length).toBeGreaterThanOrEqual(2);

    // Cleanup
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('history walk runs in the background; the churn viz shows its own loading state', async ({
    page,
  }) => {
    // Enough commits that the walk is still running when the treemap first paints.
    const repo = buildChurnFixture(160);

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('loco-drop-zone');

    await page.locator('loco-drop-zone input[type="file"]').setInputFiles(repo);

    // The tree is usable before churn finishes — the modal spinner is already gone.
    await page.waitForSelector('loco-treemap svg', { timeout: 30_000 });
    await page.waitForSelector('loco-spinner .overlay', { state: 'hidden', timeout: 60_000 });

    // Churn is selectable while pending, and the viz explains itself instead of
    // rendering an empty canvas.
    const churnChip = page.locator('loco-filter-bar .chip', { hasText: 'Churn' });
    await expect(churnChip).toBeEnabled();
    await churnChip.click();
    await expect(page.locator('loco-treemap .empty-title')).toHaveText('Walking git history…');
    await expect(page.locator('footer.status')).toContainText('Walking git history');

    // When the walk lands, the same view fills in without another reload.
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('loco-treemap .empty-title')).toHaveCount(0);

    fs.rmSync(repo, { recursive: true, force: true });
  });
});
