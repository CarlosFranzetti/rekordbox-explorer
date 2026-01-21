import { useState, useEffect, useCallback } from 'react';
import type { ColorScheme } from '@/components/SettingsPanel';

const STORAGE_KEY = 'rekordbox-viewer-settings';

interface Settings {
  colorScheme: ColorScheme;
  fontSize: number;
  hiddenColumns: string[];
}

const DEFAULT_SETTINGS: Settings = {
  colorScheme: 'dark',
  fontSize: 14,
  hiddenColumns: [],
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    return DEFAULT_SETTINGS;
  });

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }, [settings]);

  // Apply color scheme to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-dark', 'theme-light', 'theme-arctic', 'theme-midnight');
    root.classList.add(`theme-${settings.colorScheme}`);
  }, [settings.colorScheme]);

  // Apply font size to document
  useEffect(() => {
    document.documentElement.style.setProperty('--table-font-size', `${settings.fontSize}px`);
  }, [settings.fontSize]);

  const setColorScheme = useCallback((colorScheme: ColorScheme) => {
    setSettings((prev) => ({ ...prev, colorScheme }));
  }, []);

  const setFontSize = useCallback((fontSize: number) => {
    setSettings((prev) => ({ ...prev, fontSize }));
  }, []);

  const toggleColumnVisibility = useCallback((columnKey: string) => {
    setSettings((prev) => {
      const isHidden = prev.hiddenColumns.includes(columnKey);
      return {
        ...prev,
        hiddenColumns: isHidden
          ? prev.hiddenColumns.filter((key) => key !== columnKey)
          : [...prev.hiddenColumns, columnKey],
      };
    });
  }, []);

  return {
    colorScheme: settings.colorScheme,
    fontSize: settings.fontSize,
    hiddenColumns: settings.hiddenColumns,
    setColorScheme,
    setFontSize,
    toggleColumnVisibility,
  };
}
