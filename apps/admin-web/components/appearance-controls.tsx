'use client';

import { useId, useState } from 'react';

import {
  applyReduceTransparency,
  applyTheme,
  savedReduceTransparency,
  savedTheme,
  type ThemeChoice,
} from '@/lib/appearance';
import { t } from '@/lib/i18n';

export type { ThemeChoice };

/**
 * Lets an admin override the system theme and transparency settings. It sets
 * `data-theme` and `data-transparency` on <html> (the design-token CSS does
 * the rest) and remembers the choice in this browser.
 */
export function AppearanceControls() {
  // Rendered only in the appearance popover, after hydration, so reading
  // localStorage in the initial state is safe.
  const [theme, setTheme] = useState<ThemeChoice>(savedTheme);
  const [reduceTransparency, setReduceTransparency] = useState(savedReduceTransparency);
  const themeId = useId();

  return (
    <fieldset className="appearance">
      <legend>{t('appearance.legend')}</legend>
      <label htmlFor={themeId}>{t('appearance.theme')}</label>
      <select
        id={themeId}
        value={theme}
        onChange={(event) => {
          const value = event.target.value as ThemeChoice;
          setTheme(value);
          applyTheme(value);
        }}
      >
        <option value="system">{t('appearance.themeSystem')}</option>
        <option value="light">{t('appearance.themeLight')}</option>
        <option value="dark">{t('appearance.themeDark')}</option>
      </select>
      <label>
        <input
          type="checkbox"
          checked={reduceTransparency}
          onChange={(event) => {
            setReduceTransparency(event.target.checked);
            applyReduceTransparency(event.target.checked);
          }}
        />
        {t('appearance.reduceTransparency')}
      </label>
    </fieldset>
  );
}
