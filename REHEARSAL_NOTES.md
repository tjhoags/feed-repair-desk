# Rehearsal decisions for implementation

A separate Python rehearsal exercised the supplied synthetic fixtures. Its reported results are evidence about that reference runner, not acceptance of this browser application. Implement against IMPLEMENTATION_BRIEF.md and the unchanged fixture file; do not port the rehearsal blindly.

Clarifications:

- A header-only CSV is a named empty dataset with zero products checked. Disable revised-CSV export with an understandable "nothing to export" state. This follows the existing structural fixture; it is not a schema pass with meaningful product coverage.
- Preserve the active reversible change ledger when reopening a JSON job. The same next Undo action must restore the same cell, value and issue before and after reopen. Redo of changes already undone is not required. If a redo feature is added, its history must also be validated; omitting redo is simpler and sufficient.
- Validate profile identifier, rule version and job format version separately. A valid source hash does not authorize an unsupported validation profile.
- Logical CSV round-trip equality is required; byte-identical reserialization is not. Preserve original text and source hash separately.
- The browser must independently establish inert rendering, absence of data-triggered requests, truthful persistence, real downloads and responsive interaction. Python checks cannot establish these.

Keep implementation small, complete and usable. No additional approval ceremony, audit platform, signed receipt system or remote service is needed.
