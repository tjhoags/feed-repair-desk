# Feed Repair Desk - implementation brief

Build a polished static browser application for inspecting and conservatively repairing a product CSV. Show the exact proposed changes, preserve product facts that need a human decision, and export the revised file with a portable record of the work. No account, installation, API key, external model or merchant connection is required.

This is a bounded repair utility. Passing its checks is not marketplace approval, proof of product truth or evidence of financial results. No customer, novelty, demand or performance claims are authorized by this brief. No rehearsal or previous mockup is proof that the implementation works.

## Complete user journey

Start with an inviting import/paste area and a clearly fictional sample. A person can inspect the file, distinguish proposed repairs from unresolved issues, review exact old/new cell values, apply a selected correction, enter an explicit manual correction, undo it, revalidate and download the result. Every visible control must work; omit speculative features and disabled placeholders.

Use a clean editorial workspace with legible tabular data, restrained color and clear hierarchy. Keep source identity and current status visible. Group issues by useful reason, and connect each issue to its logical record and column. Make changes easy to inspect without requiring the person to read a large JSON file. Show issue counts separately from affected-record counts. Use progressive disclosure for the cell ledger and technical profile details.

Design complete desktop, phone and keyboard journeys. Contain wide tables within their own scroll region; avoid whole-page overflow. Use semantic controls, visible focus, explicit labels, understandable empty/error states and text explanations in addition to color. Use system fonts or properly licensed locally bundled fonts. No remote assets.

## Supported source and validation profile

- UTF-8 comma-separated CSV with a header; accept LF, CRLF, an initial UTF-8 BOM and no final newline. Support quoted commas, doubled quotes and quoted multiline cells. Invalid UTF-8, malformed quoting and ragged records fail explicitly. Do not guess another delimiter, pad, truncate, drop rows or silently salvage a partial file.
- Source CSV limits: **2 MB = 2,000,000 UTF-8 bytes**, **10,000 data records excluding the header**, and **200 columns**. Check bytes before parsing, then enforce record and column bounds. At-limit and over-limit tests are required. These are supported-input guards, not measured performance claims. Keep rejection recoverable.
- Use an explicit, versioned basic product-feed profile: required columns `id`, `title`, `price`, `availability`, `link`; optional `gtin`. Preserve all extra columns and still scan them for formula risk. Require unambiguous field identification. Reject empty, duplicate or normalization-colliding headers; do not select a silent first or last column. Explain required headers rather than building a general schema designer.
- Every source cell is a string. Preserve identifiers, GTIN leading zeros, spaces, blanks, row order and non-target values. A multiline title occupies one logical record. Identify issues by stable logical record/column coordinates, never by ID alone when IDs can duplicate.
- Check missing IDs/titles, duplicate IDs, the implemented price format, availability tokens, link syntax and explicitly documented GTIN checks. For the narrow price profile, require a nonnegative decimal-point amount and an explicit three-letter uppercase currency token, such as `20.00 USD`. Ambiguous prices remain unresolved. Explain that syntax checks do not verify currency validity, inventory, destination policy, GTIN ownership or a reachable URL. Do not fetch product links.

Use the dated fixture profile and list its actual checks. Canonical availability tokens are `in_stock`, `out_of_stock`, `preorder` and `backorder`. The required spelling map changes only `In Stock` to `in_stock` and `out of stock` to `out_of_stock`. More mappings are unnecessary for this release. Terms such as `available soon`, `Discontinued` or `BuildToOrder` are not inferred stock facts.

## Changes, unresolved facts and undo

Analysis proposes changes; it does not apply them automatically. Show the exact source cell, proposed value and reason before application. Record explicit manual corrections as user-entered values, not independently verified facts. Do not invent titles, identifiers, prices, currencies or dates, flip negative prices, merge duplicates, remove rows or globally trim cells.

