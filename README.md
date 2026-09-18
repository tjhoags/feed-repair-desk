# Feed Repair Desk

A local, browser-only workbench for inspecting and conservatively repairing a product CSV. Import or paste a feed, see exactly which cells the profile would change and why, apply only the repairs you choose, enter explicit corrections, undo, revalidate, and export a revised CSV plus a portable JSON job that reopens the same working state.

Everything runs in the browser tab. There is no account, installation, API key, external model, merchant connection, upload, telemetry or remote asset. The production build blocks data connections and third-party assets through its Content Security Policy. The hosting service serves the initial page and bundled JavaScript/CSS; imported feed contents are processed locally.

This is a bounded repair utility. Passing its checks means a file satisfies the implemented profile. It is not marketplace approval, proof of product truth or evidence of any result.

## The journey

1. **Import.** Choose a CSV file, paste CSV text, or load the clearly fictional sample. Malformed or over-limit input is rejected whole with an explanation; nothing is padded, truncated, salvaged or guessed.
2. **Inspect.** The summary shows records, proposed repairs, applied changes, unresolved product issues, formula risks and affected records as separate counts. Issues are grouped by reason and anchored to a logical record and column, never to an id alone.
3. **Repair.** Proposed spelling repairs show the exact current and proposed value. Apply one, apply all, or enter a different value. Any cell can receive an explicit manual correction, recorded as a user-entered value rather than a verified fact.
4. **Undo and revalidate.** Undo restores the previous value and reopens any resulting issue or proposal. Revalidation recomputes findings without adding changes; it is idempotent.
5. **Export.** Download the revised CSV (when the export policy allows it) and the JSON job. Reopen the JSON job later to continue with the same cells, ledger and undo state.
6. **Keep (optional).** Persistence in the browser's local storage is off until you turn it on. Every save is verified by readback, and a failed save is reported without discarding in-memory work.

## Supported source

- UTF-8 comma-separated CSV with a header row. LF or CRLF record endings, an initial UTF-8 BOM and a missing final newline are accepted. RFC-style double-quote escaping, quoted commas, doubled quotes and quoted multiline cells are supported; a multiline title stays one logical record.
- Rejected explicitly: invalid UTF-8, unterminated or malformed quoting, ragged records (including blank lines inside the data), CR-only line endings, other delimiters and any input over the limits.
- Limits, checked before parsing for bytes and then for structure: **2,000,000 UTF-8 bytes**, **10,000 data records** (excluding the header) and **200 columns**. Source-limit boundaries are tested at and one over each limit; the portable-job budget below also applies. These are input guards, not performance claims.
- Every cell is a string. Identifiers, GTIN leading zeros, surrounding spaces, blanks, row order and non-target values are preserved exactly.

## Profile `basic-product-feed-fixture-v1`, rules `2026-09-17`

Required columns: `id`, `title`, `price`, `availability`, `link`. Optional: `gtin`. Headers are matched after trimming and lower-casing; the original header text is kept. Empty headers, exact duplicates and headers that collide after normalization are rejected rather than silently mapped to a first or last column. Every other column is preserved without interpretation and still scanned for formula risk.

| Rule | What it checks |
| --- | --- |
| `missing-id` | The id is empty or whitespace. |
| `duplicate-id` | The same exact id appears in more than one record. Each affected record gets one issue; the number of collision groups is reported separately. |
| `missing-title` | The title is empty or whitespace. |
| `invalid-price` | Empty, negative or otherwise not `<digits>[.<digits>] <CUR>` with a three-letter uppercase currency token (for example `20.00 USD`). Negative prices are never flipped. |
| `ambiguous-price-or-missing-currency` | No currency token, or separators such as a comma that could mean thousands or decimals. One compound diagnostic per failed price. |
| `missing-availability` | The availability cell is empty. |
| `unknown-availability` | Not one of `in_stock`, `out_of_stock`, `preorder`, `backorder`. Only `In Stock` → `in_stock` and `out of stock` → `out_of_stock` become proposals; everything else (for example `available soon`) stays as entered. |
| `missing-link`, `invalid-link` | Empty, not an absolute http(s) URL, or contains whitespace. Links are never fetched. |
| `invalid-gtin` | A non-empty gtin that is not 8, 12, 13 or 14 digits with a valid GS1 check digit. Ownership is not checked. |
| `formula-risk` | Export-safety rule on every header and cell; see below. |

Syntax checks do not verify currency validity, inventory, destination marketplace policy, GTIN ownership or whether a URL is reachable. Dates and other extra columns are not interpreted.

## Formula-risk export policy

A header or cell is flagged when its first character, after skipping leading ASCII whitespace and control characters (U+0000 to U+0020 and U+007F), is `=`, `+`, `-`, `@` or a full-width equivalent (`＝`, `＋`, `－`, `＠`). Detection uses a temporary inspection value; the stored text is never altered and flagged values stay intact in the UI and the JSON job.

