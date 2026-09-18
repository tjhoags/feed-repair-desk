import { analyze, mapHeaders, PROFILE, type Analysis, type ColumnMap } from './profile';
import { parseCsv, utf8ByteLength, type ParsedSource, type ParseFailure } from './csv';
import type { HeaderFailure } from './profile';
import { sha256Hex } from './sha256';
import { JOB_LIMITS, portableJobProblem } from './jobfile';

export { replayChanges } from './jobfile';

export interface SourceInfo {
  /** Display name for the source, such as the imported file name. */
  name: string;
  /** Original text exactly as imported, including any BOM. Never modified. */
  text: string;
  /** SHA-256 over the original UTF-8 bytes. Identifies content only. */
  sha256: string;
  byteLength: number;
}

export type ChangeKind = 'proposal' | 'manual';

export interface Change {
  /** One-based position in the active ledger. */
  seq: number;
  record: number;
  column: number;
  columnName: string;
  before: string;
  after: string;
  kind: ChangeKind;
  reason: string;
}

export interface Job {
  source: SourceInfo;
  parsed: ParsedSource;
  columnMap: ColumnMap;
  /** Active, reversible cell ledger in application order. Undo pops the last entry. */
  changes: Change[];
  /** Current cells: the immutable original with the ledger replayed. */
  current: string[][];
  analysis: Analysis;
}

export type JobFailure = ParseFailure | HeaderFailure | { ok: false; code: 'job_limit'; message: string };

export type JobResult = { ok: true; value: Job } | JobFailure;

export interface ActionFailure {
  ok: false;
  message: string;
}

export type ActionResult = { ok: true; value: Job } | ActionFailure;

function cloneMatrix(matrix: string[][]): string[][] {
  return matrix.map((row) => row.slice());
}

/** Builds a validated job from source text. Fails transactionally: no partial job exists on failure. */
export function createJob(name: string, text: string): JobResult {
  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return parsed;
  }
  const mapped = mapHeaders(parsed.value.headers);
  if (!mapped.ok) {
    return mapped;
  }
  const current = cloneMatrix(parsed.value.records);
  const source: SourceInfo = {
    name,
    text,
    sha256: sha256Hex(text),
    byteLength: utf8ByteLength(text),
  };
  const value: Job = {
    source,
    parsed: parsed.value,
    columnMap: mapped.value,
    changes: [],
    current,
    analysis: analyze(mapped.value, current),
  };
  const portableProblem = portableJobProblem(value);
  return portableProblem ? { ok: false, code: 'job_limit', message: portableProblem } : { ok: true, value };
}

export function isEmptyDataset(job: Job): boolean {
  return job.parsed.records.length === 0;
}

function validTarget(job: Job, record: number, column: number): string | null {
  if (!Number.isInteger(record) || record < 1 || record > job.current.length) {
    return `Record ${record} does not exist; the job has ${job.current.length} records.`;
  }
  if (!Number.isInteger(column) || column < 0 || column >= job.parsed.headers.length) {
    return `Column index ${column} does not exist; the job has ${job.parsed.headers.length} columns.`;
  }
  return null;
}

function withChange(job: Job, change: Omit<Change, 'seq'>): ActionResult {
  if (job.changes.length >= JOB_LIMITS.maxChanges) {
    return { ok: false, message: `The active ledger cannot exceed ${JOB_LIMITS.maxChanges.toLocaleString()} changes. Undo a change or start another job; nothing was changed.` };
  }
  const current = job.current.slice();
  const row = current[change.record - 1].slice();
  row[change.column] = change.after;
  current[change.record - 1] = row;
  const changes = [...job.changes, { ...change, seq: job.changes.length + 1 }];
  const value: Job = { ...job, changes, current, analysis: analyze(job.columnMap, current) };
  const problem = portableJobProblem(value);
  return problem ? { ok: false, message: problem } : { ok: true, value };
}

