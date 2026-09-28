'use client';

import { useEffect, useId, useState } from 'react';

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
      <legend>Appearance</legend>
      <label htmlFor={themeId}>Theme</label>
      <select
        id={themeId}
        value={theme}
        onChange={(event) => setTheme(event.target.value as ThemeChoice)}
      >
        <option value="system">Same as system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <label>
        <input
          type="checkbox"
          checked={reduceTransparency}
          onChange={(event) => setReduceTransparency(event.target.checked)}
        />
        Reduce transparency
      </label>
    </fieldset>
  );
}
