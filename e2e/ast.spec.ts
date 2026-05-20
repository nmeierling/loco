import { expect, test } from '@playwright/test';
import { expandFolder, loadLocoSrc } from './fixtures';

test.describe('AST view + source panel + call graph', () => {
  test('double-click a sidebar file opens the AST view with a source pane', async ({ page }) => {
    await loadLocoSrc(page);
    await expandFolder(page, 'core');
    await expandFolder(page, 'services');

    await page
      .locator('loco-directory-tree .row.file', { hasText: 'analysis.service.ts' })
      .first()
      .dblclick();

    await page.waitForURL(/\/ast$/);
    await expect(page.locator('loco-ast-view loco-ast-node').first()).toBeVisible();

    // Source panel renders lines
    await expect(page.locator('loco-source-panel .row').first()).toBeVisible();
    const firstLine = await page.locator('loco-source-panel .row .text').first().textContent();
    expect(firstLine ?? '').toContain('import');
  });

  test('clicking an AST node highlights the matching range in the source', async ({ page }) => {
    await loadLocoSrc(page);
    await expandFolder(page, 'core');
    await expandFolder(page, 'services');
    await page
      .locator('loco-directory-tree .row.file', { hasText: 'analysis.service.ts' })
      .first()
      .dblclick();
    await page.waitForURL(/\/ast$/);

    const classNode = page
      .locator('loco-ast-view loco-ast-node .row', { hasText: 'class_declaration' })
      .first();
    await classNode.waitFor();
    await classNode.click();

    await page.waitForTimeout(200);
    const highlighted = await page.locator('loco-source-panel .row.highlighted').count();
    expect(highlighted).toBeGreaterThan(5);
  });

  test('Calls toggle renders a per-file call graph for a TS file', async ({ page }) => {
    await loadLocoSrc(page);
    await expandFolder(page, 'core');
    await expandFolder(page, 'services');
    await page
      .locator('loco-directory-tree .row.file', { hasText: 'analysis.service.ts' })
      .first()
      .dblclick();
    await page.waitForURL(/\/ast$/);

    const callsBtn = page.locator('loco-ast-view .mode', { hasText: 'Calls' });
    await expect(callsBtn).toBeEnabled();
    await callsBtn.click();

    await expect(page.locator('loco-call-graph svg circle').first()).toBeVisible({ timeout: 10_000 });
    const count = await page.locator('loco-call-graph svg circle').count();
    expect(count).toBeGreaterThan(0);
  });
});
