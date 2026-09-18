import { expect, test } from '@playwright/test';
import { expectNotice, fixtureCase, importCsv, readDownload, stat, visibleMatrix } from './helpers';

test.describe('persistence is explicit, verified and honest about failure', () => {
  test('no persistence by default: reload restores nothing and writes nothing', async ({ page }) => {
    const c = fixtureCase('stale-export-and-persistence');
    await page.goto('./');
    await importCsv(page, 'source-a.csv', c.source_a.text);
    expect(await stat(page, 'records')).toBe(1);
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByRole('checkbox', { name: /Keep the current job in this browser/ })).not.toBeChecked();
    await expect(page.getByTestId('persistence-status')).toContainText('Off. Nothing is written to browser storage');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(0);
    await expect(page.getByTestId('notice')).toHaveText('');
  });

  test('opt in, reload and get the same job back; storage failure is reported without losing work', async ({ page }) => {
    const c = fixtureCase('job-decisions-undo-and-replay');
    await page.goto('./');
    await importCsv(page, 'decisions.csv', c.source.text);
    await page.getByRole('button', { name: 'Apply repair to record 1 availability' }).click();
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await page.getByRole('checkbox', { name: /Keep the current job in this browser/ }).check();
    await expect(page.getByTestId('persistence-status')).toContainText('Saved to this browser and verified by readback.');
    const stored = await page.evaluate(() => localStorage.getItem('feed-repair-desk.job'));
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string).source.sha256).toBe(c.source.sha256);

    await page.reload();
    await expectNotice(page, /Restored decisions\.csv from this browser's storage\. 2 records, 6 columns\. 0 proposed repairs, 1 unresolved product issue/);
    expect(await stat(page, 'applied')).toBe(1);
    await page.getByRole('tab', { name: /Records/ }).click();
    const matrix = await visibleMatrix(page);
    expect(matrix[0][3]).toBe('in_stock');
    expect(matrix[1][1]).toBe('');
    await page.getByRole('tab', { name: 'Profile' }).click();
    await expect(page.getByRole('tabpanel')).toContainText(c.source.sha256);

    // Manual correction after restore, then a simulated write failure on the next change.
    await page.getByRole('tab', { name: /Issues/ }).click();
    await page.getByRole('button', { name: 'Correct value for record 2 title (missing-title)' }).click();
    await page.getByRole('dialog').getByLabel('New value (stored exactly as typed, including spaces)').fill('Foldable Desk Lamp');
    await page.getByRole('dialog').getByRole('button', { name: 'Save correction' }).click();
    expect(await stat(page, 'applied')).toBe(2);
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByTestId('persistence-status')).toContainText('Saved to this browser');

    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        const error = new Error('simulated quota failure');
        error.name = 'QuotaExceededError';
        throw error;
      };
    });
    await page.getByRole('button', { name: 'Undo last change' }).first().click();
    await expect(page.getByTestId('persistence-status')).toContainText('Not saved (QuotaExceededError). Your work stays in memory; download the JSON job to keep it.');
    await expect(page.getByTestId('persistence-status')).not.toContainText('Saved to this browser');
    expect(await stat(page, 'applied')).toBe(1);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: allowed');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON job' }).click()]);
    const job = JSON.parse(await readDownload(download));
    expect(job.changes.length).toBe(1);
    expect(job.source.sha256).toBe(c.source.sha256);

    // Turning persistence off removes the stored copy.
    await page.reload();
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await page.getByRole('checkbox', { name: /Keep the current job in this browser/ }).uncheck();
    await expect(page.getByTestId('persistence-status')).toContainText('Off. The stored copy was removed');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test('a corrupted stored job is rejected at load without pretending to restore', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => {
      localStorage.setItem('feed-repair-desk.persistence', 'on');
      localStorage.setItem('feed-repair-desk.job', '{"format":"feed-repair-desk-job","formatVersion":"0.0.1"}');
    });
    await page.reload();
    await expectNotice(page, /could not be restored\. Job rejected: job format version "0\.0\.1" is not supported/);
    await expect(page.getByRole('main')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('feed-repair-desk.job'))).toBe('{"format":"feed-repair-desk-job","formatVersion":"0.0.1"}');
    // A new working job must not silently overwrite evidence of the failed restore.
    await page.getByRole('button', { name: 'Try the fictional sample' }).click();
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByTestId('persistence-status')).toContainText('automatic storage updates are paused');
    expect(await page.evaluate(() => localStorage.getItem('feed-repair-desk.job'))).toBe('{"format":"feed-repair-desk-job","formatVersion":"0.0.1"}');
  });

  test('restoring a valid job never removes the original before a failed resave', async ({ page }) => {
    const c = fixtureCase('stale-export-and-persistence');
    await page.goto('./');
    await importCsv(page, 'retained.csv', c.source_a.text);
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await page.getByRole('checkbox', { name: /Keep the current job in this browser/ }).check();
    const saved = await page.evaluate(() => localStorage.getItem('feed-repair-desk.job'));
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => { throw new Error('write refused'); };
      const remove = Storage.prototype.removeItem;
      (window as any).__removals = [];
      Storage.prototype.removeItem = function (key) {
        (window as any).__removals.push(key);
        return remove.call(this, key);
      };
    });
    await page.reload();
    await expectNotice(page, /Restored retained\.csv/);
    expect(await page.evaluate(() => (window as any).__removals)).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('feed-repair-desk.job'))).toBe(saved);
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByTestId('persistence-status')).toContainText('Not saved');
  });

  test('failed removal reports retained data, pauses writes, and can be retried', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Try the fictional sample' }).click();
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    const checkbox = page.getByRole('checkbox', { name: /Keep the current job in this browser/ });
    await checkbox.check();
    const saved = await page.evaluate(() => localStorage.getItem('feed-repair-desk.job'));
    await page.evaluate(() => {
      const remove = Storage.prototype.removeItem;
      (window as any).__restoreRemove = () => { Storage.prototype.removeItem = remove; };
      Storage.prototype.removeItem = function (key) {
        if (key === 'feed-repair-desk.job') throw new Error('removal refused');
        return remove.call(this, key);
      };
    });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(page.getByTestId('persistence-status')).toContainText('Could not verify removal');
    await expect(page.getByTestId('persistence-status')).toContainText('may remain');
    await page.getByRole('button', { name: 'Revalidate', exact: true }).first().click();
    expect(await page.evaluate(() => localStorage.getItem('feed-repair-desk.job'))).toBe(saved);
    await page.evaluate(() => (window as any).__restoreRemove());
    await checkbox.uncheck();
    await expect(page.getByTestId('persistence-status')).toContainText('Off. The stored copy was removed');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });

  test('unreadable stored data is reported and never cleared as missing', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => {
      localStorage.setItem('feed-repair-desk.persistence', 'on');
      localStorage.setItem('feed-repair-desk.job', 'retained evidence');
    });
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem;
      (window as any).__rawRead = (key: string) => get.call(localStorage, key);
      Storage.prototype.getItem = function (key) {
        if (key === 'feed-repair-desk.job') throw new Error('read refused');
        return get.call(this, key);
      };
    });
    await page.reload();
    await expectNotice(page, /Browser storage could not be read/);
    expect(await page.evaluate(() => (window as any).__rawRead('feed-repair-desk.job'))).toBe('retained evidence');
  });
});
