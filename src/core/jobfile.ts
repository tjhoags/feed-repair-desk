import { checkByteLimit, parseCsv, utf8ByteLength } from './csv';
import { analyze, mapHeaders, PROFILE, type Issue } from './profile';
import type { Change, Job, SourceInfo } from './job';
import { sha256Hex } from './sha256';

export const JOB_FORMAT = 'feed-repair-desk-job';
export const JOB_FORMAT_VERSION = '1.0.0';
export const SUPPORTED_JOB_FORMAT_VERSIONS: ReadonlySet<string> = new Set([JOB_FORMAT_VERSION]);
export const SUPPORTED_PROFILES: ReadonlyMap<string, ReadonlySet<string>> = new Map([[PROFILE.id, new Set([PROFILE.rulesVersion])]]);

/**
 * Separate bounded guard for the JSON job. It accommodates JSON escaping of the
 * embedded source plus the ledger; the embedded CSV still obeys the source limits.
 */
export const JOB_LIMITS = {
  maxBytes: 12_000_000,
  maxChanges: 100_000,
} as const;

interface JobFileIssue {
  record: number;
  column: number;
  columnName: string;
  reason: string;
  value: string;
  relatedRecords?: number[];
}

export interface JobFile {
  format: typeof JOB_FORMAT;
  formatVersion: string;
  profile: { id: string; rulesVersion: string };
  exportedAt: string;
  source: { name: string; sha256: string; byteLength: number; text: string };
  headers: string[];
  recordCount: number;
  /** Active reversible ledger in application order; Undo reverts the last entry. */
  changes: Change[];
  /** Cells whose current value differs from the original after replaying the ledger. */
  currentCells: Array<{ record: number; column: number; columnName: string; value: string }>;
  /** Unresolved issues recomputed under the recorded profile, for the accompanying report. */
  unresolvedIssues: JobFileIssue[];
  /** Full collision membership once per group; individual row issues remain above. */
  duplicateGroups: Array<{ value: string; records: number[] }>;
  headerFormulaRisks: Array<{ column: number; value: string }>;
  proposedRepairs: Array<{ record: number; column: number; columnName: string; before: string; after: string; reason: string }>;
  counts: {
    productIssues: number;
    formulaRisks: number;
    totalIssues: number;
    affectedRecords: number;
    duplicateIdGroups: number;
    proposals: number;
    activeChanges: number;
  };
  notes: string[];
}

export function buildJobFile(job: Job, exportedAt: string): JobFile {
  const currentCells: JobFile['currentCells'] = [];
  job.current.forEach((row, rowIndex) => {
    const original = job.parsed.records[rowIndex];
    row.forEach((value, column) => {
      if (value !== original[column]) {
        currentCells.push({ record: rowIndex + 1, column, columnName: job.parsed.headers[column], value });
      }
    });
  });
  return {
    format: JOB_FORMAT,
    formatVersion: JOB_FORMAT_VERSION,
    profile: { id: PROFILE.id, rulesVersion: PROFILE.rulesVersion },
    exportedAt,
    source: {
      name: job.source.name,
      sha256: job.source.sha256,
      byteLength: job.source.byteLength,
      text: job.source.text,
    },
    headers: job.parsed.headers,
    recordCount: job.parsed.records.length,
    changes: job.changes,
    currentCells,
    unresolvedIssues: job.analysis.issues.map(toFileIssue),
    duplicateGroups: job.analysis.duplicateGroups,
    headerFormulaRisks: job.analysis.headerRisks,
    proposedRepairs: job.analysis.proposals.map((p) => ({ record: p.record, column: p.column, columnName: p.columnName, before: p.before, after: p.after, reason: p.reason })),
    counts: { ...job.analysis.counts, activeChanges: job.changes.length },
    notes: [
      'source.text is the original import, including any BOM; source.sha256 is SHA-256 over its UTF-8 bytes and identifies content only.',
      'Manual corrections are user-entered values, not independently verified product facts.',
      'Passing the implemented profile is not marketplace approval, proof of product truth or evidence of results.',
    ],
  };
}

