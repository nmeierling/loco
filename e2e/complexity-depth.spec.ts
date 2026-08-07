import { expect, test } from '@playwright/test';
import { loadFixture, selectViz, setPathFilter } from './fixtures';

test.describe('Complexity depth viz', () => {
  test('ranks flows by total branching and expands into a call tree', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Complexity depth');

    const viz = page.locator('loco-complexity-depth');
    await expect(viz.locator('.list')).toBeVisible();
    await expect(viz.locator('.caveat')).toContainText(/entry-point/i);

    const groups = viz.locator('.group-head');
    await expect(groups.first()).toBeVisible();
    expect(await groups.count()).toBeGreaterThan(0);

    // Each flow carries its aggregate badges.
    await expect(groups.first()).toContainText('Σ');
    await expect(groups.first()).toContainText('depth');
    await expect(groups.first()).toContainText('fns');

    // Flows are ordered by total complexity, descending.
    const totals = (await viz.locator('.group-head .badge.total').allTextContents()).map((t) =>
      Number(t.replace(/[^0-9]/g, '')),
    );
    for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]!);

    // Expanding a flow reveals its indented caller→callee tree.
    await groups.first().click();
    await expect(viz.locator('loco-flow-branch').first()).toBeVisible();
  });

  test('clicking a function in a flow opens it in the AST view', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Complexity depth');
    await page.locator('loco-complexity-depth .group-head').first().click();

    await page.locator('loco-complexity-depth loco-flow-branch .sym').first().click();
    await expect(page.locator('loco-ast-view')).toBeVisible();
  });

  test('the global path filter scopes the flow roots', async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'Complexity depth');
    await expect(page.locator('loco-complexity-depth .group-head').first()).toBeVisible();
    const before = await page.locator('loco-complexity-depth .group-head').count();

    // No filter box of its own — the sidebar path filter drives it, as everywhere else.
    await setPathFilter(page, 'app/core');
    await expect
      .poll(() => page.locator('loco-complexity-depth .group-head').count())
      .toBeLessThanOrEqual(before);

    const files = await page.locator('loco-complexity-depth .group-head .file').allTextContents();
    expect(files.length).toBeGreaterThan(0);
  });
});
