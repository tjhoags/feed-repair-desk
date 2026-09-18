import { SOURCE_LIMITS } from '../core/csv';
import { FORMULA_POLICY_TEXT } from '../core/formula';
import type { Job } from '../core/job';
import { JOB_LIMITS } from '../core/jobfile';
import { NOT_CHECKED_TEXT, PROFILE, RULES_TEXT, type FieldName } from '../core/profile';

interface Props {
  job: Job;
}

export function ProfilePanel({ job }: Props) {
  const fields = Object.entries(job.columnMap.fields) as Array<[FieldName, number]>;
  const extra = job.parsed.headers.map((header, index) => ({ header, index })).filter(({ index }) => !fields.some(([, i]) => i === index));
  return (
    <div className="tabpanel">
      <section className="panel">
        <h3>Source identity</h3>
        <dl className="kv">
          <dt>Name</dt>
          <dd>{job.source.name}</dd>
          <dt>SHA-256</dt>
          <dd>
            <code>{job.source.sha256}</code>
            <div className="small-text">Over the original UTF-8 bytes, including any BOM and line endings. Identifies content only; not a signature.</div>
          </dd>
          <dt>Size</dt>
          <dd>
            {job.source.byteLength.toLocaleString()} bytes · {job.parsed.records.length.toLocaleString()} data records · {job.parsed.headers.length} columns · {job.parsed.lineEnding} line endings
            {job.parsed.hadBom ? ' · initial BOM' : ''}
          </dd>
        </dl>
      </section>
      <section className="panel">
        <h3>
          Profile {PROFILE.id} · rules {PROFILE.rulesVersion}
        </h3>
        <details>
          <summary>Column identification</summary>
          <dl className="kv">
            {fields.map(([field, index]) => (
              <div key={field}>
                <dt>{field}</dt>
                <dd>
                  column {index + 1} <code>{job.parsed.headers[index]}</code>
                </dd>
              </div>
            ))}
            {extra.length > 0 && (
              <>
                <dt>preserved as-is</dt>
                <dd>{extra.map(({ header, index }) => `column ${index + 1} "${header}"`).join(', ')}</dd>
              </>
            )}
          </dl>
          <p className="small-text">Headers are matched after trimming and lower-casing; the original header text is kept in exports. Empty, duplicate or colliding headers are rejected rather than guessed.</p>
        </details>
        <details>
          <summary>Checks this profile runs</summary>
          <div className="rules">
            {RULES_TEXT.map((rule) => (
              <div key={rule.rule}>
                <code>{rule.rule}</code>
                <span className="small-text">{rule.check}</span>
              </div>
            ))}
          </div>
          <p className="small-text">{NOT_CHECKED_TEXT}</p>
        </details>
        <details>
          <summary>Formula-risk export policy</summary>
          <p className="small-text">{FORMULA_POLICY_TEXT}</p>
        </details>
        <details>
          <summary>Supported input</summary>
          <p className="small-text">
            UTF-8 comma-separated CSV with a header, LF or CRLF endings, RFC-style double-quote escaping, quoted commas and multiline cells. Limits: {SOURCE_LIMITS.maxBytes.toLocaleString()} bytes, {SOURCE_LIMITS.maxRecords.toLocaleString()} data
            records, {SOURCE_LIMITS.maxColumns} columns. JSON jobs: {JOB_LIMITS.maxBytes.toLocaleString()} bytes and {JOB_LIMITS.maxChanges.toLocaleString()} ledger entries; the embedded CSV still obeys the source limits. Invalid UTF-8,
            malformed quoting, ragged records and other delimiters are rejected without salvage.
          </p>
        </details>
      </section>
    </div>
  );
}
