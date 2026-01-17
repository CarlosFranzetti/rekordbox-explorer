import type { Track, Playlist, RekordboxDatabase, FileEntry } from '@/types/rekordbox';

// PDB file structure constants
const PDB_HEADER_SIZE = 28;
const PAGE_SIZE = 4096;

// Page types
const PAGE_TYPE_TRACKS = 0;
const PAGE_TYPE_GENRES = 1;
const PAGE_TYPE_ARTISTS = 2;
const PAGE_TYPE_ALBUMS = 3;
const PAGE_TYPE_LABELS = 4;
const PAGE_TYPE_KEYS = 5;
const PAGE_TYPE_COLORS = 6;
const PAGE_TYPE_PLAYLISTS = 7;
const PAGE_TYPE_PLAYLIST_TREE = 8;
const PAGE_TYPE_ARTWORK = 10;
const PAGE_TYPE_HISTORY = 19;

interface ParsedPage {
  type: number;
  entries: any[];
}

export async function findRekordboxDatabase(directoryHandle: FileSystemDirectoryHandle): Promise<{
  found: boolean;
  handle?: FileSystemFileHandle;
  path?: string;
  partialMatch?: boolean;
  message?: string;
}> {
  // First, try the standard path: PIONEER/rekordbox/export.pdb
  try {
    const pioneerDir = await directoryHandle.getDirectoryHandle('PIONEER', { create: false });
    const rekordboxDir = await pioneerDir.getDirectoryHandle('rekordbox', { create: false });
    const exportPdb = await rekordboxDir.getFileHandle('export.pdb', { create: false });
    
    return {
      found: true,
      handle: exportPdb,
      path: 'PIONEER/rekordbox/export.pdb'
    };
  } catch {
    // Standard path not found, check for partial structure
  }

  // Check if PIONEER folder exists
  try {
    const pioneerDir = await directoryHandle.getDirectoryHandle('PIONEER', { create: false });
    
    // Check for rekordbox folder
    try {
      const rekordboxDir = await pioneerDir.getDirectoryHandle('rekordbox', { create: false });
      
      // rekordbox folder exists but no export.pdb
      return {
        found: false,
        partialMatch: true,
        message: 'Rekordbox folder found but export.pdb is missing. The USB may not have been exported from Rekordbox properly.'
      };
    } catch {
      // PIONEER exists but no rekordbox folder
      return {
        found: false,
        partialMatch: true,
        message: 'PIONEER folder found but no rekordbox directory. Would you like to do a full scan?'
      };
    }
  } catch {
    // No PIONEER folder at all
  }

  // Check for other DJ software folders (to give helpful message)
  const djFolders = ['PIONEER', 'Serato', 'Traktor', '_Serato_', 'NativeInstruments'];
  for (const folder of djFolders) {
    try {
      await directoryHandle.getDirectoryHandle(folder, { create: false });
      if (folder !== 'PIONEER') {
        return {
          found: false,
          partialMatch: false,
          message: `This appears to be a ${folder} USB, not a Rekordbox USB.`
        };
      }
    } catch {
      // Folder doesn't exist, continue
    }
  }

  return {
    found: false,
    partialMatch: false,
    message: 'Non-Rekordbox USB detected. No PIONEER/rekordbox folder structure found.'
  };
}

export async function fullScanForDatabase(directoryHandle: FileSystemDirectoryHandle): Promise<{
  found: boolean;
  handle?: FileSystemFileHandle;
  path?: string;
}> {
  // Recursively search for export.pdb
  async function searchDirectory(dir: FileSystemDirectoryHandle, currentPath: string): Promise<{
    found: boolean;
    handle?: FileSystemFileHandle;
    path?: string;
  }> {
    const entries = (dir as any).entries() as AsyncIterableIterator<[string, FileSystemHandle]>;
    for await (const [name, handle] of entries) {
      if (handle.kind === 'file' && name === 'export.pdb') {
        return {
          found: true,
          handle: handle as FileSystemFileHandle,
          path: currentPath + '/' + name
        };
      } else if (handle.kind === 'directory') {
        const result = await searchDirectory(handle as FileSystemDirectoryHandle, currentPath + '/' + name);
        if (result.found) return result;
      }
    }
    return { found: false };
  }

  return searchDirectory(directoryHandle, '');
}

