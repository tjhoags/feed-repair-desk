import { describe, expect, it } from 'vitest';
import { applyManualCorrection, applyProposal, createJob, csvExportEligibility, revalidate, undoLastChange, type Job } from '../../src/core/job';
import { buildJobFile, JOB_FORMAT_VERSION, parseJobFile, serializeJob } from '../../src/core/jobfile';
import { PROFILE } from '../../src/core/profile';
import { saveJob, loadSavedJob, writeOptIn, readOptIn, STORAGE_KEYS, type StorageLike } from '../../src/core/persistence';
import { fixtureCase, fixtures } from './fixtures';

function mustJob(name: string, text: string): Job {
  const job = createJob(name, text);
  if (!job.ok) throw new Error(job.message);
  return job.value;
}

function columnIndex(job: Job, name: string): number {
  return job.parsed.headers.indexOf(name);
}

describe('availability-preview-apply-undo', () => {
  const c = fixtureCase('availability-preview-apply-undo');

  it('follows the fixture action sequence exactly', () => {
    let job = mustJob('availability.csv', c.source.text);
    const proposals = job.analysis.proposals.map((p) => ({ record: p.record, column: p.columnName, before: p.before, after: p.after, reason: p.reason }));
    expect(proposals).toEqual(c.expected_initial.proposed_changes);
    expect(job.changes.length).toBe(c.expected_initial.applied_changes);
    const unresolved = job.analysis.issues.map((i) => ({ record: i.record, column: i.columnName, reason: i.reason, value: i.value }));
    expect(unresolved).toEqual(c.expected_initial.unresolved);
    for (const record of c.expected_initial.canonical_unchanged_records) {
      expect(job.current[record - 1]).toEqual(job.parsed.records[record - 1]);
    }

    const avail = columnIndex(job, 'availability');
    for (const action of c.actions) {
      if (action.action === 'apply_proposal') {
        const result = applyProposal(job, action.record, avail);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        job = result.value;
        expect(job.current[action.record - 1][avail]).toBe(action.expected_cell);
        expect(job.changes.length).toBe(action.expected_active_change_count);
        expect(job.analysis.proposals.length).toBe(action.expected_remaining_proposal_count);
      } else if (action.action === 'revalidate_twice') {
        const before = job.changes.length;
        job = revalidate(revalidate(job));
        expect(job.changes.length - before).toBe(action.expected_added_mutations);
        expect(job.analysis.proposals.length).toBe(action.expected_remaining_proposal_count);
        expect(job.analysis.issues.length).toBe(action.expected_unresolved_count);
      } else if (action.action === 'undo_last_change') {
        const result = undoLastChange(job);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        job = result.value;
        expect(job.current[action.expected_record - 1][columnIndex(job, action.expected_column)]).toBe(action.expected_cell);
        expect(job.changes.length).toBe(action.expected_active_change_count);
        expect(job.analysis.proposals.length).toBe(action.expected_remaining_proposal_count);
      }
    }
    // Only explicitly accepted cells changed; the unknown value stays exactly.
    expect(job.current[4][avail]).toBe('available soon');
    expect(job.current[2]).toEqual(job.parsed.records[2]);
    expect(job.current[3]).toEqual(job.parsed.records[3]);
  });

  it('refuses a stale proposal whose target changed', () => {
    let job = mustJob('availability.csv', c.source.text);
    const avail = columnIndex(job, 'availability');
    const edited = applyManualCorrection(job, 1, avail, 'preorder');
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    job = edited.value;
    expect(applyProposal(job, 1, avail).ok).toBe(false);
    expect(applyManualCorrection(job, 1, avail, 'preorder').ok).toBe(false);
    expect(applyManualCorrection(job, 99, avail, 'x').ok).toBe(false);
    expect(undoLastChange(mustJob('availability.csv', c.source.text)).ok).toBe(false);
  });
});

