import { Page, expect, test } from '@playwright/test';
import * as path from 'node:path';
import { resetApp } from './fixtures';

// A tiny, dedicated corpus (separate from sample-app so it can't shift tile counts):
// a long text file, a small JSON file, and a binary blob.
const PREVIEW_DIR = path.resolve(__dirname, 'fixtures-data', 'preview');

async function loadPreview(page: Page): Promise<void> {
  await resetApp(page);
  await page.locator('loco-drop-zone input[type="file"]').setInputFiles(PREVIEW_DIR);
  await expect(page.locator('loco-directory-tree .row.file').first()).toBeVisible();
}

async function openFile(page: Page, name: string): Promise<void> {
  await page.locator('loco-directory-tree .row.file', { hasText: name }).first().dblclick();
  await expect(page.locator('loco-ast-view')).toBeVisible();
}

test.describe('File preview + hex view', () => {
  test('a long text file paginates with a sticky preview bar', async ({ page }) => {
    await loadPreview(page);
    await openFile(page, 'big.txt');

    // Editor-only (no AST/Graph/Usages modes for a non-code file).
    await expect(page.locator('loco-source-panel')).toBeVisible();
    await expect(page.locator('loco-ast-view .modes')).toHaveCount(0);

    // Page 1: first 1500 of 2000 lines, bar is yellow.
    const bar = page.locator('loco-preview-bar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.label')).toContainText('1–1,500 of 2,000');
    await expect(bar.locator('.bar')).toHaveCSS('background-color', 'rgb(255, 224, 102)');
    await expect(bar.locator('.page')).toHaveText('1 / 2');
    expect(await page.locator('loco-source-panel .code .row').count()).toBe(1500);
    await expect(page.locator('loco-source-panel .code .row').first()).toContainText('line 0001');

    // "Last" jumps to the tail — the remaining 500 lines.
    await bar.locator('button', { hasText: 'Last' }).click();
    await expect(bar.locator('.label')).toContainText('1,501–2,000 of 2,000');
    await expect(bar.locator('.page')).toHaveText('2 / 2');
    expect(await page.locator('loco-source-panel .code .row').count()).toBe(500);
    await expect(page.locator('loco-source-panel .code .row').first()).toContainText('line 1501');

    // "First" returns to the top.
    await bar.locator('button', { hasText: 'First' }).click();
    await expect(bar.locator('.page')).toHaveText('1 / 2');
    await expect(page.locator('loco-source-panel .code .row').first()).toContainText('line 0001');
  });

  test('a short JSON file has no preview bar', async ({ page }) => {
    await loadPreview(page);
    await openFile(page, 'data.json');

    await expect(page.locator('loco-source-panel')).toBeVisible();
    await expect(page.locator('loco-ast-view .lang')).toHaveText('JSON');
    await expect(page.locator('loco-preview-bar')).toHaveCount(0);
    // Short file — every line is present.
    expect(await page.locator('loco-source-panel .code .row').count()).toBeGreaterThan(3);
  });

  test('a binary file opens in the hex view and paginates by bytes', async ({ page }) => {
    await loadPreview(page);
    await openFile(page, 'blob.bin');

    await expect(page.locator('loco-hex-panel')).toBeVisible();
    await expect(page.locator('loco-source-panel')).toHaveCount(0);
    await expect(page.locator('loco-ast-view .lang')).toHaveText('Binary');

    const bar = page.locator('loco-preview-bar');
    await expect(bar.locator('.label')).toContainText('bytes 1–24,000 of 40,000');
    // 24000 bytes / 16 per row = 1500 rows, first offset 0.
    expect(await page.locator('loco-hex-panel .row').count()).toBe(1500);
    await expect(page.locator('loco-hex-panel .row').first().locator('.off')).toHaveText(
      '00000000',
    );

    // Next page shows the remaining 16000 bytes, offsets continuing from 0x5dc0.
    await bar.locator('button', { hasText: 'Next' }).click();
    await expect(bar.locator('.label')).toContainText('24,001–40,000 of 40,000');
    expect(await page.locator('loco-hex-panel .row').count()).toBe(1000);
    await expect(page.locator('loco-hex-panel .row').first().locator('.off')).toHaveText(
      '00005dc0',
    );
  });

  test('an image file opens as a picture preview, not hex', async ({ page }) => {
    await loadPreview(page);
    await openFile(page, 'logo.png');

    await expect(page.locator('loco-image-panel')).toBeVisible();
    await expect(page.locator('loco-hex-panel')).toHaveCount(0);
    await expect(page.locator('loco-ast-view .lang')).toHaveText('Image');
    // The <img> is wired to a blob URL and actually decodes.
    const img = page.locator('loco-image-panel img');
    await expect(img).toBeVisible();
    await expect(img).toHaveJSProperty('naturalWidth', 1);
  });

  test('a shell script opens as code with an AST', async ({ page }) => {
    await loadPreview(page);
    await openFile(page, 'script.sh');

    // .sh has a grammar (bash), so it opens in the editor-left / AST-right split.
    await expect(page.locator('loco-ast-view .split')).toBeVisible();
    await expect(page.locator('loco-source-panel')).toBeVisible();
    await expect(page.locator('loco-ast-view .lang')).toHaveText('Shell');
  });
});

