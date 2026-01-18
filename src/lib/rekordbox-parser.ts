import type { Track, Playlist, RekordboxDatabase, FileEntry } from '@/types/rekordbox';

// Page types from the PDB format
const PAGE_TYPE_TRACKS = 0;
const PAGE_TYPE_GENRES = 1;
const PAGE_TYPE_ARTISTS = 2;
const PAGE_TYPE_ALBUMS = 3;
const PAGE_TYPE_LABELS = 4;
const PAGE_TYPE_KEYS = 5;
const PAGE_TYPE_COLORS = 6;
const PAGE_TYPE_PLAYLIST_TREE = 7;
const PAGE_TYPE_PLAYLIST_ENTRIES = 8;

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
      await pioneerDir.getDirectoryHandle('rekordbox', { create: false });
      
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

// DeviceSQL String parsing
function readDeviceSqlString(dataView: DataView, offset: number, bufferLength: number): string {
  if (offset >= bufferLength || offset < 0) return '';
  
  try {
    const lengthAndKind = dataView.getUint8(offset);
    
    if (lengthAndKind === 0x40) {
      // Long ASCII: 2-byte length follows, then 1 byte padding, then string
      if (offset + 4 >= bufferLength) return '';
      const length = dataView.getUint16(offset + 1, true);
      if (length < 4 || offset + 4 + (length - 4) > bufferLength) return '';
      const textBytes = new Uint8Array(dataView.buffer, offset + 4, length - 4);
      return new TextDecoder('ascii').decode(textBytes);
    } else if (lengthAndKind === 0x90) {
      // UTF-16LE: 2-byte length follows, then 1 byte padding, then string
      if (offset + 4 >= bufferLength) return '';
      const length = dataView.getUint16(offset + 1, true);
      if (length < 4 || offset + 4 + (length - 4) > bufferLength) return '';
      const textBytes = new Uint8Array(dataView.buffer, offset + 4, length - 4);
      return new TextDecoder('utf-16le').decode(textBytes);
    } else if (lengthAndKind % 2 === 1) {
      // Short ASCII: length encoded in the byte
      const length = lengthAndKind >> 1;
      if (length < 1 || offset + 1 + (length - 1) > bufferLength) return '';
      const textBytes = new Uint8Array(dataView.buffer, offset + 1, length - 1);
      return new TextDecoder('ascii').decode(textBytes);
    }
    return '';
  } catch {
    return '';
  }
}

interface TableInfo {
  type: number;
  firstPage: number;
  lastPage: number;
}

