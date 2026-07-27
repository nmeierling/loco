import { Page, expect, test } from '@playwright/test';
import { loadFixture, selectViz } from './fixtures';

/** Numeric text of the nth cell of each rendered row (commas stripped, em-dash → null). */
async function columnValues(page: Page, cellIndex: number): Promise<(number | null)[]> {
  return page.$$eval(
    `loco-metric-list .row`,
    (rows, idx) =>
      rows.map((r) => {
        const cell = r.querySelectorAll('.td')[idx as number];
        const text = (cell?.textContent ?? '').trim().replace(/,/g, '');
        return text === '—' || text === '' ? null : Number(text);
      }),
    cellIndex,
  );
}

/** Column order without churn (src/ has no .git): File, Folder, Lang, LOC, Complexity. */
const LOC_COL = 3;
const COMPLEXITY_COL = 4;

test.describe('Metric list viz', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixture(page);
    await selectViz(page, 'List');
    await expect(page.locator('loco-metric-list .row').first()).toBeVisible();
  });

  test('defaults to the toolbar metric, ranked descending', async ({ page }) => {
    const header = page.locator('loco-metric-list .th', { hasText: 'LOC' });
    await expect(header).toHaveAttribute('aria-sort', 'descending');

    const loc = (await columnValues(page, LOC_COL)).filter((v): v is number => v !== null);
    expect(loc.length).toBeGreaterThan(5);
    for (let i = 1; i < loc.length; i++) expect(loc[i]).toBeLessThanOrEqual(loc[i - 1]);
  });

  test('clicking a metric header sorts by it, and again reverses the order', async ({ page }) => {
    const header = page.locator('loco-metric-list .th', { hasText: 'Complexity' });
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');

    const desc = (await columnValues(page, COMPLEXITY_COL)).filter((v): v is number => v !== null);
    expect(desc.length).toBeGreaterThan(5);
    for (let i = 1; i < desc.length; i++) expect(desc[i]).toBeLessThanOrEqual(desc[i - 1]);

    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');

    const asc = (await columnValues(page, COMPLEXITY_COL)).filter((v): v is number => v !== null);
    for (let i = 1; i < asc.length; i++) expect(asc[i]).toBeGreaterThanOrEqual(asc[i - 1]);
    expect(asc[0]).toBeLessThanOrEqual(desc[0]);
  });

  test('the row filter narrows the list to matching paths', async ({ page }) => {
    const before = await page.locator('loco-metric-list .row').count();

    await page.locator('loco-metric-list .search').fill('worker');
    await expect(page.locator('loco-metric-list .row').first()).toBeVisible();

    const after = await page.locator('loco-metric-list .row').count();
    expect(after).toBeLessThan(before);

    const paths = await page.$$eval('loco-metric-list .row', (rows) =>
      rows.map((r) => r.getAttribute('title') ?? ''),
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p.toLowerCase()).toContain('worker');
  });

  test('a per-metric minimum drops every row below the threshold', async ({ page }) => {
    const minLoc = page.locator('loco-metric-list .pick', { hasText: 'min loc' }).locator('input');
    await minLoc.fill('50');
    await expect(page.locator('loco-metric-list .row').first()).toBeVisible();

    const loc = await columnValues(page, LOC_COL);
    expect(loc.length).toBeGreaterThan(0);
    for (const v of loc) {
      expect(v).not.toBeNull();
      expect(v as number).toBeGreaterThanOrEqual(50);
    }

    // An impossible threshold yields the dedicated empty state, not a blank table.
    await minLoc.fill('99999999');
    await expect(page.locator('loco-metric-list .empty-title')).toContainText('No rows match');
    await page.locator('loco-metric-list .clear-filters').click();
    await expect(page.locator('loco-metric-list .row').first()).toBeVisible();
  });

  test('double-clicking a row opens that file in the AST view', async ({ page }) => {
    const row = page.locator('loco-metric-list .row').first();
    const path = await row.getAttribute('title');
    await row.dblclick();

    await page.waitForURL(/\/ast$/);
    await expect(page.locator('loco-ast-view loco-ast-node').first()).toBeVisible();
    expect(path).toBeTruthy();
  });
});