export async function parseRekordboxDatabase(fileHandle: FileSystemFileHandle): Promise<RekordboxDatabase> {
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  const dataView = new DataView(buffer);
  
  const tracks: Track[] = [];
  const playlists: Playlist[] = [];
  
  // Lookup tables for resolving IDs
  const artists: Map<number, string> = new Map();
  const albums: Map<number, string> = new Map();
  const genres: Map<number, string> = new Map();
  const keys: Map<number, string> = new Map();
  const playlistTree: Map<number, { name: string; parentId: number; isFolder: boolean }> = new Map();
  const playlistEntries: Map<number, number[]> = new Map();

  // Parse the PDB file
  const numTables = dataView.getUint32(4, true);
  let offset = PDB_HEADER_SIZE;

  // First pass: read all lookup tables
  for (let tableIdx = 0; tableIdx < numTables && offset < buffer.byteLength; tableIdx++) {
    const tableType = dataView.getUint32(offset, true);
    const emptyCandidate = dataView.getUint32(offset + 4, true);
    const firstPage = dataView.getUint32(offset + 8, true);
    const lastPage = dataView.getUint32(offset + 12, true);
    
    offset += 16;
    
    // Read pages for this table
    let pageOffset = firstPage * PAGE_SIZE;
    
    while (pageOffset < buffer.byteLength) {
      try {
        const pageHeader = parsePageHeader(dataView, pageOffset);
        
        if (pageHeader.pageType === tableType) {
          const entries = parsePageEntries(dataView, pageOffset, tableType, buffer.byteLength);
          
          switch (tableType) {
            case PAGE_TYPE_ARTISTS:
              entries.forEach(e => artists.set(e.id, e.name));
              break;
            case PAGE_TYPE_ALBUMS:
              entries.forEach(e => albums.set(e.id, e.name));
              break;
            case PAGE_TYPE_GENRES:
              entries.forEach(e => genres.set(e.id, e.name));
              break;
            case PAGE_TYPE_KEYS:
              entries.forEach(e => keys.set(e.id, e.name));
              break;
            case PAGE_TYPE_PLAYLIST_TREE:
              entries.forEach(e => playlistTree.set(e.id, { 
                name: e.name, 
                parentId: e.parentId, 
                isFolder: e.isFolder 
              }));
              break;
            case PAGE_TYPE_PLAYLISTS:
              entries.forEach(e => {
                if (!playlistEntries.has(e.playlistId)) {
                  playlistEntries.set(e.playlistId, []);
                }
                playlistEntries.get(e.playlistId)!.push(e.trackId);
              });
              break;
            case PAGE_TYPE_TRACKS:
              entries.forEach(e => {
                tracks.push({
                  id: e.id,
                  title: e.title || 'Unknown Title',
                  artist: artists.get(e.artistId) || 'Unknown Artist',
                  album: albums.get(e.albumId) || 'Unknown Album',
                  genre: genres.get(e.genreId) || '',
                  duration: e.duration || 0,
                  bpm: e.bpm || 0,
                  key: keys.get(e.keyId) || '',
                  rating: e.rating || 0,
                  bitrate: e.bitrate || 0,
                  filePath: e.filePath || '',
                  dateAdded: new Date(e.dateAdded * 1000 || Date.now())
                });
              });
              break;
          }
        }
        
        if (pageHeader.nextPage === 0 || pageHeader.nextPage === pageOffset / PAGE_SIZE) {
          break;
        }
        pageOffset = pageHeader.nextPage * PAGE_SIZE;
      } catch (e) {
        break;
      }
    }
  }

  // Build playlist hierarchy
  const playlistMap = new Map<number, Playlist>();
  
  playlistTree.forEach((value, id) => {
    const playlist: Playlist = {
      id,
      name: value.name,
      parentId: value.parentId === 0 ? null : value.parentId,
      isFolder: value.isFolder,
      children: [],
      trackIds: playlistEntries.get(id) || []
    };
    playlistMap.set(id, playlist);
  });

  // Link children to parents
  playlistMap.forEach(playlist => {
    if (playlist.parentId !== null) {
      const parent = playlistMap.get(playlist.parentId);
      if (parent) {
        parent.children.push(playlist);
      }
    }
  });

  // Get root playlists (no parent)
  const rootPlaylists = Array.from(playlistMap.values()).filter(p => p.parentId === null);

  return {
    tracks,
    playlists: rootPlaylists
  };
}

function parsePageHeader(dataView: DataView, offset: number): {
  pageType: number;
  nextPage: number;
  numRowsSmall: number;
  numRowsLarge: number;
} {
  return {
    pageType: dataView.getUint32(offset + 10, true) & 0x0F,
    nextPage: dataView.getUint32(offset + 4, true),
    numRowsSmall: dataView.getUint8(offset + 17),
    numRowsLarge: dataView.getUint16(offset + 18, true)
  };
}

function parsePageEntries(dataView: DataView, pageOffset: number, tableType: number, bufferLength: number): any[] {
  const entries: any[] = [];
  const rowOffsetStart = pageOffset + 40;
  
  try {
    const numRows = dataView.getUint8(pageOffset + 17) || dataView.getUint16(pageOffset + 18, true);
    
    for (let i = 0; i < Math.min(numRows, 100); i++) {
      const rowOffset = dataView.getUint16(rowOffsetStart + i * 2, true);
      if (rowOffset === 0 || pageOffset + rowOffset >= bufferLength) continue;
      
      const entryOffset = pageOffset + rowOffset;
      
      try {
        switch (tableType) {
          case PAGE_TYPE_ARTISTS:
          case PAGE_TYPE_ALBUMS:
          case PAGE_TYPE_GENRES:
          case PAGE_TYPE_KEYS:
          case PAGE_TYPE_LABELS:
            entries.push(parseStringEntry(dataView, entryOffset, bufferLength));
            break;
          case PAGE_TYPE_TRACKS:
            entries.push(parseTrackEntry(dataView, entryOffset, bufferLength));
            break;
          case PAGE_TYPE_PLAYLIST_TREE:
            entries.push(parsePlaylistTreeEntry(dataView, entryOffset, bufferLength));
            break;
          case PAGE_TYPE_PLAYLISTS:
            entries.push(parsePlaylistEntry(dataView, entryOffset));
            break;
        }
      } catch (e) {
        // Skip malformed entries
      }
    }
  } catch (e) {
    // Skip malformed pages
  }
  
  return entries;
}

