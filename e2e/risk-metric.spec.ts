import { expect, test } from '@playwright/test';
import { loadFixture, selectViz } from './fixtures';

test.describe('Risk metric', () => {
  test('is computed on demand and ranks the tangled, depended-on file highest', async ({
    page,
  }) => {
    await loadFixture(page);
    await selectViz(page, 'List');

    // Risk has no column until it has been asked for — it needs the module graph.
    await expect(page.locator('loco-metric-list .th-label', { hasText: 'Risk' })).toHaveCount(0);

    await page.locator('loco-filter-bar .chip', { hasText: 'Risk' }).click();
    await expect(page.locator('loco-metric-list .th-label', { hasText: 'Risk' })).toBeVisible();

    // Selecting the metric also sorts by it, so the riskiest file leads.
    const first = page.locator('loco-metric-list .row').first();
    await expect(first).toContainText('catalog.service.ts');

    const scores = await page.$$eval('loco-metric-list .row', (rows) =>
      rows.map((r) => Number((r.querySelectorAll('.td')[5]?.textContent ?? '0').trim())),
    );
    expect(scores[0]).toBeGreaterThan(0);
    expect(scores[0]).toBeLessThanOrEqual(100);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]!);
  });

  test('the treemap explains itself while the score is being built', async ({ page }) => {
    await loadFixture(page);

    const chip = page.locator('loco-filter-bar .chip', { hasText: 'Risk' });
    await expect(chip).toBeEnabled();
    await expect(chip).toHaveAttribute('title', /Click to compute/);
    await chip.click();

    // Either the placeholder is caught mid-build or the score already landed; both
    // end in tiles, and neither leaves an unexplained blank canvas.
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();
    await expect(page.locator('loco-treemap .empty')).toHaveCount(0);
    await expect(chip).toHaveAttribute('title', /0-100 score/);
  });
});