function toFileIssue(issue: Issue): JobFileIssue {
  const out: JobFileIssue = { record: issue.record, column: issue.column, columnName: issue.columnName, reason: issue.reason, value: issue.value };
  if (issue.relatedRecords) {
    out.relatedRecords = issue.relatedRecords;
  }
  return out;
}

export function serializeJob(job: Job, exportedAt: string = new Date().toISOString()): string {
  return JSON.stringify(buildJobFile(job, exportedAt), null, 2);
}

/**
 * Creation, imports and edits must remain portable before they become current.
 * A fixed-width ISO timestamp makes this the same byte budget as normal exports.
 */
export function portableJobProblem(job: Job): string | null {
  if (job.changes.length > JOB_LIMITS.maxChanges) {
    return `The active ledger would exceed ${JOB_LIMITS.maxChanges.toLocaleString()} changes. Undo a change or start a smaller job; nothing was changed.`;
  }
  const bytes = utf8ByteLength(serializeJob(job, '2000-01-01T00:00:00.000Z'));
  if (bytes > JOB_LIMITS.maxBytes) {
    return `The portable JSON job would require ${bytes.toLocaleString()} bytes, above the ${JOB_LIMITS.maxBytes.toLocaleString()}-byte job limit. Use a smaller source or correction so the result can be reopened; nothing was changed.`;
  }
  return null;
}

/** Replays the active ledger, validating each cell's identity and before-value. */
export function replayChanges(
  headers: string[],
  original: string[][],
  changes: Change[],
): { ok: true; current: string[][] } | { ok: false; message: string } {
  const current = original.map((row) => row.slice());
  for (const change of changes) {
    if (!Number.isInteger(change.record) || change.record < 1 || change.record > current.length) {
      return { ok: false, message: `Change ${change.seq} targets record ${change.record}, which does not exist.` };
    }
    if (!Number.isInteger(change.column) || change.column < 0 || change.column >= headers.length) {
      return { ok: false, message: `Change ${change.seq} targets column index ${change.column}, which does not exist.` };
    }
    if (headers[change.column] !== change.columnName) {
      return { ok: false, message: `Change ${change.seq} names column "${change.columnName}" but column index ${change.column} is "${headers[change.column]}".` };
    }
    const row = current[change.record - 1];
    if (row[change.column] !== change.before) {
      return {
        ok: false,
        message: `Change ${change.seq} expects record ${change.record} ${change.columnName} to be ${JSON.stringify(change.before)} before it applies, but replay found ${JSON.stringify(row[change.column])}.`,
      };
    }
    row[change.column] = change.after;
  }
  return { ok: true, current };
}

export interface JobImportFailure {
  ok: false;
  message: string;
}

export type JobImportResult = { ok: true; value: Job } | JobImportFailure;

