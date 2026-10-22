import { expect, test } from '@playwright/test';
import { loadFixture, selectViz } from './fixtures';

test.describe('Domain board', () => {
  test('auto-groups names, adds a note, and persists across reload', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Domain board');

    const board = page.locator('loco-domain-board .board');
    await expect(board).toBeVisible();

    // First open auto-groups: at least one domain frame with symbol stickies inside it.
    await expect(page.locator('loco-domain-board .frame').first()).toBeVisible();
    const frameCount = await page.locator('loco-domain-board .frame').count();
    expect(frameCount).toBeGreaterThan(0);
    expect(await page.locator('loco-domain-board .sticky.symbol').count()).toBeGreaterThan(0);

    // Add an empty reminder note.
    await page.locator('loco-domain-board .toolbar button', { hasText: 'Note' }).click();
    await expect(page.locator('loco-domain-board .sticky.note')).toHaveCount(1);
    await page.locator('loco-domain-board .sticky.note textarea').fill('check payment split');

    // Give the debounced IndexedDB save time to flush, then reload the whole app.
    await page.waitForTimeout(700);
    await page.reload();

    // The session cache restores the project; the board loads from its own DB.
    await page.waitForSelector('loco-viz-switcher');
    await selectViz(page, 'Domain board');
    await expect(page.locator('loco-domain-board .frame').first()).toBeVisible();
    await expect(page.locator('loco-domain-board .sticky.note textarea')).toHaveValue(
      'check payment split',
    );
    expect(await page.locator('loco-domain-board .frame').count()).toBe(frameCount);
  });

  test('sizes stickies to their name and re-chunks on strategy change', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Domain board');
    await expect(page.locator('loco-domain-board .frame').first()).toBeVisible();

    // Each sticky is sized to its own label, so widths vary rather than being uniform.
    const widths = await page
      .locator('loco-domain-board .sticky.symbol')
      .evaluateAll((els) => els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().width)));
    expect(new Set(widths).size).toBeGreaterThan(1);

    const titlesOf = () =>
      page
        .locator('loco-domain-board .frame-title')
        .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

    // The compound strategy can produce two-term domains (e.g. "Cart · Line").
    await page.locator('loco-domain-board .strategy').selectOption('compound');
    await expect
      .poll(async () => (await titlesOf()).some((t) => t.includes('·')))
      .toBe(true);

    // The folder strategy names domains after source directories, not terms.
    await page.locator('loco-domain-board .strategy').selectOption('folder');
    await expect.poll(async () => (await titlesOf()).includes('services')).toBe(true);
  });
});
