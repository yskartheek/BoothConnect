import type { FieldType, Prisma } from '../generated/prisma/client';

const PHONE = /^\+[1-9]\d{7,14}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TEXT_LENGTH = 2000;

const optionValues = (options: Prisma.JsonValue): string[] =>
  Array.isArray(options)
    ? options.flatMap((option) =>
        option &&
        typeof option === 'object' &&
        !Array.isArray(option) &&
        typeof option.value === 'string'
          ? [option.value]
          : [],
      )
    : [];

/**
 * Whether `value` fits a field of this type: text up to 2000 characters, a
 * finite number, a boolean, a real calendar date (YYYY-MM-DD), an E.164 phone
 * number, or one (single_select) or several distinct (multi_select) of the
 * field's option values. Null is not a value; clearing a field isn't supported.
 */
export function isValidValue(type: FieldType, options: Prisma.JsonValue, value: unknown): boolean {
  switch (type) {
    case 'text':
      return (
        typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH
      );
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date': {
      if (typeof value !== 'string' || !DATE.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    }
    case 'phone':
      return typeof value === 'string' && PHONE.test(value);
    case 'single_select':
      return typeof value === 'string' && optionValues(options).includes(value);
    case 'multi_select': {
      const allowed = optionValues(options);
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        new Set(value).size === value.length &&
        value.every((item) => typeof item === 'string' && allowed.includes(item))
      );
    }
    default:
      return false;
  }
}
