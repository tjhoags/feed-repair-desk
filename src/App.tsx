import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkByteLimit, decodeUtf8Strict, serializeCsv } from './core/csv';
import { applyManualCorrection, applyProposal, createJob, csvExportEligibility, revalidate, undoLastChange, type Job } from './core/job';
import { JOB_LIMITS, parseJobFile, serializeJob } from './core/jobfile';
import { getStorage, loadSavedJob, readOptIn, saveJob, writeOptIn } from './core/persistence';
import { SAMPLE_CSV, SAMPLE_NAME } from './sample';
import { CellEditor, type CellTarget } from './ui/CellEditor';
import { ChangesPanel } from './ui/ChangesPanel';
import { baseName, downloadText, formatBytes } from './ui/download';
import { ExportPanel, type PersistenceStatus } from './ui/ExportPanel';
import { IssuesPanel } from './ui/IssuesPanel';
import { ProfilePanel } from './ui/ProfilePanel';
import { RecordsPanel } from './ui/RecordsPanel';
import { SourcePanel } from './ui/SourcePanel';
import { Tabs } from './ui/Tabs';

type TabId = 'issues' | 'records' | 'changes' | 'export' | 'profile';

interface Notice {
  kind: 'info' | 'ok' | 'warn' | 'error';
  text: string;
}

interface Failure {
  code: string;
  message: string;
  sourceName: string;
}

const PASTED_NAME = 'pasted-feed.csv';

function describeJob(job: Job): string {
  const { counts } = job.analysis;
  const records = job.parsed.records.length;
  return `${records.toLocaleString()} record${records === 1 ? '' : 's'}, ${job.parsed.headers.length} columns. ${counts.proposals} proposed repair${counts.proposals === 1 ? '' : 's'}, ${counts.productIssues} unresolved product issue${counts.productIssues === 1 ? '' : 's'}, ${counts.formulaRisks} formula risk${counts.formulaRisks === 1 ? '' : 's'}.`;
}

