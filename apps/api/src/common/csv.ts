/**
 * CSV output that is safe to open in a spreadsheet (plan §8). A cell whose
 * text starts with `=`, `+`, `-`, `@`, a tab or a carriage return could be
 * run as a formula by Excel, LibreOffice or Google Sheets, so it gets a
 * leading `'`, which they show as text. Values come from OCR and admins,
 * so every exported cell goes through here.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell's text, neutralised against formula injection (not yet quoted). */
export function safeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** One CSV line (RFC 4180): safe cells, quoted when needed, ending in CRLF. */
export function csvLine(values: unknown[]): string {
  return (
    values
      .map((value) => {
        const cell = safeCsvCell(value);
        return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
      })
      .join(',') + '\r\n'
  );
}

/** Byte-order mark, so spreadsheet apps read the file as UTF-8 (Telugu names). */
export const CSV_BOM = '﻿';

/**
 * Parses CSV text (RFC 4180: quoted cells, `""` escapes, CRLF or LF line
 * ends, a leading byte-order mark). Returns the rows as arrays of cells;
 * blank lines are skipped. Throws on an unclosed quote.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sawQuote = false;
  const source = text.startsWith(CSV_BOM) ? text.slice(1) : text;
  const endRow = () => {
    row.push(cell);
    if (row.length > 1 || row[0] !== '' || sawQuote) rows.push(row);
    row = [];
    cell = '';
    sawQuote = false;
  };
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') {
      quoted = true;
      sawQuote = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i += 1;
      endRow();
    } else cell += c;
  }
  if (quoted) throw new Error('The CSV has a quote that is never closed');
  if (cell !== '' || row.length > 0 || sawQuote) endRow();
  return rows;
}
