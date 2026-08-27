import { useCallback, useRef, useState } from 'react';
import type {
  FileEntry,
  Playlist,
  RekordboxDatabase,
  SortColumn,
  SortDirection,
  Track,
  USBStatus,
} from '@/types/rekordbox';
import {
  findRekordboxDatabase,
  fullScanForDatabase,
  listDirectory,
  parseRekordboxDatabase,
  parseRekordboxDatabaseFromFile,
} from '@/lib/rekordbox-parser';
import { useToast } from '@/hooks/use-toast';
import { identifyFile } from '@/lib/file-sniff';
import { MOBILE_BREAKPOINT } from '@/hooks/use-mobile';
import { rememberDevice } from '@/lib/device-registry';

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function isSmallScreen(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
  );
}

/**
 * `exportExt.pdb` sometimes carries BPM and genre the base export omits, so
 * fill in only the gaps — never overwrite a value the base database has.
 */
function mergeExportExt(base: RekordboxDatabase, ext: RekordboxDatabase): RekordboxDatabase {
  const extById = new Map(ext.tracks.map((track) => [track.id, track] as const));
  return {
    ...base,
    tracks: base.tracks.map((track) => {
      const extra = extById.get(track.id);
      if (!extra) return track;
      return {
        ...track,
        bpm: track.bpm > 0 ? track.bpm : extra.bpm,
        genre: track.genre ? track.genre : extra.genre,
      };
    }),
  };
}

const EXPORT_EXT_NAMES = ['exportExt.pdb', 'exportext.pdb'];

async function findExportExt(
  root: FileSystemDirectoryHandle
): Promise<FileSystemFileHandle | null> {
  try {
    const pioneer = await root.getDirectoryHandle('PIONEER', { create: false });
    const rekordbox = await pioneer.getDirectoryHandle('rekordbox', { create: false });
    for (const name of EXPORT_EXT_NAMES) {
      try {
        return await rekordbox.getFileHandle(name, { create: false });
      } catch {
        // try the next spelling
      }
    }
  } catch {
    // No PIONEER/rekordbox — nothing to merge.
  }
  return null;
}

