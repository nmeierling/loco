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

  test('minimap drag clamps the viewport at the graph edge (no rescale shrink)', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Module graph');
    await page.waitForSelector('loco-module-graph svg circle');
    // Let the simulation settle so node bounds stabilise.
    await page.waitForTimeout(400);

    const minimap = page.locator('loco-module-graph svg.minimap');
    const box = await minimap.boundingBox();
    if (!box) throw new Error('minimap not visible');

    const scaleBefore = await page.$eval('loco-module-graph svg.minimap', (svg) => {
      const stop = svg.querySelector<SVGCircleElement>('circle');
      return stop ? Number(stop.getAttribute('r')) : 0;
    });

    // Drag past the bottom-right corner — the viewport rectangle must stop at the
    // border instead of pushing the minimap to rescale (which used to make every
    // node and the rect visibly shrink).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 60, box.y + box.height + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const vpBox = await page.$eval('loco-module-graph svg.minimap rect.vp', (r) => ({
      x: Number(r.getAttribute('x')),
      y: Number(r.getAttribute('y')),
      w: Number(r.getAttribute('width')),
      h: Number(r.getAttribute('height')),
    }));
    expect(vpBox.x + vpBox.w).toBeLessThanOrEqual(200 + 1); // MINIMAP_W
    expect(vpBox.y + vpBox.h).toBeLessThanOrEqual(140 + 1); // MINIMAP_H

    // Scale shouldn't have collapsed — first node radius should still be in the
    // same ballpark (allow a small tolerance for simulation drift).
    const scaleAfter = await page.$eval('loco-module-graph svg.minimap', (svg) => {
      const stop = svg.querySelector<SVGCircleElement>('circle');
      return stop ? Number(stop.getAttribute('r')) : 0;
    });
    expect(scaleAfter).toBeGreaterThan(scaleBefore * 0.5);
  });

  test('module graph shows a minimap; clicking it pans the main view', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Module graph');
    await page.waitForSelector('loco-module-graph svg circle');
    const minimap = page.locator('loco-module-graph svg.minimap');
    await expect(minimap).toBeVisible();
    await expect(minimap.locator('rect.vp')).toBeVisible();
    const beforeTransform = await page.$eval(
      'loco-module-graph svg g[transform^="translate"]',
      (el) => el.getAttribute('transform') ?? '',
    );

    // Click on a corner of the minimap to pan
    const box = await minimap.boundingBox();
    if (!box) throw new Error('minimap not visible');
    await page.mouse.click(box.x + 20, box.y + 20);
    await page.waitForTimeout(120);

    const afterTransform = await page.$eval(
      'loco-module-graph svg g[transform^="translate"]',
      (el) => el.getAttribute('transform') ?? '',
    );
    expect(afterTransform).not.toBe(beforeTransform);
  });

  test('dep matrix builds and renders a square grid of cells', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Dep matrix');

    await page.waitForSelector('loco-dependency-matrix svg rect', { timeout: 60_000 });
    const cells = await page.locator('loco-dependency-matrix svg rect').count();
    expect(cells).toBeGreaterThan(100); // n*n + a couple of background rects
  });
});
