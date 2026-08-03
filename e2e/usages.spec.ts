import { expect, test } from '@playwright/test';
import { loadFixture, openInAst } from './fixtures';

test.describe('AST usages panel', () => {
  test('lists the symbols a file declares with their repo-wide usage counts', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'catalog.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();

    const rows = page.locator('loco-usages-panel .sym-head');
    await expect(rows.first()).toBeVisible();

    // The store class itself is imported all over the app.
    const classRow = rows.filter({ hasText: 'CatalogStore' }).first();
    await expect(classRow).toContainText(/\d+ in \d+ files/);

    // Its methods are listed as members and are used outside this file.
    const method = rows.filter({ hasText: 'selectProduct' }).first();
    await expect(method).toContainText('method');
    await expect(method).toContainText(/\d+ in \d+ files/);
  });

  test('expanding a symbol shows call sites grouped by file', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'catalog.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();
    await expect(page.locator('loco-usages-panel .sym-head').first()).toBeVisible();

    await page.locator('loco-usages-panel .sym-head', { hasText: 'selectProduct' }).first().click();

    const refs = page.locator('loco-usages-panel .ref');
    await expect(refs.first()).toBeVisible();
    expect(await refs.count()).toBeGreaterThan(2);

    // Usages come from more than one file, and each carries its source line.
    const files = await page.locator('loco-usages-panel .ref-path').allTextContents();
    expect(new Set(files).size).toBeGreaterThan(1);
    await expect(refs.first().locator('code')).toContainText('selectProduct');
  });

  test('clicking a usage opens that file and highlights the line', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'catalog.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();
    await expect(page.locator('loco-usages-panel .sym-head').first()).toBeVisible();
    await page.locator('loco-usages-panel .sym-head', { hasText: 'selectProduct' }).first().click();

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
    await loadFixture(page);
    await openInAst(page, 'cart.component');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();
    await expect(page.locator('loco-usages-panel .sym-head').first()).toBeVisible();

    await page.locator('loco-usages-panel .tabs button', { hasText: 'Uses' }).click();

    const rows = page.locator('loco-usages-panel .sym-head');
    await expect(rows.first()).toBeVisible();
    // It injects CatalogStore, so the store and the methods it calls show up here.
    await expect(rows.filter({ hasText: 'CatalogStore' }).first()).toBeVisible();
    await expect(rows.filter({ hasText: 'CatalogStore' }).first()).toContainText(
      'app/core/state/catalog.store.ts',
    );
  });

  test('identifiers in the source pane link to their declaration', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'cart.component');

    const links = page.locator('loco-source-panel .tok.link');
    await expect(links.first()).toBeVisible();
    // The imported store and the method called on it are both resolved.
    await expect(links.filter({ hasText: 'CatalogStore' }).first()).toBeVisible();

    const target = links.filter({ hasText: 'selectProduct' }).first();
    await expect(target).toHaveAttribute('title', /catalog\.store\.ts:\d+/);
    await target.click();

    await expect(page.locator('loco-ast-view .path')).toHaveText('app/core/state/catalog.store.ts');
    // Landed on the declaration itself, not just the file.
    const highlighted = page.locator('loco-source-panel .row.highlighted');
    await expect(highlighted.first()).toBeVisible();
    await expect(highlighted.first()).toContainText('selectProduct');
  });

  test('the impact tab walks outwards through callers', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'catalog.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();
    await page.locator('loco-usages-panel .sym-head', { hasText: 'selectProduct' }).first().click();
    await page.locator('loco-usages-panel .submodes button', { hasText: 'Impact' }).click();

    // First level: the methods that call it.
    const callers = page.locator('loco-usages-panel .caller-head');
    await expect(callers.first()).toBeVisible();
    const firstLevel = await callers.count();
    expect(firstLevel).toBeGreaterThan(3);
    await expect(callers.filter({ hasText: 'CheckoutComponent.confirm' })).toHaveCount(1);

    // Second level: bootstrap reaches selectProduct through confirm().
    await page
      .locator('loco-usages-panel .caller-row', { hasText: 'CheckoutComponent.confirm' })
      .locator('.chev-btn')
      .click();
    await expect.poll(() => callers.count()).toBeGreaterThan(firstLevel);
    await expect(callers.filter({ hasText: 'bootstrap' }).first()).toBeVisible();

    // Clicking a caller navigates to it.
    await callers.filter({ hasText: 'bootstrap' }).first().click();
    await expect(page.locator('loco-ast-view .path')).toHaveText('app/app.ts');
  });

  test('a file with no grammar opens as an editor-only preview, no mode buttons', async ({
    page,
  }) => {
    await loadFixture(page);
    await openInAst(page, 'index.html');

    // index.html has no grammar, so there is no AST/Graph/Usages — just the editor.
    await expect(page.locator('loco-ast-view loco-source-panel')).toBeVisible();
    await expect(page.locator('loco-ast-view .mode')).toHaveCount(0);
    await expect(page.locator('loco-ast-view .split')).toHaveCount(0);
  });
});