export function useRekordbox() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<USBStatus>({ type: 'idle' });
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [currentDirectory, setCurrentDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [directoryPath, setDirectoryPath] = useState<string[]>([]);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const { toast } = useToast();

  /** Parse a drive's database, merging exportExt when it is worth the time. */
  const loadFromHandle = useCallback(
    async (root: FileSystemDirectoryHandle, options: { quiet?: boolean } = {}) => {
      const result = await findRekordboxDatabase(root);

      if (!result.found || !result.handle) {
        if (result.partialMatch) {
          setStatus({
            type: 'partial',
            message: result.message || 'Partial Rekordbox structure found.',
            libraries: result.libraries,
          });
        } else {
          setStatus({ type: 'invalid', message: result.message || 'Non-Rekordbox USB detected.' });
        }
        return;
      }

      const base = await parseRekordboxDatabase(result.handle);

      // Merging doubles the parse work; skip it on phones where it hurts most.
      let database = base;
      if (!isSmallScreen()) {
        const extHandle = await findExportExt(root);
        if (extHandle) {
          try {
            database = mergeExportExt(base, await parseRekordboxDatabase(extHandle));
          } catch (error) {
            console.warn('Optional exportExt.pdb merge failed:', error);
          }
        }
      }

      const libraries = result.libraries || { hasLegacy: true, hasPlus: false };
      setStatus({ type: 'valid', database, libraries });
      setSelectedPlaylist(null);

      void rememberDevice({ volumeName: root.name, database, libraries }).catch(() => {
        // The registry is a convenience; never let it break loading a drive.
      });

      if (!options.quiet) {
        toast({
          title: 'Library loaded',
          description: `${database.tracks.length} tracks from ${root.name}.`,
        });
      }
    },
    [toast]
  );

  const selectFolder = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      setStatus({
        type: 'error',
        message:
          'This browser cannot open folders. Use Chrome, Edge or Opera on a desktop, or pick export.pdb directly.',
      });
      return;
    }

    try {
      setStatus({ type: 'loading' });
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      setRootHandle(handle);
      setCurrentDirectory(handle);
      setDirectoryPath([handle.name]);
      setFileEntries([]);
      await loadFromHandle(handle);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus({ type: 'idle' });
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Failed to access the selected folder.';
      console.error('Folder selection error:', error);
      toast({ title: 'Could not open that drive', description: message, variant: 'destructive' });
      setStatus({ type: 'error', message });
    }
  }, [loadFromHandle, toast]);

  /** Re-read the drive after a write, so the UI reflects what is on disk. */
  const reload = useCallback(async () => {
    if (!rootHandle) return;
    try {
      await loadFromHandle(rootHandle, { quiet: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast({ title: 'Could not reload the drive', description: message, variant: 'destructive' });
    }
  }, [loadFromHandle, rootHandle, toast]);

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const fileArray = Array.from(files);
      const lower = (name: string) => name.toLowerCase();
      const pdbFiles = fileArray.filter((file) => lower(file.name).endsWith('.pdb'));

      const exportFile =
        pdbFiles.find((f) => lower(f.name) === 'export.pdb') ??
        pdbFiles.find((f) => lower(f.name).includes('export') && !lower(f.name).includes('ext'));
      const exportExtFile =
        pdbFiles.find((f) => lower(f.name) === 'exportext.pdb') ??
        pdbFiles.find((f) => lower(f.name).includes('export') && lower(f.name).includes('ext'));

      const primary =
        exportFile ?? exportExtFile ?? pdbFiles[0] ?? (fileArray.length === 1 ? fileArray[0] : null);

      if (!primary) {
        const message =
          'No export.pdb found. Pick the database file at PIONEER/rekordbox/export.pdb.';
        setStatus({ type: 'error', message });
        toast({ title: 'Database not found', description: message, variant: 'destructive' });
        return;
      }

      setStatus({ type: 'loading' });

      try {
        // Identify the file before parsing it. On iOS there is no folder picker,
        // so people reach for their music and the raw parser error for an audio
        // file is unreadable — see src/lib/file-sniff.ts.
        const head = new Uint8Array(await primary.slice(0, 256).arrayBuffer());
        const id = identifyFile(head, primary.name);
        if (!id.parseable) {
          setStatus({ type: 'error', message: id.message });
          toast({ title: 'Wrong file', description: id.message, variant: 'destructive' });
          return;
        }

        const base = await parseRekordboxDatabaseFromFile(primary);
        let database = base;
        if (!isSmallScreen() && exportFile && exportExtFile) {
          database = mergeExportExt(base, await parseRekordboxDatabaseFromFile(exportExtFile));
        }

        setStatus({
          type: 'valid',
          database,
          libraries: { hasLegacy: true, hasPlus: false },
        });
        toast({
          title: 'Library loaded',
          description: `${database.tracks.length} tracks.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Parse error:', error);
        toast({ title: 'Could not read that file', description: message, variant: 'destructive' });
        setStatus({ type: 'error', message: `Failed to parse the database: ${message}` });
      } finally {
        event.target.value = '';
      }
    },
    [toast]
  );

  const triggerFileInput = useCallback(() => fileInputRef.current?.click(), []);

  const performFullScan = useCallback(async () => {
    if (!rootHandle) return;
    setStatus({ type: 'loading' });

    try {
      const result = await fullScanForDatabase(rootHandle);
      if (!result.found || !result.handle) {
        const message = 'No export.pdb found anywhere on this drive.';
        setStatus({ type: 'invalid', message });
        toast({ title: 'Database not found', description: message, variant: 'destructive' });
        return;
      }

      const database = await parseRekordboxDatabase(result.handle);
      setStatus({ type: 'valid', database, libraries: { hasLegacy: true, hasPlus: false } });
      toast({
        title: 'Database found',
        description: `${database.tracks.length} tracks at ${result.path}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Full scan failed.';
      console.error('Full scan error:', error);
      toast({ title: 'Scan failed', description: message, variant: 'destructive' });
      setStatus({ type: 'error', message });
    }
  }, [rootHandle, toast]);

  const navigateToDirectory = useCallback(
    async (dirHandle: FileSystemDirectoryHandle, dirName: string) => {
      try {
        const entries = await listDirectory(dirHandle);
        setCurrentDirectory(dirHandle);
        setDirectoryPath((prev) => [...prev, dirName]);
        setFileEntries(entries);
      } catch (error) {
        console.error('Navigation error:', error);
      }
    },
    []
  );

  const navigateUp = useCallback(async () => {
    if (!rootHandle || directoryPath.length <= 1) return;

    try {
      let handle = rootHandle;
      const newPath = directoryPath.slice(0, -1);
      for (let i = 1; i < newPath.length; i++) {
        handle = await handle.getDirectoryHandle(newPath[i]);
      }
      setCurrentDirectory(handle);
      setDirectoryPath(newPath);
      setFileEntries(await listDirectory(handle));
    } catch (error) {
      console.error('Navigate up error:', error);
    }
  }, [rootHandle, directoryPath]);

  const loadFileEntries = useCallback(async () => {
    if (!currentDirectory) return;
    try {
      setFileEntries(await listDirectory(currentDirectory));
    } catch (error) {
      console.error('Load entries error:', error);
    }
  }, [currentDirectory]);

  const reset = useCallback(() => {
    setStatus({ type: 'idle' });
    setRootHandle(null);
    setCurrentDirectory(null);
    setDirectoryPath([]);
    setFileEntries([]);
    setSelectedPlaylist(null);
    setSearchQuery('');
  }, []);

  const getFilteredTracks = useCallback((): Track[] => {
    if (status.type !== 'valid') return [];

    let tracks = status.database.tracks;

    if (selectedPlaylist && !selectedPlaylist.isFolder) {
      const order = new Map(selectedPlaylist.trackIds.map((id, index) => [id, index] as const));
      tracks = tracks.filter((track) => order.has(track.id));
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      tracks = tracks.filter(
        (track) =>
          track.title.toLowerCase().includes(query) ||
          track.artist.toLowerCase().includes(query) ||
          track.album.toLowerCase().includes(query) ||
          track.genre.toLowerCase().includes(query)
      );
    }

    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...tracks].sort((a, b) => {
      switch (sortColumn) {
        case 'duration':
          return (a.duration - b.duration) * direction;
        case 'bpm':
          return (a.bpm - b.bpm) * direction;
        case 'year':
          return ((a.year ?? 0) - (b.year ?? 0)) * direction;
        case 'label':
          return (a.label ?? '').localeCompare(b.label ?? '') * direction;
        default:
          return a[sortColumn].localeCompare(b[sortColumn]) * direction;
      }
    });
  }, [status, selectedPlaylist, searchQuery, sortColumn, sortDirection]);

  const handleSort = useCallback(
    (column: SortColumn) => {
      if (column === sortColumn) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(column);
        setSortDirection('asc');
      }
    },
    [sortColumn]
  );

  return {
    status,
    rootHandle,
    currentDirectory,
    directoryPath,
    fileEntries,
    selectedPlaylist,
    searchQuery,
    sortColumn,
    sortDirection,
    selectFolder,
    reload,
    performFullScan,
    navigateToDirectory,
    navigateUp,
    loadFileEntries,
    reset,
    setSelectedPlaylist,
    setSearchQuery,
    getFilteredTracks,
    handleSort,
    fileInputRef,
    handleFileInput,
    triggerFileInput,
  };
}