export default function App() {
  const storage = useMemo(() => getStorage(), []);
  const [sourceText, setSourceText] = useState('');
  const [sourceName, setSourceName] = useState(PASTED_NAME);
  const [job, setJob] = useState<Job | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editor, setEditor] = useState<CellTarget | null>(null);
  const [tab, setTab] = useState<TabId>('issues');
  const [persistenceEnabled, setPersistenceEnabled] = useState<boolean>(() => readOptIn(storage));
  const [persistence, setPersistence] = useState<PersistenceStatus>(() =>
    storage ? { kind: 'off', message: 'Off. Nothing is written to browser storage; your work lives in this tab until you download it.' } : { kind: 'unavailable', message: 'Browser storage is unavailable here. Use the JSON download to keep your work.' },
  );
  const restoredRef = useRef(false);
  const storagePausedRef = useRef(false);
  const importGeneration = useRef(0);
  const invalidatePendingImport = () => { importGeneration.current += 1; };

  // Restore an explicitly kept job on first load, validating it like any other import.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!persistenceEnabled) return;
    const restored = loadSavedJob(storage);
    if (!restored) {
      setPersistence({ kind: 'cleared', message: 'On. No job is stored yet; the next analyzed job will be kept here.' });
      return;
    }
    if (restored.ok) {
      setJob(restored.value);
      setSourceText(restored.value.source.text);
      setSourceName(restored.value.source.name);
      setFailure(null);
      setNotice({ kind: 'ok', text: `Restored ${restored.value.source.name} from this browser's storage. ${describeJob(restored.value)}` });
      setPersistence({ kind: 'restored', message: 'Restored from this browser at page load; the stored copy passed full validation.' });
    } else {
      storagePausedRef.current = true;
      setNotice({ kind: 'error', text: `The job kept in this browser could not be restored. ${restored.message}` });
      setPersistence({ kind: 'failed', message: 'The stored job could not be restored. No stored data was changed; automatic storage updates are paused. Turn saving off to remove the stored copy, or download your current work.' });
    }
  }, [persistenceEnabled, storage]);

  // Keep the stored copy in sync while persistence is on, verifying every write by readback.
  useEffect(() => {
    // A null job on startup or a rejected import is not an instruction to delete a saved copy.
    if (!persistenceEnabled || !job || storagePausedRef.current) return;
    const outcome = saveJob(storage, job);
    if (outcome.ok) {
      setPersistence({ kind: 'saved', message: outcome.message, savedAt: outcome.savedAt, bytes: outcome.bytes });
    } else {
      setPersistence({ kind: 'failed', message: `${outcome.message} The last verified copy, if any, may be older than what you see.` });
    }
  }, [job, persistenceEnabled, storage]);

  const sourceDirty = job !== null && sourceText !== job.source.text;

  const analyze = useCallback((name: string, text: string) => {
    importGeneration.current += 1;
    setEditor(null);
    const result = createJob(name, text);
    if (result.ok) {
      setJob(result.value);
      setFailure(null);
      setNotice({ kind: 'ok', text: `Analyzed ${name}: ${describeJob(result.value)}` });
      setTab('issues');
    } else {
      setJob(null);
      setFailure({ code: result.code, message: result.message, sourceName: name });
      setNotice(null);
    }
  }, []);

  const onAnalyze = () => analyze(sourceName, sourceText);

  const onLoadSample = () => {
    setSourceText(SAMPLE_CSV);
    setSourceName(SAMPLE_NAME);
    analyze(SAMPLE_NAME, SAMPLE_CSV);
  };

  const onFile = async (file: File) => {
    const generation = ++importGeneration.current;
    const name = file.name || 'imported-feed.csv';
    const tooLarge = checkByteLimit(file.size);
    if (tooLarge) {
      setJob(null);
      setSourceText('');
      setSourceName(name);
      setFailure({ code: tooLarge.code, message: tooLarge.message, sourceName: name });
      setNotice(null);
      return;
    }
    setNotice({ kind: 'info', text: `Reading ${name}. Your current work remains available until the file is accepted.` });
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (generation !== importGeneration.current) return;
      setNotice({ kind: 'error', text: `Could not read ${name}. Your current work is unchanged; try importing the file again.` });
      return;
    }
    if (generation !== importGeneration.current) return;
    const decoded = decodeUtf8Strict(bytes);
    if (!decoded.ok) {
      setJob(null);
      setSourceText('');
      setSourceName(name);
      setFailure({ code: 'invalid_utf8', message: decoded.message, sourceName: name });
      setNotice(null);
      return;
    }
    setSourceText(decoded.text);
    setSourceName(name);
    analyze(name, decoded.text);
  };

  const onJobFile = async (file: File) => {
    const generation = ++importGeneration.current;
    if (file.size > JOB_LIMITS.maxBytes) {
      setNotice({ kind: 'error', text: `Job rejected: ${file.name} is ${formatBytes(file.size)}, above the ${JOB_LIMITS.maxBytes.toLocaleString()}-byte job limit. Your current work is unchanged.` });
      return;
    }
    setNotice({ kind: 'info', text: `Reading ${file.name}. Your current work remains available until the job is accepted.` });
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (generation !== importGeneration.current) return;
      setNotice({ kind: 'error', text: `Could not read ${file.name}. Your current work is unchanged; try importing the file again.` });
      return;
    }
    if (generation !== importGeneration.current) return;
    const decoded = decodeUtf8Strict(bytes);
    if (!decoded.ok) {
      setNotice({ kind: 'error', text: `Job rejected: ${file.name} is not valid UTF-8. Your current work is unchanged.` });
      return;
    }
    const result = parseJobFile(decoded.text);
    if (!result.ok) {
      setNotice({ kind: 'error', text: `${file.name}: ${result.message}` });
      return;
    }
    setEditor(null);
    setJob(result.value);
    setSourceText(result.value.source.text);
    setSourceName(result.value.source.name);
    setFailure(null);
    setNotice({ kind: 'ok', text: `Reopened job for ${result.value.source.name} from ${file.name}: ${result.value.changes.length} applied change${result.value.changes.length === 1 ? '' : 's'} replayed and verified. ${describeJob(result.value)}` });
    setTab('issues');
  };

  const onApply = (record: number, column: number) => {
    invalidatePendingImport();
    if (!job) return;
    const result = applyProposal(job, record, column);
    if (result.ok) {
      setJob(result.value);
      const change = result.value.changes[result.value.changes.length - 1];
      setNotice({ kind: 'ok', text: `Applied: record ${change.record} ${change.columnName} changed from "${change.before}" to "${change.after}". Undo is available.` });
    } else {
      setNotice({ kind: 'error', text: result.message });
    }
  };

  const onApplyAll = () => {
    invalidatePendingImport();
    if (!job) return;
    let next = job;
    let applied = 0;
    let stoppedReason: string | null = null;
    for (const proposal of job.analysis.proposals) {
      const result = applyProposal(next, proposal.record, proposal.column);
      if (result.ok) {
        next = result.value;
        applied += 1;
      } else {
        stoppedReason = result.message;
        break;
      }
    }
    setJob(next);
    setNotice({ kind: stoppedReason ? 'warn' : 'ok', text: `Applied ${applied} proposed spelling repair${applied === 1 ? '' : 's'}. Each one is a separate ledger entry you can undo.${stoppedReason ? ` Stopped: ${stoppedReason} Remaining proposals were not applied.` : ''}` });
  };

  const onManualSave = (value: string) => {
    invalidatePendingImport();
    if (!job || !editor) return;
    const result = applyManualCorrection(job, editor.record, editor.column, value);
    if (result.ok) {
      setJob(result.value);
      const change = result.value.changes[result.value.changes.length - 1];
      setNotice({ kind: 'ok', text: `Recorded your correction for record ${change.record} ${change.columnName}. It is stored as entered, not verified.` });
      setEditor(null);
    } else {
      setNotice({ kind: 'error', text: result.message });
    }
  };

  const onUndo = () => {
    invalidatePendingImport();
    if (!job) return;
    const last = job.changes[job.changes.length - 1];
    const result = undoLastChange(job);
    if (result.ok) {
      setJob(result.value);
      setNotice({ kind: 'ok', text: `Undid change #${last.seq}: record ${last.record} ${last.columnName} is back to "${last.before}". Any resulting issue or proposal is open again.` });
    } else {
      setNotice({ kind: 'error', text: result.message });
    }
  };

  const onRevalidate = () => {
    invalidatePendingImport();
    if (!job) return;
    const next = revalidate(job);
    setJob(next);
    setNotice({ kind: 'info', text: `Revalidated ${next.source.name}: ${describeJob(next)} No changes were added; the ledger still has ${next.changes.length} entr${next.changes.length === 1 ? 'y' : 'ies'}.` });
  };

  const eligibility = job ? csvExportEligibility(job) : { csv: false, reason: 'No validated job.' };
  const jsonEligible = job !== null && !sourceDirty;

  const onDownloadCsv = () => {
    if (!job || sourceDirty || !eligibility.csv) return;
    const text = serializeCsv(job.parsed.headers, job.current, job.parsed.lineEnding, job.parsed.hadBom);
    const filename = `${baseName(job.source.name)}-revised.csv`;
    const bytes = downloadText(filename, text, 'text/csv;charset=utf-8');
    setNotice({ kind: 'info', text: `Download started for ${filename} (${formatBytes(bytes)}) from ${job.source.name} with ${job.changes.length} applied change${job.changes.length === 1 ? '' : 's'}. Confirm the file in your downloads; this message is not proof it was saved.` });
  };

  const onDownloadJson = () => {
    if (!job || sourceDirty) return;
    const filename = `${baseName(job.source.name)}-job.json`;
    const bytes = downloadText(filename, serializeJob(job), 'application/json');
    setNotice({ kind: 'info', text: `Download started for ${filename} (${formatBytes(bytes)}) from ${job.source.name}. Confirm the file in your downloads; this message is not proof it was saved.` });
  };

  const onPersistenceChange = (enabled: boolean) => {
    const written = writeOptIn(storage, enabled);
    if (!storage || !written) {
      storagePausedRef.current = true;
      setPersistence({ kind: 'failed', message: `Could not verify ${enabled ? 'the storage setting' : 'removal of the stored copy'}. Earlier data or the setting may remain in this browser. Automatic storage updates are paused in this tab; retry the setting or download your current work.` });
      return;
    }
    storagePausedRef.current = false;
    setPersistenceEnabled(enabled);
    if (!enabled) {
      setPersistence({ kind: 'off', message: 'Off. The stored copy was removed; your work stays in this tab until you download it.' });
    }
  };

  const counts = job?.analysis.counts;
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'issues', label: `Issues${counts ? ` (${counts.proposals + counts.totalIssues + (job?.analysis.headerRisks.length ?? 0)})` : ''}` },
    { id: 'records', label: `Records${job ? ` (${job.parsed.records.length.toLocaleString()})` : ''}` },
    { id: 'changes', label: `Changes${job ? ` (${job.changes.length})` : ''}` },
    { id: 'export', label: 'Export & keep' },
    { id: 'profile', label: 'Profile' },
  ];

  return (
    <div className="app">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="masthead">
        <div>
          <h1>Feed Repair Desk</h1>
          <p className="tagline">Inspect a product CSV, apply only the repairs you choose, and export a reviewable result. Everything runs in this browser tab; nothing is uploaded.</p>
        </div>
        {job && (
          <span className={`pill ${failure ? 'danger' : sourceDirty ? 'warn' : 'ok'}`} data-testid="job-status">
            {sourceDirty ? 'Source edited, not validated' : 'Analyzed feed'}
          </span>
        )}
      </header>

      <SourcePanel
        sourceText={sourceText}
        sourceName={sourceName}
        job={job}
        sourceDirty={sourceDirty}
        failure={failure}
        onSourceTextChange={(text) => { invalidatePendingImport(); setNotice(null); setSourceText(text); }}
        onAnalyze={onAnalyze}
        onFile={(file) => {
          void onFile(file);
        }}
        onJobFile={(file) => {
          void onJobFile(file);
        }}
        onLoadSample={onLoadSample}
      />

      <div role="status" aria-live="polite" data-testid="notice">
        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
      </div>

      {job && counts && (
        <main id="workspace" className="panel" aria-label="Workspace">
          <div className="stats" aria-label="Summary">
            <div className="stat">
              <span className="value" data-testid="stat-records">
                {job.parsed.records.length.toLocaleString()}
              </span>
              <span className="label">Records</span>
            </div>
            <div className={`stat ${counts.proposals > 0 ? 'accent' : ''}`}>
              <span className="value" data-testid="stat-proposals">
                {counts.proposals}
              </span>
              <span className="label">Proposed repairs</span>
            </div>
            <div className="stat">
              <span className="value" data-testid="stat-applied">
                {job.changes.length}
              </span>
              <span className="label">Applied changes</span>
            </div>
            <div className={`stat ${counts.productIssues > 0 ? 'warn' : ''}`}>
              <span className="value" data-testid="stat-issues">
                {counts.productIssues}
              </span>
              <span className="label">Unresolved issues</span>
            </div>
            <div className={`stat ${counts.formulaRisks + job.analysis.headerRisks.length > 0 ? 'danger' : ''}`}>
              <span className="value" data-testid="stat-risks">
                {counts.formulaRisks + job.analysis.headerRisks.length}
              </span>
              <span className="label">Formula risks</span>
            </div>
            <div className="stat">
              <span className="value" data-testid="stat-affected">
                {counts.affectedRecords}
              </span>
              <span className="label">Affected records</span>
            </div>
          </div>
          <div className="status-line">
            <span>
              <span className={`pill ${sourceDirty ? 'warn' : eligibility.csv ? 'ok' : 'danger'}`} data-testid="csv-eligibility">
                {sourceDirty ? 'CSV export: source not validated' : eligibility.csv ? 'CSV export: allowed' : 'CSV export: blocked'}
              </span>
            </span>
            <span>{sourceDirty ? 'Analyze the edited source to refresh results and downloads.' : eligibility.reason}</span>
            <button type="button" className="small" onClick={onUndo} disabled={job.changes.length === 0}>
              Undo last change
            </button>
            <button type="button" className="small" onClick={onRevalidate}>
              Revalidate
            </button>
          </div>
          <Tabs tabs={tabs} active={tab} onChange={setTab} idPrefix="ws" />
          <div id={`ws-panel-${tab}`} role="tabpanel" aria-labelledby={`ws-tab-${tab}`} tabIndex={0}>
            {tab === 'issues' && <IssuesPanel job={job} onApply={onApply} onApplyAll={onApplyAll} onEdit={(target) => { invalidatePendingImport(); setNotice(null); setEditor(target); }} />}
            {tab === 'records' && <RecordsPanel job={job} onEdit={(target) => { invalidatePendingImport(); setNotice(null); setEditor(target); }} />}
            {tab === 'changes' && <ChangesPanel job={job} onUndo={onUndo} onRevalidate={onRevalidate} />}
            {tab === 'export' && (
              <ExportPanel
                job={job}
                eligibility={eligibility}
                jsonEligible={jsonEligible}
                sourceDirty={sourceDirty}
                persistenceEnabled={persistenceEnabled}
                persistence={persistence}
                onDownloadCsv={onDownloadCsv}
                onDownloadJson={onDownloadJson}
                onPersistenceChange={onPersistenceChange}
              />
            )}
            {tab === 'profile' && <ProfilePanel job={job} />}
          </div>
        </main>
      )}

      {!job && !failure && (
        <section className="panel" aria-label="How it works">
          <h2>How it works</h2>
          <ol className="small-text">
            <li>Import or paste a product CSV, or try the fictional sample. The file is parsed strictly; malformed input is rejected whole.</li>
            <li>Review proposed spelling repairs and unresolved issues by record and column. Nothing is changed until you apply or enter a value.</li>
            <li>Undo any change, revalidate, then download the revised CSV and a JSON job that reopens the same state.</li>
          </ol>
          <p className="small-text">Passing these checks means the file satisfies this profile only, not any marketplace's rules. Links, inventory, currencies and GTIN ownership are never verified.</p>
        </section>
      )}

      {editor && job && <CellEditor key={`${editor.record}:${editor.column}`} job={job} target={editor} onSave={onManualSave} onClose={() => setEditor(null)} />}

      <footer className="footer">
        <span>Feed Repair Desk runs locally in your browser with bundled dependencies and system fonts: no accounts, uploads, telemetry or external services.</span>
        <span>Synthetic examples only. Passing the implemented profile is not marketplace approval, proof of product truth or evidence of results.</span>
      </footer>
    </div>
  );
}
