import { expect, test } from '@playwright/test';
import { expandFolder, loadFixture, openFilesFilter, openInAst, showHeatmap } from './fixtures';

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

  test('the sidebar path filter keeps a stable width across Overview and an AST tab', async ({
    page,
  }) => {
    await loadFixture(page);
    await openFilesFilter(page);
    const widthOf = () =>
      page.$eval('loco-file-browser input[placeholder*="path"]', (el) =>
        el.getBoundingClientRect().width,
      );
    const onOverview = await widthOf();
    await openInAst(page, 'app.ts');
    const onAst = await widthOf();
    expect(Math.round(onOverview)).toBe(Math.round(onAst));
  });

  test('an AST tab hides the viz switcher; the Overview tab shows it', async ({ page }) => {
    await loadFixture(page);
    // On the Overview (default), the viz switcher is visible.
    await expect(page.locator('loco-viz-switcher')).toBeVisible();

    // Open a file in an AST tab
    await openInAst(page, 'app.ts');
    await expect(page.locator('loco-viz-switcher')).toBeHidden();

    // Back on the Overview tab, the viz switcher reappears
    await showHeatmap(page);
    await expect(page.locator('loco-viz-switcher')).toBeVisible();
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
