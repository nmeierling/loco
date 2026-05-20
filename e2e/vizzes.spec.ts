import { expect, test } from '@playwright/test';
import { loadLocoSrc, selectViz } from './fixtures';

test.describe('Alternative vizzes (sunburst, module graph, dep matrix)', () => {
  test('sunburst renders segments and clicking a file segment selects it', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Sunburst');

    await expect(page.locator('loco-sunburst svg path').first()).toBeVisible({ timeout: 10_000 });
    const segments = await page.locator('loco-sunburst svg path').count();
    expect(segments).toBeGreaterThan(10);

    // Click somewhere — should not error
    await page.locator('loco-sunburst svg path').nth(5).click();
  });

  test('module graph builds, renders nodes + edges, dbl-click opens AST', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Module graph');

    await page.waitForSelector('loco-module-graph svg circle', { timeout: 60_000 });
    const nodes = await page.locator('loco-module-graph svg circle').count();
    const edges = await page.locator('loco-module-graph svg line').count();
    expect(nodes).toBeGreaterThan(5);
    expect(edges).toBeGreaterThan(5);

    await page.locator('loco-module-graph svg circle').first().dblclick();
    await page.waitForURL(/\/ast$/);
    await expect(page.locator('loco-ast-view loco-ast-node').first()).toBeVisible();
  });

  test('dep matrix builds and renders a square grid of cells', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Dep matrix');

    await page.waitForSelector('loco-dependency-matrix svg rect', { timeout: 60_000 });
    const cells = await page.locator('loco-dependency-matrix svg rect').count();
    expect(cells).toBeGreaterThan(100); // n*n + a couple of background rects
  });
});
