import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const KOTLIN_DIR = path.resolve(__dirname, 'fixtures-data', 'kotlin');

test.describe('Module graph — Kotlin support', () => {
  test('builds a connected graph from .kt files (class import + multi-class file + top-level fn)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('loco-drop-zone');
    await page.locator('loco-drop-zone input[type="file"]').setInputFiles(KOTLIN_DIR);
    await page.waitForSelector('loco-treemap svg', { timeout: 30_000 });
    await page
      .waitForSelector('loco-spinner .overlay', { state: 'hidden', timeout: 60_000 })
      .catch(() => undefined);

    // Switch to module graph
    await page.locator('loco-filter-bar .chip', { hasText: 'Module graph' }).click();
    await page.waitForSelector('loco-module-graph svg circle', { timeout: 60_000 });

    const nodeLabels = await page.$$eval(
      'loco-module-graph svg .node text',
      (els) => els.map((e) => e.textContent?.trim() ?? ''),
    );
    expect(nodeLabels).toEqual(
      expect.arrayContaining(['Foo.kt', 'Bar.kt', 'Utils.kt', 'Models.kt', 'UseModels.kt']),
    );

    // We expect at least 3 resolved edges:
    //   Bar.kt -> Foo.kt          (class import)
    //   Bar.kt -> Utils.kt        (single-file-in-package fallback for parseInt)
    //   UseModels.kt -> Models.kt (two class imports collapse to one edge)
    const edgeCount = await page.locator('loco-module-graph svg .links line').count();
    expect(edgeCount).toBeGreaterThanOrEqual(3);
  });
});