test.describe('Default AST mode', () => {
  test('a symbol-indexed file opens on the Usages tab by default', async ({ page }) => {
    await resetApp(page);
    const sampleApp = path.resolve(__dirname, 'fixtures-data', 'sample-app');
    await page.locator('loco-drop-zone input[type="file"]').setInputFiles(sampleApp);
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();

    await page.locator('loco-directory-tree .row.dir', { hasText: 'core' }).first().click();
    await page.locator('loco-directory-tree .row.dir', { hasText: 'services' }).first().click();
    await page
      .locator('loco-directory-tree .row.file', { hasText: 'catalog.service.ts' })
      .first()
      .dblclick();
    await expect(page.locator('loco-ast-view .split')).toBeVisible();

    // Usages is the active mode and its panel is showing, without any click.
    await expect(page.locator('loco-ast-view .mode.active')).toHaveText('Usages');
    await expect(page.locator('loco-usages-panel')).toBeVisible();
  });
});

test.describe('Editor / AST alignment', () => {
  test('the editor is left of the AST pane for a code file', async ({ page }) => {
    await resetApp(page);
    const sampleApp = path.resolve(__dirname, 'fixtures-data', 'sample-app');
    await page.locator('loco-drop-zone input[type="file"]').setInputFiles(sampleApp);
    await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();

    await page.locator('loco-directory-tree .row.dir', { hasText: 'core' }).first().click();
    await page.locator('loco-directory-tree .row.dir', { hasText: 'services' }).first().click();
    await page
      .locator('loco-directory-tree .row.file', { hasText: 'catalog.service.ts' })
      .first()
      .dblclick();
    await expect(page.locator('loco-ast-view .split')).toBeVisible();

    // The header carries the file's metrics next to its name.
    const stats = page.locator('loco-ast-view .stat');
    await expect(stats.filter({ hasText: 'LOC' })).toBeVisible();
    await expect(stats.filter({ hasText: 'Size' })).toBeVisible();

    // Default mode is Usages, so the right pane is the usages panel.
    const editorX = await page
      .locator('loco-ast-view loco-source-panel')
      .evaluate((el) => el.getBoundingClientRect().left);
    const rightX = await page
      .locator('loco-ast-view loco-usages-panel')
      .evaluate((el) => el.getBoundingClientRect().left);
    expect(editorX).toBeLessThan(rightX);
  });
});

test.describe('Whole-file search', () => {
  test('a scalar match shows only its line; an array/object opener shows context', async ({
    page,
  }) => {
    await loadPreview(page);
    await openFile(page, 'structured.json');
    const search = page.locator('loco-file-search');
    const input = search.locator('input');

    // A value line — just the one line.
    await input.fill('count');
    await expect(search.locator('.hit')).toHaveCount(1);
    await expect(search.locator('.hit .ctx')).toHaveCount(1);
    await expect(search.locator('.hit .ctx.match .mark')).toHaveText('count');

    // An array field name — the opener plus up to 3 following lines.
    await input.fill('items');
    await expect(search.locator('.hit')).toHaveCount(1);
    await expect(search.locator('.hit .ctx')).toHaveCount(4);
    await expect(search.locator('.hit .ctx').nth(1)).toContainText('alpha');
    await expect(search.locator('.hit .ctx').nth(3)).toContainText('gamma');
  });

  test('a hit expands ±5 from the first/last line-number cell on hover', async ({ page }) => {
    await loadPreview(page);
    await openFile(page, 'structured.json');
    const search = page.locator('loco-file-search');
    await search.locator('input').fill('count');
    await expect(search.locator('.hit .ctx')).toHaveCount(1);

    // The expand controls live in the line-number cell, revealed on hover.
    const num = search.locator('.hit .ctx').first().locator('.num');
    await num.hover();
    await num.locator('.exp', { hasText: '↓5' }).click();
    await expect(search.locator('.hit .ctx')).toHaveCount(6);
    await expect(search.locator('.hit .ctx').first()).toContainText('"count"');
  });

  test('results cap at 50 per page, show total + "+N more", and paginate', async ({ page }) => {
    await loadPreview(page);
    await openFile(page, 'big.txt');
    const search = page.locator('loco-file-search');
    // "line 0" matches lines 0001–0999.
    await search.locator('input').fill('line 0');

    // Total hits sit before the pagination stats, in a bar below the search input.
    await expect(search.locator('.pagerbar .total')).toHaveText('999 hits');
    await expect(search.locator('.pagerbar .stats')).toContainText('1–50 of 999');
    await expect(search.locator('.hit')).toHaveCount(50);
    // A 51st row hints at the remaining hits and pages forward when clicked.
    await expect(search.locator('.more')).toHaveText('+ 949 more');

    await search.locator('.more').click();
    await expect(search.locator('.pagerbar .stats')).toContainText('51–100 of 999');
    await expect(search.locator('.more')).toHaveText('+ 899 more');
  });

  test('clicking a hit opens the editor at that line, paging if needed', async ({ page }) => {
    await loadPreview(page);
    await openFile(page, 'big.txt');
    const search = page.locator('loco-file-search');
    await search.locator('input').fill('line 1600');
    await expect(search.locator('.hit')).toHaveCount(1);
    await search.locator('.hit .ctx .text').first().click();

    // Search closes, the editor pages to line 1600 and highlights it.
    await expect(page.locator('loco-file-search .results')).toHaveCount(0);
    await expect(page.locator('loco-preview-bar .page')).toHaveText('2 / 2');
    await expect(page.locator('loco-source-panel .row.highlighted')).toContainText('line 1600');
  });
});