export async function parseRekordboxDatabase(fileHandle: FileSystemFileHandle): Promise<RekordboxDatabase> {
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  const dataView = new DataView(buffer);
  const bufferLength = buffer.byteLength;
  
  // Parse file header
  const lenPage = dataView.getUint32(4, true);
  const numTables = dataView.getUint32(8, true);
  
  // Parse table pointers (starting at offset 28)
  const tables: TableInfo[] = [];
  let offset = 28;
  for (let i = 0; i < numTables && offset + 16 <= bufferLength; i++) {
    const type = dataView.getUint32(offset, true);
    const firstPage = dataView.getUint32(offset + 8, true);
    const lastPage = dataView.getUint32(offset + 12, true);
    tables.push({ type, firstPage, lastPage });
    offset += 16;
  }

  // Lookup tables
  const artists: Map<number, string> = new Map();
  const albums: Map<number, string> = new Map();
  const genres: Map<number, string> = new Map();
  const keys: Map<number, string> = new Map();
  const labels: Map<number, string> = new Map();
  const playlistTree: Map<number, { name: string; parentId: number; isFolder: boolean; sortOrder: number }> = new Map();
  const playlistEntries: Map<number, { trackId: number; position: number }[]> = new Map();
  const trackData: Map<number, Track> = new Map();

  // First pass: parse lookup tables (artists, albums, genres, keys, labels)
  for (const table of tables) {
    if (table.type === PAGE_TYPE_ARTISTS || table.type === PAGE_TYPE_ALBUMS || 
        table.type === PAGE_TYPE_GENRES || table.type === PAGE_TYPE_KEYS || 
        table.type === PAGE_TYPE_LABELS) {
      parseTablePages(dataView, table, lenPage, bufferLength, (rowBase: number, pageType: number) => {
        parseSimpleRow(dataView, rowBase, pageType, bufferLength, artists, albums, genres, keys, labels);
      });
    }
  }

  // Second pass: parse playlist tree
  for (const table of tables) {
    if (table.type === PAGE_TYPE_PLAYLIST_TREE) {
      parseTablePages(dataView, table, lenPage, bufferLength, (rowBase: number) => {
        parsePlaylistTreeRow(dataView, rowBase, bufferLength, playlistTree);
      });
    }
  }

  // Third pass: parse playlist entries  
  for (const table of tables) {
    if (table.type === PAGE_TYPE_PLAYLIST_ENTRIES) {
      parseTablePages(dataView, table, lenPage, bufferLength, (rowBase: number) => {
        parsePlaylistEntryRow(dataView, rowBase, playlistEntries);
      });
    }
  }

  // Fourth pass: parse tracks
  for (const table of tables) {
    if (table.type === PAGE_TYPE_TRACKS) {
      parseTablePages(dataView, table, lenPage, bufferLength, (rowBase: number) => {
        parseTrackRow(dataView, rowBase, bufferLength, artists, albums, genres, keys, trackData);
      });
    }
  }

  // Convert track map to array
  const tracks = Array.from(trackData.values());

  // Build playlist hierarchy
  const playlistMap = new Map<number, Playlist>();
  
  playlistTree.forEach((value, id) => {
    const entries = playlistEntries.get(id) || [];
    const sortedEntries = entries.sort((a, b) => a.position - b.position);
    
    const playlist: Playlist = {
      id,
      name: value.name,
      parentId: value.parentId === 0 ? null : value.parentId,
      isFolder: value.isFolder,
      children: [],
      trackIds: sortedEntries.map(e => e.trackId)
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

  // Get root playlists (no parent) and sort by original order
  const rootPlaylists = Array.from(playlistMap.values())
    .filter(p => p.parentId === null)
    .sort((a, b) => {
      const aOrder = playlistTree.get(a.id)?.sortOrder ?? 0;
      const bOrder = playlistTree.get(b.id)?.sortOrder ?? 0;
      return aOrder - bOrder;
    });

  return {
    tracks,
    playlists: rootPlaylists
  };
}

function parseTablePages(
  dataView: DataView, 
  table: TableInfo, 
  lenPage: number, 
  bufferLength: number,
  rowCallback: (rowBase: number, pageType: number) => void
) {
  let pageIndex = table.firstPage;
  const visitedPages = new Set<number>();
  
  while (pageIndex > 0 && !visitedPages.has(pageIndex)) {
    visitedPages.add(pageIndex);
    const pageOffset = pageIndex * lenPage;
    
    if (pageOffset + lenPage > bufferLength) break;
    
    // Parse page header
    // Bytes 0-3: gap (zeros)
    // Bytes 4-7: page_index
    // Bytes 8-11: type
    // Bytes 12-15: next_page index
    // Bytes 16-19: sequence
    // Bytes 20-23: unknown
    // Bytes 24-26: packed bits (num_row_offsets: 13 bits, num_rows: 11 bits)
    // Byte 27: page_flags
    
    const pageType = dataView.getUint32(pageOffset + 8, true);
    const nextPageIndex = dataView.getUint32(pageOffset + 12, true);
    
    // Read the packed bits for row counts
    const packedRowInfo = dataView.getUint32(pageOffset + 24, true);
    const numRowOffsets = packedRowInfo & 0x1FFF; // Lower 13 bits
    const pageFlags = dataView.getUint8(pageOffset + 27);
    
    // Check if this is a data page (bit 0x40 not set means it's a data page)
    const isDataPage = (pageFlags & 0x40) === 0;
    
    if (isDataPage && pageType === table.type && numRowOffsets > 0) {
      // Row index is built backwards from end of page
      // Each row group can hold up to 16 rows
      const numRowGroups = Math.ceil(numRowOffsets / 16);
      const heapPos = pageOffset + 40; // Data starts after 40-byte header
      
      for (let groupIndex = 0; groupIndex < numRowGroups; groupIndex++) {
        const groupBase = pageOffset + lenPage - (groupIndex * 0x24);
        
        // Row present flags at groupBase - 4
        if (groupBase - 4 < pageOffset + 40) continue;
        const rowPresentFlags = dataView.getUint16(groupBase - 4, true);
        
        // Parse up to 16 rows in this group
        for (let rowIndex = 0; rowIndex < 16; rowIndex++) {
          // Check if this row is present
          const isPresent = ((rowPresentFlags >> rowIndex) & 1) !== 0;
          if (!isPresent) continue;
          
          // Row offset is at groupBase - 6 - (rowIndex * 2)
          const ofsRowPos = groupBase - 6 - (rowIndex * 2);
          if (ofsRowPos < pageOffset + 40) continue;
          
          const ofsRow = dataView.getUint16(ofsRowPos, true);
          const rowBase = heapPos + ofsRow;
          
          if (rowBase >= pageOffset + lenPage) continue;
          
          try {
            rowCallback(rowBase, pageType);
          } catch {
            // Skip malformed rows
          }
        }
      }
    }
    
    // Move to next page
    if (nextPageIndex === 0 || nextPageIndex >= bufferLength / lenPage) break;
    if (pageIndex === table.lastPage) break;
    pageIndex = nextPageIndex;
  }
}

function parseSimpleRow(
  dataView: DataView,
  rowBase: number,
  pageType: number,
  bufferLength: number,
  artists: Map<number, string>,
  albums: Map<number, string>,
  genres: Map<number, string>,
  keys: Map<number, string>,
  labels: Map<number, string>
) {
  if (rowBase + 10 > bufferLength) return;
  
  switch (pageType) {
    case PAGE_TYPE_ARTISTS: {
      // Artist row: subtype (u16), index_shift (u16), id (u32), 0x03 (u8), ofs_name_near (u8)
      const subtype = dataView.getUint16(rowBase, true);
      const id = dataView.getUint32(rowBase + 4, true);
      let nameOffset: number;
      if ((subtype & 0x04) === 0x04) {
        // Long offset at row + 0x0a
        nameOffset = dataView.getUint16(rowBase + 0x0a, true);
      } else {
        nameOffset = dataView.getUint8(rowBase + 9);
      }
      const name = readDeviceSqlString(dataView, rowBase + nameOffset, bufferLength);
      if (name) artists.set(id, name);
      break;
    }
    case PAGE_TYPE_ALBUMS: {
      // Album row: subtype (u16), index_shift (u16), unknown (u32), artist_id (u32), id (u32), unknown (u32), 0x03 (u8), ofs_name_near (u8)
      const subtype = dataView.getUint16(rowBase, true);
      const id = dataView.getUint32(rowBase + 12, true);
      let nameOffset: number;
      if ((subtype & 0x04) === 0x04) {
        // Long offset at row + 0x16
        nameOffset = dataView.getUint16(rowBase + 0x16, true);
      } else {
        nameOffset = dataView.getUint8(rowBase + 17);
      }
      const name = readDeviceSqlString(dataView, rowBase + nameOffset, bufferLength);
      if (name) albums.set(id, name);
      break;
    }
    case PAGE_TYPE_GENRES: {
      // Genre row: id (u32), name (device_sql_string)
      const id = dataView.getUint32(rowBase, true);
      const name = readDeviceSqlString(dataView, rowBase + 4, bufferLength);
      if (name) genres.set(id, name);
      break;
    }
    case PAGE_TYPE_KEYS: {
      // Key row: id (u32), id2 (u32), name (device_sql_string)
      const id = dataView.getUint32(rowBase, true);
      const name = readDeviceSqlString(dataView, rowBase + 8, bufferLength);
      if (name) keys.set(id, name);
      break;
    }
    case PAGE_TYPE_LABELS: {
      // Label row: id (u32), name (device_sql_string)
      const id = dataView.getUint32(rowBase, true);
      const name = readDeviceSqlString(dataView, rowBase + 4, bufferLength);
      if (name) labels.set(id, name);
      break;
    }
  }
}

function parsePlaylistTreeRow(
  dataView: DataView,
  rowBase: number,
  bufferLength: number,
  playlistTree: Map<number, { name: string; parentId: number; isFolder: boolean; sortOrder: number }>
) {
  if (rowBase + 20 > bufferLength) return;
  
  // Playlist tree row: parent_id (u32), unknown (u32), sort_order (u32), id (u32), raw_is_folder (u32), name
  const parentId = dataView.getUint32(rowBase, true);
  const sortOrder = dataView.getUint32(rowBase + 8, true);
  const id = dataView.getUint32(rowBase + 12, true);
  const rawIsFolder = dataView.getUint32(rowBase + 16, true);
  const name = readDeviceSqlString(dataView, rowBase + 20, bufferLength);
  
  if (name && id > 0) {
    playlistTree.set(id, {
      name,
      parentId,
      isFolder: rawIsFolder !== 0,
      sortOrder
    });
  }
}

function parsePlaylistEntryRow(
  dataView: DataView,
  rowBase: number,
  playlistEntries: Map<number, { trackId: number; position: number }[]>
) {
  // Playlist entry row: entry_index (u32), track_id (u32), playlist_id (u32)
  const entryIndex = dataView.getUint32(rowBase, true);
  const trackId = dataView.getUint32(rowBase + 4, true);
  const playlistId = dataView.getUint32(rowBase + 8, true);
  
  if (playlistId > 0 && trackId > 0) {
    if (!playlistEntries.has(playlistId)) {
      playlistEntries.set(playlistId, []);
    }
    playlistEntries.get(playlistId)!.push({ trackId, position: entryIndex });
  }
}

function parseTrackRow(
  dataView: DataView,
  rowBase: number,
  bufferLength: number,
  artists: Map<number, string>,
  albums: Map<number, string>,
  genres: Map<number, string>,
  keys: Map<number, string>,
  trackData: Map<number, Track>
) {
  // Track row structure (based on kaitai spec):
  // 0x00: subtype (u16) - always 0x24
  // 0x02: index_shift (u16)
  // 0x04: bitmask (u32)
  // 0x08: sample_rate (u32)
  // 0x0C: composer_id (u32)
  // 0x10: file_size (u32)
  // 0x14: unknown (u32)
  // 0x18: unknown (u16)
  // 0x1A: unknown (u16)
  // 0x1C: artwork_id (u32)
  // 0x20: key_id (u32)
  // 0x24: original_artist_id (u32)
  // 0x28: label_id (u32)
  // 0x2C: remixer_id (u32)
  // 0x30: bitrate (u32)
  // 0x34: track_number (u32)
  // 0x38: tempo (u32) - BPM * 100
  // 0x3C: genre_id (u32)
  // 0x40: album_id (u32)
  // 0x44: artist_id (u32)
  // 0x48: id (u32)
  // 0x4C: disc_number (u16)
  // 0x4E: play_count (u16)
  // 0x50: year (u16)
  // 0x52: sample_depth (u16)
  // 0x54: duration (u16)
  // 0x56: unknown (u16)
  // 0x58: color_id (u8)
  // 0x59: rating (u8)
  // 0x5A: unknown (u16)
  // 0x5C: unknown (u16)
  // 0x5E-0x86: ofs_strings[21] (u16 each, 42 bytes total)
  // String offsets: [0]=isrc, [1]=texter, ..., [17]=title, [18]=unknown, [19]=filename, [20]=file_path

  if (rowBase + 0x86 > bufferLength) return;
  
  const tempo = dataView.getUint32(rowBase + 0x38, true);
  const genreId = dataView.getUint32(rowBase + 0x3C, true);
  const albumId = dataView.getUint32(rowBase + 0x40, true);
  const artistId = dataView.getUint32(rowBase + 0x44, true);
  const id = dataView.getUint32(rowBase + 0x48, true);
  const duration = dataView.getUint16(rowBase + 0x54, true);
  const rating = dataView.getUint8(rowBase + 0x59);
  const bitrate = dataView.getUint32(rowBase + 0x30, true);
  const keyId = dataView.getUint32(rowBase + 0x20, true);
  
  // Read string offsets (21 u16 values starting at 0x5E)
  const ofsStrings: number[] = [];
  for (let i = 0; i < 21; i++) {
    ofsStrings.push(dataView.getUint16(rowBase + 0x5E + (i * 2), true));
  }
  
  // Title is at index 17
  const titleOffset = ofsStrings[17];
  const title = titleOffset > 0 ? readDeviceSqlString(dataView, rowBase + titleOffset, bufferLength) : '';
  
  // File path is at index 20
  const filePathOffset = ofsStrings[20];
  const filePath = filePathOffset > 0 ? readDeviceSqlString(dataView, rowBase + filePathOffset, bufferLength) : '';
  
  // Date added is at index 10
  const dateAddedOffset = ofsStrings[10];
  const dateAddedStr = dateAddedOffset > 0 ? readDeviceSqlString(dataView, rowBase + dateAddedOffset, bufferLength) : '';
  
  // Only add if we have a valid ID and some meaningful data
  if (id > 0) {
    // Use the latest entry for each track ID (handles duplicates)
    trackData.set(id, {
      id,
      title: title || 'Unknown Title',
      artist: artists.get(artistId) || 'Unknown Artist',
      album: albums.get(albumId) || 'Unknown Album',
      genre: genres.get(genreId) || '',
      duration: duration,
      bpm: tempo / 100,
      key: keys.get(keyId) || '',
      rating: rating,
      bitrate: bitrate,
      filePath: filePath,
      dateAdded: dateAddedStr ? new Date(dateAddedStr) : new Date()
    });
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
