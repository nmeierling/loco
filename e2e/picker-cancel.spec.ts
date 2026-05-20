import { expect, test } from '@playwright/test';

test('cancelling the file picker resets the spinner instead of leaving it stuck', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('loco-drop-zone');

  // Pretend the FS Access API isn't there so the webkitdirectory path is exercised.
  // (Cancel via that path is fully driven by the input's `cancel` event, which we can dispatch.)
  await page.evaluate(() => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
  await page.reload();
  await page.waitForSelector('loco-drop-zone');

  // Click "choose a folder" — this fires started.emit() and calls input.click().
  // In headless Chrome the click on a file input doesn't open a real dialog; we
  // just need to verify that the spinner appears and that cancel resets it.
  await page.locator('loco-drop-zone .link').click();

  // Spinner becomes visible immediately
  await expect(page.locator('loco-spinner .overlay')).toBeVisible();

  // Simulate the user dismissing the picker
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('loco-drop-zone input[type="file"]');
    input?.dispatchEvent(new Event('cancel'));
  });

  // Spinner goes away
  await expect(page.locator('loco-spinner .overlay')).toBeHidden();
  // And the welcome screen is still visible (no project loaded)
  await expect(page.locator('loco-drop-zone')).toBeVisible();
});
