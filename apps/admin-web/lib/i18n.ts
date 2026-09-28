import en from '@boothconnect/i18n/web/en.json';

/**
 * Every string the admin web can show: the shared keys (visitOutcome.*,
 * syncState.*, error.*, consent.*) plus its own `web.*` keys without the
 * prefix. Generated from packages/i18n/locales by `pnpm build`.
 */
export type MessageKey = keyof typeof en;

// English only for now; a language switch comes with the admin settings.
const messages: Record<MessageKey, string> = en;

export function t(key: MessageKey): string {
  return messages[key];
}
