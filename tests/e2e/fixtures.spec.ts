import { expect, test } from '@playwright/test';
import { serializeJob } from '../../src/core/jobfile';
import { createJob } from '../../src/core/job';
import { expectNotice, fixtureCase, importCsv, importCsvBytes, importJob, stat, visibleMatrix, watchNetwork } from './helpers';

test.describe('acceptance fixtures in the browser', () => {
  test('availability proposals apply, revalidate idempotently and undo', async ({ page }) => {
    const c = fixtureCase('availability-preview-apply-undo');
    await page.goto('./');
    await importCsv(page, 'availability.csv', c.source.text);
    expect(await stat(page, 'proposals')).toBe(2);
    expect(await stat(page, 'issues')).toBe(1);
    await page.getByRole('button', { name: 'Apply repair to record 1 availability' }).click();
    expect(await stat(page, 'applied')).toBe(1);
    expect(await stat(page, 'proposals')).toBe(1);
    await page.getByRole('button', { name: 'Apply repair to record 2 availability' }).click();
    expect(await stat(page, 'applied')).toBe(2);
    expect(await stat(page, 'proposals')).toBe(0);
    await page.getByRole('button', { name: 'Revalidate' }).first().click();
    await page.getByRole('button', { name: 'Revalidate' }).first().click();
    expect(await stat(page, 'applied')).toBe(2);
    expect(await stat(page, 'proposals')).toBe(0);
    expect(await stat(page, 'issues')).toBe(1);
    await page.getByRole('button', { name: 'Undo last change' }).first().click();
    expect(await stat(page, 'applied')).toBe(1);
    expect(await stat(page, 'proposals')).toBe(1);
    await page.getByRole('tab', { name: /Records/ }).click();
    const matrix = await visibleMatrix(page);
    expect(matrix[0][3]).toBe('in_stock');
    expect(matrix[1][3]).toBe('out of stock');
    expect(matrix[4][3]).toBe('available soon');
  });

  test('quoted, multiline, BOM and CRLF sources parse to the same matrix', async ({ page }) => {
    const c = fixtureCase('quoting-and-string-preservation');
    await page.goto('./');
    for (const source of c.sources) {
      await importCsv(page, `${source.id}.csv`, source.source.text);
      await expectNotice(page, new RegExp(`Analyzed ${source.id}\\.csv: 2 records, 7 columns`));
      await page.getByRole('tab', { name: /Records/ }).click();
      expect(await visibleMatrix(page)).toEqual(c.expected.records);
      await page.getByRole('tab', { name: 'Profile' }).click();
      await expect(page.getByRole('tabpanel')).toContainText(source.source.sha256);
      await page.getByRole('button', { name: 'Edit source' }).click();
    }
  });

  test('structural failures are rejected whole with an explanation', async ({ page }) => {
    const c = fixtureCase('structural-failures');
    await page.goto('./');
    for (const v of c.variants) {
      if (v.id === 'header-only') continue;
      await importCsv(page, `${v.id}.csv`, v.source.text);
      await expect(page.getByRole('alert')).toContainText(`${v.id}.csv was not accepted`);
      await expect(page.getByRole('main')).toHaveCount(0);
    }
    await expect(page.getByRole('alert')).toContainText('only comma-separated CSV is supported');
    await importCsvBytes(page, 'latin1.csv', Buffer.from([0x69, 0x64, 0x2c, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x0a, 0x31, 0x2c, 0xe9, 0x0a]));
    await expect(page.getByRole('alert')).toContainText('not valid UTF-8');
    const big = Buffer.alloc(2_000_001, 0x61);
    await importCsvBytes(page, 'big.csv', big);
    await expect(page.getByRole('alert')).toContainText('2,000,001 UTF-8 bytes; the supported limit is 2,000,000 bytes');
  });

  test('header ambiguity is rejected instead of guessed', async ({ page }) => {
    const c = fixtureCase('header-ambiguity');
    await page.goto('./');
    for (const v of c.variants) {
      await importCsv(page, `${v.id}.csv`, v.source.text);
      await expect(page.getByRole('alert')).toContainText(`${v.id}.csv was not accepted`);
      await expect(page.getByRole('main')).toHaveCount(0);
    }
    await expect(page.getByRole('alert')).toContainText('both identify "id"');
  });

  test('formula and markup policy: literal rendering, no script, no requests, export gated on explicit correction', async ({ page }) => {
    const c = fixtureCase('formula-and-markup-policy');
    const network = watchNetwork(page);
    await page.goto('./');
    const loaded = network.requests.length;
    await importCsv(page, 'formula.csv', c.source.text);
    expect(await stat(page, 'records')).toBe(14);
    expect(await stat(page, 'risks')).toBe(13);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: blocked');

    // Markup stays text: no image element, no script side effect, literal text visible.
    await page.getByRole('tab', { name: /Records/ }).click();
    expect(await page.locator('main img').count()).toBe(0);
    expect(await page.evaluate(() => (globalThis as { __feedFixtureXss?: number }).__feedFixtureXss)).toBeUndefined();
    const matrix = await visibleMatrix(page);
    expect(matrix[13][1]).toBe(c.expected.markup_cell.value);
    expect(matrix[6][6]).toBe('\r=1+1');
    expect(matrix[7][0]).toBe('  =1+1');
    await expect(page.getByRole('button', { name: /Record 14 title: <img src=x/ })).toBeVisible();

    // Header variant blocks export too.
    await page.getByRole('button', { name: 'Edit source' }).click();
    await importCsv(page, 'header.csv', c.header_variant.source.text);
    expect(await stat(page, 'risks')).toBe(1);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: blocked');
    await expect(page.getByRole('tabpanel')).toContainText('Header formula risk');

    // Ignoring the warning changes nothing; correcting each risky value in the dialog re-enables export.
    await page.getByRole('button', { name: 'Edit source' }).click();
    await importCsv(page, 'formula.csv', c.source.text);
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByRole('button', { name: 'Download revised CSV' })).toBeDisabled();
    await page.getByRole('tab', { name: /Issues/ }).click();
    const replacement = c.actions[1].replacement_records as string[][];
    for (const risk of c.expected.formula_risk_cells as Array<{ record: number; column: string }>) {
      const column = ['id', 'title', 'price', 'availability', 'link', 'gtin', 'notes'].indexOf(risk.column);
      await page.getByRole('button', { name: `Correct value for record ${risk.record} ${risk.column} (formula-risk)` }).click();
      await page.getByRole('dialog').getByLabel('New value (stored exactly as typed, including spaces)').fill(replacement[risk.record - 1][column]);
      await page.getByRole('dialog').getByRole('button', { name: 'Save correction' }).click();
    }
    expect(await stat(page, 'risks')).toBe(0);
    expect(await stat(page, 'applied')).toBe(13);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: allowed');
    await page.getByRole('tab', { name: /Records/ }).click();
    expect((await visibleMatrix(page))[13][1]).toBe(c.expected.markup_cell.value);

    expect(network.requests.length).toBe(loaded);
    network.assertLocalOnly(['SUM', 'HYPERLINK', 'onerror', 'example.invalid']);
  });

  test('stale export prevention and transactional job import', async ({ page }) => {
    const c = fixtureCase('stale-export-and-persistence');
    await page.goto('./');
    await importCsv(page, 'source-a.csv', c.source_a.text);
    await page.getByRole('tab', { name: /Records/ }).click();
    expect((await visibleMatrix(page))[0][0]).toBe('000123');
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: allowed');

    // Editing the source without revalidating disables downloads.
    await page.getByRole('button', { name: 'Edit source' }).click();
    const textarea = page.getByLabel(/Or paste CSV text/);
    await textarea.fill(`${c.source_a.text}000124,Second lamp,21.00 USD,in_stock,https://example.invalid/p/000124\n`);
    await expect(page.getByTestId('job-status')).toHaveText('Source edited, not validated');
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: source not validated');
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByRole('button', { name: 'Download revised CSV' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Download JSON job' })).toBeDisabled();
    await expect(page.getByRole('tabpanel')).toContainText('source-differs-from-validated-job');

    // Loading invalid CSV removes the earlier job entirely.
    await importCsv(page, 'source-b.csv', c.invalid_source_b.text);
    await expect(page.getByRole('alert')).toContainText('source-b.csv was not accepted (missing-required-column)');
    await expect(page.getByRole('alert')).toContainText('availability');
    await expect(page.getByRole('main')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download revised CSV' })).toHaveCount(0);
    await expect(page.getByLabel(/Or paste CSV text/)).toHaveValue(c.invalid_source_b.text);

    // Restore A, then import an invalid job: the rejection leaves A intact and exportable.
    await importCsv(page, 'source-a.csv', c.source_a.text);
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: allowed');
    const goodJob = createJob('source-a.csv', c.source_a.text);
    if (!goodJob.ok) throw new Error(goodJob.message);
    const tampered = JSON.parse(serializeJob(goodJob.value));
    tampered.source.text = tampered.source.text.replace('Desk lamp', 'Desk Lamp');
    await page.getByRole('button', { name: 'Edit source' }).click();
    await importJob(page, 'tampered.json', JSON.stringify(tampered));
    await expectNotice(page, /tampered\.json: Job rejected: the declared source hash does not match .* Your current work is unchanged\./);
    await importJob(page, 'broken.json', '{not json');
    await expectNotice(page, /broken\.json: Job rejected: the file is not valid JSON/);
    const wrongProfile = JSON.parse(serializeJob(goodJob.value));
    wrongProfile.profile.rulesVersion = '1999-01-01';
    await importJob(page, 'old-rules.json', JSON.stringify(wrongProfile));
    await expectNotice(page, /rule version "1999-01-01" of profile basic-product-feed-fixture-v1 is not supported/);
    await expect(page.getByTestId('job-status')).toHaveText('Analyzed feed');
    await expect(page.getByTestId('csv-eligibility')).toHaveText('CSV export: allowed');
    await page.getByRole('tab', { name: /Records/ }).click();
    expect((await visibleMatrix(page))[0][0]).toBe('000123');
    await page.getByRole('tab', { name: 'Export & keep' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('Downloads for source-a.csv');
    await expect(page.getByRole('button', { name: 'Download revised CSV' })).toBeEnabled();
  });
});
