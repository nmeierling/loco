import { expect, test } from '@playwright/test';
import { expandFolder, loadFixture, selectViz } from './fixtures';

test.describe('Path filter — sidebar funnel + viz-wide application', () => {
  test('funnel icon on a directory row sets the path filter', async ({ page }) => {
    await loadFixture(page);

    // Expand into a known subfolder
    await expandFolder(page, 'core');

    // The funnel button is hidden until the row is hovered; force-click to bypass that.
    const dirRow = page.locator('loco-directory-tree .row.dir', { hasText: 'services' }).first();
    await dirRow.locator('.filter-btn').click({ force: true });

    const pathInput = page.locator('loco-filter-bar input.search.path');
    await expect(pathInput).toHaveValue(/services/);
  });

  test('path filter shrinks treemap tile count (still wider than tall after re-layout)', async ({
    page,
  }) => {
    await loadFixture(page);

    const initial = await page.locator('loco-treemap svg rect').count();
    await page.locator('loco-filter-bar input.search.path').fill('app/core');
    await expect.poll(() => page.locator('loco-treemap svg rect').count()).toBeLessThan(initial);

    // Sanity: at least one tile is now wider than tall (aspect-ratio change took effect).
    const rectsMeta = await page.$$eval('loco-treemap svg rect', (rs) =>
      rs.map((r) => ({
        w: parseFloat(r.getAttribute('width') ?? '0'),
        h: parseFloat(r.getAttribute('height') ?? '0'),
      })),
    );
    const widerCount = rectsMeta.filter((r) => r.w > r.h && r.w > 30).length;
    expect(widerCount).toBeGreaterThan(0);
  });

  test('path filter is applied to the module graph viz', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Module graph');
    await page.waitForSelector('loco-module-graph svg circle');

    const before = await page.locator('loco-module-graph svg circle').count();
    await page.locator('loco-filter-bar input.search.path').fill('app/core/services');
    await expect
      .poll(() => page.locator('loco-module-graph svg circle').count())
      .toBeLessThan(before);
    const after = await page.locator('loco-module-graph svg circle').count();
    expect(after).toBeGreaterThan(0);
  });

  test('path filter is applied to the dep-matrix viz', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Dep matrix');
    await page.waitForSelector('loco-dependency-matrix svg rect');

    await page.locator('loco-filter-bar input.search.path').fill('app/core/services');

    // Folder mode splits the biggest bucket until the grid is worth reading, so a
    // narrow filter drills all the way down to files. Every row must come from the
    // filtered folder.
    const labels = page.locator('loco-dependency-matrix svg g.row-labels text');
    await expect.poll(() => labels.count()).toBeGreaterThan(0);
    const texts = await labels.allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t.trim()).toMatch(/^app\/core\/services\//);
  });

  test('clear button next to the path input wipes the filter', async ({ page }) => {
    await loadFixture(page);
    const initial = await page.locator('loco-treemap svg rect').count();

    await page.locator('loco-filter-bar input.search.path').fill('app/core');
    await expect.poll(() => page.locator('loco-treemap svg rect').count()).toBeLessThan(initial);

    await page.locator('loco-filter-bar button.clear').click();
    await expect.poll(() => page.locator('loco-treemap svg rect').count()).toBe(initial);
  });
});
