import { HttpStatus } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { AppException } from './errors/app.exception';
import { ErrorCode } from './errors/error-codes';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Query parameters shared by cursor-paginated lists: `?limit=&cursor=`. */
export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  /** Opaque: the `nextCursor` of the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

/** Cursors are opaque to clients: base64url JSON of the last row's sort key. */
export function encodeCursor(position: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(
  cursor: string,
  isValid: (value: Record<string, unknown>) => value is T,
): T {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown;
    if (value && typeof value === 'object' && isValid(value as Record<string, unknown>)) {
      return value as T;
    }
  } catch {
    // fall through
  }
  throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST, 'Invalid cursor');
}

/**
 * Turns `limit + 1` fetched rows into a page: the extra row, if present, only
 * signals that there is a next page.
 */
export function toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => string): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? cursorOf(last) : null };
}

/** Escapes `%`, `_` and `\` for use inside a LIKE pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
