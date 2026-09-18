import { useEffect, useId, useRef, useState } from 'react';
import { SOURCE_LIMITS } from '../core/csv';
import type { Job } from '../core/job';
import { formatBytes } from './download';

interface Props {
  sourceText: string;
  sourceName: string;
  job: Job | null;
  sourceDirty: boolean;
  failure: { code: string; message: string; sourceName: string } | null;
  onSourceTextChange: (text: string) => void;
  onAnalyze: () => void;
  onFile: (file: File) => void;
  onJobFile: (file: File) => void;
  onLoadSample: () => void;
}

export function SourcePanel({ sourceText, sourceName, job, sourceDirty, failure, onSourceTextChange, onAnalyze, onFile, onJobFile, onLoadSample }: Props) {
  const textId = useId();
  const fileId = useId();
  const jobFileId = useId();
  const [open, setOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<HTMLInputElement>(null);
  const hasJob = job !== null;
  const jobHash = job?.source.sha256 ?? null;
  useEffect(() => {
    setOpen(jobHash === null);
  }, [jobHash]);
  const summary = hasJob
    ? `${job.source.name} · ${job.parsed.records.length.toLocaleString()} record${job.parsed.records.length === 1 ? '' : 's'} · ${job.parsed.headers.length} columns · ${formatBytes(job.source.byteLength)} · SHA-256 ${job.source.sha256.slice(0, 12)}…`
    : failure
      ? `${failure.sourceName} · not analyzed`
      : 'No source loaded';

  return (
    <section className="panel" aria-labelledby="source-heading">
      <div className="panel-head">
        <h2 id="source-heading">Source</h2>
        <span className="meta">{summary}</span>
        {hasJob && (
          <button type="button" className="small" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide source editor' : 'Edit source'}
          </button>
        )}
      </div>
      {(open || !hasJob) && (
        <>
          <div className="button-row">
            <label htmlFor={fileId} className="visually-hidden">
              Import CSV file
            </label>
            <input
              id={fileId}
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-describedby="source-limits"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onFile(file);
                }
                event.target.value = '';
              }}
            />
            <button type="button" onClick={onLoadSample}>
              Try the fictional sample
            </button>
            <label htmlFor={jobFileId} className="visually-hidden">
              Reopen JSON job
            </label>
            <button type="button" onClick={() => jobRef.current?.click()}>
              Reopen JSON job…
            </button>
            <input
              id={jobFileId}
              ref={jobRef}
              type="file"
              accept=".json,application/json"
              className="visually-hidden"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onJobFile(file);
                }
                event.target.value = '';
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={textId}>Or paste CSV text ({sourceName})</label>
            <textarea
              id={textId}
              value={sourceText}
              spellCheck={false}
              placeholder={'id,title,price,availability,link\nsku-1,Desk lamp,20.00 USD,in_stock,https://example.invalid/p/sku-1'}
              onChange={(event) => onSourceTextChange(event.target.value)}
              aria-describedby="source-limits"
            />
            <p className="hint" id="source-limits">
              UTF-8 comma-separated CSV with a header row. LF or CRLF endings, an initial BOM and a missing final newline are fine. Supported input: up to{' '}
              {SOURCE_LIMITS.maxBytes.toLocaleString()} bytes, {SOURCE_LIMITS.maxRecords.toLocaleString()} data records and {SOURCE_LIMITS.maxColumns} columns. Required
              headers: id, title, price, availability, link (gtin optional; other columns are preserved). Nothing leaves this page.
            </p>
          </div>
          <div className="button-row">
            <button type="button" className="primary" onClick={onAnalyze} disabled={sourceText.length === 0}>
              {hasJob ? 'Analyze again' : 'Analyze CSV'}
            </button>
            {sourceDirty && (
              <span className="pill warn" role="status">
                Source text differs from the validated job
              </span>
            )}
          </div>
        </>
      )}
      {failure && (
        <div className="notice error" role="alert">
          <strong>{failure.sourceName} was not accepted ({failure.code.replace(/_/g, ' ')}).</strong> {failure.message} No partial data was kept and no earlier results are current.
        </div>
      )}
    </section>
  );
}
