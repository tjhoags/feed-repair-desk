import { expect, test } from '@playwright/test';
import { expectNotice, fixtureCase, importCsv, importJob, readDownload } from './helpers';

// Control the asynchronous file read, not a timer: every stale read is released explicitly.
async function delayFileReads(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    (window as any).__pendingReads = {};
    File.prototype.arrayBuffer = function () {
      if (!this.name.startsWith('slow-')) return read.call(this);
      return new Promise<ArrayBuffer>((resolve, reject) => {
        (window as any).__pendingReads[this.name] = () => read.call(this).then(resolve, reject);
      });
    };
  });
}

test('a slower CSV cannot replace a newer CSV import', async ({ page }) => {
  const c = fixtureCase('stale-export-and-persistence');
  await page.goto('./');
  await delayFileReads(page);
  await importCsv(page, 'slow-a.csv', c.source_a.text);
  await expectNotice(page, /Reading slow-a/);
  await importCsv(page, 'newer-b.csv', c.source_a.text.replace('Desk lamp', 'Newer product'));
  await expectNotice(page, /Analyzed newer-b/);
  await page.evaluate(() => (window as any).__pendingReads['slow-a.csv']());
  await expectNotice(page, /Analyzed newer-b/);
  await page.getByRole('tab', { name: 'Export & keep' }).click();
  await expect(page.getByRole('heading', { name: 'Downloads for newer-b.csv' })).toBeVisible();
});

test('a delayed JSON import cannot replace a newer sample or pasted edit', async ({ page }) => {
  const c = fixtureCase('stale-export-and-persistence');
  await page.goto('./');
  await importCsv(page, 'old-job.csv', c.source_a.text);
  await page.getByRole('tab', { name: 'Export & keep' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON job' }).click()]);
  const saved = await readDownload(download);
  await page.getByRole('button', { name: 'Edit source', exact: true }).click();
  await delayFileReads(page);
  await importJob(page, 'slow-old.json', saved);
  await expectNotice(page, /Reading slow-old/);
  await page.getByRole('button', { name: 'Try the fictional sample' }).click();
  await expectNotice(page, /Analyzed/);
  const sampleNotice = await page.getByTestId('notice').textContent();
  await page.evaluate(() => (window as any).__pendingReads['slow-old.json']());
  await expect(page.getByTestId('notice')).toHaveText(sampleNotice!);

  await page.getByRole('button', { name: 'Edit source', exact: true }).click();
  await importJob(page, 'slow-second.json', saved);
  const textarea = page.getByRole('textbox', { name: /Or paste CSV text/ });
  await textarea.fill(c.invalid_source_b.text);
  await page.evaluate(() => (window as any).__pendingReads['slow-second.json']());
  await expect(textarea).toHaveValue(c.invalid_source_b.text);
  await expect(page.getByTestId('job-status')).toHaveText('Source edited, not validated');
});

test('CSV and JSON read errors keep current work and report the failure', async ({ page }) => {
  const c = fixtureCase('stale-export-and-persistence');
  await page.goto('./');
  await importCsv(page, 'retained.csv', c.source_a.text);
  await page.getByRole('button', { name: 'Edit source', exact: true }).click();
  await page.evaluate(() => { File.prototype.arrayBuffer = async () => { throw new Error('unreadable'); }; });
  await importCsv(page, 'broken.csv', c.invalid_source_b.text);
  await expectNotice(page, /Could not read broken\.csv\. Your current work is unchanged/);
  await importJob(page, 'broken.json', '{}');
  await expectNotice(page, /Could not read broken\.json\. Your current work is unchanged/);
  await page.getByRole('tab', { name: 'Export & keep' }).click();
  await expect(page.getByRole('heading', { name: 'Downloads for retained.csv' })).toBeVisible();
});
