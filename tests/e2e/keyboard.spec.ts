import { expect, test } from '@playwright/test';
import { expectNotice, stat, visibleMatrix } from './helpers';

test.describe('keyboard and small-screen behaviour', () => {
  test('the whole repair loop works from the keyboard alone', async ({ page }) => {
    await page.goto('./');
    await page.keyboard.press('Tab'); // skip link
    await expect(page.getByRole('link', { name: 'Skip to workspace' })).toBeFocused();
    await page.keyboard.press('Tab'); // file input
    await page.keyboard.press('Tab'); // sample button
    await expect(page.getByRole('button', { name: 'Try the fictional sample' })).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await stat(page, 'records')).toBe(8);

    // Tabs: arrow keys move selection and focus.
    await page.getByRole('tab', { name: /Issues/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /Records/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /Records/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: /Issues/ })).toHaveAttribute('aria-selected', 'true');

    // Apply a proposal with Enter, then open the cell editor from the records grid.
    await page.getByRole('button', { name: 'Apply repair to record 2 availability' }).focus();
    await page.keyboard.press('Enter');
    await expectNotice(page, /Applied: record 2 availability changed from "out of stock" to "out_of_stock"/);
    await page.getByRole('tab', { name: /Records/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Record 4 title: empty/ }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('New value (stored exactly as typed, including spaces)')).toBeFocused();
    await page.keyboard.type('Wool throw');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Save correction' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    expect((await visibleMatrix(page))[3][1]).toBe('Wool throw');

    // Escape cancels an edit without recording anything.
    await page.getByRole('button', { name: /^Record 1 id: LL-1001/ }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type('changed');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await stat(page, 'applied')).toBe(2);
    expect((await visibleMatrix(page))[0][0]).toBe('LL-1001');

    // Undo from the keyboard.
    await page.getByRole('button', { name: 'Undo last change' }).first().focus();
    await page.keyboard.press('Enter');
    await expectNotice(page, /Undid change #2/);
    expect(await stat(page, 'applied')).toBe(1);
  });

  test('wide tables scroll inside their region without page overflow', async ({ page }) => {
    await page.goto('./');
    const columns = ['id', 'title', 'price', 'availability', 'link', ...Array.from({ length: 40 }, (_, i) => `attribute_${i}`)];
    const row = ['w-1', 'Wide product', '20.00 USD', 'in_stock', 'https://example.invalid/p/w-1', ...Array.from({ length: 40 }, (_, i) => `value ${i}`)];
    await page.getByLabel(/Or paste CSV text/).fill(`${columns.join(',')}\n${row.join(',')}\n`);
    await page.getByRole('button', { name: 'Analyze CSV' }).click();
    await page.getByRole('tab', { name: /Records/ }).click();
    const region = page.getByRole('region', { name: /Records table/ });
    await expect(region).toBeVisible();
    const overflow = await page.evaluate(() => ({
      pageScrollWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      regionScrollWidth: document.querySelector('.table-region')?.scrollWidth ?? 0,
      regionClientWidth: document.querySelector('.table-region')?.clientWidth ?? 0,
    }));
    expect(overflow.pageScrollWidth).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.regionScrollWidth).toBeGreaterThan(overflow.regionClientWidth);
    await page.getByRole('tab', { name: /Issues/ }).click();
    const overflowIssues = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(overflowIssues).toBe(true);
  });
});
