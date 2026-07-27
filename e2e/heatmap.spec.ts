import { expect, test } from '@playwright/test';
import { loadFixture } from './fixtures';

test.describe('Heatmap (treemap)', () => {
  test('name filter narrows the tile count, clearing restores it', async ({ page }) => {
    await loadFixture(page);
    const initial = await page.locator('loco-treemap svg rect').count();
    expect(initial).toBeGreaterThan(10);

    await page.locator('loco-filter-bar input[placeholder*="name"]').fill('component');
    await expect.poll(() => page.locator('loco-treemap svg rect').count()).toBeLessThan(initial);
    const filtered = await page.locator('loco-treemap svg rect').count();
    expect(filtered).toBeGreaterThan(0);

    await page.locator('loco-filter-bar input[placeholder*="name"]').fill('');
    await expect.poll(() => page.locator('loco-treemap svg rect').count()).toBe(initial);
  });

  test('switching to the Complexity metric keeps the treemap visible', async ({ page }) => {
    await loadFixture(page);
    await page.locator('loco-filter-bar .chip', { hasText: 'Complexity' }).click();
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();
    const tiles = await page.locator('loco-treemap svg rect').count();
    expect(tiles).toBeGreaterThan(5);
  });

  test('hover shows a tooltip with LOC and Complexity numbers', async ({ page }) => {
    await loadFixture(page);
    const firstTile = page.locator('loco-treemap svg rect').first();
    await firstTile.hover();
    const tip = page.locator('loco-treemap .tip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('LOC');
    await expect(tip).toContainText('Complexity');
  });
});
