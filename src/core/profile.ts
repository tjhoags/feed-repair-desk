import { isFormulaRisk } from './formula';

/**
 * Versioned basic product-feed profile. The profile identifier and rules
 * version are validated separately from the job format version and source hash.
 */
export const PROFILE = {
  id: 'basic-product-feed-fixture-v1',
  rulesVersion: '2026-09-17',
  requiredFields: ['id', 'title', 'price', 'availability', 'link'] as const,
  optionalFields: ['gtin'] as const,
} as const;

export type FieldName = (typeof PROFILE.requiredFields)[number] | (typeof PROFILE.optionalFields)[number];

export const AVAILABILITY_CANONICAL = ['in_stock', 'out_of_stock', 'preorder', 'backorder'] as const;

/** The only spelling repairs this release proposes. Other values stay unresolved facts. */
export const AVAILABILITY_SPELLING_MAP: Readonly<Record<string, string>> = {
  'In Stock': 'in_stock',
  'out of stock': 'out_of_stock',
};

export const RULES_TEXT: ReadonlyArray<{ rule: string; check: string }> = [
  { rule: 'missing-id', check: 'The id cell is empty or only whitespace.' },
  { rule: 'duplicate-id', check: 'The same exact id appears in more than one record. Each affected record gets one issue; the collision group is counted separately.' },
  { rule: 'missing-title', check: 'The title cell is empty or only whitespace.' },
  {
    rule: 'invalid-price',
    check: 'The price is empty, negative or otherwise not "<digits>[.<digits>] <CUR>" with a three-letter uppercase currency token (for example 20.00 USD). Negative prices are never flipped.',
  },
  {
    rule: 'ambiguous-price-or-missing-currency',
    check: 'The price has no three-letter uppercase currency token, or uses separators such as a comma that could mean thousands or decimals. Nothing is inferred.',
  },
  { rule: 'missing-availability', check: 'The availability cell is empty.' },
  {
    rule: 'unknown-availability',
    check: 'The availability value is not one of in_stock, out_of_stock, preorder, backorder. Only "In Stock" and "out of stock" get a proposed spelling repair; every other value stays as entered.',
  },
  { rule: 'missing-link', check: 'The link cell is empty.' },
  { rule: 'invalid-link', check: 'The link is not an absolute http or https URL, or contains whitespace. Links are never fetched.' },
  {
    rule: 'invalid-gtin',
    check: 'A non-empty gtin is not 8, 12, 13 or 14 digits with a valid GS1 check digit. Leading zeros are preserved. Ownership is not checked.',
  },
  { rule: 'formula-risk', check: 'Export-safety rule inspected on every header and cell; see the formula policy.' },
];

export const NOT_CHECKED_TEXT =
  'Syntax checks do not verify currency validity, inventory, destination marketplace policy, GTIN ownership or whether a URL is reachable. Passing every check means the file satisfies this profile only.';

export type HeaderFailureCode =
  | 'unnamed-column'
  | 'ambiguous-column-identity'
  | 'ambiguous-field-mapping'
  | 'missing-required-column';

export interface HeaderFailure {
  ok: false;
  code: HeaderFailureCode;
  message: string;
}

export interface ColumnMap {
  /** Index of each profile field in the header row (optional fields may be absent). */
  fields: Partial<Record<FieldName, number>>;
  /** Original header text for every column, in order. */
  headers: string[];
}

export type HeaderResult = { ok: true; value: ColumnMap } | HeaderFailure;

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function describeHeader(header: string, index: number): string {
  return `column ${index + 1} (${JSON.stringify(header)})`;
}

/**
 * Identifies profile fields from the header row. Headers are matched after trimming
 * and lower-casing; a header that is empty, duplicated or collides with another
 * after normalization is rejected instead of silently picking a first or last column.
 */