function fail(message: string): JobImportFailure {
  return { ok: false, message: `Job rejected: ${message} Your current work is unchanged.` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function issueKey(issue: { record: number; column: number; reason: string; value: string }): string {
  return JSON.stringify([issue.record, issue.column, issue.reason, issue.value]);
}

/**
 * Validates a whole job before loading it: format and version, profile and rule
 * version, types, bounded sizes, source hash and limits, replayed ledger anchors,
 * agreement between replayed changes and stored current cells, and recomputed
 * issues under the recorded profile. Fails without producing a partial job.
 */
export function parseJobFile(text: string): JobImportResult {
  if (utf8ByteLength(text) > JOB_LIMITS.maxBytes) {
    return fail(`the file is larger than the ${JOB_LIMITS.maxBytes.toLocaleString()}-byte job limit.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return fail(`the file is not valid JSON (${error instanceof Error ? error.message : 'parse error'}).`);
  }
  if (!isRecord(raw)) {
    return fail('the top level is not an object.');
  }
  if (raw.format !== JOB_FORMAT) {
    return fail(`format is ${JSON.stringify(raw.format)}, expected ${JSON.stringify(JOB_FORMAT)}.`);
  }
  if (typeof raw.formatVersion !== 'string' || !SUPPORTED_JOB_FORMAT_VERSIONS.has(raw.formatVersion)) {
    return fail(`job format version ${JSON.stringify(raw.formatVersion)} is not supported (supported: ${[...SUPPORTED_JOB_FORMAT_VERSIONS].join(', ')}).`);
  }
  if (!isRecord(raw.profile) || typeof raw.profile.id !== 'string' || typeof raw.profile.rulesVersion !== 'string') {
    return fail('profile identifier or rule version is missing.');
  }
  const supportedRules = SUPPORTED_PROFILES.get(raw.profile.id);
  if (!supportedRules) {
    return fail(`validation profile ${JSON.stringify(raw.profile.id)} is not supported by this build (supported: ${PROFILE.id}).`);
  }
  if (!supportedRules.has(raw.profile.rulesVersion)) {
    return fail(`rule version ${JSON.stringify(raw.profile.rulesVersion)} of profile ${raw.profile.id} is not supported (supported: ${[...supportedRules].join(', ')}).`);
  }
  if (!isRecord(raw.source) || typeof raw.source.text !== 'string' || typeof raw.source.sha256 !== 'string' || typeof raw.source.name !== 'string') {
    return fail('source name, text or hash is missing or has the wrong type.');
  }
  const sourceText = raw.source.text;
  const byteLength = utf8ByteLength(sourceText);
  const byteFailure = checkByteLimit(byteLength);
  if (byteFailure) {
    return fail(`the embedded source exceeds the source limits. ${byteFailure.message}`);
  }
  if (raw.source.byteLength !== undefined && raw.source.byteLength !== byteLength) {
    return fail(`declared source byte length ${String(raw.source.byteLength)} does not match the embedded text (${byteLength}).`);
  }
  const actualHash = sha256Hex(sourceText);
  if (!/^[0-9a-f]{64}$/.test(raw.source.sha256) || raw.source.sha256 !== actualHash) {
    return fail('the declared source hash does not match the embedded source text. The job was edited or corrupted.');
  }
  const parsed = parseCsv(sourceText);
  if (!parsed.ok) {
    return fail(`the embedded source does not parse under the source rules. ${parsed.message}`);
  }
  const mapped = mapHeaders(parsed.value.headers);
  if (!mapped.ok) {
    return fail(`the embedded source fails header identification. ${mapped.message}`);
  }
  if (!isStringArray(raw.headers) || raw.headers.length !== parsed.value.headers.length || raw.headers.some((h, i) => h !== parsed.value.headers[i])) {
    return fail('the recorded headers do not match the embedded source.');
  }
  if (raw.recordCount !== parsed.value.records.length) {
    return fail(`the recorded record count ${String(raw.recordCount)} does not match the embedded source (${parsed.value.records.length}).`);
  }
  if (!Array.isArray(raw.changes)) {
    return fail('changes is not an array.');
  }
  if (raw.changes.length > JOB_LIMITS.maxChanges) {
    return fail(`the ledger has ${raw.changes.length} entries; the limit is ${JOB_LIMITS.maxChanges}.`);
  }
  const changes: Change[] = [];
  for (let i = 0; i < raw.changes.length; i += 1) {
    const entry: unknown = raw.changes[i];
    if (!isRecord(entry)) {
      return fail(`change ${i + 1} is not an object.`);
    }
    const { seq, record, column, columnName, before, after, kind, reason } = entry;
    if (seq !== i + 1) {
      return fail(`change ${i + 1} has sequence ${String(seq)}; the ledger must be contiguous.`);
    }
    if (!isNonNegativeInt(record) || !isNonNegativeInt(column)) {
      return fail(`change ${i + 1} has a non-integer record or column.`);
    }
    if (typeof columnName !== 'string' || typeof before !== 'string' || typeof after !== 'string' || typeof reason !== 'string') {
      return fail(`change ${i + 1} has a non-string column name, before, after or reason.`);
    }
    if (kind !== 'proposal' && kind !== 'manual') {
      return fail(`change ${i + 1} has unknown kind ${JSON.stringify(kind)}.`);
    }
    if (before === after) {
      return fail(`change ${i + 1} does not change the cell.`);
    }
    changes.push({ seq, record, column, columnName, before, after, kind, reason });
  }
  const replay = replayChanges(parsed.value.headers, parsed.value.records, changes);
  if (!replay.ok) {
    return fail(`the change ledger does not replay. ${replay.message}`);
  }
  if (!Array.isArray(raw.currentCells)) {
    return fail('currentCells is not an array.');
  }
  const expectedDiff = new Map<string, string>();
  replay.current.forEach((row, rowIndex) => {
    row.forEach((value, column) => {
      if (value !== parsed.value.records[rowIndex][column]) {
        expectedDiff.set(`${rowIndex + 1}:${column}`, value);
      }
    });
  });
  if (raw.currentCells.length !== expectedDiff.size) {
    return fail(`stored current cells (${raw.currentCells.length}) do not agree with the replayed ledger (${expectedDiff.size} changed cells).`);
  }
  for (const cell of raw.currentCells as unknown[]) {
    if (!isRecord(cell) || !isNonNegativeInt(cell.record) || !isNonNegativeInt(cell.column) || typeof cell.value !== 'string' || typeof cell.columnName !== 'string') {
      return fail('a stored current cell has the wrong shape.');
    }
    if (cell.columnName !== parsed.value.headers[cell.column]) {
      return fail('a stored current cell column name does not match its column index.');
    }
    const key = `${cell.record}:${cell.column}`;
    const expected = expectedDiff.get(key);
    if (expected === undefined || expected !== cell.value) {
      return fail(`stored current cell for record ${cell.record}, column ${cell.column + 1} is repeated or differs from replaying the approved changes.`);
    }
    expectedDiff.delete(key);
  }
  const analysis = analyze(mapped.value, replay.current);
  if (!Array.isArray(raw.unresolvedIssues) || raw.unresolvedIssues.length !== analysis.issues.length) {
    return fail(`recorded unresolved issues (${Array.isArray(raw.unresolvedIssues) ? raw.unresolvedIssues.length : 'missing'}) do not match recomputation under ${PROFILE.id} ${PROFILE.rulesVersion} (${analysis.issues.length}).`);
  }
  const recomputed = new Set(analysis.issues.map(issueKey));
  for (const item of raw.unresolvedIssues as unknown[]) {
    if (!isRecord(item) || !isNonNegativeInt(item.record) || !isNonNegativeInt(item.column) || typeof item.reason !== 'string' || typeof item.value !== 'string') {
      return fail('a recorded issue has the wrong shape.');
    }
    const key = issueKey({ record: item.record, column: item.column, reason: item.reason, value: item.value });
    if (item.columnName !== parsed.value.headers[item.column] || !recomputed.delete(key)) {
      return fail(`recorded issue ${item.reason} at record ${item.record}, column ${item.column + 1} is not produced by recomputation.`);
    }
  }
  if (!isRecord(raw.counts) || raw.counts.activeChanges !== changes.length || raw.counts.totalIssues !== analysis.issues.length || raw.counts.proposals !== analysis.proposals.length) {
    return fail('recorded counts do not match the replayed job.');
  }
  const source: SourceInfo = { name: raw.source.name, text: sourceText, sha256: actualHash, byteLength };
  const value: Job = {
    source,
    parsed: parsed.value,
    columnMap: mapped.value,
    changes,
    current: replay.current,
    analysis,
  };
  const portableProblem = portableJobProblem(value);
  return portableProblem ? fail(portableProblem) : { ok: true, value };
}
