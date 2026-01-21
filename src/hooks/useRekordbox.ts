import { useState, useCallback, useRef } from 'react';
import type { USBStatus, FileEntry, Playlist, Track, SortColumn, SortDirection } from '@/types/rekordbox';
import { 
  findRekordboxDatabase, 
  fullScanForDatabase, 
  parseRekordboxDatabase,
  parseRekordboxDatabaseFromFile,
  listDirectory 
} from '@/lib/rekordbox-parser';
import { useToast } from '@/hooks/use-toast';

// Check if File System Access API is supported
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
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

  const selectFolder = useCallback(async () => {
    try {
      // Check for File System Access API support
      if (!('showDirectoryPicker' in window)) {
        setStatus({
          type: 'error',
          message: 'Your browser does not support the File System Access API. Please use Chrome, Edge, or Opera.'
        });
        return;
      }

      setStatus({ type: 'loading' });
      
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      setRootHandle(handle);
      setCurrentDirectory(handle);
      setDirectoryPath([handle.name]);
      
      // Try to find Rekordbox database (export.pdb preferred; exportExt.pdb fallback)
      const result = await findRekordboxDatabase(handle);

      if (result.found && result.handle) {
        try {
          // iOS/small screens: keep it lightweight (skip exportExt merge)
          const isSmallScreen = window.matchMedia('(max-width: 767px)').matches;

          const baseDb = await parseRekordboxDatabase(result.handle);

          // If we loaded export.pdb from the standard location, try to also load exportExt.pdb
          // to fill in fields like BPM/Genre when they are missing in the base DB.
          let mergedDb = baseDb;

          if (!isSmallScreen) {
            try {
              const pioneerDir = await handle.getDirectoryHandle('PIONEER', { create: false });
              const rekordboxDir = await pioneerDir.getDirectoryHandle('rekordbox', { create: false });

              // Try common filename variants
              const extNames = ['exportExt.pdb', 'exportext.pdb'];
              let extHandle: FileSystemFileHandle | null = null;
              for (const n of extNames) {
                try {
                  extHandle = await rekordboxDir.getFileHandle(n, { create: false });
                  break;
                } catch {
                  // continue
                }
              }

              if (extHandle) {
                const extDb = await parseRekordboxDatabase(extHandle);
                const extById = new Map(extDb.tracks.map((t) => [t.id, t] as const));

                mergedDb = {
                  ...baseDb,
                  tracks: baseDb.tracks.map((t) => {
                    const ext = extById.get(t.id);
                    if (!ext) return t;
                    return {
                      ...t,
                      bpm: t.bpm > 0 ? t.bpm : ext.bpm,
                      genre: t.genre ? t.genre : ext.genre,
                    };
                  }),
                };
              }
            } catch (e) {
              // Non-fatal; proceed with base DB
              console.warn('Optional exportExt.pdb merge failed:', e);
            }
          }

          setStatus({ type: 'valid', database: mergedDb, libraries: result.libraries || { hasLegacy: true, hasPlus: false } });

          // Show success toast
          toast({
            title: 'Database Loaded',
            description: `Successfully loaded ${mergedDb.tracks.length} tracks from Rekordbox database.`,
            variant: 'default',
          });
        } catch (parseError) {
          console.error('Parse error:', parseError);

          const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown error';

          // Show error toast for user feedback
          toast({
            title: 'Parse Error',
            description: errorMessage,
            variant: 'destructive',
          });

          setStatus({
            type: 'error',
            message: `Failed to parse Rekordbox database: ${errorMessage}`,
          });
        }
      } else if (result.partialMatch) {
        setStatus({
          type: 'partial',
          message: result.message || 'Partial Rekordbox structure found.',
          libraries: result.libraries
        });
      } else {
        setStatus({
          type: 'invalid',
          message: result.message || 'Non-Rekordbox USB detected.',
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus({ type: 'idle' });
        return;
      }
      console.error('Folder selection error:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to access the selected folder.';
      
      // Show error toast for user feedback
      toast({
        title: "Folder Selection Error",
        description: errorMessage,
        variant: "destructive",
      });
      
      setStatus({
        type: 'error',
        message: errorMessage
      });
    }
  }, [toast]);

  const handleFileInput = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const norm = (name: string) => name.toLowerCase();

    // On small screens (iOS/mobile), keep parsing lightweight.
    const isSmallScreen = window.matchMedia('(max-width: 767px)').matches;

    const pdbCandidates = fileArray.filter((f) => norm(f.name).endsWith('.pdb') || norm(f.name).includes('.pdb'));

    const exportFile =
      pdbCandidates.find((f) => norm(f.name) === 'export.pdb') ||
      pdbCandidates.find((f) => norm(f.name).includes('export') && !norm(f.name).includes('ext')) ||
      null;

    const exportExtFile =
      pdbCandidates.find((f) => norm(f.name) === 'exportext.pdb') ||
      pdbCandidates.find((f) => norm(f.name).includes('export') && norm(f.name).includes('ext')) ||
      null;

    const primaryFile = exportFile || exportExtFile || pdbCandidates[0] || (fileArray.length === 1 ? fileArray[0] : null);

    if (!primaryFile) {
      setStatus({
        type: 'error',
        message:
          'No export.pdb file found. Please select the Rekordbox database file (export.pdb) or a folder containing it.',
      });
      toast({
        title: 'Database Not Found',
        description: 'Please select export.pdb or exportExt.pdb (or a folder containing them).',
        variant: 'destructive',
      });
      return;
    }

    setStatus({ type: 'loading' });

    try {
      const baseDb = await parseRekordboxDatabaseFromFile(primaryFile);

      // Desktop/large screens: if both are available, merge exportExt into export (for BPM/Genre completeness).
      let mergedDb = baseDb;

      if (!isSmallScreen && exportFile && exportExtFile) {
        const extDb = await parseRekordboxDatabaseFromFile(exportExtFile);
        const extById = new Map(extDb.tracks.map((t) => [t.id, t] as const));

        mergedDb = {
          ...baseDb,
          tracks: baseDb.tracks.map((t) => {
            const ext = extById.get(t.id);
            if (!ext) return t;
            return {
              ...t,
              bpm: t.bpm > 0 ? t.bpm : ext.bpm,
              genre: t.genre ? t.genre : ext.genre,
            };
          }),
        };
      }

      setStatus({ 
        type: 'valid', 
        database: mergedDb,
        libraries: { hasLegacy: true, hasPlus: false } 
      });

      toast({
        title: 'Database Loaded',
        description: `Successfully loaded ${mergedDb.tracks.length} tracks from Rekordbox database.`,
        variant: 'default',
      });
    } catch (parseError) {
      console.error('Parse error:', parseError);
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown error';

      toast({
        title: 'Parse Error',
        description: errorMessage,
        variant: 'destructive',
      });

      setStatus({
        type: 'error',
        message: `Failed to parse Rekordbox database: ${errorMessage}`,
      });
    }

    // Reset file input
    if (event.target) {
      event.target.value = '';
    }
  }, [toast]);

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const performFullScan = useCallback(async () => {
    if (!rootHandle) return;
    
    setStatus({ type: 'loading' });
    
    try {
      const result = await fullScanForDatabase(rootHandle);
      
      if (result.found && result.handle) {
        const database = await parseRekordboxDatabase(result.handle);
        setStatus({ 
          type: 'valid', 
          database,
          libraries: { hasLegacy: true, hasPlus: false }
        });
        
        // Show success toast
        toast({
          title: "Database Found",
          description: `Found and loaded ${database.tracks.length} tracks from Rekordbox database.`,
          variant: "default",
        });
      } else {
        setStatus({
          type: 'invalid',
          message: 'No export.pdb file found after full scan.'
        });
        
        // Show info toast
        toast({
          title: "Database Not Found",
          description: "No export.pdb file found after full scan.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Full scan error:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Full scan failed.';
      
      // Show error toast
      toast({
        title: "Full Scan Error",
        description: errorMessage,
        variant: "destructive",
      });
      
      setStatus({
        type: 'error',
        message: errorMessage
      });
    }
  }, [rootHandle, toast]);

  const navigateToDirectory = useCallback(async (dirHandle: FileSystemDirectoryHandle, dirName: string) => {
    try {
      const entries = await listDirectory(dirHandle);
      setCurrentDirectory(dirHandle);
      setDirectoryPath(prev => [...prev, dirName]);
      setFileEntries(entries);
    } catch (error) {
      console.error('Navigation error:', error);
    }
  }, []);

  const navigateUp = useCallback(async () => {
    if (!rootHandle || directoryPath.length <= 1) return;
    
    try {
      // Navigate from root to parent of current
      let handle = rootHandle;
      const newPath = directoryPath.slice(0, -1);
      
      for (let i = 1; i < newPath.length; i++) {
        handle = await handle.getDirectoryHandle(newPath[i]);
      }
      
      const entries = await listDirectory(handle);
      setCurrentDirectory(handle);
      setDirectoryPath(newPath);
      setFileEntries(entries);
    } catch (error) {
      console.error('Navigate up error:', error);
    }
  }, [rootHandle, directoryPath]);

  const loadFileEntries = useCallback(async () => {
    if (!currentDirectory) return;
    
    try {
      const entries = await listDirectory(currentDirectory);
      setFileEntries(entries);
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
    
    // Filter by selected playlist
    if (selectedPlaylist && !selectedPlaylist.isFolder) {
      const trackIdSet = new Set(selectedPlaylist.trackIds);
      tracks = tracks.filter(t => trackIdSet.has(t.id));
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      tracks = tracks.filter(t => 
        t.title.toLowerCase().includes(query) ||
        t.artist.toLowerCase().includes(query) ||
        t.album.toLowerCase().includes(query) ||
        t.genre.toLowerCase().includes(query)
      );
    }
    
    // Sort tracks
    tracks = [...tracks].sort((a, b) => {
      let comparison = 0;
      
      switch (sortColumn) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'artist':
          comparison = a.artist.localeCompare(b.artist);
          break;
        case 'album':
          comparison = a.album.localeCompare(b.album);
          break;
        case 'genre':
          comparison = a.genre.localeCompare(b.genre);
          break;
        case 'duration':
          comparison = a.duration - b.duration;
          break;
        case 'bpm':
          comparison = a.bpm - b.bpm;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return tracks;
  }, [status, selectedPlaylist, searchQuery, sortColumn, sortDirection]);

  const handleSort = useCallback((column: SortColumn) => {
    if (column === sortColumn) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

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
    triggerFileInput
  };
}