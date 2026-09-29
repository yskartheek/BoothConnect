export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'bc.theme';
export const TRANSPARENCY_KEY = 'bc.transparency';

/**
 * Runs in <head> before the first paint: applies the saved theme and
 * transparency to <html>, so a dark-theme admin never sees a light flash.
 */
export const APPEARANCE_SCRIPT = `(function(){try{var r=document.documentElement;var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")r.dataset.theme=t;if(localStorage.getItem(${JSON.stringify(TRANSPARENCY_KEY)})==="reduced")r.dataset.transparency="reduced"}catch(e){}})()`;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function savedTheme(): ThemeChoice {
  const value = storage()?.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function savedReduceTransparency(): boolean {
  return storage()?.getItem(TRANSPARENCY_KEY) === 'reduced';
}

/** Applies the choice to <html> and remembers it in this browser. */
export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === 'system') {
    delete root.dataset.theme;
    storage()?.removeItem(THEME_KEY);
  } else {
    root.dataset.theme = theme;
    storage()?.setItem(THEME_KEY, theme);
  }
}

export function applyReduceTransparency(reduce: boolean): void {
  const root = document.documentElement;
  if (reduce) {
    root.dataset.transparency = 'reduced';
    storage()?.setItem(TRANSPARENCY_KEY, 'reduced');
  } else {
    delete root.dataset.transparency;
    storage()?.removeItem(TRANSPARENCY_KEY);
  }
}
