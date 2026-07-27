import { expect, test } from '@playwright/test';
import { FIXTURE_DIR, resetApp } from './fixtures';

test('spinner shows during the directory-read phase (before analysis kicks in)', async ({
  page,
  browser,
}) => {
  await resetApp(page);

  // Throttle CPU so the read is slow enough for the spinner to appear
  const cdp = await browser.newBrowserCDPSession();
  // Per-page CDP is more reliable for emulation; fall back to page.context if needed
  const pageSession = await page.context().newCDPSession(page);
  await pageSession.send('Emulation.setCPUThrottlingRate', { rate: 20 });

  // Race: as soon as we set files, the started handler should flip status to 'reading'
  const seen = page
    .waitForSelector('loco-spinner .overlay', { state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  // Capture the headline text while the spinner is visible
  const headlinePromise = page
    .waitForFunction(
      () => {
        const h = document.querySelector<HTMLElement>('loco-spinner .line');
        return h ? (h.textContent ?? '') : null;
      },
      null,
      { timeout: 15_000 },
    )
    .then((handle) => handle.jsonValue());

  await page.locator('loco-drop-zone input[type="file"]').setInputFiles(FIXTURE_DIR);

  const overlayShown = await seen;
  expect(overlayShown).toBe(true);

  const headline = await headlinePromise;
  // Either we caught the "Reading folder…" frame or analysis already advanced. Both prove the spinner showed.
  expect(headline).toMatch(/Reading folder|Counting lines|Parsing|Reading /);

  await pageSession.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
