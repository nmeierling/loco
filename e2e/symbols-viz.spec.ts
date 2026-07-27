import { expect, test } from '@playwright/test';
import { loadFixture, selectViz } from './fixtures';

test.describe('Symbols viz', () => {
  test('lists exported names nothing in the repo references', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Symbols');

    await expect(page.locator('loco-symbols-viz .list')).toBeVisible();
    await expect(page.locator('loco-symbols-viz .count')).toContainText('unused');

    // The fixture leaves a handful of exports unreferenced on purpose.
    const rows = page.locator('loco-symbols-viz .row');
    expect(await rows.count()).toBeGreaterThan(2);
    await expect(rows.filter({ hasText: 'EMPTY_PRODUCT' })).toHaveCount(1);

    // A name that is used everywhere must not appear.
    await expect(rows.filter({ hasText: 'CatalogStore' })).toHaveCount(0);

    // The caveat is part of the feature: this is a shortlist, not a delete list.
    await expect(page.locator('loco-symbols-viz .caveat')).toContainText(/entry points/i);
  });

  test('the global path filter scopes the list', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Symbols');
    await expect(page.locator('loco-symbols-viz .row').first()).toBeVisible();
    const before = await page.locator('loco-symbols-viz .row').count();

    // No filter box of its own — the toolbar's path filter drives it, as everywhere else.
    await expect(page.locator('loco-symbols-viz input[type="search"]')).toHaveCount(0);
    await page.locator('loco-filter-bar input.search.path').fill('app/core/workers');

    await expect.poll(() => page.locator('loco-symbols-viz .row').count()).toBeLessThan(before);
    const paths = await page.locator('loco-symbols-viz .group-head .path').allTextContents();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p).toContain('app/core/workers');
  });

  test('copies the visible list to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loadFixture(page);
    await selectViz(page, 'Symbols');
    await expect(page.locator('loco-symbols-viz .row').first()).toBeVisible();

    await page.locator('loco-symbols-viz .copy').click();
    await expect(page.locator('loco-symbols-viz .copy')).toHaveText('copied');

    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('EMPTY_PRODUCT');
    expect(text).toContain('app/core/models/product.ts');

    // The other tab copies its own shape.
    await page.locator('loco-symbols-viz .tabs button', { hasText: 'Folder surface' }).click();
    await page.locator('loco-symbols-viz .copy').click();
    const surface = await page.evaluate(() => navigator.clipboard.readText());
    expect(surface).toMatch(/\d+\/\d+ public/);
  });

  test('clicking an unused export opens it in the AST view', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Symbols');
    await page.locator('loco-symbols-viz .row', { hasText: 'EMPTY_PRODUCT' }).first().click();

    await page.waitForURL(/\/ast$/);
    await expect(page.locator('loco-ast-view .path')).toHaveText('app/core/models/product.ts');
    await expect(page.locator('loco-source-panel .row.highlighted').first()).toBeVisible();
  });

  test('folder surface splits each folder into public, internal and unused', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Symbols');
    await page.locator('loco-symbols-viz .tabs button', { hasText: 'Folder surface' }).click();

    const folders = page.locator('loco-symbols-viz .group-head');
    await expect(folders.first()).toBeVisible();
    expect(await folders.count()).toBeGreaterThan(3);
    // Each row states how much of the folder's export list is reached from outside.
    await expect(folders.first()).toContainText(/\d+\/\d+ public/);

    // app/core/state exports only the store, and it is used from other folders.
    const state = folders.filter({ hasText: 'app/core/state' }).first();
    await expect(state).toContainText('1/1 public');

    await folders.first().click();
    await expect(page.locator('loco-symbols-viz .bucket-head').first()).toBeVisible();
    await expect(page.locator('loco-symbols-viz .bucket-head').first()).toContainText(
      'used outside the folder',
    );
  });
});
