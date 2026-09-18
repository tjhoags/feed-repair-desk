import { useId } from 'react';
import type { ExportEligibility, Job } from '../core/job';
import { JOB_FORMAT_VERSION } from '../core/jobfile';
import { PROFILE } from '../core/profile';
import { baseName, formatBytes } from './download';

export interface PersistenceStatus {
  kind: 'off' | 'saved' | 'failed' | 'cleared' | 'restored' | 'unavailable';
  message: string;
  savedAt?: string;
  bytes?: number;
}

interface Props {
  job: Job;
  eligibility: ExportEligibility;
  jsonEligible: boolean;
  sourceDirty: boolean;
  persistenceEnabled: boolean;
  persistence: PersistenceStatus;
  onDownloadCsv: () => void;
  onDownloadJson: () => void;
  onPersistenceChange: (enabled: boolean) => void;
}

export function ExportPanel({ job, eligibility, jsonEligible, sourceDirty, persistenceEnabled, persistence, onDownloadCsv, onDownloadJson, onPersistenceChange }: Props) {
  const persistId = useId();
  const base = baseName(job.source.name);
  const unresolved = job.analysis.counts.productIssues;
  return (
    <div className="tabpanel two-col">
      <section className="panel" aria-labelledby="export-heading">
        <h3 id="export-heading">Downloads for {job.source.name}</h3>
        {sourceDirty && (
          <div className="notice warn" role="status">
            The source text differs from the validated job (source-differs-from-validated-job). Downloads are disabled until you analyze again, so nothing stale can be exported.
          </div>
        )}
        <div className="button-row">
          <button type="button" className="primary" onClick={onDownloadCsv} disabled={sourceDirty || !eligibility.csv} aria-describedby="csv-export-reason">
            Download revised CSV
          </button>
          <code>{base}-revised.csv</code>
        </div>
        <p className="small-text" id="csv-export-reason">
          {sourceDirty ? 'Disabled while the source differs from the validated job.' : eligibility.reason}
          {!sourceDirty && eligibility.csv && unresolved > 0 && ' This is a correction export, not a clean feed.'}
        </p>
        <div className="button-row">
          <button type="button" onClick={onDownloadJson} disabled={!jsonEligible} aria-describedby="json-export-reason">
            Download JSON job
          </button>
          <code>{base}-job.json</code>
        </div>
        <p className="small-text" id="json-export-reason">
          Portable record (format {JOB_FORMAT_VERSION}, profile {PROFILE.id} rules {PROFILE.rulesVersion}): the original source text and its SHA-256, the reversible change ledger with reasons, changed cells, unresolved issues and
          proposed repairs. Reopening it restores the same working and undo state after full validation.
        </p>
        <p className="small-text">
          CSV export writes UTF-8 with {job.parsed.lineEnding} line endings{job.parsed.hadBom ? ' and keeps the initial BOM' : ' and no BOM'}, matching the source. Quoting may be normalized; every logical cell value and the row order are
          preserved. Byte-identical reserialization is not claimed. A download prompt is not proof that a file was saved; check your downloads folder.
        </p>
      </section>
      <section className="panel" aria-labelledby="persist-heading">
        <h3 id="persist-heading">Keep in this browser</h3>
        <label className="checkbox" htmlFor={persistId}>
          <input id={persistId} type="checkbox" checked={persistenceEnabled} onChange={(event) => onPersistenceChange(event.target.checked)} />
          <span>
            Keep the current job in this browser's local storage (off by default). It stores the same JSON job shown above, on this device only, and restores it when you reopen the page. Nothing is uploaded. Turning this off
            removes the stored copy.
          </span>
        </label>
        <div className={`notice ${persistence.kind === 'saved' || persistence.kind === 'restored' ? 'ok' : persistence.kind === 'failed' || persistence.kind === 'unavailable' ? 'error' : 'info'}`} role="status" data-testid="persistence-status">
          {persistence.message}
          {persistence.kind === 'saved' && persistence.savedAt && persistence.bytes !== undefined && (
            <>
              {' '}
              ({formatBytes(persistence.bytes)}, {new Date(persistence.savedAt).toLocaleTimeString()})
            </>
          )}
        </div>
      </section>
    </div>
  );
}
