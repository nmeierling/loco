import { Page, expect } from '@playwright/test';
import * as path from 'node:path';

/** Path to the project's own src/ directory — used as a stable test corpus. */
export const SRC_DIR = path.resolve(__dirname, '..', 'src');

/** Loads the loco src/ folder via the webkitdirectory input and waits until analysis settles. */
export async function loadLocoSrc(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('loco-drop-zone');

  const input = page.locator('loco-drop-zone input[type="file"]');
  await input.setInputFiles(SRC_DIR);

  // Wait for the treemap to render (default viz) and any spinner to dismiss
  await page.waitForSelector('loco-treemap svg', { timeout: 30_000 });
  await page
    .waitForSelector('loco-spinner .overlay', { state: 'hidden', timeout: 60_000 })
    .catch(() => undefined);
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