describe('job-decisions-undo-and-replay', () => {
  const c = fixtureCase('job-decisions-undo-and-replay');

  function runToUndo(): Job {
    let job = mustJob('decisions.csv', c.source.text);
    expect(job.changes.length).toBe(0);
    expect(job.analysis.proposals.length).toBe(1);
    expect(job.analysis.issues.map((i) => ({ record: i.record, column: i.columnName, reason: i.reason }))).toEqual(c.actions[0].expected_unresolved);

    const accept = applyProposal(job, 1, columnIndex(job, 'availability'));
    if (!accept.ok) throw new Error(accept.message);
    job = accept.value;
    expect(job.changes[0]).toMatchObject({ before: 'In Stock', after: 'in_stock', kind: 'proposal' });
    expect(job.changes.length).toBe(1);

    const manual = applyManualCorrection(job, 2, columnIndex(job, 'title'), c.actions[2].entered_value);
    if (!manual.ok) throw new Error(manual.message);
    job = manual.value;
    expect(job.changes[1]).toMatchObject({ before: '', after: 'Foldable Desk Lamp', kind: 'manual', reason: 'manual-correction' });
    expect(job.changes.length).toBe(2);
    expect(job.analysis.issues.filter((i) => i.reason === 'missing-title').length).toBe(0);

    const undo = undoLastChange(job);
    if (!undo.ok) throw new Error(undo.message);
    job = undo.value;
    expect(job.current[1][columnIndex(job, 'title')]).toBe('');
    expect(job.changes.length).toBe(1);
    expect(job.analysis.issues.filter((i) => i.reason === 'missing-title').length).toBe(1);
    return job;
  }

  it('exports a job that reopens with identical source, cells, ledger and issues', () => {
    const job = runToUndo();
    const text = serializeJob(job, '2026-01-01T00:00:00.000Z');
    const reopened = parseJobFile(text);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.source.text).toBe(job.source.text);
    expect(reopened.value.source.sha256).toBe(c.source.sha256);
    expect(reopened.value.current).toEqual(job.current);
    expect(reopened.value.changes).toEqual(job.changes);
    expect(reopened.value.analysis.issues).toEqual(job.analysis.issues);
    expect(reopened.value.analysis.proposals).toEqual(job.analysis.proposals);
    const file = JSON.parse(text);
    expect(file.profile).toEqual({ id: PROFILE.id, rulesVersion: PROFILE.rulesVersion });

    // The same next Undo restores the same cell before and after reopen.
    const undoBefore = undoLastChange(job);
    const undoAfter = undoLastChange(reopened.value);
    expect(undoBefore.ok && undoAfter.ok).toBe(true);
    if (!undoBefore.ok || !undoAfter.ok) return;
    expect(undoAfter.value.current).toEqual(undoBefore.value.current);
    expect(undoAfter.value.current[0][columnIndex(job, 'availability')]).toBe('In Stock');
    expect(undoAfter.value.analysis.proposals.length).toBe(1);

    let twice = revalidate(revalidate(reopened.value));
    expect(twice.changes.length).toBe(1);
    expect(twice.analysis.issues.filter((i) => i.reason === 'missing-title').length).toBe(1);
    expect(twice.current).toEqual(c.expected_final_records);
    twice = revalidate(twice);
    expect(twice.changes).toEqual(job.changes);
  });

  it('rejects every fixture integrity mutation transactionally', () => {
    const job = runToUndo();
    const good = JSON.parse(serializeJob(job, '2026-01-01T00:00:00.000Z'));
    const mutate = (fn: (f: any) => void): string => {
      const copy = JSON.parse(JSON.stringify(good));
      fn(copy);
      return JSON.stringify(copy);
    };
    const cases: Array<[string, string]> = [
      ['malformed JSON', '{"format": "feed-repair-desk-job", '],
      ['unsupported job format version', mutate((f) => (f.formatVersion = '9.0.0'))],
      ['unsupported profile id', mutate((f) => (f.profile.id = 'other-profile'))],
      ['unsupported rule version with valid hash', mutate((f) => (f.profile.rulesVersion = '1999-01-01'))],
      ['changed original content without changing hash', mutate((f) => (f.source.text = f.source.text.replace('Desk lamp', 'Desk Lamp')))],
      ['stored current cell differs from replay', mutate((f) => (f.currentCells[0].value = 'preorder'))],
      ['extra stored current cell', mutate((f) => f.currentCells.push({ record: 2, column: 1, columnName: 'title', value: 'x' }))],
      ['change before-value no longer matches', mutate((f) => (f.changes[0].before = 'in stock'))],
      ['change targets nonexistent record', mutate((f) => (f.changes[0].record = 3))],
      ['change targets nonexistent column', mutate((f) => (f.changes[0].column = 9))],
      ['change column name disagrees with index', mutate((f) => (f.changes[0].columnName = 'title'))],
      ['non-contiguous sequence', mutate((f) => (f.changes[0].seq = 2))],
      ['wrong format', mutate((f) => (f.format = 'something-else'))],
      ['recorded issues disagree with recomputation', mutate((f) => f.unresolvedIssues.pop())],
      ['embedded source over limits', mutate((f) => { f.source.text = f.source.text + 'x'.repeat(2_000_000); })],
      ['embedded source malformed', mutate((f) => { f.source.text = 'id,title\n"unclosed'; })],
      ['not an object', '[]'],
    ];
    for (const [label, text] of cases) {
      const result = parseJobFile(text);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.message, label).toMatch(/^Job rejected/);
    }
    // The current job is untouched by any failed import because parseJobFile is pure.
    expect(job.changes.length).toBe(1);
    expect(parseJobFile(JSON.stringify(good)).ok).toBe(true);
  });

  it('accepts a job the app itself exported for every valid fixture source, including the empty dataset', () => {
    const sources: string[] = [];
    for (const c2 of fixtures.cases) {
      for (const s of c2.sources ?? []) sources.push(s.source.text);
      if (c2.source) sources.push(c2.source.text);
      if (c2.source_a) sources.push(c2.source_a.text);
      if (c2.header_variant) sources.push(c2.header_variant.source.text);
      for (const v of c2.variants ?? []) if (v.id === 'header-only') sources.push(v.source.text);
    }
    let checked = 0;
    for (const text of sources) {
      const job = createJob('roundtrip.csv', text);
      if (!job.ok) continue;
      let current = job.value;
      for (const p of current.analysis.proposals) {
        const r = applyProposal(current, p.record, p.column);
        if (r.ok) current = r.value;
      }
      const serialized = serializeJob(current, '2026-01-01T00:00:00.000Z');
      const reopened = parseJobFile(serialized);
      expect(reopened.ok, text.slice(0, 40)).toBe(true);
      if (!reopened.ok) continue;
      expect(reopened.value.current).toEqual(current.current);
      expect(reopened.value.changes).toEqual(current.changes);
      expect(csvExportEligibility(reopened.value)).toEqual(csvExportEligibility(current));
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(9);
  });

  it('records the format version and counts in the file', () => {
    const job = runToUndo();
    const file = buildJobFile(job, '2026-01-01T00:00:00.000Z');
    expect(file.formatVersion).toBe(JOB_FORMAT_VERSION);
    expect(file.counts.activeChanges).toBe(1);
    expect(file.currentCells).toEqual([{ record: 1, column: 3, columnName: 'availability', value: 'in_stock' }]);
    expect(file.recordCount).toBe(2);
  });
});

