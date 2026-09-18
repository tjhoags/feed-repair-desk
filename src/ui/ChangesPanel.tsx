import type { Job } from '../core/job';
import { ValueChip } from './ValueChip';

interface Props {
  job: Job;
  onUndo: () => void;
  onRevalidate: () => void;
}

export function ChangesPanel({ job, onUndo, onRevalidate }: Props) {
  const { changes } = job;
  const last = changes[changes.length - 1];
  return (
    <div className="tabpanel">
      <div className="button-row">
        <button type="button" onClick={onUndo} disabled={!last} aria-describedby="undo-hint">
          Undo last change
        </button>
        <button type="button" onClick={onRevalidate}>
          Revalidate
        </button>
        <span className="small-text" id="undo-hint">
          {last ? (
            <>
              Undo will restore record {last.record} {last.columnName} to <ValueChip value={last.before} />.
            </>
          ) : (
            'No applied changes; every current cell equals its original.'
          )}
        </span>
      </div>
      <p className="small-text">
        {changes.length} applied change{changes.length === 1 ? '' : 's'} in the reversible ledger. Every entry records the exact cell, the previous value and the reason. Manual entries are user corrections, not
        verified facts.
      </p>
      {changes.length > 0 && (
        <ol className="ledger" aria-label="Applied changes, oldest first">
          {changes.map((change) => (
            <li key={change.seq}>
              <div>
                <span className="seq">#{change.seq}</span>
                Record <strong>{change.record}</strong> · column <strong>{change.columnName}</strong> ·{' '}
                <span className={`pill ${change.kind === 'proposal' ? 'accent' : 'ok'}`}>{change.kind === 'proposal' ? 'applied proposal' : 'manual correction'}</span>
              </div>
              <div>
                <ValueChip value={change.before} tone="before" label="Before" />
                <span className="arrow" aria-hidden="true">
                  →
                </span>
                <span className="visually-hidden">became</span>
                <ValueChip value={change.after} tone="after" label="After" />
              </div>
              <div className="small-text">Reason: {change.reason}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
