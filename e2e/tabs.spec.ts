import { expect, test } from '@playwright/test';
import { expandFolder, loadFixture, showHeatmap } from './fixtures';

/** Double-clicks a fixture file in the sidebar tree, opening it in an AST tab. */
async function openTreeFile(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page
    .locator('loco-directory-tree .row.file', { hasText: name })
    .first()
    .dblclick();
}

test.describe('AST tabs', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixture(page);
    await expandFolder(page, 'core');
    await expandFolder(page, 'services');
    await expandFolder(page, 'state');
  });

  test('the heatmap tab is first, permanent and has no close button', async ({ page }) => {
    const heatmap = page.locator('header.head .tab', { hasText: 'heatmap' });
    await expect(heatmap).toBeVisible();
    await expect(heatmap.locator('.tab-close')).toHaveCount(0);
    // The standalone "ast" nav button is gone.
    await expect(page.locator('header.head .tab', { hasText: 'ast' })).toHaveCount(0);
  });

  test('double-clicking a file opens a tab named after it', async ({ page }) => {
    await openTreeFile(page, 'catalog.service.ts');
    const tab = page.locator('header.head .tab.file', { hasText: 'catalog.service.ts' });
    await expect(tab).toBeVisible();
    await expect(tab).toHaveClass(/active/);
    await expect(page.locator('loco-ast-view')).toBeVisible();
    await expect(page.locator('loco-ast-view .path')).toHaveText(/catalog\.service\.ts$/);
  });

  test('a second file opens a second tab; tabs switch views', async ({ page }) => {
    await openTreeFile(page, 'catalog.service.ts');
    await openTreeFile(page, 'catalog.store.ts');
    await expect(page.locator('header.head .tab.file')).toHaveCount(2);

    // The second tab is active and showing its file.
    await expect(page.locator('loco-ast-view .path')).toHaveText(/catalog\.store\.ts$/);

    // Click back to the first tab.
    await page.locator('header.head .tab.file', { hasText: 'catalog.service.ts' }).click();
    await expect(page.locator('loco-ast-view .path')).toHaveText(/catalog\.service\.ts$/);
  });

  test('double-clicking an already-open file focuses its tab, no duplicate', async ({ page }) => {
    await openTreeFile(page, 'catalog.service.ts');
    await openTreeFile(page, 'catalog.store.ts');
    await openTreeFile(page, 'catalog.service.ts');
    await expect(page.locator('header.head .tab.file')).toHaveCount(2);
    await expect(page.locator('loco-ast-view .path')).toHaveText(/catalog\.service\.ts$/);
  });

  test('closing the active tab activates a neighbour', async ({ page }) => {
    await openTreeFile(page, 'catalog.service.ts');
    await openTreeFile(page, 'catalog.store.ts');

    await page
      .locator('header.head .tab.file', { hasText: 'catalog.store.ts' })
      .locator('.tab-close')
      .click();

    await expect(page.locator('header.head .tab.file')).toHaveCount(1);
    // The left neighbour becomes active.
    await expect(page.locator('loco-ast-view .path')).toHaveText(/catalog\.service\.ts$/);
  });

  test('closing the last tab falls back to the heatmap', async ({ page }) => {
    await openTreeFile(page, 'catalog.service.ts');
    await page
      .locator('header.head .tab.file', { hasText: 'catalog.service.ts' })
      .locator('.tab-close')
      .click();

    await expect(page.locator('header.head .tab.file')).toHaveCount(0);
    await expect(page.locator('loco-ast-view')).toBeHidden();
    await expect(page.locator('loco-treemap svg')).toBeVisible();
  });

  test('open tabs and the active tab survive a reload', async ({ page }) => {
    await openTreeFile(page, 'catalog.service.ts');
    await openTreeFile(page, 'catalog.store.ts');
    await showHeatmap(page);

    // The metadata write is debounced, so give it a beat to land.
    await page.waitForTimeout(700);
    await page.reload();

    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();
    await expect(page.locator('header.head .tab.file')).toHaveCount(2);
    await expect(
      page.locator('header.head .tab.file', { hasText: 'catalog.service.ts' }),
    ).toBeVisible();
    await expect(
      page.locator('header.head .tab.file', { hasText: 'catalog.store.ts' }),
    ).toBeVisible();
    // Heatmap was active when saved, so it comes back active.
    await expect(page.locator('loco-ast-view')).toBeHidden();
  });
});
