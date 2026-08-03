import { expect, test } from '@playwright/test';
import { expandFolder, loadFixture, openInAst, showHeatmap } from './fixtures';

test.describe('UX tweaks', () => {
  test('treemap shows a color legend in the top-left', async ({ page }) => {
    await loadFixture(page);
    const legend = page.locator('loco-treemap .legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.legend-label')).toHaveText(/complexity/i);
    const stopCount = await legend.locator('.legend-stop').count();
    expect(stopCount).toBeGreaterThanOrEqual(8); // discretized gradient with multiple stops
    // Scale shows two numeric bookends
    const scaleText = await legend.locator('.legend-scale').textContent();
    expect(scaleText ?? '').toMatch(/0/);
  });

  test('path filter input has the same width on heatmap and an AST tab', async ({ page }) => {
    await loadFixture(page);
    const widthOf = () =>
      page.$eval('loco-filter-bar input.search.path', (el) => el.getBoundingClientRect().width);
    const onHeatmap = await widthOf();
    await openInAst(page, 'app.ts');
    const onAst = await widthOf();
    expect(Math.round(onHeatmap)).toBe(Math.round(onAst));
  });

  test('an AST tab hides VIZ chips; the heatmap tab shows them', async ({ page }) => {
    await loadFixture(page);
    // On heatmap (default), the VIZ row is visible.
    await expect(page.locator('loco-filter-bar .group .label', { hasText: 'viz' })).toBeVisible();

    // Open a file in an AST tab
    await openInAst(page, 'app.ts');
    await expect(page.locator('loco-filter-bar .group .label', { hasText: 'viz' })).toHaveCount(0);

    // Back on the heatmap tab, the VIZ row reappears
    await showHeatmap(page);
    await expect(page.locator('loco-filter-bar .group .label', { hasText: 'viz' })).toBeVisible();
  });

  test('the sidebar shows every file, even with an AST tab open', async ({ page }) => {
    await loadFixture(page);

    // On the heatmap, every file extension is listed.
    await expandFolder(page, 'app');
    await expect(
      page.locator('loco-directory-tree .row.file:has(.name:has-text("app.scss"))'),
    ).toBeVisible();

    // Opening an AST tab no longer prunes the tree — non-code files stay openable
    // (they now open as a text/hex preview).
    await openInAst(page, 'app.ts');
    await expect(
      page.locator('loco-directory-tree .row.file:has(.name:has-text("app.scss"))'),
    ).toBeVisible();
    await expect(
      page.locator('loco-directory-tree .row.file:has(.name:has-text("app.ts"))'),
    ).toBeVisible();
  });
});
