// Drives the running dev server against a synthetic 3000-file project and reports
// wall-clock for the load pipeline and for the per-view layouts.
// Usage: node scripts/bench.mjs [label] [projectDir] [port]
import { chromium } from 'playwright';

const LABEL = process.argv[2] ?? 'run';
const PROJECT = process.argv[3] ?? '/tmp/bigproj';
const PORT = process.argv[4] ?? '4321';

// CHROMIUM_PATH is only needed where Playwright's own download isn't resolvable
// (the Linux dev sandbox); locally, leaving it unset picks the installed browser.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CHROMIUM_PATH ? ['--no-sandbox'] : [],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const t = async (name, fn) => {
  const start = Date.now();
  await fn();
  const ms = Date.now() - start;
  console.log(`${LABEL}\t${name}\t${ms}`);
  return ms;
};

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('loco-session');
    req.onsuccess = req.onerror = req.onblocked = () => r();
  });
});
await page.reload();
await page.waitForSelector('loco-drop-zone');

await t('analyze+treemap', async () => {
  await page.locator('loco-drop-zone input[type="file"]').setInputFiles(PROJECT);
  await page.waitForSelector('loco-treemap svg rect', { timeout: 600_000 });
  await page
    .waitForSelector('loco-spinner .overlay', { state: 'hidden', timeout: 600_000 })
    .catch(() => undefined);
});

const viz = async (label) => page.locator('loco-viz-switcher .tab', { hasText: label }).click();

await t('list-view', async () => {
  await viz('List');
  await page.waitForSelector('loco-metric-list .row', { timeout: 300_000 });
  await page
    .waitForSelector('loco-metric-list loco-view-spinner', { state: 'hidden', timeout: 300_000 })
    .catch(() => undefined);
});

await t('list-sort-click', async () => {
  await page.locator('loco-metric-list .th', { hasText: 'Complexity' }).click();
  await page
    .waitForSelector('loco-metric-list loco-view-spinner', { state: 'hidden', timeout: 300_000 })
    .catch(() => undefined);
  await page.waitForTimeout(50);
});

await t('name-filter-typing', async () => {
  const n = await page.locator('loco-file-browser input[placeholder*="name"]').count();
  if (n === 0) await page.locator('loco-file-browser button[aria-label="Filter files"]').click();
  const input = page.locator('loco-file-browser input[placeholder*="name"]');
  await input.pressSequentially('mod12', { delay: 30 });
  await page
    .waitForSelector('loco-metric-list loco-view-spinner', { state: 'hidden', timeout: 300_000 })
    .catch(() => undefined);
  await input.fill('');
  await page
    .waitForSelector('loco-metric-list loco-view-spinner', { state: 'hidden', timeout: 300_000 })
    .catch(() => undefined);
});

await t('dep-matrix', async () => {
  await viz('Dep matrix');
  await page.waitForSelector('loco-dependency-matrix .count', { timeout: 600_000 });
});

await t('symbols-index', async () => {
  await viz('Symbols');
  await page.waitForSelector('loco-symbols-viz .list, loco-symbols-viz .empty .title', {
    timeout: 600_000,
  });
  await page.waitForFunction(
    () => !document.querySelector('loco-symbols-viz')?.textContent?.includes('Indexing symbols'),
    undefined,
    { timeout: 600_000 },
  );
});

await t('isometric', async () => {
  await viz('Isometric');
  await page.waitForSelector('loco-isometric svg polygon', { timeout: 600_000 });
  await page
    .waitForSelector('loco-isometric loco-view-spinner', { state: 'hidden', timeout: 600_000 })
    .catch(() => undefined);
});

await t('isometric-pan-30-frames', async () => {
  const box = await page.locator('loco-isometric svg').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + i * 2);
  }
  await page.mouse.up();
});

await t('module-graph', async () => {
  await viz('Module graph');
  await page.waitForSelector('loco-module-graph svg circle', { timeout: 600_000 });
});

await browser.close();
