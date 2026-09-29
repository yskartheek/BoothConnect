import type { MessageKey } from './i18n';

export interface NavItem {
  href: string;
  label: MessageKey;
  /** False: shown, but not in Milestone 1 yet. */
  enabled: boolean;
}

export interface NavGroup {
  /** Null for the first group, which has no heading. */
  label: MessageKey | null;
  items: NavItem[];
}

/** The side navigation (spec §9.3). Only Milestone 1 pages are enabled. */
export const NAVIGATION: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/', label: 'nav.overview', enabled: true },
      { href: '/geography', label: 'nav.geography', enabled: true },
      { href: '/voters', label: 'nav.voters', enabled: true },
      { href: '/field-operations', label: 'nav.fieldOperations', enabled: false },
    ],
  },
  {
    label: 'nav.groupData',
    items: [
      { href: '/analytics', label: 'nav.analytics', enabled: true },
      { href: '/imports', label: 'nav.imports', enabled: true },
      { href: '/campaigns', label: 'nav.campaigns', enabled: false },
    ],
  },
  {
    label: 'nav.groupAdmin',
    items: [
      { href: '/users', label: 'nav.users', enabled: true },
      { href: '/forms', label: 'nav.forms', enabled: false },
      { href: '/privacy', label: 'nav.privacy', enabled: false },
      { href: '/audit', label: 'nav.audit', enabled: true },
      { href: '/settings', label: 'nav.settings', enabled: false },
    ],
  },
];

/** Whether `pathname` is the item's page or one below it. */
export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
