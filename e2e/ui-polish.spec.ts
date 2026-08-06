import { expect, test } from '@playwright/test';
import { loadFixture, openGearMenu, selectViz } from './fixtures';

test.describe('UI polish', () => {
  test('treemap tooltip flips to the left instead of shrinking at the right edge', async ({
    page,
  }) => {
    await loadFixture(page);
    const rects = page.locator('loco-treemap svg rect');

    // A tooltip with room to breathe: two rows, one line of path, nothing wrapped.
    const first = await rects.first().boundingBox();
    await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
    const roomy = await page.locator('loco-treemap .tip').boundingBox();

    let rightmost = 0;
    let maxX = -1;
    const count = await rects.count();
    for (let i = 0; i < count; i++) {
      const b = await rects.nth(i).boundingBox();
      if (b && b.x > maxX) {
        maxX = b.x;
        rightmost = i;
      }
    }
    const edge = await rects.nth(rightmost).boundingBox();
    await page.mouse.move(edge!.x + edge!.width - 2, edge!.y + edge!.height / 2);

    const tip = page.locator('loco-treemap .tip');
    await expect(tip).toHaveClass(/flip-x/);
    const flipped = await tip.boundingBox();

    // It sits left of the cursor, fully on screen, and is not squeezed: a narrowed box
    // would wrap the path and grow taller than the roomy one.
    const cursorX = edge!.x + edge!.width - 2;
    expect(flipped!.x).toBeGreaterThan(0);
    expect(flipped!.x + flipped!.width).toBeLessThanOrEqual(cursorX + 1);
    expect(Math.round(flipped!.height)).toBe(Math.round(roomy!.height));
  });

  test('selecting a file leaves the module graph layout untouched', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Module graph');
    await page.waitForSelector('loco-module-graph svg circle');
    // Let the force layout settle before sampling positions.
    await page.waitForTimeout(2500);

    const positions = () =>
      page.$$eval('loco-module-graph .nodes g', (gs) =>
        gs.map((g) => g.getAttribute('transform')).join('|'),
      );
    const before = await positions();

    await page.locator('loco-module-graph .nodes g').nth(3).click();
    await page.waitForTimeout(600);

    expect(await positions()).toBe(before);
    // The selection still repaints: its edges light up.
    expect(
      await page.locator('loco-module-graph line[stroke="var(--accent)"]').count(),
    ).toBeGreaterThan(0);

    // Picking a different file in the sidebar must not disturb it either.
    await page.locator('loco-directory-tree .row.file').first().click();
    await page.waitForTimeout(600);
    expect(await positions()).toBe(before);
  });

  test('the help button explains churn and risk', async ({ page }) => {
    await loadFixture(page);
    await expect(page.locator('loco-metrics-help')).toHaveCount(0);

    await openGearMenu(page);
    await page.locator('loco-shell .menu-item', { hasText: 'How the metrics' }).click();
    const dialog = page.locator('loco-metrics-help [role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Churn');
    await expect(dialog).toContainText('Risk');
    // The caveats are the point of the modal, not just the definitions.
    await expect(dialog).toContainText(/geometric mean/i);
    await expect(dialog).toContainText(/Safari and Firefox/i);

    await page.locator('loco-metrics-help .close').click();
    await expect(page.locator('loco-metrics-help')).toHaveCount(0);

    // Clicking the backdrop also dismisses it.
    await openGearMenu(page);
    await page.locator('loco-shell .menu-item', { hasText: 'How the metrics' }).click();
    await page.locator('loco-metrics-help .backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('loco-metrics-help')).toHaveCount(0);
  });
});
