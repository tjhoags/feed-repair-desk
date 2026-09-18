import { describe, expect, it } from 'vitest';
import { decodeUtf8Strict, parseCsv, serializeCsv, SOURCE_LIMITS } from '../../src/core/csv';
import { createJob, csvExportEligibility, isEmptyDataset } from '../../src/core/job';
import { fixtureCase } from './fixtures';

describe('quoting-and-string-preservation', () => {
  const c = fixtureCase('quoting-and-string-preservation');
  for (const source of c.sources) {
    it(`parses ${source.id} into the expected matrix and round-trips through export`, () => {
      const parsed = parseCsv(source.source.text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.headers).toEqual(c.expected.headers);
      expect(parsed.value.records).toEqual(c.expected.records);
      expect(parsed.value.records.length).toBe(c.expected.data_record_count);
      expect(parsed.value.hadBom).toBe(source.id === 'utf8-bom');
      expect(parsed.value.lineEnding).toBe(source.id === 'crlf' ? 'CRLF' : 'LF');
      expect(typeof parsed.value.records[0][0]).toBe('string');
      expect(parsed.value.records[0][0]).toBe(c.expected.first_id);
      expect(parsed.value.records[0][5]).toBe('');
      const loc = c.expected.logical_title_location;
      expect(parsed.value.records[loc.record - 1][parsed.value.headers.indexOf(loc.column)]).toBe(loc.value);

      const job = createJob('fixture.csv', source.source.text);
      expect(job.ok).toBe(true);
      if (!job.ok) return;
      expect(job.value.source.text).toBe(source.source.text);
      expect(job.value.source.sha256).toBe(source.source.sha256);
      expect(job.value.analysis.counts.totalIssues).toBe(c.expected.mutation_count);
      expect(job.value.changes.length).toBe(0);

      const exported = serializeCsv(job.value.parsed.headers, job.value.current, job.value.parsed.lineEnding, job.value.parsed.hadBom);
      const reparsed = parseCsv(exported);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) return;
      expect(reparsed.value.headers).toEqual(c.expected.headers);
      expect(reparsed.value.records).toEqual(c.expected.records);
    });
  }
});

