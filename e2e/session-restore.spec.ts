import { expect, test } from '@playwright/test';
import {
  FIXTURE_ROOT_NAME,
  loadFixture,
  openGearMenu,
  openInAst,
  resetApp,
  selectMetric,
  selectViz,
  setPathFilter,
} from './fixtures';

test.describe('Session survives a reload', () => {
  test('a reload comes back to the analysed project, not the drop zone', async ({ page }) => {
    await loadFixture(page);
    const tiles = await page.locator('loco-treemap svg rect').count();

    await page.reload();

    await expect(page.locator('loco-drop-zone')).toHaveCount(0);
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();
    // The folder name now labels the pinned first tab rather than the top-right corner.
    await expect(page.locator('loco-shell .tab.overview')).toHaveText(FIXTURE_ROOT_NAME);
    // The same corpus came back, not a fresh (empty) read.
    await expect.poll(() => page.locator('loco-treemap svg rect').count()).toBe(tiles);
    // The gear menu says this is a cached copy rather than a fresh read.
    await openGearMenu(page);
    await expect(page.locator('loco-shell .menu-cache')).toContainText('cached');
  });

  test('filters, metric and the active viz come back too', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'List');
    await selectMetric(page, 'complexity');
    await setPathFilter(page, 'app/core');
    await expect(page.locator('loco-metric-list .row').first()).toBeVisible();
    const rows = await page.locator('loco-metric-list .row').count();

    // The metadata write is debounced, so give it a beat to land.
    await page.waitForTimeout(700);
    await page.reload();

    await expect(page.locator('loco-metric-list .row').first()).toBeVisible();
    await expect(page.locator('loco-file-browser input[placeholder*="path"]')).toHaveValue(
      'app/core',
    );
    await expect(page.locator('loco-file-browser .metric select')).toHaveValue('complexity');
    await expect(page.locator('loco-viz-switcher .tab.active', { hasText: 'List' })).toBeVisible();
    expect(await page.locator('loco-metric-list .row').count()).toBe(rows);
  });

  test('restored files still drive the AST view and the symbol index', async ({ page }) => {
    await loadFixture(page);
    await page.reload();
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();

    await openInAst(page, 'catalog.store');

    // Source text came out of the cache, so the editor renders — and a TS file opens on
    // the Usages tab by default, proving the symbol index rebuilt from the cached blobs.
    await expect(page.locator('loco-source-panel .row').first()).toBeVisible();
    // The Incoming direction lists the outside classes that use this store — proof the
    // repo-wide index came back, not just this file's own text.
    const incoming = page.locator('loco-usages-panel .grp-head');
    await expect(incoming.first()).toBeVisible();
    await expect(incoming.filter({ hasText: 'CartComponent' }).first()).toContainText(/\d+×/);
  });

  test('change folder wipes the cache so the next reload starts clean', async ({ page }) => {
    await loadFixture(page);
    await openGearMenu(page);
    await page.locator('loco-shell .menu-item', { hasText: 'Change folder' }).click();
    // Changing folders ends the session, so it asks for confirmation first.
    await expect(page.locator('loco-shell .confirm')).toBeVisible();
    await page.locator('loco-shell .confirm .btn.danger').click();
    await expect(page.locator('loco-drop-zone')).toBeVisible();

    await page.reload();
    await expect(page.locator('loco-drop-zone')).toBeVisible();
    await expect(page.locator('loco-treemap')).toHaveCount(0);
  });

  test('a first visit with no cache goes straight to the drop zone', async ({ page }) => {
    await resetApp(page);
    await expect(page.locator('loco-drop-zone')).toBeVisible();
    // No project loaded → no gear menu (and so no cache indicator) in the header.
    await expect(page.locator('loco-shell .gear')).toHaveCount(0);
  });
});
