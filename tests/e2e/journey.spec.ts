import { expect, test } from '@playwright/test';
import { parseCsv } from '../../src/core/csv';
import { parseJobFile } from '../../src/core/jobfile';
import { expectNotice, importJob, readDownload, stat, visibleMatrix, watchNetwork } from './helpers';

test.describe('sample journey: import, apply, edit, undo, revalidate, download, reopen', () => {
  test('completes the whole journey with real downloads and no network traffic', async ({ page }) => {
    const network = watchNetwork(page);
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Feed Repair Desk' })).toBeVisible();
    const requestsAtLoad = network.requests.length;

    // Import: fictional sample.
    await page.getByRole('button', { name: 'Try the fictional sample' }).click();
    await expectNotice(page, /Analyzed fictional-sample-feed\.csv: 8 records, 7 columns\. 2 proposed repairs, 8 unresolved product issues, 2 formula risks\./);
    expect(await stat(page, 'records')).toBe(8);
    expect(await stat(page, 'proposals')).toBe(2);
    expect(await stat(page, 'applied')).toBe(0);
    expect(await stat(page, 'issues')).toBe(8);
    expect(await stat(page, 'risks')).toBe(2);
    expect(await stat(page, 'affected')).toBe(6);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: blocked');

    // Inspect: proposals show exact before/after values.
    const proposals = page.getByRole('list', { name: 'Proposed repairs' }).getByRole('listitem');
    await expect(proposals).toHaveCount(2);
    await expect(proposals.first()).toContainText('In Stock');
    await expect(proposals.first()).toContainText('in_stock');

    // Apply one selected proposal.
    await page.getByRole('button', { name: 'Apply repair to record 1 availability' }).click();
    await expectNotice(page, /Applied: record 1 availability changed from "In Stock" to "in_stock"/);
    expect(await stat(page, 'proposals')).toBe(1);
    expect(await stat(page, 'applied')).toBe(1);

    // Manual correction through the dialog (missing title in record 4).
    await page.getByRole('button', { name: 'Correct value for record 4 title (missing-title)' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toContainText('Correct record 4, column title');
    await expect(dialog.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    await dialog.getByLabel('New value (stored exactly as typed, including spaces)').fill('Wool throw, moss');
    await dialog.getByRole('button', { name: 'Save correction' }).click();
    await expect(dialog).toBeHidden();
    await expectNotice(page, /Recorded your correction for record 4 title/);
    expect(await stat(page, 'applied')).toBe(2);
    expect(await stat(page, 'issues')).toBe(7);

    // Records tab shows the changed cell and literal text.
    await page.getByRole('tab', { name: /Records/ }).click();
    let matrix = await visibleMatrix(page);
    expect(matrix[3][1]).toBe('Wool throw, moss');
    expect(matrix[0][3]).toBe('in_stock');
    expect(matrix[1][3]).toBe('out of stock');
    expect(matrix[7][1]).toBe('=SUM(A1:A9)');

    // Undo restores the previous value and reopens the issue.
    await page.getByRole('button', { name: 'Undo last change' }).first().click();
    await expectNotice(page, /Undid change #2: record 4 title is back to ""/);
    expect(await stat(page, 'applied')).toBe(1);
    expect(await stat(page, 'issues')).toBe(8);
    matrix = await visibleMatrix(page);
    expect(matrix[3][1]).toBe('');

    // Revalidate adds nothing.
    await page.getByRole('button', { name: 'Revalidate' }).first().click();
    await expectNotice(page, /Revalidated fictional-sample-feed\.csv: .*No changes were added; the ledger still has 1 entry\./);
    expect(await stat(page, 'applied')).toBe(1);

    // Changes ledger lists the applied proposal.
    await page.getByRole('tab', { name: /Changes/ }).click();
    const ledger = page.getByRole('list', { name: 'Applied changes, oldest first' }).getByRole('listitem');
    await expect(ledger).toHaveCount(1);
    await expect(ledger.first()).toContainText('applied proposal');
    await expect(ledger.first()).toContainText('availability-spelling');

    // CSV export is blocked by the two formula risks; the JSON job is still exportable.
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByRole('button', { name: 'Download revised CSV' })).toBeDisabled();
    await expect(page.locator('#csv-export-reason')).toContainText('Blocked by the formula policy: 2 cells');
    await expect(page.getByRole('button', { name: 'Download JSON job' })).toBeEnabled();

    // Correct both formula-risk cells explicitly.
    await page.getByRole('tab', { name: /Issues/ }).click();
    await page.getByRole('button', { name: 'Correct value for record 6 price (formula-risk)' }).click();
    await page.getByRole('dialog').getByLabel('New value (stored exactly as typed, including spaces)').fill('8.00 USD');
    await page.getByRole('dialog').getByRole('button', { name: 'Save correction' }).click();
    await page.getByRole('button', { name: 'Correct value for record 8 title (formula-risk)' }).click();
    await page.getByRole('dialog').getByLabel('New value (stored exactly as typed, including spaces)').fill('Storage basket');
    await page.getByRole('dialog').getByRole('button', { name: 'Save correction' }).click();
    expect(await stat(page, 'risks')).toBe(0);
    expect(await stat(page, 'applied')).toBe(3);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: allowed');

    // Download the revised CSV and reparse it: it must equal the visible matrix.
    await page.getByRole('tab', { name: /Records/ }).click();
    const visible = await visibleMatrix(page);
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download revised CSV' }).click()]);
    expect(csvDownload.suggestedFilename()).toBe('fictional-sample-feed-revised.csv');
    await expectNotice(page, /Download started for fictional-sample-feed-revised\.csv .* not proof it was saved/);
    const csvText = await readDownload(csvDownload);
    const reparsed = parseCsv(csvText);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.value.headers).toEqual(['id', 'title', 'price', 'availability', 'link', 'gtin', 'colour']);
      expect(reparsed.value.records).toEqual(visible);
      expect(reparsed.value.records[0][5]).toBe('04006381333931');
      expect(reparsed.value.records[1][1]).toBe('Oak shelf, two tiers');
    }

    // Download the JSON job and check it validates and reopens the same state.
    const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON job' }).click()]);
    expect(jsonDownload.suggestedFilename()).toBe('fictional-sample-feed-job.json');
    const jobText = await readDownload(jsonDownload);
    const parsedJob = parseJobFile(jobText);
    expect(parsedJob.ok).toBe(true);
    if (parsedJob.ok) {
      expect(parsedJob.value.changes.length).toBe(3);
      expect(parsedJob.value.current).toEqual(visible);
    }

    // Reopen: load a different file first, then reopen the job and confirm state and undo behave the same.
    await page.getByRole('button', { name: 'Edit source' }).click();
    await page.getByLabel(/Or paste CSV text/).fill('id,title,price,availability,link\nz-1,Other,1.00 USD,in_stock,https://example.invalid/p/z-1\n');
    await page.getByRole('button', { name: 'Analyze again' }).click();
    expect(await stat(page, 'records')).toBe(1);
    await page.getByRole('button', { name: 'Edit source' }).click();
    await importJob(page, 'reopened.json', jobText);
    await expectNotice(page, /Reopened job for fictional-sample-feed\.csv from reopened\.json: 3 applied changes replayed and verified/);
    expect(await stat(page, 'records')).toBe(8);
    expect(await stat(page, 'applied')).toBe(3);
    expect(await stat(page, 'risks')).toBe(0);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: allowed');
    await page.getByRole('tab', { name: /Records/ }).click();
    expect(await visibleMatrix(page)).toEqual(visible);
    await page.getByRole('button', { name: 'Undo last change' }).first().click();
    await expectNotice(page, /Undid change #3: record 8 title is back to "=SUM\(A1:A9\)"/);
    expect(await stat(page, 'risks')).toBe(1);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: blocked');

    // No request left the local origin and no cell text was sent anywhere.
    expect(network.requests.length).toBe(requestsAtLoad);
    network.assertLocalOnly(['LL-1001', 'example.invalid', 'Wool', 'SUM']);
  });

  test('shows the empty state and rejects blank input recoverably', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze CSV' })).toBeDisabled();
    await page.getByLabel(/Or paste CSV text/).fill('   \n');
    await page.getByRole('button', { name: 'Analyze CSV' }).click();
    await expect(page.getByRole('alert')).toContainText('pasted-feed.csv was not accepted (empty input)');
    await expect(page.getByRole('main')).toHaveCount(0);
    await page.getByLabel(/Or paste CSV text/).fill('id,title,price,availability,link\n');
    await page.getByRole('button', { name: 'Analyze CSV' }).click();
    expect(await stat(page, 'records')).toBe(0);
    await expect(page.getByRole('status').filter({ hasText: 'zero products were checked' })).toBeVisible();
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByRole('button', { name: 'Download revised CSV' })).toBeDisabled();
    await expect(page.locator('#csv-export-reason')).toContainText('Nothing to export');
  });
});
