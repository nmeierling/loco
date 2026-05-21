import { expect, test } from '@playwright/test';
import { expandFolder, loadLocoSrc } from './fixtures';

test.describe('UX tweaks', () => {
  test('treemap shows a color legend in the top-left', async ({ page }) => {
    await loadLocoSrc(page);
    const legend = page.locator('loco-treemap .legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.legend-label')).toHaveText(/complexity/i);
    const stopCount = await legend.locator('.legend-stop').count();
    expect(stopCount).toBeGreaterThanOrEqual(8); // discretized gradient with multiple stops
    // Scale shows two numeric bookends
    const scaleText = await legend.locator('.legend-scale').textContent();
    expect(scaleText ?? '').toMatch(/0/);
  });

  test('path filter input has the same width on / and /ast', async ({ page }) => {
    await loadLocoSrc(page);
    const widthOf = () =>
      page.$eval('loco-filter-bar input.search.path', (el) => el.getBoundingClientRect().width);
    const onHeatmap = await widthOf();
    await page.locator('header.head a[href="/ast"]').click();
    await page.waitForURL(/\/ast$/);
    const onAst = await widthOf();
    expect(Math.round(onHeatmap)).toBe(Math.round(onAst));
  });

  test('AST route hides VIZ chips; heatmap route shows them', async ({ page }) => {
    await loadLocoSrc(page);
    // On heatmap (default), the VIZ row is visible.
    await expect(page.locator('loco-filter-bar .group .label', { hasText: 'viz' })).toBeVisible();

    // Navigate to AST
    await page.locator('header.head a[href="/ast"]').click();
    await page.waitForURL(/\/ast$/);
    await expect(page.locator('loco-filter-bar .group .label', { hasText: 'viz' })).toHaveCount(0);

    // Going back hides nothing — the VIZ row should reappear
    await page.locator('header.head a[href="/"]').click();
    await page.waitForURL(/\/$/);
    await expect(page.locator('loco-filter-bar .group .label', { hasText: 'viz' })).toBeVisible();
  });

  test('AST route filters the sidebar to AST-supported files', async ({ page }) => {
    await loadLocoSrc(page);

    // On /, every file extension is allowed in the tree.
    await expandFolder(page, 'app');
    await expect(
      page.locator('loco-directory-tree .row.file:has(.name:has-text("app.scss"))'),
    ).toBeVisible();

    // Switch to /ast — .scss has no AST parser, so the row disappears.
    await page.locator('header.head a[href="/ast"]').click();
    await page.waitForURL(/\/ast$/);
    await expect(
      page.locator('loco-directory-tree .row.file:has(.name:has-text("app.scss"))'),
    ).toHaveCount(0);
    // TS files remain visible (after expanding the dir on /ast)
    await expect(
      page.locator('loco-directory-tree .row.file:has(.name:has-text("app.ts"))'),
    ).toBeVisible();
    // Note line at the bottom of the tree
    await expect(page.locator('loco-directory-tree .note')).toContainText(/AST support/i);
  });
});
