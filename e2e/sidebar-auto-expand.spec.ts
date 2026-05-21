import { expect, test } from '@playwright/test';
import { loadLocoSrc } from './fixtures';

test.describe('Sidebar — auto-expand on filter', () => {
  test('typing into the name filter expands all folders so matches are visible', async ({ page }) => {
    await loadLocoSrc(page);

    // Pick a known-deep file that lives behind two collapsed folders by default.
    // The default expansion is depth < 2, so `app/core/services/analysis.service.ts`
    // (depth 4 by our counting — root=0, app=1, core=2, services=3, file=4) is not
    // visible from a fresh load.
    const target = page.locator(
      'loco-directory-tree .row.file:has(.name:has-text("analysis.service.ts"))',
    );
    await expect(target).toHaveCount(0);

    // Typing "analysis" should expand all folders and reveal the file.
    await page.locator('loco-filter-bar input[placeholder*="name"]').fill('analysis');
    await expect(target).toBeVisible();

    // Clearing the filter restores the default (collapsed) state.
    await page.locator('loco-filter-bar input[placeholder*="name"]').fill('');
    await expect(target).toHaveCount(0);
  });

  test('path filter does NOT auto-expand — leaves the user\'s expansion state alone', async ({ page }) => {
    await loadLocoSrc(page);

    // `services` is collapsed by default, so `analysis.service.ts` isn't visible.
    await expect(
      page.locator('loco-directory-tree .row.file:has(.name:has-text("analysis.service.ts"))'),
    ).toHaveCount(0);

    // Path filter narrows the tree but does not force-expand collapsed folders.
    await page.locator('loco-filter-bar input.search.path').fill('services');
    await page.waitForTimeout(150);
    await expect(
      page.locator('loco-directory-tree .row.file:has(.name:has-text("analysis.service.ts"))'),
    ).toHaveCount(0);

    // The `core` folder row should still be visible (it's in the path), but its children stay collapsed.
    await expect(
      page.locator('loco-directory-tree .row.dir:has(.name:has-text("core"))'),
    ).toBeVisible();
  });
});
