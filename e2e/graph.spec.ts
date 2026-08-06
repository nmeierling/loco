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
    const nodes = page.locator(`${G} .nodes .node`);
    const count = await nodes.count();

    // Pick a node comfortably inside the canvas — below the toolbar, clear of the minimap.
    let chosen = -1;
    let center: { cx: number; cy: number } | null = null;
    for (let i = 0; i < count; i++) {
      const bb = await nodes.nth(i).locator('circle').boundingBox();
      if (!bb) continue;
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;
      if (
        cx > svgBox.x + 40 &&
        cx < svgBox.x + svgBox.width - 220 &&
        cy > svgBox.y + 70 &&
        cy < svgBox.y + svgBox.height - 120 &&
        bb.width > 6
      ) {
        chosen = i;
        center = { cx, cy };
        break;
      }
    }
    expect(chosen).toBeGreaterThanOrEqual(0);

    const node = nodes.nth(chosen);
    const before = await node.getAttribute('transform');
    await page.mouse.move(center!.cx, center!.cy);
    await page.mouse.down();
    await page.mouse.move(center!.cx + 120, center!.cy + 70, { steps: 10 });
    await page.mouse.up();

    // The node followed the pointer and stayed put (pinned) rather than snapping back.
    await expect.poll(() => node.getAttribute('transform')).not.toBe(before);
  });
});