Revised CSV export is blocked while any flagged data cell or header remains. Only an explicit correction of the value followed by revalidation resolves a cell risk; a header risk is resolved by renaming the header in the source and analyzing again. The app never prefixes cells with apostrophes or tabs. CSV quoting protects structure, not formula execution, and this bounded policy is not a universal spreadsheet safety guarantee.

## Changes, undo and the JSON job

The original source is immutable. Every applied change is a ledger entry with the record, column, previous value, new value, kind (`proposal` or `manual`) and reason. Applying a proposal checks that the target still holds the proposed before-value. Undo pops the last entry and restores its previous value. Redo is intentionally omitted.

The JSON job (`<source>-job.json`, format `feed-repair-desk-job` version `1.0.0`) contains the original source text including any BOM, its SHA-256 over the UTF-8 bytes, the profile identifier and rules version, headers and record count, the active ledger, the cells that currently differ from the original, unresolved issues, header risks, proposed repairs and counts. SHA-256 identifies content; it is not a signature or proof of authenticity.

Reopening validates the whole file before anything is replaced: size guard (12,000,000 bytes and 100,000 ledger entries), JSON syntax, format and version, supported profile and rules version (checked separately from the hash), field types, the embedded source under the source limits and parsing rules, the declared hash against the embedded text, replay of every ledger entry with anchor checks, agreement between the replayed cells and the stored current cells, and agreement between recorded issues and a fresh recomputation. Any inconsistency rejects the job and leaves the current work untouched. Source dimensions and the 12,000,000-byte portable-job / 100,000 active-change limits all apply. Inputs or edits that would produce an oversized report are rejected before replacing current work. Every exported job remains within its own import limits, and the next Undo behaves identically before and after reopening.

## Stale outputs

Editing the source text after analysis disables both downloads until you analyze again. Replacing the source with invalid CSV removes the earlier job entirely so nothing stale can be exported. An invalid JSON job import is different: it is rejected transactionally and the current valid job stays as it was.

## Export encoding

The revised CSV is UTF-8 with the source's line endings (LF or CRLF) and keeps an initial BOM only if the source had one. Quoting may be normalized; every logical cell value and the row order are preserved, and reparsing the export yields the visible matrix. Byte-identical reserialization is not claimed. A download prompt is not proof that a file was saved.

## Persistence

Off by default. When enabled, the same JSON job is written to `localStorage` under `feed-repair-desk.job`, read back and compared before the app reports it saved. A write failure or readback mismatch is reported as "not saved" while the in-memory work and the JSON download remain available. On reload with persistence on, the stored job goes through the same validation as an imported file. Turning persistence off removes the stored copy.

## Development

Node 24 LTS is recommended and used by CI. The supported tooling ranges are Node 22.12+, Node 24.x, or Node 26+; Node 23 and 25 are excluded by the test runner. Dependencies are bundled; no runtime network access is needed.

```bash
npm ci
npm run dev            # local development server
npm run typecheck      # TypeScript, app and tooling configs
npm test               # Vitest unit tests against tests/acceptance/feed-fixtures.json
npm run build          # production build with the /feed-repair-desk/ base and CSP
npm run privacy-check  # scans tracked files and dist/ for URLs, e-mails, paths, network call sites
npm run test:e2e       # Playwright, desktop and phone Chromium, against the production build
```

`tests/acceptance/feed-fixtures.json` is the independent synthetic fixture set and must not be edited to make implementation failures pass. Unit tests exercise every case, the source-limit boundaries and the job-integrity mutations. The browser tests exercise real import, apply, manual edit, undo, revalidate, downloads (read back and reparsed), JSON reopen, reload with and without persistence, a simulated storage write failure, invalid JSON and invalid CSV recovery, the formula and markup fixture with a network observer, keyboard-only operation and phone-width layout.

## Deployment

The build is prepared for GitHub Pages under `/feed-repair-desk/`. `.github/workflows/ci.yml` runs on every push and pull request. `.github/workflows/pages.yml` is manual only (`workflow_dispatch`), repeats the full verification (typecheck, unit tests, build, privacy check, browser tests) and deploys only if all of it passes. Publishing is a separate decision for the release owner; nothing in this repository enables hosting on its own.

## Privacy

Only synthetic examples and reserved `example.invalid` URLs are used. Imported CSV and JSON text is treated as untrusted text: it is rendered as text, never as HTML, never navigated to, never evaluated. Scenario data never enters URLs or requests. The privacy check and the browser tests are bounded guards, not a certification.

## Limitations

- One profile and one rules version. There is no schema designer; other feed formats need their own profile.
- The price rule is deliberately narrow (`20.00 USD`). Localized formats such as `1,20 EUR` stay unresolved rather than being interpreted.
- Headers cannot be edited in the app; header problems are fixed in the source and re-analyzed.
- Large feeds near the limits are usable but not tuned: the issue list previews 100 items per group and the records table pages 50 rows at a time.
- Redo is not provided.
- The formula policy is the fixture's bounded policy, not a guarantee for every spreadsheet application.

## License

MIT. See `LICENSE`.
