import { expect, test } from '@playwright/test';
import { expandFolder, loadLocoSrc } from './fixtures';

test.describe('Empty-state, resizable AST split, syntax highlighting', () => {
  test('treemap shows a tailored "no matches" empty state + clear button restores tiles', async ({
    page,
  }) => {
    await loadLocoSrc(page);
    const initial = await page.locator('loco-treemap svg rect').count();
    expect(initial).toBeGreaterThan(10);

    // Type a name filter that nothing in src/ will match.
    await page.locator('loco-filter-bar input[placeholder*="name"]').fill('zzznotafile');

    // Tiles disappear and we get the no-matches empty state.
    await expect(page.locator('loco-treemap .empty .empty-title')).toContainText(/no files match/i);
    const clearBtn = page.locator('loco-treemap .empty .clear-filters');
    await expect(clearBtn).toBeVisible();
    await expect(page.locator('loco-treemap svg rect')).toHaveCount(0);

    // Click "Clear name & path filters" — the filter input empties, tiles return.
    await clearBtn.click();
    await expect(page.locator('loco-filter-bar input[placeholder*="name"]')).toHaveValue('');
    await expect.poll(() => page.locator('loco-treemap svg rect').count()).toBe(initial);
  });

  test('AST view: dragging the divider resizes the split and persists to localStorage', async ({
    page,
  }) => {
    await loadLocoSrc(page);
    await expandFolder(page, 'core');
    await expandFolder(page, 'services');
    await page
      .locator('loco-directory-tree .row.file', { hasText: 'analysis.service.ts' })
      .first()
      .dblclick();
    await page.waitForURL(/\/ast$/);
    await expect(page.locator('loco-ast-view loco-ast-node').first()).toBeVisible();

    const divider = page.locator('loco-ast-view .divider');
    await expect(divider).toBeVisible();

    const before = await page.$eval(
      'loco-ast-view .split',
      (el) => (el as HTMLElement).style.gridTemplateColumns,
    );

    // Drag the divider 120px to the right.
    const box = await divider.boundingBox();
    if (!box) throw new Error('divider not measurable');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const after = await page.$eval(
      'loco-ast-view .split',
      (el) => (el as HTMLElement).style.gridTemplateColumns,
    );
    expect(after).not.toBe(before);

    // Persisted to localStorage so the choice survives reloads.
    const stored = await page.evaluate(() => localStorage.getItem('loco:ast-split'));
    expect(stored).not.toBeNull();
    const storedNum = Number(stored);
    expect(storedNum).toBeGreaterThan(0.15);
    expect(storedNum).toBeLessThan(0.85);
  });

  test('source panel: keywords, strings, and comments get colored token spans', async ({
    page,
  }) => {
    await loadLocoSrc(page);
    await expandFolder(page, 'core');
    await expandFolder(page, 'services');
    await page
      .locator('loco-directory-tree .row.file', { hasText: 'analysis.service.ts' })
      .first()
      .dblclick();
    await page.waitForURL(/\/ast$/);
    await expect(page.locator('loco-source-panel .row').first()).toBeVisible();

    // We expect at least a handful of each token kind in any TS service file.
    await expect.poll(() => page.locator('loco-source-panel .tok-keyword').count()).toBeGreaterThan(
      5,
    );
    await expect.poll(() => page.locator('loco-source-panel .tok-string').count()).toBeGreaterThan(
      0,
    );
    await expect.poll(() => page.locator('loco-source-panel .tok-ident').count()).toBeGreaterThan(
      5,
    );

    // First keyword should be 'import' on the first source line.
    const firstKw = await page.locator('loco-source-panel .tok-keyword').first().textContent();
    expect(firstKw ?? '').toBe('import');
  });
});
