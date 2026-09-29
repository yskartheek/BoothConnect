export const REDACTED = '[REDACTED]';

// Metadata keys whose values never go into the audit log: credentials and
// codes, and personal data (spec §14: the log records who did what to which
// record, never the data itself). Compared case-insensitively, ignoring
// `_` and `-`, so `refresh_token`, `refreshToken` and `Refresh-Token` match.
const SENSITIVE_KEYS = new Set(
  [
    // credentials and one-time codes
    'password',
    'secret',
    'token',
    'accessToken',
    'refreshToken',
    'idToken',
    'authorization',
    'cookie',
    'otp',
    'code',
    'apiKey',
    // personal data
    'name',
    'firstName',
    'lastName',
    'fullName',
    'relativeName',
    'phone',
    'mobile',
    'email',
    'address',
    'houseNumber',
    'epic',
    'epicNumber',
    'dob',
    'dateOfBirth',
    'age',
    'gender',
    'caste',
    'casteCommunity',
    'religion',
    'politicalAffiliation',
    'latitude',
    'longitude',
    'lat',
    'lng',
    'location',
    'photo',
  ].map(normalize),
);

// Values redacted wherever they appear, in case a caller puts them under an
// innocent key: phone numbers (E.164 or 10-digit Indian mobile, not part of
// a longer word such as a UUID group), JWTs, and long opaque tokens (our
// refresh tokens are 43 base64url characters).
const SENSITIVE_VALUES = [
  /(?<![\p{L}\p{N}])\+?[1-9]\d{9,14}(?![\p{L}\p{N}])/u,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/,
  /\b[\w-]{40,}\b/,
];

// Ids are what the log is for: a value that is exactly a UUID is never
// redacted, even when its hex digits happen to look like a phone number.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalize(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase();
}

/**
 * A copy of `value` safe for the audit log: sensitive keys and
 * sensitive-looking strings replaced by `[REDACTED]`, recursively.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') {
    if (UUID.test(value)) return value;
    return SENSITIVE_VALUES.some((pattern) => pattern.test(value)) ? REDACTED : value;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.has(normalize(key)) ? REDACTED : redact(item, depth + 1),
      ]),
    );
  }
  return value;
}
