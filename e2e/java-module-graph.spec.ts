import { resetApp } from './fixtures';
import { expect, test } from '@playwright/test';
import * as path from 'node:path';

const JAVA_DIR = path.resolve(__dirname, 'fixtures-data', 'java');

test.describe('Module graph — Java support', () => {
  test('builds a connected graph from .java files (class import + static + multi-class file)', async ({
    page,
  }) => {
    await resetApp(page);
    await page.locator('loco-drop-zone input[type="file"]').setInputFiles(JAVA_DIR);
    await page.waitForSelector('loco-treemap svg');
    await page.waitForSelector('loco-spinner .overlay', { state: 'hidden' }).catch(() => undefined);

    await page.locator('loco-filter-bar .chip', { hasText: 'Module graph' }).click();
    await page.waitForSelector('loco-module-graph svg circle');

    const nodeLabels = await page.$$eval('loco-module-graph svg .node text', (els) =>
      els.map((e) => e.textContent?.trim() ?? ''),
    );
    expect(nodeLabels).toEqual(
      expect.arrayContaining([
        'Foo.java',
        'Bar.java',
        'Utils.java',
        'Models.java',
        'UseModels.java',
      ]),
    );

    // Bar.java -> Foo.java (class import) + Bar.java -> Utils.java (static import walked up)
    // + UseModels.java -> Models.java (one or two imports collapse).
    const edgeCount = await page.locator('loco-module-graph svg .links line').count();
    expect(edgeCount).toBeGreaterThanOrEqual(3);
  });
});
