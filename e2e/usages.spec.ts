import { Page, expect, test } from '@playwright/test';
import { loadLocoSrc, selectViz } from './fixtures';

/** Opens a file in the AST view by name, via the list viz. */
async function openInAst(page: Page, nameFragment: string): Promise<void> {
  await selectViz(page, 'List');
  await page.locator('loco-metric-list .search').fill(nameFragment);
  await page.locator('loco-metric-list .row').first().dblclick();
  await page.waitForURL(/\/ast$/);
}

test.describe('AST usages panel', () => {
  test('lists the symbols a file declares with their repo-wide usage counts', async ({ page }) => {
    await loadLocoSrc(page);
    await openInAst(page, 'analysis.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();

    const rows = page.locator('loco-usages-panel .sym-head');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });

    // The store class itself is imported all over the app.
    const classRow = rows.filter({ hasText: 'AnalysisStore' }).first();
    await expect(classRow).toContainText(/\d+ in \d+ files/);

    // Its methods are listed as members and are used outside this file.
    const method = rows.filter({ hasText: 'selectPath' }).first();
    await expect(method).toContainText('method');
    await expect(method).toContainText(/\d+ in \d+ files/);
  });

  test('expanding a symbol shows call sites grouped by file', async ({ page }) => {
    await loadLocoSrc(page);
    await openInAst(page, 'analysis.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();
    await expect(page.locator('loco-usages-panel .sym-head').first()).toBeVisible({
      timeout: 60_000,
    });

    await page.locator('loco-usages-panel .sym-head', { hasText: 'selectPath' }).first().click();

    const refs = page.locator('loco-usages-panel .ref');
    await expect(refs.first()).toBeVisible();
    expect(await refs.count()).toBeGreaterThan(2);

    // Usages come from more than one file, and each carries its source line.
    const files = await page.locator('loco-usages-panel .ref-path').allTextContents();
    expect(new Set(files).size).toBeGreaterThan(1);
    await expect(refs.first().locator('code')).toContainText('selectPath');
  });

  test('clicking a usage opens that file and highlights the line', async ({ page }) => {
    await loadLocoSrc(page);
    await openInAst(page, 'analysis.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();
    await expect(page.locator('loco-usages-panel .sym-head').first()).toBeVisible({
      timeout: 60_000,
    });
    await page.locator('loco-usages-panel .sym-head', { hasText: 'selectPath' }).first().click();

    const before = await page.locator('loco-ast-view .path').textContent();
    const target = page.locator('loco-usages-panel .ref').first();
    const lineNo = (await target.locator('.ref-line').textContent())?.trim();
    await target.click();

    await expect.poll(() => page.locator('loco-ast-view .path').textContent()).not.toBe(before);
    // The source pane highlights the exact line the usage sits on.
    const highlighted = page.locator('loco-source-panel .row.highlighted');
    await expect(highlighted.first()).toBeVisible();
    const num = await highlighted.first().locator('.num').textContent();
    expect(num?.trim()).toBe(lineNo);
  });

  test('the Uses tab lists symbols this file pulls in from elsewhere', async ({ page }) => {
    await loadLocoSrc(page);
    await openInAst(page, 'ast-selection.service');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();
    await expect(page.locator('loco-usages-panel .sym-head').first()).toBeVisible({
      timeout: 60_000,
    });

    await page.locator('loco-usages-panel .tabs button', { hasText: 'Uses' }).click();

    const rows = page.locator('loco-usages-panel .sym-head');
    await expect(rows.first()).toBeVisible();
    // It injects AnalysisStore, so the store and the methods it calls show up here.
    await expect(rows.filter({ hasText: 'AnalysisStore' }).first()).toBeVisible();
    await expect(rows.filter({ hasText: 'AnalysisStore' }).first()).toContainText(
      'app/core/state/analysis.store.ts',
    );
  });

  test('the Usages tab is disabled for a language with no symbol index', async ({ page }) => {
    await loadLocoSrc(page);
    await openInAst(page, 'index.html');

    // index.html has no grammar at all, so the AST view never reaches the ready state
    // that renders the mode buttons.
    await expect(page.locator('loco-ast-view .placeholder')).toBeVisible();
    await expect(page.locator('loco-ast-view .mode')).toHaveCount(0);
  });
});
