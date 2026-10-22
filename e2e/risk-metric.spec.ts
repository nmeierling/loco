import { expect, test } from '@playwright/test';
import { loadFixture, selectMetric, selectViz } from './fixtures';

test.describe('Risk metric', () => {
  test('is computed on demand and ranks the tangled, depended-on file highest', async ({
    page,
  }) => {
    await loadFixture(page);
    await selectViz(page, 'List');

    // Risk has no column until it has been asked for — it needs the module graph.
    await expect(page.locator('loco-metric-list .th-label', { hasText: 'Risk' })).toHaveCount(0);

    await selectMetric(page, 'risk');
    await expect(page.locator('loco-metric-list .th-label', { hasText: 'Risk' })).toBeVisible();

    // Selecting the metric also sorts by it, so the riskiest file leads.
    const first = page.locator('loco-metric-list .row').first();
    await expect(first).toContainText('catalog.service.ts');

    // Find the Risk column by its header rather than by a fixed offset — the table grew
    // a Size column between LOC and Complexity, which silently shifted every index.
    const headers = await page.locator('loco-metric-list .th-label').allTextContents();
    const riskCol = headers.findIndex((h) => h.trim() === 'Risk');
    expect(riskCol, 'no Risk column in the table header').toBeGreaterThanOrEqual(0);

    const scores = await page.$$eval(
      'loco-metric-list .row',
      (rows, col) =>
        rows.map((r) => Number((r.querySelectorAll('.td')[col]?.textContent ?? '0').trim())),
      riskCol,
    );
    expect(scores[0]).toBeGreaterThan(0);
    expect(scores[0]).toBeLessThanOrEqual(100);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]!);
  });

  test('the treemap explains itself while the score is being built', async ({ page }) => {
    await loadFixture(page);

    const riskOption = page.locator('loco-file-browser .metric select option[value="risk"]');
    await expect(riskOption).toBeEnabled();
    await expect(riskOption).toHaveAttribute('title', /Click to compute/);
    await selectMetric(page, 'risk');

    // Either the placeholder is caught mid-build or the score already landed; both
    // end in tiles, and neither leaves an unexplained blank canvas.
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();
    await expect(page.locator('loco-treemap .empty')).toHaveCount(0);
    await expect(riskOption).toHaveAttribute('title', /0-100 score/);
  });
});
