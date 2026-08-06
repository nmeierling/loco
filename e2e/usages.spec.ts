import { expect, test } from '@playwright/test';
import { loadFixture, openInAst } from './fixtures';

test.describe('AST usages panel', () => {
  test('the Incoming tab groups outside classes by which of this file they use', async ({
    page,
  }) => {
    await loadFixture(page);
    await openInAst(page, 'catalog.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();

    // Incoming is the default direction.
    await expect(page.locator('loco-usages-panel .tabs button.active')).toContainText('Incoming');

    const groups = page.locator('loco-usages-panel .grp-head');
    await expect(groups.first()).toBeVisible();

    // CartComponent calls the store, so it shows up as an incoming class with a count.
    const cart = groups.filter({ hasText: 'CartComponent' }).first();
    await expect(cart).toBeVisible();
    await expect(cart).toContainText('app/ui/cart.component.ts');
    await expect(cart).toContainText(/\d+×/);

    // Expanding it lists which of this file's members it uses — selectProduct among them.
    await cart.click();
    const members = page.locator('loco-usages-panel .grp .mem-head');
    await expect(members.filter({ hasText: 'selectProduct' }).first()).toBeVisible();
  });

  test('expanding an incoming member shows the external call sites and navigates', async ({
    page,
  }) => {
    await loadFixture(page);
    await openInAst(page, 'catalog.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();

    await page.locator('loco-usages-panel .grp-head', { hasText: 'CartComponent' }).first().click();
    await page
      .locator('loco-usages-panel .mem-head', { hasText: 'selectProduct' })
      .first()
      .click();

    const refs = page.locator('loco-usages-panel .ref');
    await expect(refs.first()).toBeVisible();
    await expect(refs.first().locator('code')).toContainText('selectProduct');

    // Clicking a usage opens the calling file and highlights the exact line.
    const before = await page.locator('loco-ast-view:visible .path').textContent();
    const lineNo = (await refs.first().locator('.ref-line').textContent())?.trim();
    await refs.first().click();

    await expect
      .poll(() => page.locator('loco-ast-view:visible .path').textContent())
      .not.toBe(before);
    const highlighted = page.locator('loco-ast-view:visible loco-source-panel .row.highlighted');
    await expect(highlighted.first()).toBeVisible();
    const num = await highlighted.first().locator('.num').textContent();
    expect(num?.trim()).toBe(lineNo);
  });

  test('the Outgoing tab groups the classes this file depends on', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'cart.component');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();

    await page.locator('loco-usages-panel .tabs button', { hasText: 'Outgoing' }).click();

    const groups = page.locator('loco-usages-panel .grp-head');
    await expect(groups.first()).toBeVisible();

    // It injects CatalogStore, so the store is an outgoing class carrying its own file path.
    const store = groups.filter({ hasText: 'CatalogStore' }).first();
    await expect(store).toBeVisible();
    await expect(store).toContainText('app/core/state/catalog.store.ts');

    // The members it calls are listed, and each expands to sites inside this file.
    await store.click();
    const method = page.locator('loco-usages-panel .mem-head', { hasText: 'selectProduct' }).first();
    await expect(method).toBeVisible();
    await method.click();
    const refs = page.locator('loco-usages-panel .ref');
    await expect(refs.filter({ hasText: 'selectProduct' }).first()).toBeVisible();
  });

  test('the External tab groups third-party dependencies by module', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'cart.component');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();

    await page.locator('loco-usages-panel .tabs button', { hasText: 'External' }).click();

    // cart.component imports Subject from rxjs — the one out-of-repo dependency.
    const dep = page.locator('loco-usages-panel .grp-head', { hasText: 'rxjs' }).first();
    await expect(dep).toBeVisible();
    await expect(dep).toContainText(/\d+×/);

    await dep.click();
    const member = page.locator('loco-usages-panel .mem-head', { hasText: 'Subject' }).first();
    await expect(member).toBeVisible();

    // Its usage sites (the import and the `new Subject()`) are listed and jump within the file.
    await member.click();
    await expect(page.locator('loco-usages-panel .ref').first()).toBeVisible();
  });

  test('the Self tab ranks a file’s members by how often it uses them itself', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'catalog.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();

    await page.locator('loco-usages-panel .tabs button', { hasText: 'Self' }).click();

    const rows = page.locator('loco-usages-panel .sym-head');
    await expect(rows.first()).toBeVisible();

    // The private `products` field is read from many methods, so it ranks near the top.
    await expect(rows.filter({ hasText: 'products' }).first()).toBeVisible();

    // Counts are non-increasing down the list.
    const counts = await page
      .locator('loco-usages-panel .sym-head .badge')
      .allTextContents();
    const nums = counts.map((c) => Number(c.replace(/[^\d]/g, '')));
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeLessThanOrEqual(nums[i - 1]);

    // Expanding a member shows its in-file references.
    await rows.filter({ hasText: 'products' }).first().click();
    await expect(page.locator('loco-usages-panel .ref').first()).toBeVisible();
  });

  test('a wildcard ignore pattern removes those files from the usages', async ({ page }) => {
    await loadFixture(page);
    await openInAst(page, 'catalog.store');
    await page.locator('loco-ast-view .mode', { hasText: 'Usages' }).click();

    const groups = page.locator('loco-usages-panel .grp-head');
    await expect(groups.filter({ hasText: 'CartComponent' }).first()).toBeVisible();

    // Ignore the whole ui/ folder with a path glob — the components living there should
    // drop out of the incoming list, proving usages honour the (wildcard) ignore list.
    const ignore = page.locator('loco-ignore-panel .input');
    await ignore.fill('**/ui/**');
    await page.locator('loco-ignore-panel .add-btn').click();

    await expect(groups.filter({ hasText: 'CartComponent' })).toHaveCount(0);
    await expect(groups.filter({ hasText: 'CheckoutComponent' })).toHaveCount(0);
    // A class outside the ignored folder still shows.
    await expect(groups.filter({ hasText: 'CatalogService' }).first()).toBeVisible();
  });

  test('the tabs stay visible within the pane when it is narrow', async ({ page }) => {
    await page.setViewportSize({ width: 940, height: 800 });
    await loadFixture(page);
    // A TS file opens on the Usages tab by default, so the panel is already showing.
    await openInAst(page, 'catalog.store');
    await expect(page.locator('loco-usages-panel .tabs button').first()).toBeVisible();

    const panel = (await page.locator('loco-usages-panel').boundingBox())!;
    const sidebar = (await page.locator('loco-shell .sidebar.right').boundingBox())!;
    // The panel must not spill under the Ignore sidebar.
    expect(panel.x + panel.width).toBeLessThanOrEqual(sidebar.x + 1);

    // All four tabs are present and each sits fully inside the panel (wrapping as needed),
    // never clipped behind the sidebar.
    const btns = page.locator('loco-usages-panel .tabs button');
    await expect(btns).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(btns.nth(i)).toBeVisible();
      const bb = (await btns.nth(i).boundingBox())!;
      expect(bb.x + bb.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    }
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

    await expect(page.locator('loco-ast-view:visible .path')).toHaveText(
      'app/core/state/catalog.store.ts',
    );
    // Landed on the declaration itself, not just the file.
    const highlighted = page.locator('loco-ast-view:visible loco-source-panel .row.highlighted');
    await expect(highlighted.first()).toBeVisible();
    await expect(highlighted.first()).toContainText('selectProduct');
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
