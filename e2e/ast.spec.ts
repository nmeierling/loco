import { expect, test } from '@playwright/test';
import { expandFolder, loadFixture, showAstTree } from './fixtures';

test.describe('AST view + source panel', () => {
  test('double-click a sidebar file opens the AST view with a source pane', async ({ page }) => {
    await loadFixture(page);
    await expandFolder(page, 'core');
    await expandFolder(page, 'services');

    await page
      .locator('loco-directory-tree .row.file', { hasText: 'catalog.service.ts' })
      .first()
      .dblclick();

    await expect(page.locator('loco-ast-view')).toBeVisible();
    await showAstTree(page);

    // Source panel renders lines
    await expect(page.locator('loco-source-panel .row').first()).toBeVisible();
    const firstLine = await page.locator('loco-source-panel .row .text').first().textContent();
    expect(firstLine ?? '').toContain('import');
  });

  test('clicking an AST node highlights the matching range in the source', async ({ page }) => {
    await loadFixture(page);
    await expandFolder(page, 'core');
    await expandFolder(page, 'services');
    await page
      .locator('loco-directory-tree .row.file', { hasText: 'catalog.service.ts' })
      .first()
      .dblclick();
    await expect(page.locator('loco-ast-view')).toBeVisible();
    await showAstTree(page);

    const classNode = page
      .locator('loco-ast-view loco-ast-node .row', { hasText: 'class_declaration' })
      .first();
    await classNode.waitFor();
    await classNode.click();

    await page.waitForTimeout(200);
    const highlighted = await page.locator('loco-source-panel .row.highlighted').count();
    expect(highlighted).toBeGreaterThan(5);
  });
});
