import { useEffect, useState } from 'react';

const KEY = 'theme';

function initial() {
  try {
    return localStorage.getItem(KEY) || 'dark'; // dark is the default for every new user
  } catch {
    return 'dark';
  }
}

function apply(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

// runs once on import, so the right theme is set before the first paint of the app
apply(initial());

export function useTheme() {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}