/**
 * Formula-risk policy (bounded, documented):
 *
 * A cell or header is a spreadsheet formula risk when, after removing leading
 * ASCII whitespace/control characters (U+0000 to U+0020 and U+007F) for
 * inspection only, its first character is one of `=`, `+`, `-`, `@` or their
 * full-width counterparts `＝` (U+FF1D), `＋` (U+FF0B), `－` (U+FF0D), `＠` (U+FF20).
 *
 * Detection never changes the stored text. This policy is not a universal
 * spreadsheet safety guarantee: CSV quoting protects structure, not formula
 * execution, and other applications may apply different rules.
 */

const TRIGGERS = new Set(['=', '+', '-', '@']);

const FULL_WIDTH: Record<string, string> = {
  '＝': '=',
  '＋': '+',
  '－': '-',
  '＠': '@',
};

function isLeadingControlOrSpace(code: number): boolean {
  return code <= 0x20 || code === 0x7f;
}

/** Returns the inspection view of a value: leading ASCII whitespace/control removed and full-width triggers normalized. Used for detection only. */
export function inspectionValue(value: string): string {
  let start = 0;
  while (start < value.length && isLeadingControlOrSpace(value.charCodeAt(start))) {
    start += 1;
  }
  const rest = value.slice(start);
  if (rest.length === 0) {
    return rest;
  }
  const first = rest[0];
  const mapped = FULL_WIDTH[first];
  return mapped ? mapped + rest.slice(1) : rest;
}

export function isFormulaRisk(value: string): boolean {
  const view = inspectionValue(value);
  return view.length > 0 && TRIGGERS.has(view[0]);
}

export const FORMULA_POLICY_TEXT =
  'A cell or header is flagged when its first character, after skipping leading ASCII whitespace or control characters, is =, +, -, @ or a full-width equivalent. Stored text is never altered by detection. Revised CSV export stays blocked until every flagged data value is explicitly corrected; acknowledging a warning is not a resolution. This bounded policy is not a universal spreadsheet safety guarantee.';
