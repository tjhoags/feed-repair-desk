import { useId, useMemo, useState } from 'react';
import type { Job } from '../core/job';
import type { CellTarget } from './CellEditor';

interface Props {
  job: Job;
  onEdit: (target: CellTarget) => void;
}

const PAGE_SIZE = 50;

export function RecordsPanel({ job, onEdit }: Props) {
  const [page, setPage] = useState(0);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const filterId = useId();
  const pageId = useId();
  const { headers, records: original } = job.parsed;
  const { current, analysis } = job;

  const cellIssues = useMemo(() => {
    const map = new Map<string, { risk: boolean; reasons: string[] }>();
    for (const issue of analysis.issues) {
      const key = `${issue.record}:${issue.column}`;
      const entry = map.get(key) ?? { risk: false, reasons: [] };
      entry.reasons.push(issue.reason);
      if (issue.reason === 'formula-risk') {
        entry.risk = true;
      }
      map.set(key, entry);
    }
    return map;
  }, [analysis]);

  const proposalCells = useMemo(() => new Set(analysis.proposals.map((p) => `${p.record}:${p.column}`)), [analysis]);
  const flaggedRecords = useMemo(() => {
    const set = new Set<number>();
    for (const issue of analysis.issues) set.add(issue.record);
    for (const proposal of analysis.proposals) set.add(proposal.record);
    return set;
  }, [analysis]);
  const headerRiskColumns = useMemo(() => new Set(analysis.headerRisks.map((r) => r.column)), [analysis]);

  const visibleIndexes = useMemo(() => {
    const all = current.map((_, index) => index);
    return onlyFlagged ? all.filter((index) => flaggedRecords.has(index + 1)) : all;
  }, [current, onlyFlagged, flaggedRecords]);

  const pageCount = Math.max(1, Math.ceil(visibleIndexes.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageIndexes = visibleIndexes.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (current.length === 0) {
    return (
      <div className="tabpanel">
        <div className="notice info" role="status">
          The header row was read ({headers.length} columns) but the file has no product records to show.
        </div>
      </div>
    );
  }

  return (
    <div className="tabpanel">
      <div className="toolbar">
        <label htmlFor={filterId}>
          <input
            id={filterId}
            type="checkbox"
            checked={onlyFlagged}
            onChange={(event) => {
              setOnlyFlagged(event.target.checked);
              setPage(0);
            }}
          />
          Only records with issues or proposals ({flaggedRecords.size})
        </label>
        <span>
          Showing {pageIndexes.length === 0 ? 0 : safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + pageIndexes.length} of {visibleIndexes.length.toLocaleString()} record
          {visibleIndexes.length === 1 ? '' : 's'}
        </span>
        {pageCount > 1 && (
          <>
            <button type="button" className="small" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}>
              Previous page
            </button>
            <label htmlFor={pageId}>
              Page
              <input
                id={pageId}
                type="number"
                min={1}
                max={pageCount}
                value={safePage + 1}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isInteger(next) && next >= 1 && next <= pageCount) {
                    setPage(next - 1);
                  }
                }}
              />
              of {pageCount}
            </label>
            <button type="button" className="small" onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage >= pageCount - 1}>
              Next page
            </button>
          </>
        )}
      </div>
      <p className="small-text">Select any cell to enter an explicit correction. Shaded cells carry an open issue (amber), a formula risk (red) or an applied change (green); each cell also says so in text.</p>
      <div className="table-region" role="region" aria-label="Records table, scrolls horizontally" tabIndex={0}>
        <table className="grid">
          <thead>
            <tr>
              <th scope="col" className="record-col">
                #
              </th>
              {headers.map((header, column) => (
                <th scope="col" key={column}>
                  <span className="mono">{header.length === 0 ? '(unnamed)' : header}</span>
                  {headerRiskColumns.has(column) && <span className="flag">formula risk</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageIndexes.map((index) => {
              const record = index + 1;
              const row = current[index];
              return (
                <tr key={record}>
                  <td className="record-col">{record}</td>
                  {row.map((value, column) => {
                    const key = `${record}:${column}`;
                    const info = cellIssues.get(key);
                    const changed = value !== original[index][column];
                    const proposed = proposalCells.has(key);
                    const classes = ['cell', info?.risk ? 'has-risk' : info ? 'has-issue' : proposed ? 'has-issue' : changed ? 'changed' : ''].filter(Boolean).join(' ');
                    const markers: string[] = [];
                    if (info) markers.push(info.reasons.join(', '));
                    if (proposed) markers.push('repair proposed');
                    if (changed) markers.push('changed');
                    return (
                      <td key={column}>
                        <button
                          type="button"
                          className={classes}
                          onClick={() => onEdit({ record, column })}
                          aria-label={`Record ${record} ${headers[column]}: ${value.length === 0 ? 'empty' : value}${markers.length > 0 ? `. ${markers.join('; ')}` : ''}. Press to correct.`}
                        >
                          {value.length === 0 ? <span className="empty-marker">empty</span> : value}
                          {markers.length > 0 && <span className="marker">{markers.join(' · ')}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
