import Papa from 'papaparse';

/** Supported-input guards. These bound what the app accepts; they are not performance claims. */
export const SOURCE_LIMITS = {
  /** Maximum source size in UTF-8 bytes, checked before parsing. */
  maxBytes: 2_000_000,
  /** Maximum data records, excluding the header. */
  maxRecords: 10_000,
  /** Maximum columns. */
  maxColumns: 200,
} as const;

export type LineEnding = 'LF' | 'CRLF';

export interface ParsedSource {
  headers: string[];
  records: string[][];
  lineEnding: LineEnding;
  hadBom: boolean;
}

export type ParseFailureCode =
  | 'empty_input'
  | 'byte_limit'
  | 'invalid_utf8'
  | 'unsupported_line_ending'
  | 'parse_error'
  | 'row_width_error'
  | 'record_limit'
  | 'column_limit';

export interface ParseFailure {
  ok: false;
  code: ParseFailureCode;
  message: string;
}

export interface ParseSuccess {
  ok: true;
  value: ParsedSource;
}

export type ParseResult = ParseSuccess | ParseFailure;

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

/** Decodes bytes as strict UTF-8. Invalid sequences are rejected rather than replaced. */
export function decodeUtf8Strict(bytes: Uint8Array): { ok: true; text: string } | { ok: false; message: string } {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    return { ok: true, text: decoder.decode(bytes) };
  } catch {
    return { ok: false, message: 'The file is not valid UTF-8. Re-save it as UTF-8 and try again.' };
  }
}

function failure(code: ParseFailureCode, message: string): ParseFailure {
  return { ok: false, code, message };
}

export function checkByteLimit(byteLength: number): ParseFailure | null {
  if (byteLength > SOURCE_LIMITS.maxBytes) {
    return failure(
      'byte_limit',
      `The source is ${byteLength.toLocaleString()} UTF-8 bytes; the supported limit is ${SOURCE_LIMITS.maxBytes.toLocaleString()} bytes. Split the file before importing.`,
    );
  }
  return null;
}

/**
 * Parses UTF-8 comma-separated CSV text with a header row.
 * Accepts LF or CRLF endings, an initial BOM and a missing final newline.
 * Rejects malformed quoting, ragged records, CR-only endings and any input over the supported limits.
 * Never guesses another delimiter, pads, truncates or drops rows.
 */
export function parseCsv(originalText: string): ParseResult {
  const byteFailure = checkByteLimit(utf8ByteLength(originalText));
  if (byteFailure) {
    return byteFailure;
  }
  const hadBom = originalText.charCodeAt(0) === 0xfeff;
  const text = hadBom ? originalText.slice(1) : originalText;
  if (text.trim().length === 0) {
    return failure('empty_input', 'The source is empty. Paste or import a CSV file with a header row.');
  }

  const result = Papa.parse<string[]>(text, {
    delimiter: ',',
    quoteChar: '"',
    escapeChar: '"',
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });

  if (result.errors.length > 0) {
    const first = result.errors[0];
    const where = typeof first.row === 'number' ? ` near data record ${first.row}` : '';
    return failure(
      'parse_error',
      `Malformed CSV quoting${where}: ${first.message}. Fix the quoting in the source and try again; nothing was salvaged.`,
    );
  }

  const linebreak = result.meta.linebreak;
  if (linebreak === '\r') {
    return failure(
      'unsupported_line_ending',
      'CR-only line endings are not supported. Save the file with LF or CRLF line endings.',
    );
  }
  const lineEnding: LineEnding = linebreak === '\r\n' ? 'CRLF' : 'LF';

  const rows = result.data;
  if (rows.length > 0 && text.endsWith(linebreak)) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') {
      rows.pop();
    }
  }
  if (rows.length === 0) {
    return failure('empty_input', 'The source is empty. Paste or import a CSV file with a header row.');
  }

  const headers = rows[0];
  if (headers.length > SOURCE_LIMITS.maxColumns) {
    return failure(
      'column_limit',
      `The header has ${headers.length.toLocaleString()} columns; the supported limit is ${SOURCE_LIMITS.maxColumns.toLocaleString()}.`,
    );
  }
  const records = rows.slice(1);
  if (records.length > SOURCE_LIMITS.maxRecords) {
    return failure(
      'record_limit',
      `The source has ${records.length.toLocaleString()} data records; the supported limit is ${SOURCE_LIMITS.maxRecords.toLocaleString()}.`,
    );
  }
  for (let i = 0; i < records.length; i += 1) {
    const row = records[i];
    if (row.length !== headers.length) {
      const hint =
        row.length === 1 && row[0] === ''
          ? ' The record is a blank line.'
          : ' Mixed line endings, a stray comma or a missing quote can cause this.';
      return failure(
        'row_width_error',
        `Record ${i + 1} has ${row.length} cell${row.length === 1 ? '' : 's'} but the header has ${headers.length}.${hint} Nothing was padded or dropped.`,
      );
    }
  }
  return { ok: true, value: { headers, records, lineEnding, hadBom } };
}

/** Serializes a matrix back to CSV. Quoting may be normalized; logical cell values are preserved exactly. */
export function serializeCsv(headers: string[], records: string[][], lineEnding: LineEnding, withBom: boolean): string {
  const newline = lineEnding === 'CRLF' ? '\r\n' : '\n';
  const body = Papa.unparse({ fields: headers, data: records }, { quotes: false, newline, delimiter: ',' });
  return (withBom ? '﻿' : '') + body + newline;
}