/** Applies a proposed spelling repair after checking that the target cell still holds the proposed before-value. */
export function applyProposal(job: Job, record: number, column: number): ActionResult {
  const proposal = job.analysis.proposals.find((p) => p.record === record && p.column === column);
  if (!proposal) {
    return { ok: false, message: `No proposed repair exists for record ${record}, column ${column + 1}.` };
  }
  const currentValue = job.current[record - 1][column];
  if (currentValue !== proposal.before) {
    return { ok: false, message: 'The cell changed since the proposal was made. Revalidate and try again.' };
  }
  return withChange(job, {
    record,
    column,
    columnName: job.parsed.headers[column],
    before: proposal.before,
    after: proposal.after,
    kind: 'proposal',
    reason: proposal.reason,
  });
}

/** Records an explicit user-entered correction. The value is stored as entered, not verified. */
export function applyManualCorrection(job: Job, record: number, column: number, value: string): ActionResult {
  const targetProblem = validTarget(job, record, column);
  if (targetProblem) {
    return { ok: false, message: targetProblem };
  }
  const before = job.current[record - 1][column];
  if (before === value) {
    return { ok: false, message: 'The entered value is identical to the current cell; nothing was recorded.' };
  }
  if (utf8ByteLength(value) > JOB_LIMITS.maxBytes) {
    return { ok: false, message: `The correction alone exceeds the ${JOB_LIMITS.maxBytes.toLocaleString()}-byte portable job limit; nothing was changed.` };
  }
  return withChange(job, {
    record,
    column,
    columnName: job.parsed.headers[column],
    before,
    after: value,
    kind: 'manual',
    reason: 'manual-correction',
  });
}

/** Reverts the most recent change, restoring its previous value and reopening any resulting issue. */
export function undoLastChange(job: Job): ActionResult {
  if (job.changes.length === 0) {
    return { ok: false, message: 'There is nothing to undo.' };
  }
  const last = job.changes[job.changes.length - 1];
  const currentValue = job.current[last.record - 1][last.column];
  if (currentValue !== last.after) {
    return { ok: false, message: 'The ledger does not match the current cells; undo was refused to avoid corrupting the job.' };
  }
  const current = job.current.slice();
  const row = current[last.record - 1].slice();
  row[last.column] = last.before;
  current[last.record - 1] = row;
  const changes = job.changes.slice(0, -1);
  const value: Job = { ...job, changes, current, analysis: analyze(job.columnMap, current) };
  const problem = portableJobProblem(value);
  return problem ? { ok: false, message: problem } : { ok: true, value };
}

/** Recomputes issues and proposals from the current cells. Adds no changes; idempotent. */
export function revalidate(job: Job): Job {
  return { ...job, analysis: analyze(job.columnMap, job.current) };
}

export interface ExportEligibility {
  csv: boolean;
  reason: string;
}

/** Explicit export policy for the revised CSV. The JSON job can always be exported for a valid job. */
export function csvExportEligibility(job: Job): ExportEligibility {
  if (isEmptyDataset(job)) {
    return { csv: false, reason: 'Nothing to export: the file has a header row but no product records.' };
  }
  const headerRisks = job.analysis.headerRisks.length;
  const cellRisks = job.analysis.counts.formulaRisks;
  if (headerRisks > 0 || cellRisks > 0) {
    const parts: string[] = [];
    if (cellRisks > 0) {
      parts.push(`${cellRisks} cell${cellRisks === 1 ? '' : 's'}`);
    }
    if (headerRisks > 0) {
      parts.push(`${headerRisks} header${headerRisks === 1 ? '' : 's'}`);
    }
    return {
      csv: false,
      reason: `Blocked by the formula policy: ${parts.join(' and ')} still start with a formula trigger. Correct the values explicitly; acknowledging is not a fix.`,
    };
  }
  const unresolved = job.analysis.counts.productIssues;
  const proposals = job.analysis.counts.proposals;
  const notes: string[] = [];
  if (unresolved > 0) {
    notes.push(`${unresolved} unresolved product issue${unresolved === 1 ? '' : 's'} stay in the file and are listed in the JSON job`);
  }
  if (proposals > 0) {
    notes.push(`${proposals} proposed repair${proposals === 1 ? '' : 's'} not applied`);
  }
  return {
    csv: true,
    reason: notes.length > 0 ? `Correction export allowed; ${notes.join('; ')}.` : 'Every implemented profile check passed. This is not marketplace approval.',
  };
}

export const PROFILE_ID = PROFILE.id;
export const RULES_VERSION = PROFILE.rulesVersion;
