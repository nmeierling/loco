import { expect, test } from '@playwright/test';

test('cancelling the file picker resets the spinner instead of leaving it stuck', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('loco-drop-zone');

  // Pre-register a filechooser handler so Playwright doesn't hang on the programmatic
  // input.click() inside our openPicker. The handler just keeps a reference; we don't
  // call setFiles because we want to test the cancel path.
  page.on('filechooser', () => undefined);

  // Click "choose a folder" — fires the started event before opening the picker.
  await page.locator('loco-drop-zone .link').click({ noWaitAfter: true });

  // Spinner becomes visible (because started.emit set status to 'reading')
  await expect(page.locator('loco-spinner .overlay')).toBeVisible();

  // Simulate the user dismissing the picker
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('loco-drop-zone input[type="file"]');
    input?.dispatchEvent(new Event('cancel'));
  });

  // Spinner goes away
  await expect(page.locator('loco-spinner .overlay')).toBeHidden();
  await expect(page.locator('loco-drop-zone')).toBeVisible();
});
