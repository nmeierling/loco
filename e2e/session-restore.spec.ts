import { expect, test } from '@playwright/test';
import { FIXTURE_ROOT_NAME, loadFixture, openInAst, resetApp, selectViz } from './fixtures';

test.describe('Session survives a reload', () => {
  test('a reload comes back to the analysed project, not the drop zone', async ({ page }) => {
    await loadFixture(page);
    const files = await page.locator('loco-filter-bar .stats').textContent();

    await page.reload();

    await expect(page.locator('loco-drop-zone')).toHaveCount(0);
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();
    await expect(page.locator('loco-shell .root-name')).toHaveText(FIXTURE_ROOT_NAME);
    await expect(page.locator('loco-filter-bar .stats')).toHaveText(files ?? '');
    // The header says this is a cached copy rather than a fresh read.
    await expect(page.locator('loco-shell .cache')).toContainText('cached');
  });

  test('filters, metric and the active viz come back too', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'List');
    await page.locator('loco-filter-bar .chip', { hasText: 'Complexity' }).click();
    await page.locator('loco-filter-bar input.search.path').fill('app/core');
    await expect(page.locator('loco-metric-list .row').first()).toBeVisible();
    const rows = await page.locator('loco-metric-list .row').count();

    // The metadata write is debounced, so give it a beat to land.
    await page.waitForTimeout(700);
    await page.reload();

    await expect(page.locator('loco-metric-list .row').first()).toBeVisible();
    await expect(page.locator('loco-filter-bar input.search.path')).toHaveValue('app/core');
    await expect(
      page.locator('loco-filter-bar .chip.active', { hasText: 'Complexity' }),
    ).toBeVisible();
    await expect(page.locator('loco-filter-bar .chip.active', { hasText: 'List' })).toBeVisible();
    expect(await page.locator('loco-metric-list .row').count()).toBe(rows);
  });

  test('restored files still drive the AST view and the symbol index', async ({ page }) => {
    await loadFixture(page);
    await page.reload();
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();

    await openInAst(page, 'catalog.store');

    // Source text came out of the cache, so the tree and the panel both render.
    await expect(page.locator('loco-ast-view loco-ast-node').first()).toBeVisible();
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();
    await expect(page.locator('loco-usages-panel .sym-head').first()).toBeVisible();
    await expect(
      page.locator('loco-usages-panel .sym-head', { hasText: 'CatalogStore' }).first(),
    ).toContainText(/\d+ in \d+ files/);
  });

  test('change folder wipes the cache so the next reload starts clean', async ({ page }) => {
    await loadFixture(page);
    await page.locator('loco-shell .ghost', { hasText: 'change folder' }).click();
    await expect(page.locator('loco-drop-zone')).toBeVisible();

    await page.reload();
    await expect(page.locator('loco-drop-zone')).toBeVisible();
    await expect(page.locator('loco-treemap')).toHaveCount(0);
  });

  test('a first visit with no cache goes straight to the drop zone', async ({ page }) => {
    await resetApp(page);
    await expect(page.locator('loco-drop-zone')).toBeVisible();
    await expect(page.locator('loco-shell .cache')).toHaveCount(0);
  });
});
