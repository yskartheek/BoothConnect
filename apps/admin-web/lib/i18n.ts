import en from '@boothconnect/i18n/web/en.json';

/**
 * Every string the admin web can show: the shared keys (visitOutcome.*,
 * syncState.*, error.*, consent.*) plus its own `web.*` keys without the
 * prefix. Generated from packages/i18n/locales by `pnpm build`.
 */
export type MessageKey = keyof typeof en;

// English only for now; a language switch comes with the admin settings.
const messages: Record<MessageKey, string> = en;

/** The message, with `{name}` placeholders filled from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const message = messages[key];
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Whether a string is a message key (e.g. an API error code as `error.<CODE>`). */
export function isMessageKey(key: string): key is MessageKey {
  return key in messages;
}
