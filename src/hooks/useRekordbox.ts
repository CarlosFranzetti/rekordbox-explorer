import { useState, useCallback } from 'react';
import type { RekordboxDatabase, USBStatus, FileEntry, Playlist, Track, SortColumn, SortDirection } from '@/types/rekordbox';
import { 
  findRekordboxDatabase, 
  fullScanForDatabase, 
  parseRekordboxDatabase, 
  listDirectory 
} from '@/lib/rekordbox-parser';

export function useRekordbox() {
  const [status, setStatus] = useState<USBStatus>({ type: 'idle' });
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [currentDirectory, setCurrentDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [directoryPath, setDirectoryPath] = useState<string[]>([]);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

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
      
      const handle = await (window as any).showDirectoryPicker({ mode: 'read' }) as FileSystemDirectoryHandle;
      setRootHandle(handle);
      setCurrentDirectory(handle);
      setDirectoryPath([handle.name]);
      
      // Try to find Rekordbox database
      const result = await findRekordboxDatabase(handle);
      
      if (result.found && result.handle) {
        try {
          const database = await parseRekordboxDatabase(result.handle);
          setStatus({ type: 'valid', database });
        } catch (parseError) {
          console.error('Parse error:', parseError);
          setStatus({
            type: 'error',
            message: `Failed to parse Rekordbox database: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
          });
        }
      } else if (result.partialMatch) {
        setStatus({
          type: 'partial',
          message: result.message || 'Partial Rekordbox structure found.'
        });
      } else {
        setStatus({
          type: 'invalid',
          message: result.message || 'Non-Rekordbox USB detected.'
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus({ type: 'idle' });
        return;
      }
      console.error('Folder selection error:', error);
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to access the selected folder.'
      });
    }
  }, []);

  const performFullScan = useCallback(async () => {
    if (!rootHandle) return;
    
    setStatus({ type: 'loading' });
    
    try {
      const result = await fullScanForDatabase(rootHandle);
      
      if (result.found && result.handle) {
        const database = await parseRekordboxDatabase(result.handle);
        setStatus({ type: 'valid', database });
      } else {
        setStatus({
          type: 'invalid',
          message: 'No export.pdb file found after full scan.'
        });
      }
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Full scan failed.'
      });
    }
  }, [rootHandle]);

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
        case 'duration':
          comparison = a.duration - b.duration;
          break;
        case 'bpm':
          comparison = a.bpm - b.bpm;
          break;
        case 'key':
          comparison = a.key.localeCompare(b.key);
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
    handleSort
  };
}