describe('persistence', () => {
  class FakeStorage implements StorageLike {
    map = new Map<string, string>();
    failWrites = false;
    corruptReadback = false;
    getItem(key: string) {
      const v = this.map.get(key);
      if (v === undefined) return null;
      return this.corruptReadback && key === STORAGE_KEYS.job ? v.slice(0, -1) : v;
    }
    setItem(key: string, value: string) {
      if (this.failWrites) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      this.map.set(key, value);
    }
    removeItem(key: string) {
      this.map.delete(key);
    }
  }
  const c = fixtureCase('stale-export-and-persistence');

  it('saves with readback verification and restores the same job', () => {
    const storage = new FakeStorage();
    expect(readOptIn(storage)).toBe(false);
    expect(writeOptIn(storage, true)).toBe(true);
    const job = mustJob('source-a.csv', c.source_a.text);
    const outcome = saveJob(storage, job, new Date('2026-01-01T00:00:00Z'));
    expect(outcome.ok).toBe(true);
    const restored = loadSavedJob(storage);
    expect(restored?.ok).toBe(true);
    if (restored?.ok) {
      expect(restored.value.source.sha256).toBe(c.source_a.sha256);
      expect(restored.value.current[0][0]).toBe('000123');
    }
    expect(writeOptIn(storage, false)).toBe(true);
    expect(storage.map.size).toBe(0);
  });

  it('reports write failure and readback mismatch without claiming a save', () => {
    const storage = new FakeStorage();
    const job = mustJob('source-a.csv', c.source_a.text);
    storage.failWrites = true;
    expect(saveJob(storage, job)).toMatchObject({ ok: false });
    expect(saveJob(storage, job).message).toMatch(/QuotaExceededError/);
    storage.failWrites = false;
    storage.corruptReadback = true;
    expect(saveJob(storage, job).message).toMatch(/readback/);
    expect(saveJob(null, job).ok).toBe(false);
    expect(loadSavedJob(null)).toBeNull();
  });
});
