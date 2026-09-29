'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { t } from '@/lib/i18n';
import { isActive, NAVIGATION } from '@/lib/navigation';

/** The portal's side navigation; items not in Milestone 1 are shown but disabled. */
export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label={t('nav.label')} className="side-nav">
      {NAVIGATION.map((group, index) => (
        <div key={group.label ?? index} className="side-nav-group">
          {group.label ? <p className="side-nav-heading">{t(group.label)}</p> : null}
          <ul>
            {group.items.map((item) => (
              <li key={item.href}>
                {item.enabled ? (
                  <Link
                    href={item.href}
                    className="side-nav-item"
                    aria-current={isActive(item.href, pathname) ? 'page' : undefined}
                  >
                    {t(item.label)}
                  </Link>
                ) : (
                  <span className="side-nav-item" aria-disabled="true">
                    {t(item.label)}
                    <span className="side-nav-badge">{t('nav.later')}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
