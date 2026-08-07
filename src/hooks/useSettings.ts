import { useCallback, useEffect, useState } from 'react';
import type { ColorScheme } from '@/components/SettingsPanel';
import { DEFAULT_BACKUP_LIMIT, MAX_BACKUP_LIMIT, MIN_BACKUP_LIMIT } from '@/lib/usb/backup';
import { DEFAULT_EXPORT_COLUMNS, type ExportColumn } from '@/lib/export/exporters';

const STORAGE_KEY = 'rekordbox-viewer-settings';

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 28;

export const FONT_PRESETS = [
  { label: 'Compact', size: 11 },
  { label: 'Default', size: 14 },
  { label: 'Large', size: 18 },
  { label: 'Booth', size: 24 },
] as const;

export interface Settings {
  colorScheme: ColorScheme;
  fontSize: number;
  hiddenColumns: string[];
  /** How many backup snapshots to keep on each drive. */
  backupLimit: number;
  /** Snapshot automatically the first time a drive is opened in a session. */
  backupOnOpen: boolean;
  exportColumns: ExportColumn[];
  /** Paper size for PDF export. */
  pdfPageSize: 'a4' | 'letter';
  pdfOrientation: 'portrait' | 'landscape';
  pdfIncludeNumbers: boolean;
  pdfIncludeFooter: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  colorScheme: 'dark',
  fontSize: 14,
  hiddenColumns: [],
  backupLimit: DEFAULT_BACKUP_LIMIT,
  backupOnOpen: true,
  exportColumns: [...DEFAULT_EXPORT_COLUMNS],
  pdfPageSize: 'a4',
  pdfOrientation: 'portrait',
  pdfIncludeNumbers: true,
  pdfIncludeFooter: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Merge stored settings over the defaults, discarding anything malformed. */
function hydrate(stored: unknown): Settings {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS;
  const raw = stored as Partial<Settings>;

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    fontSize: clamp(Number(raw.fontSize) || DEFAULT_SETTINGS.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    backupLimit: clamp(
      Number(raw.backupLimit) || DEFAULT_SETTINGS.backupLimit,
      MIN_BACKUP_LIMIT,
      MAX_BACKUP_LIMIT
    ),
    hiddenColumns: Array.isArray(raw.hiddenColumns) ? raw.hiddenColumns.filter((c) => typeof c === 'string') : [],
    exportColumns: Array.isArray(raw.exportColumns) && raw.exportColumns.length > 0
      ? (raw.exportColumns as ExportColumn[])
      : [...DEFAULT_EXPORT_COLUMNS],
  };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? hydrate(JSON.parse(stored)) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Private browsing or a full quota — settings just will not persist.
    }
  }, [settings]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-dark', 'theme-light', 'theme-arctic', 'theme-midnight');
    root.classList.add(`theme-${settings.colorScheme}`);
  }, [settings.colorScheme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--table-font-size', `${settings.fontSize}px`);
  }, [settings.fontSize]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setFontSize = useCallback((size: number) => {
    setSettings((prev) => ({ ...prev, fontSize: clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE) }));
  }, []);

  const adjustFontSize = useCallback((delta: number) => {
    setSettings((prev) => ({
      ...prev,
      fontSize: clamp(prev.fontSize + delta, MIN_FONT_SIZE, MAX_FONT_SIZE),
    }));
  }, []);

  const toggleColumnVisibility = useCallback((columnKey: string) => {
    setSettings((prev) => ({
      ...prev,
      hiddenColumns: prev.hiddenColumns.includes(columnKey)
        ? prev.hiddenColumns.filter((key) => key !== columnKey)
        : [...prev.hiddenColumns, columnKey],
    }));
  }, []);

  const toggleExportColumn = useCallback((columnKey: ExportColumn) => {
    setSettings((prev) => {
      const next = prev.exportColumns.includes(columnKey)
        ? prev.exportColumns.filter((key) => key !== columnKey)
        : [...prev.exportColumns, columnKey];
      // Always leave something to export.
      return { ...prev, exportColumns: next.length > 0 ? next : prev.exportColumns };
    });
  }, []);

  const resetSettings = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return {
    ...settings,
    setColorScheme: useCallback((scheme: ColorScheme) => update('colorScheme', scheme), [update]),
    setFontSize,
    adjustFontSize,
    toggleColumnVisibility,
    toggleExportColumn,
    setBackupLimit: useCallback(
      (limit: number) => update('backupLimit', clamp(limit, MIN_BACKUP_LIMIT, MAX_BACKUP_LIMIT)),
      [update]
    ),
    setBackupOnOpen: useCallback((value: boolean) => update('backupOnOpen', value), [update]),
    setPdfPageSize: useCallback((v: Settings['pdfPageSize']) => update('pdfPageSize', v), [update]),
    setPdfOrientation: useCallback(
      (v: Settings['pdfOrientation']) => update('pdfOrientation', v),
      [update]
    ),
    setPdfIncludeNumbers: useCallback((v: boolean) => update('pdfIncludeNumbers', v), [update]),
    setPdfIncludeFooter: useCallback((v: boolean) => update('pdfIncludeFooter', v), [update]),
    resetSettings,
  };
}

export type SettingsApi = ReturnType<typeof useSettings>;
