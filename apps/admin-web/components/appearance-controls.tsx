'use client';

import { useEffect, useId, useState } from 'react';

import { t } from '@/lib/i18n';

export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * Lets an admin override the system theme and transparency settings. It sets
 * `data-theme` and `data-transparency` on <html>; the design-token CSS does the rest.
 */
export function AppearanceControls() {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const themeId = useId();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (reduceTransparency) root.dataset.transparency = 'reduced';
    else delete root.dataset.transparency;
  }, [reduceTransparency]);

  return (
    <fieldset className="appearance">
      <legend>{t('appearance.legend')}</legend>
      <label htmlFor={themeId}>{t('appearance.theme')}</label>
      <select
        id={themeId}
        value={theme}
        onChange={(event) => setTheme(event.target.value as ThemeChoice)}
      >
        <option value="system">{t('appearance.themeSystem')}</option>
        <option value="light">{t('appearance.themeLight')}</option>
        <option value="dark">{t('appearance.themeDark')}</option>
      </select>
      <label>
        <input
          type="checkbox"
          checked={reduceTransparency}
          onChange={(event) => setReduceTransparency(event.target.checked)}
        />
        {t('appearance.reduceTransparency')}
      </label>
    </fieldset>
  );
}
