import { Page, expect } from '@playwright/test';
import * as path from 'node:path';

/**
 * The corpus every spec analyses. It is a checked-in fake project rather than loco's
 * own `src/`, so adding a file to this repo cannot silently change tile counts, graph
 * layout or usage totals. See its README for the shape the specs depend on.
 */
export const FIXTURE_DIR = path.resolve(__dirname, 'fixtures-data', 'sample-app');

/** Folder name the app shows once the fixture is loaded. */
export const FIXTURE_ROOT_NAME = 'sample-app';

/**
 * Wipes every scrap of persisted state and lands on the folder picker. The session
 * cache lives in IndexedDB, so clearing localStorage alone would restore the previous
 * test's project.
 */
export async function resetApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('loco-session');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
  await page.reload();
  await page.waitForSelector('loco-drop-zone');
}

/** Loads the fixture project via the webkitdirectory input and waits until it settles. */
export async function loadFixture(page: Page): Promise<void> {
  await resetApp(page);

  const input = page.locator('loco-drop-zone input[type="file"]');
  await input.setInputFiles(FIXTURE_DIR);

  // The treemap is the default viz; the spinner clears once analysis finishes.
  await page.waitForSelector('loco-treemap svg');
  await page.waitForSelector('loco-spinner .overlay', { state: 'hidden' }).catch(() => undefined);
  await expect(page.locator('loco-treemap svg rect').first()).toBeVisible();
}

/** Switches the active viz via the filter bar chip. */
export async function selectViz(page: Page, label: string): Promise<void> {
  await page.locator('loco-filter-bar .chip', { hasText: label }).click();
}

/** Expands a directory tree row by its visible name (climbs the chevron if collapsed). */
export async function expandFolder(page: Page, name: string): Promise<void> {
  const row = page.locator('loco-directory-tree .row.dir', { hasText: name }).first();
  await row.waitFor();
  const chev = (await row.locator('.chev').textContent()) ?? '';
  if (chev.includes('▸')) {
    await row.click();
  }
}

/**
 * Opens a fixture file in a new AST tab through the list viz, narrowing with the
 * toolbar's name filter — the list has no filter box of its own. Double-clicking a file
 * opens (or focuses) a tab rather than navigating a route.
 */
export async function openInAst(page: Page, nameFragment: string): Promise<void> {
  await selectViz(page, 'List');
  const nameFilter = page.locator('loco-filter-bar input[placeholder*="name"]');
  await nameFilter.fill(nameFragment);
  await page.locator('loco-metric-list .row').first().dblclick();
  await expect(page.locator('loco-ast-view')).toBeVisible();
  // Leave the corpus intact for whatever the test does next.
  await nameFilter.fill('');
}

/** Activates the permanent heatmap tab. */
export async function showHeatmap(page: Page): Promise<void> {
  await page.locator('header.head .tab', { hasText: 'heatmap' }).click();
}

/**
 * Switches an open code file's right pane to the AST Tree. Symbol-indexed files now open
 * on the Usages tab by default, so tree-focused specs opt in explicitly.
 */
export async function showAstTree(page: Page): Promise<void> {
  await page.locator('loco-ast-view .mode', { hasText: 'Tree' }).click();
  await expect(page.locator('loco-ast-view loco-ast-node').first()).toBeVisible();
}
