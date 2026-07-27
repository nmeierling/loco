import { expect, test } from '@playwright/test';
import { loadFixture } from './fixtures';

test.describe('Ignore panel', () => {
  test('language sections are present and expandable', async ({ page }) => {
    await loadFixture(page);
    const labels = [
      'VCS, builds & caches',
      'Editor & OS files',
      'JavaScript / TypeScript',
      'Python',
      'Rust',
      '.NET',
    ];
    for (const label of labels) {
      await expect(page.locator('loco-ignore-panel .block-head', { hasText: label })).toBeVisible();
    }

    await page.locator('loco-ignore-panel .block-head.clickable', { hasText: 'Python' }).click();
    await expect(
      page.locator('loco-ignore-panel .pattern.ro code', { hasText: '__pycache__/' }).first(),
    ).toBeVisible();
  });

  test('quick-ignore from a heat tile removes the file from the treemap', async ({ page }) => {
    await loadFixture(page);

    const initial = await page.locator('loco-treemap svg rect').count();
    await page.locator('loco-treemap svg rect').first().click();

    await expect(page.locator('loco-ignore-panel .block.selected')).toBeVisible();
    await page
      .locator('loco-ignore-panel .block.selected button.action', { hasText: 'Ignore file' })
      .click();

    await page.waitForTimeout(150);
    const after = await page.locator('loco-treemap svg rect').count();
    expect(after).toBe(initial - 1);
    await expect(
      page.locator('loco-ignore-panel .patterns:not(.ro) .pattern code').first(),
    ).toBeVisible();
  });

  test('a custom pattern lives in the Custom list and filters the heatmap', async ({ page }) => {
    await loadFixture(page);
    const initial = await page.locator('loco-treemap svg rect').count();

    await page.locator('loco-ignore-panel input.input').fill('*.component.ts');
    await page.locator('loco-ignore-panel .add-btn').click();
    await page.waitForTimeout(150);

    const after = await page.locator('loco-treemap svg rect').count();
    expect(after).toBeLessThan(initial);
    await expect(
      page.locator('loco-ignore-panel .patterns:not(.ro) .pattern code', {
        hasText: '*.component.ts',
      }),
    ).toBeVisible();
  });
});
