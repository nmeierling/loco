import { Page, expect, test } from '@playwright/test';
import { loadLocoSrc } from './fixtures';

async function width(page: Page, selector: string): Promise<number> {
  return page.$eval(selector, (el) => el.getBoundingClientRect().width);
}

test.describe('Sidebars (left files + right ignore)', () => {
  test('default widths, resize drag, collapse + reopen, persistence is honored', async ({ page }) => {
    await loadLocoSrc(page);

    const left = 'aside.sidebar.left';
    const right = 'aside.sidebar.right';
    expect(await width(page, left)).toBe(280);
    expect(await width(page, right)).toBe(280);

    // Drag the left resizer to the right by ~100px
    const resizer = page.locator('aside.sidebar.left .resizer.right');
    const box = await resizer.boundingBox();
    if (!box) throw new Error('left resizer not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => width(page, left)).toBeGreaterThan(360);
    const resizedWidth = await width(page, left);

    // Collapse left, then reopen — the resized width should be restored
    await page.locator(`${left} .collapse-btn`).click();
    await expect.poll(() => width(page, left)).toBe(28);
    await page.locator(`${left} .open-btn`).click();
    await expect.poll(() => width(page, left)).toBe(resizedWidth);

    // Collapse right and reopen
    await page.locator(`${right} .collapse-btn`).click();
    await expect.poll(() => width(page, right)).toBe(28);
    await page.locator(`${right} .open-btn`).click();
    await expect.poll(() => width(page, right)).toBe(280);
  });

  test('file rows show LOC counts; clicking a file populates Selected in the ignore panel', async ({ page }) => {
    await loadLocoSrc(page);
    const fileRow = page.locator('loco-directory-tree .row.file').first();
    await expect(fileRow.locator('.meta')).toHaveText(/\d/);

    await fileRow.click();
    await expect(page.locator('loco-ignore-panel .block.selected')).toBeVisible();
  });
});