describe('structural-failures', () => {
  const c = fixtureCase('structural-failures');
  const expectedCodes: Record<string, string> = {
    'unclosed-quote': 'parse_error',
    'extra-cell': 'row_width_error',
    'missing-cell': 'row_width_error',
    empty: 'empty_input',
    'semicolon-delimiter': 'missing-required-column',
  };
  for (const v of c.variants) {
    it(`rejects or names ${v.id} (${v.expected_status})`, () => {
      const job = createJob(`${v.id}.csv`, v.source.text);
      if (v.id === 'header-only') {
        expect(job.ok).toBe(true);
        if (!job.ok) return;
        expect(job.value.parsed.records.length).toBe(v.expected_record_count);
        expect(isEmptyDataset(job.value)).toBe(true);
        expect(csvExportEligibility(job.value).csv).toBe(false);
        expect(csvExportEligibility(job.value).reason).toMatch(/nothing to export/i);
        return;
      }
      expect(job.ok).toBe(false);
      if (job.ok) return;
      expect(job.code).toBe(expectedCodes[v.id]);
      expect(job.message.length).toBeGreaterThan(10);
    });
  }

  it('does not guess a semicolon delimiter and says so', () => {
    const v = c.variants.find((x: any) => x.id === 'semicolon-delimiter');
    const job = createJob('semi.csv', v.source.text);
    expect(job.ok).toBe(false);
    if (job.ok) return;
    expect(job.message).toMatch(/only comma-separated CSV is supported/);
  });

  it('rejects CR-only line endings, blank lines and invalid UTF-8 explicitly', () => {
    expect(parseCsv('id,title,price,availability,link\r1,a,20.00 USD,in_stock,https://example.invalid/p/1\r')).toMatchObject({ ok: false, code: 'unsupported_line_ending' });
    expect(parseCsv('id,title,price,availability,link\n1,a,20.00 USD,in_stock,https://example.invalid/p/1\n\n2,b,20.00 USD,in_stock,https://example.invalid/p/2\n')).toMatchObject({ ok: false, code: 'row_width_error' });
    expect(decodeUtf8Strict(new Uint8Array([0x69, 0x64, 0xff, 0xfe]))).toMatchObject({ ok: false });
    expect(decodeUtf8Strict(new Uint8Array([0xef, 0xbb, 0xbf, 0x69, 0x64]))).toEqual({ ok: true, text: '﻿id' });
  });

  it('keeps a BOM only at the document start, not inside cells', () => {
    const parsed = parseCsv('﻿id,title\n1,﻿keep\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.headers[0]).toBe('id');
    expect(parsed.value.records[0][1]).toBe('﻿keep');
  });
});

describe('source limits (supported-input guards)', () => {
  const header = 'id,title,price,availability,link\n';
  const row = (i: number) => `r${i},Desk lamp,20.00 USD,in_stock,https://example.invalid/p/r${i}\n`;

  it('accepts exactly 2,000,000 bytes and rejects 2,000,001 before parsing', () => {
    const base = header + row(1);
    const padLength = SOURCE_LIMITS.maxBytes - Buffer.byteLength(base, 'utf8');
    // Pad a final record's title with ASCII so the byte count is exact.
    const atLimit = header + `r1,${'x'.repeat(padLength + 'Desk lamp'.length)},20.00 USD,in_stock,https://example.invalid/p/r1\n`;
    expect(Buffer.byteLength(atLimit, 'utf8')).toBe(SOURCE_LIMITS.maxBytes);
    expect(parseCsv(atLimit).ok).toBe(true);
    const overLimit = atLimit.replace('\n', 'y\n');
    expect(Buffer.byteLength(overLimit, 'utf8')).toBe(SOURCE_LIMITS.maxBytes + 1);
    expect(parseCsv(overLimit)).toMatchObject({ ok: false, code: 'byte_limit' });
    // A multi-byte character counts by bytes, not characters.
    const multiByte = atLimit.replace('\n', 'é\n').replace('x', '');
    expect(Buffer.byteLength(multiByte, 'utf8')).toBe(SOURCE_LIMITS.maxBytes + 1);
    expect(parseCsv(multiByte)).toMatchObject({ ok: false, code: 'byte_limit' });
  });

  it('accepts exactly 10,000 records and rejects 10,001', () => {
    let text = header;
    for (let i = 1; i <= SOURCE_LIMITS.maxRecords; i += 1) text += row(i);
    const at = parseCsv(text);
    expect(at.ok).toBe(true);
    if (at.ok) expect(at.value.records.length).toBe(SOURCE_LIMITS.maxRecords);
    expect(parseCsv(text + row(SOURCE_LIMITS.maxRecords + 1))).toMatchObject({ ok: false, code: 'record_limit' });
  });

  it('accepts exactly 200 columns and rejects 201', () => {
    const extra = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);
    const build = (n: number) => {
      const cols = ['id', 'title', 'price', 'availability', 'link', ...extra(n - 5)];
      const cells = ['r1', 'Desk lamp', '20.00 USD', 'in_stock', 'https://example.invalid/p/r1', ...extra(n - 5).map(() => 'v')];
      return `${cols.join(',')}\n${cells.join(',')}\n`;
    };
    const at = createJob('cols.csv', build(SOURCE_LIMITS.maxColumns));
    expect(at.ok).toBe(true);
    if (at.ok) expect(at.value.parsed.headers.length).toBe(SOURCE_LIMITS.maxColumns);
    expect(parseCsv(build(SOURCE_LIMITS.maxColumns + 1))).toMatchObject({ ok: false, code: 'column_limit' });
  });
});
