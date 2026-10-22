// Interaction-level measurements: average frame time while panning the isometric view,
// main-thread blocking while typing a filter, and whether the dep matrix survives
// switching to per-file level on a 3000-file project.
// Usage: node scripts/bench-interaction.mjs [label] [projectDir] [port]
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

const report = (name, value) => console.log(`${LABEL}\t${name}\t${value}`);

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
await page.locator('loco-drop-zone input[type="file"]').setInputFiles(PROJECT);
await page.waitForSelector('loco-treemap svg rect', { timeout: 600_000 });
await page
  .waitForSelector('loco-spinner .overlay', { state: 'hidden', timeout: 600_000 })
  .catch(() => undefined);

const viz = async (label) => page.locator('loco-viz-switcher .tab', { hasText: label }).click();

// --- isometric pan: average frame time over 60 rAF-paced drag steps ---------
await viz('Isometric');
await page.waitForSelector('loco-isometric svg polygon', { timeout: 600_000 });
await page.waitForTimeout(1500);

const panMs = await page.evaluate(async () => {
  const svg = document.querySelector('loco-isometric svg');
  if (!svg) return -1;
  const r = svg.getBoundingClientRect();
  const at = (x, y, type, extra = {}) =>
    svg.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        clientX: r.left + x,
        clientY: r.top + y,
        button: 0,
        ...extra,
      }),
    );
  const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
  at(600, 400, 'mousedown');
  await frame();
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) {
    at(600 + i * 2, 400 + i, 'mousemove');
    await frame();
  }
  const t1 = performance.now();
  at(700, 460, 'mouseup');
  return (t1 - t0) / 60;
});
report('iso-pan-avg-frame-ms', panMs.toFixed(1));

// --- filter typing: total long-task time while typing 6 characters ----------
await viz('List');
await page.waitForSelector('loco-metric-list .row', { timeout: 300_000 });
const n = await page.locator('loco-file-browser input[placeholder*="name"]').count();
if (n === 0) await page.locator('loco-file-browser button[aria-label="Filter files"]').click();

await page.evaluate(() => {
  window.__blocking = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__blocking += Math.max(0, e.duration - 50);
  });
  obs.observe({ entryTypes: ['longtask'] });
});
const input = page.locator('loco-file-browser input[placeholder*="name"]');
await input.pressSequentially('mod123', { delay: 120 });
await page.waitForTimeout(1500);
const blocking = await page.evaluate(() => window.__blocking);
report('filter-typing-blocking-ms', Math.round(blocking));
await input.fill('');
await page.waitForTimeout(800);

// --- dep matrix at file level on 3000 files ---------------------------------
await viz('Dep matrix');
await page.waitForSelector(
  'loco-dependency-matrix .count, loco-dependency-matrix .status-overlay',
  {
    timeout: 600_000,
  },
);
const start = Date.now();
let filesModeMs = 'TIMEOUT>30000';
try {
  await page.locator('loco-dependency-matrix .chip', { hasText: 'Files' }).click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('loco-dependency-matrix');
      if (!el) return false;
      // Either the grid rendered, or the view told us it refuses this many rows.
      return (
        !!el.querySelector('g.row-labels text') || /neither readable/.test(el.textContent ?? '')
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  filesModeMs = String(Date.now() - start);
} catch {
  // leave the TIMEOUT marker
}
report('dep-matrix-files-mode-ms', filesModeMs);
const rectCount = await page
  .locator('loco-dependency-matrix svg rect')
  .count()
  .catch(() => -1);
report('dep-matrix-files-mode-rects', rectCount);

await browser.close();
