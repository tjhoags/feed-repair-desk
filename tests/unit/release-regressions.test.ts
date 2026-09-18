import { describe, expect, it } from 'vitest';
import { createJob, applyManualCorrection, applyProposal, undoLastChange, csvExportEligibility, type Job } from '../../src/core/job';
import { buildJobFile, JOB_LIMITS, parseJobFile, serializeJob } from '../../src/core/jobfile';
import { utf8ByteLength } from '../../src/core/csv';

const CSV = 'id,title,price,availability,link,notes\n001,Lamp,20.00 USD,in_stock,https://example.invalid/p,plain\n';
const DATE = '2026-01-01T00:00:00.000Z';

function must<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function editedJob(): Job {
  let job = must(createJob('synthetic.csv', CSV));
  job = must(applyManualCorrection(job, 1, 1, 'Desk lamp'));
  return must(applyManualCorrection(job, 1, 5, 'Note'));
}

describe('release regressions: bounded, reversible and portable jobs', () => {
  it('treats inherited object keys as unknown availability, never as spelling repairs', () => {
    for (const value of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const job = must(createJob('synthetic.csv', CSV.replace('in_stock', value)));
      expect(job.analysis.proposals, value).toEqual([]);
      expect(job.analysis.issues, value).toContainEqual(expect.objectContaining({ reason: 'unknown-availability', value }));
      expect(applyProposal(job, 1, 3).ok, value).toBe(false);
      expect(must(parseJobFile(serializeJob(job))).current).toEqual(job.current);
    }
  });

  it('keeps prototype-like extra headers as ordinary columns with exact string cells', () => {
    const text = CSV.replace('notes\n', '__proto__,constructor,toString\n').replace(',plain\n', ',alpha,beta,gamma\n');
    const job = must(createJob('headers.csv', text));
    expect(job.parsed.headers.slice(5)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(job.current[0].slice(5)).toEqual(['alpha', 'beta', 'gamma']);
    expect(must(parseJobFile(serializeJob(job))).current).toEqual(job.current);
  });

  it('exports all duplicate-ID facts without repeating the full group on each row', () => {
    const source = 'id,title,price,availability,link\n' + 'same,Lamp,20.00 USD,in_stock,https://example.invalid/p\n'.repeat(1000);
    const job = must(createJob('duplicates.csv', source));
    expect(utf8ByteLength(source)).toBe(55_033);
    expect(job.analysis.issues).toHaveLength(1000);
    expect(job.analysis.issues.every((issue) => issue.reason === 'duplicate-id' && issue.relatedRecords === undefined)).toBe(true);
    expect(job.analysis.duplicateGroups).toEqual([{ value: 'same', records: Array.from({ length: 1000 }, (_, i) => i + 1) }]);
    const serialized = serializeJob(job, DATE);
    expect(utf8ByteLength(serialized)).toBeLessThan(JOB_LIMITS.maxBytes);
    const reopened = must(parseJobFile(serialized));
    expect(reopened.analysis).toEqual(job.analysis);
    expect(reopened.current).toEqual(job.current);
  });

  it('refuses the first edit that would strand a portable job, without mutating current work', () => {
    let job = must(createJob('large-correction.csv', CSV));
    for (const value of ['a', 'b']) {
      job = must(applyManualCorrection(job, 1, 5, value.repeat(2_000_000)));
      expect(must(parseJobFile(serializeJob(job))).current).toEqual(job.current);
    }
    const before = serializeJob(job, DATE);
    const refused = applyManualCorrection(job, 1, 5, 'c'.repeat(2_000_000));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/portable JSON job.*12,000,000-byte/);
    expect(serializeJob(job, DATE)).toBe(before);
    expect(job.changes).toHaveLength(2);
    expect(must(undoLastChange(must(parseJobFile(before)))).current[0][5]).toBe('a'.repeat(2_000_000));
  });

  it('rejects a source whose expanded issue report exceeds the job guard, instead of offering an unreopenable export', () => {
    const extraHeader = 'x'.repeat(1_000_000);
    const source = `id,title,price,availability,link,${extraHeader}\n` + Array.from({ length: 11 }, (_, i) => `${i},Lamp,20.00 USD,in_stock,https://example.invalid/p,=1\n`).join('');
    expect(utf8ByteLength(source)).toBeLessThan(2_000_000);
    expect(createJob('large-report.csv', source)).toMatchObject({ ok: false, code: 'job_limit' });
  });

  it('rejects compact imported JSON when its canonical export would exceed the job guard', () => {
    const file = buildJobFile(must(createJob('synthetic.csv', CSV)), DATE);
    const baseBytes = utf8ByteLength(JSON.stringify(file, null, 2));
    file.source.name = 'x'.repeat(JOB_LIMITS.maxBytes - baseBytes + file.source.name.length + 1);
    const compact = JSON.stringify(file);
    expect(utf8ByteLength(compact)).toBeLessThan(JOB_LIMITS.maxBytes);
    expect(utf8ByteLength(JSON.stringify(file, null, 2))).toBe(JOB_LIMITS.maxBytes + 1);
    const imported = parseJobFile(compact);
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.message).toMatch(/portable JSON job/);
  });

  it('rejects duplicate stored current cells and mismatched column aliases', () => {
    const job = editedJob();
    const duplicate = buildJobFile(job, DATE);
    duplicate.currentCells[1] = { ...duplicate.currentCells[0] };
    expect(parseJobFile(JSON.stringify(duplicate)).ok).toBe(false);
    for (const columnName of ['notes', 'Title', '', undefined, 3]) {
      const raw = JSON.parse(serializeJob(job, DATE));
      raw.currentCells[0].columnName = columnName;
      expect(parseJobFile(JSON.stringify(raw)).ok, String(columnName)).toBe(false);
    }
    expect(must(parseJobFile(serializeJob(job))).current).toEqual(job.current);
  });

  it('rejects duplicated issue entries that substitute for another unresolved fact', () => {
    const job = must(createJob('issues.csv', CSV.replace(',Lamp,', ',,').replace('20.00 USD', 'unknown')));
    const raw = buildJobFile(job, DATE);
    expect(raw.unresolvedIssues).toHaveLength(2);
    raw.unresolvedIssues[1] = { ...raw.unresolvedIssues[0] };
    expect(parseJobFile(JSON.stringify(raw)).ok).toBe(false);
  });

  it('rejects coherent wrong-typed source, cells, coordinates and version values without throwing', () => {
    const job = editedJob();
    const mutations: Array<(raw: any) => void> = [
      (raw) => { raw.source.text = 123; },
      (raw) => { raw.formatVersion = {}; },
      (raw) => { raw.profile.id = 'future-profile'; },
      (raw) => { raw.profile.rulesVersion = 2099; },
      ...[123, null, [], {}].map((value) => (raw: any) => { raw.changes[1].after = value; raw.currentCells[1].value = value; }),
      ...[true, 1.5, 0, 99].map((value) => (raw: any) => { raw.changes[1].record = value; }),
    ];
    for (const mutate of mutations) {
      const raw = JSON.parse(serializeJob(job, DATE));
      mutate(raw);
      expect(parseJobFile(JSON.stringify(raw)).ok).toBe(false);
    }
    expect(must(parseJobFile(serializeJob(job))).current).toEqual(job.current);
  });

  it('recomputes formula safety instead of trusting exported flags and restores the block on undo after reopen', () => {
    let job = must(createJob('risk.csv', CSV.replace(',Lamp,', ',=1+1,')));
    job = must(applyManualCorrection(job, 1, 1, 'Lamp'));
    expect(csvExportEligibility(job).csv).toBe(true);
    const undone = must(undoLastChange(must(parseJobFile(serializeJob(job)))));
    expect(undone.current[0][1]).toBe('=1+1');
    expect(csvExportEligibility(undone).csv).toBe(false);
    const raw = JSON.parse(serializeJob(undone));
    raw.csvExportEnabled = true;
    raw.counts.formulaRisks = 0;
    raw.headerFormulaRisks = [];
    const imported = parseJobFile(JSON.stringify(raw));
    // Ignoring derived fields is acceptable only when the actual cells still block export.
    if (imported.ok) expect(csvExportEligibility(imported.value).csv).toBe(false);
  });
});
