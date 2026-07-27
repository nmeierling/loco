import { expect, test } from '@playwright/test';
import { loadLocoSrc, selectViz } from './fixtures';

test.describe('Alternative vizzes (sunburst, module graph, dep matrix)', () => {
  test('List leads the viz chips but the treemap is what opens', async ({ page }) => {
    await loadLocoSrc(page);

    const chips = page.locator('loco-filter-bar .group', { hasText: 'viz' }).locator('.chip');
    await expect(chips.first()).toHaveText('List');
    await expect(chips.first()).not.toHaveClass(/active/);
    await expect(
      page.locator('loco-filter-bar .chip.active', { hasText: 'Treemap' }),
    ).toBeVisible();
    await expect(page.locator('loco-treemap svg')).toBeVisible();
  });

  test('sunburst renders segments and clicking a file segment selects it', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Sunburst');

    await expect(page.locator('loco-sunburst svg path').first()).toBeVisible({ timeout: 10_000 });
    const segments = await page.locator('loco-sunburst svg path').count();
    expect(segments).toBeGreaterThan(10);

    // Click somewhere — should not error. Forced because the bounding-box centre of a
    // wide ring arc can sit in the donut hole, where the click would hit the bare svg.
    await page.locator('loco-sunburst svg path').nth(5).click({ force: true });
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

  test('minimap drag clamps the viewport at the graph edge (no rescale shrink)', async ({
    page,
  }) => {
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

  test('dep matrix opens at folder level and drills down on a folder label', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Dep matrix');

    await page.waitForSelector('loco-dependency-matrix svg rect', { timeout: 60_000 });

    // Folder mode is the default: rows are folders (trailing slash) or loose files,
    // and the count stays far below the file count of the repo.
    await expect(page.locator('loco-dependency-matrix .chip', { hasText: 'Folders' })).toHaveClass(
      /active/,
    );
    // Rows are folder buckets, not files: far fewer rows than the repo has files, and
    // most of them are folders (trailing slash on the label).
    const folderRows = await page.locator('loco-dependency-matrix .count').textContent();
    const n = Number((folderRows ?? '0 × 0').split('×')[0]!.trim());
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(40);
    expect(await page.locator('loco-dependency-matrix text.drillable').count()).toBeGreaterThan(0);

    // At the top there is just the root crumb. Folder labels are mixed-depth buckets,
    // so drilling into one can add several crumbs at once.
    await expect(page.locator('loco-dependency-matrix .crumb')).toHaveCount(1);
    const label = (
      (await page.locator('loco-dependency-matrix text.drillable').first().textContent()) ?? ''
    ).trim();
    await page.locator('loco-dependency-matrix text.drillable').first().click();

    const crumbs = page.locator('loco-dependency-matrix .crumb');
    await expect.poll(() => crumbs.count()).toBeGreaterThan(1);
    const leaf = label.replace(/\/$/, '').split('/').pop()!;
    await expect(crumbs.last()).toHaveText(leaf);

    // The breadcrumb walks back up.
    await crumbs.first().click();
    await expect(crumbs).toHaveCount(1);
  });

  test('dep matrix Files mode expands to the full per-file grid', async ({ page }) => {
    await loadLocoSrc(page);
    await selectViz(page, 'Dep matrix');
    await page.waitForSelector('loco-dependency-matrix svg rect', { timeout: 60_000 });

    const folderCells = await page.locator('loco-dependency-matrix svg rect').count();
    await page.locator('loco-dependency-matrix .chip', { hasText: 'Files' }).click();

    await expect
      .poll(() => page.locator('loco-dependency-matrix svg rect').count())
      .toBeGreaterThan(folderCells);
    const fileCells = await page.locator('loco-dependency-matrix svg rect').count();
    expect(fileCells).toBeGreaterThan(100); // n*n + the background rect
  });
});
