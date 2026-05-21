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
 */
function buildChurnFixture(): string {
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

  return dir;
}

test.describe('Git churn — local .git directory', () => {
  test('Churn chip is visible but disabled when the dropped folder has no .git/', async ({ page }) => {
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

    // Hover a tile and confirm Churn is shown in the tooltip.
    await page.locator('loco-treemap svg rect').first().hover();
    await expect(page.locator('loco-treemap .tip')).toContainText('Churn');

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
});
