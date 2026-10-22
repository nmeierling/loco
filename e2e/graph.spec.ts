import { Page, expect, test } from '@playwright/test';
import { expandFolder, loadFixture } from './fixtures';

const G = 'loco-symbol-graph';

async function openGraph(page: Page): Promise<void> {
  await loadFixture(page);
  await expandFolder(page, 'core');
  await expandFolder(page, 'services');
  await page
    .locator('loco-directory-tree .row.file', { hasText: 'catalog.service.ts' })
    .first()
    .dblclick();
  await expect(page.locator('loco-ast-view:visible .split')).toBeVisible();
  await page.locator('loco-ast-view:visible .mode', { hasText: 'Graph' }).click();
  await page.waitForSelector(`${G} svg .nodes .node`);
  // Let the force layout settle and auto-fit before interacting.
  await page.waitForTimeout(3000);
}

test.describe('Symbol graph navigation', () => {
  test('renders nodes with a minimap and zoom controls', async ({ page }) => {
    await openGraph(page);
    expect(await page.locator(`${G} .nodes .node`).count()).toBeGreaterThan(2);
    await expect(page.locator(`${G} .minimap`)).toBeVisible();
    await expect(page.locator(`${G} .zoomctl button`, { hasText: 'Fit' })).toBeVisible();
  });

  test('the zoom control changes the viewport scale', async ({ page }) => {
    await openGraph(page);
    const viewport = page.locator(`${G} svg:not(.minimap) > g`);
    const before = await viewport.getAttribute('transform');
    await page.locator(`${G} .zoomctl button`, { hasText: '+' }).click();
    await expect.poll(() => viewport.getAttribute('transform')).not.toBe(before);
  });

  test('a single node can be dragged to a new position', async ({ page }) => {
    await openGraph(page);
    const svgBox = (await page.locator(`${G} svg:not(.minimap)`).boundingBox())!;

    // The toolbar, legend and minimap float over the canvas and would swallow the press,
    // so grab and release have to stay clear of them. Measure where they actually are:
    // the graph shares the pane with the source view, which leaves it only a few hundred
    // pixels wide, and fixed margins big enough for the minimap left no room at all.
    const overlays = (
      await Promise.all(
        [`${G} .toolbar`, `${G} .legend`, `${G} .minimap`].map((sel) =>
          page.locator(sel).boundingBox(),
        ),
      )
    ).filter((b) => b !== null);

    const clear = (cx: number, cy: number): boolean =>
      cx > svgBox.x + 8 &&
      cx < svgBox.x + svgBox.width - 8 &&
      cy > svgBox.y + 8 &&
      cy < svgBox.y + svgBox.height - 8 &&
      overlays.every((o) => cx < o.x || cx > o.x + o.width || cy < o.y || cy > o.y + o.height);

    const nodes = page.locator(`${G} .nodes .node`);
    const count = await nodes.count();
    let chosen = -1;
    let center: { cx: number; cy: number } | null = null;
    for (let i = 0; i < count; i++) {
      const bb = await nodes.nth(i).locator('circle').boundingBox();
      if (!bb) continue;
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;
      if (clear(cx, cy)) {
        chosen = i;
        center = { cx, cy };
        break;
      }
    }
    expect(chosen, 'no graph node sits clear of the floating controls').toBeGreaterThanOrEqual(0);

    // Drop somewhere that is also clear, whichever direction that happens to be.
    const delta = [
      [70, 50],
      [-70, 50],
      [70, -50],
      [-70, -50],
    ].find(([dx, dy]) => clear(center!.cx + dx!, center!.cy + dy!));
    expect(delta, 'nowhere clear to drop the node').toBeDefined();

    const node = nodes.nth(chosen);
    const before = await node.getAttribute('transform');
    await page.mouse.move(center!.cx, center!.cy);
    await page.mouse.down();
    await page.mouse.move(center!.cx + delta![0]!, center!.cy + delta![1]!, { steps: 10 });
    await page.mouse.up();

    // The node followed the pointer and stayed put (pinned) rather than snapping back.
    await expect.poll(() => node.getAttribute('transform')).not.toBe(before);
  });
});