Keep an immutable original and a compact reversible cell ledger. Applying a change checks its target and previous value. Undo restores the previous value and reopens any resulting issue. Revalidation is idempotent: it must not add duplicate decisions or repeatedly transform an already-normalized cell. Distinguish applied, proposed and unresolved states.

Ordinary unresolved product facts may remain in a clearly labeled correction export with an accompanying issue report. Preserve their rows. A file with no detected issues passes only the implemented profile, not every marketplace's requirements.

## Formula and markup policy

Treat all imported CSV and JSON text as untrusted text. Never render it as HTML, load embedded images, navigate to a cell value or evaluate formulas. Inspect every cell and header for the fixture's formula-risk policy, including leading ASCII whitespace/control characters and full-width equivalents of `=`, `+`, `-`, `@`. Detection may normalize a temporary inspection value; it must not alter source text.

Keep flagged values intact in the UI and JSON job. Block CSV export while formula risks remain. Dismissing or acknowledging a warning is not resolution. Explicitly correcting the underlying value and revalidating can resolve it. Do not silently prefix cells with apostrophes or tabs, and do not promise universal spreadsheet safety. CSV quoting protects structure; it does not itself prevent spreadsheet formula execution.

## Portable job, persistence and export integrity

Export revised CSV and a versioned JSON job containing original input or a lossless source representation, original hash, profile/rule version, current state, exact changes with reasons, manual decisions, undo state and unresolved issues. Prefer this single compact record over a separate audit platform. SHA-256 identifies content; it is not a signature or proof of authenticity.

Validate the whole job before loading it: format/version, types, bounded sizes, source hash, valid record/column targets, change anchors and agreement between replayed changes and current cells. Recompute exceptions under the recorded supported profile. Reject inconsistent jobs transactionally, preserving current valid work. Define a separate bounded JSON-job size guard that accommodates escaping and the ledger; every job the app exports must be accepted by its own importer. The embedded CSV still obeys the source limits.

Persistence is an explicit displayed choice, off until selected. Explain what stays in browser storage, verify saved content by readback, restore the same valid state after reload, and report failure without discarding in-memory work or pretending it saved. A portable download remains available where browser storage fails.

Editing source text invalidates old export eligibility until revalidated. Replacing it with invalid CSV must not expose the earlier file's outputs as current. This differs from an invalid JSON job import, which leaves the existing valid job intact. Downloads must match the visible validated job and applied changes. Do not claim a download saved merely because a click was dispatched; inspect actual files during acceptance.

CSV export may normalize quoting and line endings while preserving logical cell values. Document encoding and line endings, preserve the original source, and do not claim byte-identical reserialization. Exported JSON must reopen the same working and undo state.

## Implementation and release checks

Keep parsing, profile checks, change application/replay, serialization and UI separate. Use a maintained, locally bundled CSV parser rather than splitting lines or commas. No backend, telemetry, remote fonts/images, hosted AI, URL-state sharing, payment flow, recurring sync or external runtime service. Keep scenario data out of URLs and network requests.

`tests/acceptance/feed-fixtures.json` contains independent synthetic cases. Map their semantic checks to the implementation without weakening expected outcomes. Exercise the fixture data in actual assertions, including multiline parsing, header ambiguity, exact mutations, formula risks, undo/replay, corrupt job rejection and stale-export prevention. Add the explicit input-limit boundaries above. Do not alter fixtures to make implementation failures pass.

Run unit tests, type checking, a production build and real browser checks for import, apply, manual edit, undo, download/reparse, reload, failed storage, keyboard/phone use and invalid-input recovery. Observe network activity during the deployed or served workflow before asserting local-only processing. Use only synthetic examples and reserved `example.invalid` URLs.

Include a readable README, profile/formula-policy limitations, license, lockfile and minimal CI. Prepare a static build that works from a repository subpath. Report the exact checks run and remaining limitations. Repository publication and hosting are handled by the release owner after review; implementation must not change visibility or publish itself.