export function mapHeaders(headers: string[]): HeaderResult {
  const seen = new Map<string, number>();
  for (let i = 0; i < headers.length; i += 1) {
    const raw = headers[i];
    const normalized = normalizeHeader(raw);
    if (normalized.length === 0) {
      return {
        ok: false,
        code: 'unnamed-column',
        message: `${describeHeader(raw, i)} has no name. Every column needs a distinct header; nothing was renamed.`,
      };
    }
    const previous = seen.get(normalized);
    if (previous !== undefined) {
      const isProfileField = (PROFILE.requiredFields as readonly string[]).includes(normalized) || (PROFILE.optionalFields as readonly string[]).includes(normalized);
      const code: HeaderFailureCode = isProfileField ? 'ambiguous-field-mapping' : 'ambiguous-column-identity';
      const field = isProfileField ? ` Both would map to the ${normalized} field, so no column was chosen.` : '';
      return {
        ok: false,
        code,
        message: `${describeHeader(headers[previous], previous)} and ${describeHeader(raw, i)} both identify "${normalized}".${field} Rename one in the source and analyze again.`,
      };
    }
    seen.set(normalized, i);
  }
  const fields: Partial<Record<FieldName, number>> = {};
  const missing: string[] = [];
  for (const field of PROFILE.requiredFields) {
    const index = seen.get(field);
    if (index === undefined) {
      missing.push(field);
    } else {
      fields[field] = index;
    }
  }
  if (missing.length > 0) {
    const looksLikeOtherDelimiter = headers.length === 1 && /[;\t|]/.test(headers[0]);
    const hint = looksLikeOtherDelimiter
      ? ' The header row is a single column containing a separator; only comma-separated CSV is supported and other delimiters are never guessed.'
      : ` Required headers are ${PROFILE.requiredFields.join(', ')} (case and surrounding spaces are ignored).`;
    return {
      ok: false,
      code: 'missing-required-column',
      message: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.${hint}`,
    };
  }
  for (const field of PROFILE.optionalFields) {
    const index = seen.get(field);
    if (index !== undefined) {
      fields[field] = index;
    }
  }
  return { ok: true, value: { fields, headers } };
}

export type IssueReason =
  | 'missing-id'
  | 'duplicate-id'
  | 'missing-title'
  | 'invalid-price'
  | 'ambiguous-price-or-missing-currency'
  | 'missing-availability'
  | 'unknown-availability'
  | 'missing-link'
  | 'invalid-link'
  | 'invalid-gtin'
  | 'formula-risk';

export interface Issue {
  /** One-based logical data record. */
  record: number;
  /** Zero-based column index. */
  column: number;
  columnName: string;
  reason: IssueReason;
  category: 'product' | 'formula-risk';
  value: string;
  message: string;
  relatedRecords?: number[];
}

export interface HeaderRisk {
  column: number;
  value: string;
}

export interface Proposal {
  record: number;
  column: number;
  columnName: string;
  before: string;
  after: string;
  reason: 'availability-spelling';
  message: string;
}

export interface Analysis {
  issues: Issue[];
  proposals: Proposal[];
  headerRisks: HeaderRisk[];
  /** Complete membership once per collision group, rather than once per affected record. */
  duplicateGroups: Array<{ value: string; records: number[] }>;
  counts: {
    productIssues: number;
    formulaRisks: number;
    totalIssues: number;
    affectedRecords: number;
    duplicateIdGroups: number;
    proposals: number;
  };
}

const PRICE_PATTERN = /^[0-9]+(\.[0-9]+)? [A-Z]{3}$/;
const CURRENCY_TOKEN = /(^| )[A-Z]{3}$/;

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function checkPrice(value: string): { reason: IssueReason; message: string } | null {
  if (PRICE_PATTERN.test(value)) {
    return null;
  }
  if (value.length === 0) {
    return { reason: 'invalid-price', message: 'Price is empty. Expected an amount and currency such as 20.00 USD.' };
  }
  const hasCurrency = CURRENCY_TOKEN.test(value);
  if (!hasCurrency) {
    return {
      reason: 'ambiguous-price-or-missing-currency',
      message: 'No three-letter uppercase currency token was found, and the amount was not interpreted. Expected a form such as 20.00 USD.',
    };
  }
  const amount = value.slice(0, Math.max(0, value.length - 4));
  if (amount.startsWith('-')) {
    return { reason: 'invalid-price', message: 'Negative price. The sign was not flipped; enter the intended nonnegative amount.' };
  }
  if (/[, \s']/.test(amount)) {
    return {
      reason: 'ambiguous-price-or-missing-currency',
      message: 'The amount uses separators that could mean thousands or decimals. Enter a decimal-point amount such as 1234.00 USD.',
    };
  }
  return { reason: 'invalid-price', message: 'Price is not "<digits>[.<digits>] <CUR>". Expected a form such as 20.00 USD.' };
}

function checkLink(value: string): string | null {
  if (/\s/.test(value)) {
    return 'Link contains whitespace.';
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Link is not an absolute URL.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `Link scheme "${url.protocol.replace(':', '')}" is not http or https.`;
  }
  if (url.hostname.length === 0) {
    return 'Link has no host.';
  }
  return null;
}

export function isValidGtin(value: string): boolean {
  if (!/^[0-9]+$/.test(value)) {
    return false;
  }
  if (![8, 12, 13, 14].includes(value.length)) {
    return false;
  }
  let sum = 0;
  // Weights alternate 3,1 from the right, excluding the check digit.
  for (let i = value.length - 2, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(value[i]) * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(value[value.length - 1]);
}

/** Runs the profile rules and the formula policy over the given headers and current cells. Pure and idempotent. */
export function analyze(map: ColumnMap, records: string[][]): Analysis {
  const issues: Issue[] = [];
  const proposals: Proposal[] = [];
  const headerRisks: HeaderRisk[] = [];
  const { fields, headers } = map;
  const columnName = (column: number): string => headers[column];

  headers.forEach((header, column) => {
    if (isFormulaRisk(header)) {
      headerRisks.push({ column, value: header });
    }
  });

  const idColumn = fields.id as number;
  const idOwners = new Map<string, number[]>();
  records.forEach((row, index) => {
    const id = row[idColumn];
    if (!isBlank(id)) {
      const list = idOwners.get(id) ?? [];
      list.push(index + 1);
      idOwners.set(id, list);
    }
  });
  const duplicateGroups: Analysis['duplicateGroups'] = [];
  for (const [value, owners] of idOwners) {
    if (owners.length > 1) {
      duplicateGroups.push({ value, records: owners });
    }
  }

  const push = (record: number, column: number, reason: IssueReason, value: string, message: string, relatedRecords?: number[]): void => {
    issues.push({ record, column, columnName: columnName(column), reason, category: 'product', value, message, relatedRecords });
  };

  records.forEach((row, index) => {
    const record = index + 1;

    const id = row[idColumn];
    if (isBlank(id)) {
      push(record, idColumn, 'missing-id', id, 'The id is empty. No identifier was invented.');
    } else {
      const owners = idOwners.get(id) ?? [];
      if (owners.length > 1) {
        // Small groups remain convenient to inspect inline. Large groups keep
        // their complete membership in duplicateGroups, without quadratic text
        // and JSON growth from repeating the whole list on every issue.
        const inlineOwners = owners.length <= 20 ? owners : undefined;
        const message = inlineOwners
          ? `The id also appears in record${owners.length > 2 ? 's' : ''} ${owners.filter((r) => r !== record).join(', ')}. Rows were not merged.`
          : `This exact id appears in ${owners.length} records. Every affected record is listed as a duplicate-id issue; complete group membership is in the JSON job. Rows were not merged.`;
        push(record, idColumn, 'duplicate-id', id, message, inlineOwners);
      }
    }

    const titleColumn = fields.title as number;
    const title = row[titleColumn];
    if (isBlank(title)) {
      push(record, titleColumn, 'missing-title', title, 'The title is empty. No title was invented.');
    }

    const priceColumn = fields.price as number;
    const priceProblem = checkPrice(row[priceColumn]);
    if (priceProblem) {
      push(record, priceColumn, priceProblem.reason, row[priceColumn], priceProblem.message);
    }

    const availabilityColumn = fields.availability as number;
    const availability = row[availabilityColumn];
    if (availability.length === 0) {
      push(record, availabilityColumn, 'missing-availability', availability, 'Availability is empty. No stock state was inferred.');
    } else if (!(AVAILABILITY_CANONICAL as readonly string[]).includes(availability)) {
      const mapped = Object.hasOwn(AVAILABILITY_SPELLING_MAP, availability) ? AVAILABILITY_SPELLING_MAP[availability] : undefined;
      if (mapped !== undefined) {
        proposals.push({
          record,
          column: availabilityColumn,
          columnName: columnName(availabilityColumn),
          before: availability,
          after: mapped,
          reason: 'availability-spelling',
          message: `Spelling repair: "${availability}" is the profile's known spelling of ${mapped}. Nothing changes until you apply it.`,
        });
      } else {
        push(record, availabilityColumn, 'unknown-availability', availability, 'Not a canonical availability token (in_stock, out_of_stock, preorder, backorder). The value was kept exactly; no stock state was inferred.');
      }
    }

    const linkColumn = fields.link as number;
    const link = row[linkColumn];
    if (link.length === 0) {
      push(record, linkColumn, 'missing-link', link, 'The link is empty.');
    } else {
      const linkProblem = checkLink(link);
      if (linkProblem) {
        push(record, linkColumn, 'invalid-link', link, `${linkProblem} Links are never fetched, so reachability is unknown either way.`);
      }
    }

    const gtinColumn = fields.gtin;
    if (gtinColumn !== undefined) {
      const gtin = row[gtinColumn];
      if (gtin.length > 0 && !isValidGtin(gtin)) {
        push(record, gtinColumn, 'invalid-gtin', gtin, 'Not 8, 12, 13 or 14 digits with a valid GS1 check digit. The value was kept; ownership was not checked.');
      }
    }

    row.forEach((cell, column) => {
      if (isFormulaRisk(cell)) {
        issues.push({
          record,
          column,
          columnName: columnName(column),
          reason: 'formula-risk',
          category: 'formula-risk',
          value: cell,
          message: 'Starts with a spreadsheet formula trigger. The text is unchanged; revised CSV export is blocked until the value is explicitly corrected.',
        });
      }
    });
  });

  const productIssues = issues.filter((issue) => issue.category === 'product').length;
  const formulaRisks = issues.length - productIssues;
  const affected = new Set(issues.map((issue) => issue.record));
  return {
    issues,
    proposals,
    headerRisks,
    duplicateGroups,
    counts: {
      productIssues,
      formulaRisks,
      totalIssues: issues.length,
      affectedRecords: affected.size,
      duplicateIdGroups: duplicateGroups.length,
      proposals: proposals.length,
    },
  };
}
