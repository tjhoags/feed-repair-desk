import { useState } from 'react';
import type { Job } from '../core/job';
import type { Issue, IssueReason, Proposal } from '../core/profile';
import { ValueChip } from './ValueChip';
import type { CellTarget } from './CellEditor';

interface Props {
  job: Job;
  onApply: (record: number, column: number) => void;
  onApplyAll: () => void;
  onEdit: (target: CellTarget) => void;
}

const REASON_TITLES: Record<IssueReason, string> = {
  'formula-risk': 'Formula risk (blocks CSV export)',
  'duplicate-id': 'Duplicate id',
  'missing-id': 'Missing id',
  'missing-title': 'Missing title',
  'invalid-price': 'Invalid price',
  'ambiguous-price-or-missing-currency': 'Ambiguous price or missing currency',
  'missing-availability': 'Missing availability',
  'unknown-availability': 'Unknown availability',
  'missing-link': 'Missing link',
  'invalid-link': 'Invalid link syntax',
  'invalid-gtin': 'Invalid GTIN',
};

const REASON_ORDER: IssueReason[] = [
  'formula-risk',
  'duplicate-id',
  'missing-id',
  'missing-title',
  'invalid-price',
  'ambiguous-price-or-missing-currency',
  'missing-availability',
  'unknown-availability',
  'missing-link',
  'invalid-link',
  'invalid-gtin',
];

function groupIssues(issues: Issue[]): Array<{ reason: IssueReason; items: Issue[] }> {
  const groups = new Map<IssueReason, Issue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.reason) ?? [];
    list.push(issue);
    groups.set(issue.reason, list);
  }
  return REASON_ORDER.filter((reason) => groups.has(reason)).map((reason) => ({ reason, items: groups.get(reason) as Issue[] }));
}

function ProposalItem({ proposal, onApply, onEdit }: { proposal: Proposal; onApply: Props['onApply']; onEdit: Props['onEdit'] }) {
  return (
    <li className="issue">
      <div className="values">
        <div className="where">
          Record <strong>{proposal.record}</strong> · column <strong>{proposal.columnName}</strong>
        </div>
        <div>
          <ValueChip value={proposal.before} tone="before" label="Current" />
          <span className="arrow" aria-hidden="true">
            →
          </span>
          <span className="visually-hidden">becomes</span>
          <ValueChip value={proposal.after} tone="after" label="Proposed" />
        </div>
        <div className="message">{proposal.message}</div>
      </div>
      <div className="actions">
        <button type="button" className="small primary" onClick={() => onApply(proposal.record, proposal.column)} aria-label={`Apply repair to record ${proposal.record} ${proposal.columnName}`}>
          Apply
        </button>
        <button type="button" className="small" onClick={() => onEdit({ record: proposal.record, column: proposal.column })} aria-label={`Enter a different value for record ${proposal.record} ${proposal.columnName}`}>
          Enter value
        </button>
      </div>
    </li>
  );
}

function IssueItem({ issue, onEdit }: { issue: Issue; onEdit: Props['onEdit'] }) {
  return (
    <li className="issue">
      <div className="values">
        <div className="where">
          Record <strong>{issue.record}</strong> · column <strong>{issue.columnName}</strong>
          {issue.relatedRecords && issue.relatedRecords.length > 1 && <> · group of records {issue.relatedRecords.join(', ')}</>}
        </div>
        <div>
          <ValueChip value={issue.value} label="Current" />
        </div>
        <div className="message">{issue.message}</div>
      </div>
      <div className="actions">
        <button type="button" className="small" onClick={() => onEdit({ record: issue.record, column: issue.column })} aria-label={`Correct value for record ${issue.record} ${issue.columnName} (${issue.reason})`}>
          Correct value
        </button>
      </div>
    </li>
  );
}

const GROUP_PREVIEW = 100;

function IssueGroup({ reason, items, onEdit }: { reason: IssueReason; items: Issue[]; onEdit: Props['onEdit'] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, GROUP_PREVIEW);
  return (
    <details className="group" open>
      <summary>
        {REASON_TITLES[reason]} <span className="count">({items.length})</span>
      </summary>
      <ul className="issue-list" aria-label={REASON_TITLES[reason]}>
        {visible.map((issue) => (
          <IssueItem key={`${issue.record}:${issue.column}:${issue.reason}`} issue={issue} onEdit={onEdit} />
        ))}
      </ul>
      {items.length > GROUP_PREVIEW && (
        <div className="issue-list">
          <div className="button-row">
            <button type="button" className="small" onClick={() => setShowAll((value) => !value)}>
              {showAll ? `Show first ${GROUP_PREVIEW} only` : `Show all ${items.length}`}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}

export function IssuesPanel({ job, onApply, onApplyAll, onEdit }: Props) {
  const { proposals, issues, headerRisks, counts } = job.analysis;
  const groups = groupIssues(issues);
  const nothing = proposals.length === 0 && issues.length === 0 && headerRisks.length === 0;

  return (
    <div className="tabpanel">
      {nothing && (
        <div className="notice ok" role="status">
          {job.parsed.records.length === 0
            ? 'The file has a header row but no product records, so zero products were checked. This is a named empty dataset, not a pass.'
            : `No proposed repairs or unresolved issues. Every implemented check of profile ${job.parsed.records.length === 1 ? 'for this record' : 'for these records'} passed. That is not marketplace approval or proof of product truth.`}
        </div>
      )}

      {headerRisks.length > 0 && (
        <details className="group" open>
          <summary>
            Header formula risk <span className="count">({headerRisks.length})</span>
            <span className="explain">A header starts with a formula trigger. Headers cannot be edited here; rename the header in the source file and analyze again. CSV export stays blocked meanwhile.</span>
          </summary>
          <ul className="issue-list">
            {headerRisks.map((risk) => (
              <li className="issue" key={risk.column}>
                <div className="values">
                  <div className="where">
                    Header column <strong>{risk.column + 1}</strong>
                  </div>
                  <ValueChip value={risk.value} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {proposals.length > 0 && (
        <details className="group" open>
          <summary>
            Proposed spelling repairs <span className="count">({proposals.length})</span>
            <span className="explain">Only the known spellings “In Stock” and “out of stock” are mapped. Nothing changes until you apply a proposal; each application is reversible.</span>
          </summary>
          <div className="issue-list">
            <div className="button-row">
              <button type="button" className="small" onClick={onApplyAll}>
                Apply all {proposals.length} proposed repair{proposals.length === 1 ? '' : 's'}
              </button>
            </div>
            <ul className="issue-list" aria-label="Proposed repairs">
              {proposals.map((proposal) => (
                <ProposalItem key={`${proposal.record}:${proposal.column}`} proposal={proposal} onApply={onApply} onEdit={onEdit} />
              ))}
            </ul>
          </div>
        </details>
      )}

      {groups.length > 0 && (
        <p className="small-text">
          {counts.productIssues} unresolved product issue{counts.productIssues === 1 ? '' : 's'} and {counts.formulaRisks} formula risk{counts.formulaRisks === 1 ? '' : 's'} across{' '}
          {counts.affectedRecords} affected record{counts.affectedRecords === 1 ? '' : 's'}
          {counts.duplicateIdGroups > 0 && <> ({counts.duplicateIdGroups} duplicate-id group{counts.duplicateIdGroups === 1 ? '' : 's'})</>}. Values are kept exactly as entered until you correct them.
        </p>
      )}

      {groups.map((group) => (
        <IssueGroup key={group.reason} reason={group.reason} items={group.items} onEdit={onEdit} />
      ))}
    </div>
  );
}
