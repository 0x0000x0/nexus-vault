import { useState, useEffect, useCallback } from 'react';
import { nexus } from '../utils/nexus';

export function useTheme() {
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>('system');
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    };
    updateSystemTheme();
    mediaQuery.addEventListener('change', updateSystemTheme);

    const unsub = nexus.theme.onChange((t) => {
      if (theme === 'system') {
        setSystemTheme(t);
      }
    });

    return () => {
      mediaQuery.removeEventListener('change', updateSystemTheme);
      unsub();
    };
  }, [theme]);

  const setTheme = useCallback(async (t: 'light' | 'dark' | 'system') => {
    setThemeState(t);
    await nexus.settings.save({ theme: t });
    if (t !== 'system') {
      setSystemTheme(t);
    }
    document.documentElement.setAttribute('data-theme', t === 'system' ? '' : t);
  }, []);

  useEffect(() => {
    if (theme !== 'system') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme, systemTheme]);

  return { theme, setTheme, systemTheme };
}