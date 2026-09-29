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