function parseStringEntry(dataView: DataView, offset: number, bufferLength: number): { id: number; name: string } {
  const id = dataView.getUint32(offset + 4, true);
  const nameOffset = offset + 10;
  const name = readString(dataView, nameOffset, bufferLength);
  return { id, name };
}

function parseTrackEntry(dataView: DataView, offset: number, bufferLength: number): any {
  const bitmask = dataView.getUint16(offset, true);
  let fieldOffset = offset + 2;
  
  const entry: any = {
    id: 0,
    title: '',
    artistId: 0,
    albumId: 0,
    genreId: 0,
    keyId: 0,
    duration: 0,
    bpm: 0,
    rating: 0,
    bitrate: 0,
    filePath: '',
    dateAdded: 0
  };

  // Parse fields based on bitmask
  // This is a simplified parser - real implementation would need field-by-field parsing
  try {
    entry.id = dataView.getUint32(offset + 4, true);
    
    // Find title offset (usually around byte 20-40)
    for (let searchOffset = offset + 20; searchOffset < Math.min(offset + 200, bufferLength); searchOffset++) {
      const char = dataView.getUint8(searchOffset);
      if (char > 31 && char < 127) {
        entry.title = readString(dataView, searchOffset, bufferLength);
        break;
      }
    }
    
    // Parse numeric fields at known offsets
    if (offset + 16 < bufferLength) entry.artistId = dataView.getUint32(offset + 12, true);
    if (offset + 20 < bufferLength) entry.albumId = dataView.getUint32(offset + 16, true);
    if (offset + 24 < bufferLength) entry.genreId = dataView.getUint32(offset + 20, true);
    if (offset + 28 < bufferLength) entry.keyId = dataView.getUint32(offset + 24, true);
    if (offset + 32 < bufferLength) entry.duration = dataView.getUint32(offset + 28, true);
    if (offset + 36 < bufferLength) entry.bpm = dataView.getUint16(offset + 32, true) / 100;
    if (offset + 40 < bufferLength) entry.rating = dataView.getUint8(offset + 36);
    if (offset + 44 < bufferLength) entry.bitrate = dataView.getUint16(offset + 40, true);
  } catch (e) {
    // Return partial entry
  }
  
  return entry;
}

function parsePlaylistTreeEntry(dataView: DataView, offset: number, bufferLength: number): any {
  return {
    id: dataView.getUint32(offset + 4, true),
    parentId: dataView.getUint32(offset + 8, true),
    name: readString(dataView, offset + 16, bufferLength),
    isFolder: dataView.getUint8(offset + 12) === 1
  };
}

function parsePlaylistEntry(dataView: DataView, offset: number): any {
  return {
    playlistId: dataView.getUint32(offset + 4, true),
    trackId: dataView.getUint32(offset + 8, true)
  };
}

function readString(dataView: DataView, offset: number, bufferLength: number): string {
  const chars: number[] = [];
  let currentOffset = offset;
  
  // Check for UTF-16 (starts with 0x90 0x03 or similar)
  const firstByte = dataView.getUint8(currentOffset);
  const isUtf16 = firstByte === 0x90 || firstByte === 0x03;
  
  if (isUtf16) {
    currentOffset += 2; // Skip length bytes
    while (currentOffset + 1 < bufferLength) {
      const char = dataView.getUint16(currentOffset, true);
      if (char === 0) break;
      chars.push(char);
      currentOffset += 2;
      if (chars.length > 500) break; // Safety limit
    }
    return String.fromCharCode(...chars);
  } else {
    // ASCII/Latin-1
    while (currentOffset < bufferLength) {
      const char = dataView.getUint8(currentOffset);
      if (char === 0) break;
      if (char < 32 && char !== 9 && char !== 10 && char !== 13) break;
      chars.push(char);
      currentOffset++;
      if (chars.length > 500) break; // Safety limit
    }
    return String.fromCharCode(...chars);
  }
}

export async function listDirectory(directoryHandle: FileSystemDirectoryHandle): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  
  const dirEntries = (directoryHandle as any).entries() as AsyncIterableIterator<[string, FileSystemHandle]>;
  for await (const [name, handle] of dirEntries) {
    const entry: FileEntry = {
      name,
      path: name,
      isDirectory: handle.kind === 'directory',
      handle
    };
    
    if (handle.kind === 'file') {
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        entry.size = file.size;
      } catch {
        entry.size = 0;
      }
    }
    
    entries.push(entry);
  }
  
  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
  
  return entries;
}

export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatBpm(bpm: number): string {
  if (!bpm || isNaN(bpm)) return '--';
  return bpm.toFixed(1);
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}