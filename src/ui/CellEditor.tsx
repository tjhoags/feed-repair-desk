import { useEffect, useRef, useState } from 'react';
import type { Job } from '../core/job';
import { ValueChip } from './ValueChip';

export interface CellTarget {
  record: number;
  column: number;
}

interface Props {
  job: Job;
  target: CellTarget;
  onSave: (value: string) => void;
  onClose: () => void;
}

/** Explicit manual correction dialog. The entered value is recorded as user-entered, not verified. */
export function CellEditor({ job, target, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = job.current[target.record - 1][target.column];
  const original = job.parsed.records[target.record - 1][target.column];
  const columnName = job.parsed.headers[target.column];
  const [value, setValue] = useState(current);
  const issues = job.analysis.issues.filter((issue) => issue.record === target.record && issue.column === target.column);
  const proposal = job.analysis.proposals.find((p) => p.record === target.record && p.column === target.column);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const unchanged = value === current;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="cell-editor-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!unchanged) {
            onSave(value);
          }
        }}
      >
        <h2 id="cell-editor-title">
          Correct record {target.record}, column <code>{columnName}</code>
        </h2>
        <dl className="kv">
          <dt>Current value</dt>
          <dd>
            <ValueChip value={current} />
          </dd>
          {original !== current && (
            <>
              <dt>Original value</dt>
              <dd>
                <ValueChip value={original} tone="before" />
              </dd>
            </>
          )}
          {proposal && (
            <>
              <dt>Proposed repair</dt>
              <dd>
                <ValueChip value={proposal.after} tone="after" /> <span className="small-text">({proposal.reason})</span>
              </dd>
            </>
          )}
          {issues.length > 0 && (
            <>
              <dt>Open issues</dt>
              <dd>
                {issues.map((issue) => (
                  <div key={issue.reason} className="small-text">
                    <strong>{issue.reason}</strong>: {issue.message}
                  </div>
                ))}
              </dd>
            </>
          )}
        </dl>
        <div className="field">
          <label htmlFor="cell-editor-value">New value (stored exactly as typed, including spaces)</label>
          <textarea id="cell-editor-value" className="wrap" rows={3} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
          <p className="hint">This is recorded as your correction, not as a verified product fact. Undo restores the previous value.</p>
        </div>
        <div className="button-row">
          <button type="submit" className="primary" disabled={unchanged}>
            Save correction
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {unchanged && <span className="small-text">Enter a different value to enable saving.</span>}
        </div>
      </form>
    </dialog>
  );
}
