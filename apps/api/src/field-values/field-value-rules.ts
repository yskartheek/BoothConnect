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
 * field's option values, or a household address or location (see below).
 * Null is not a value; clearing a field isn't supported.
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
    case 'address':
      return isAddress(value);
    case 'location':
      return isLocation(value);
    default:
      return false;
  }
}

export const ADDRESS_PARTS = ['house_no', 'street', 'area', 'pin_code', 'landmark'] as const;
export type Address = Partial<Record<(typeof ADDRESS_PARTS)[number], string>>;
const MAX_ADDRESS_PART = 200;
const PIN_CODE = /^\d{6}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Only the known parts, each a non-blank string of up to 200 characters; a
 * PIN code has 6 digits; a house number or street is required.
 */
function isAddress(value: unknown): value is Address {
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.every(
      ([key, part]) =>
        (ADDRESS_PARTS as readonly string[]).includes(key) &&
        typeof part === 'string' &&
        part.trim().length > 0 &&
        part.length <= MAX_ADDRESS_PART &&
        (key !== 'pin_code' || PIN_CODE.test(part)),
    ) &&
    (typeof value.house_no === 'string' || typeof value.street === 'string')
  );
}

export interface Location {
  lat: number;
  lng: number;
  accuracyM?: number;
  /** ISO 8601, when the phone took the reading. */
  capturedAt: string;
}

/** Latitude and longitude in range, accuracy in metres if given, a real timestamp. */
function isLocation(value: unknown): value is Location {
  if (!isObject(value)) return false;
  const known = ['lat', 'lng', 'accuracyM', 'capturedAt'];
  const { lat, lng, accuracyM, capturedAt } = value;
  return (
    Object.keys(value).every((key) => known.includes(key)) &&
    typeof lat === 'number' &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    lng >= -180 &&
    lng <= 180 &&
    (accuracyM === undefined ||
      (typeof accuracyM === 'number' && accuracyM >= 0 && accuracyM <= 100_000)) &&
    typeof capturedAt === 'string' &&
    !Number.isNaN(Date.parse(capturedAt)) &&
    /^\d{4}-\d{2}-\d{2}T/.test(capturedAt)
  );
}

/** "12/4, Gandhi Road, Nehru Nagar, 500038": what lists and search show. */
export function displayAddress(address: Address): string {
  return [address.house_no, address.street, address.area, address.pin_code]
    .filter((part): part is string => !!part)
    .map((part) => part.trim())
    .join(', ');
}
