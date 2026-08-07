/**
 * Reads a rekordbox `export.pdb` into the app's Track/Playlist model.
 *
 * Page and row plumbing lives in `src/lib/pdb/structure.ts`; string decoding in
 * `src/lib/pdb/devicesql.ts`. This file is only the row layouts and the
 * assembly of the final library.
 *
 * Row layouts follow Deep-Symmetry/crate-digger `rekordbox_pdb.ksy`.
 */

import type { FileEntry, Playlist, RekordboxDatabase, Track } from '@/types/rekordbox';
import { decodeDeviceSqlString } from '@/lib/pdb/devicesql';
import {
  PAGE_TYPE,
  PdbFormatError,
  readFileHeader,
  readPresentRowOffsets,
  walkTablePages,
} from '@/lib/pdb/structure';

/** Refuse anything implausibly large before allocating a buffer for it. */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/* ------------------------------------------------------------------ discovery */

export async function findRekordboxDatabase(directoryHandle: FileSystemDirectoryHandle): Promise<{
  found: boolean;
  handle?: FileSystemFileHandle;
  path?: string;
  partialMatch?: boolean;
  message?: string;
  libraries?: { hasLegacy: boolean; hasPlus: boolean };
}> {
  let pioneerDir: FileSystemDirectoryHandle | undefined;
  try {
    pioneerDir = await directoryHandle.getDirectoryHandle('PIONEER', { create: false });
  } catch {
    pioneerDir = undefined;
  }

  if (!pioneerDir) {
    // Give a useful answer when this is some other DJ software's drive.
    for (const folder of ['Serato', '_Serato_', 'Traktor', 'NativeInstruments', 'Engine Library']) {
      try {
        await directoryHandle.getDirectoryHandle(folder, { create: false });
        return {
          found: false,
          partialMatch: false,
          message: `This looks like a ${folder.replace(/_/g, '')} drive, not a rekordbox one.`,
        };
      } catch {
        // keep looking
      }
    }
    return {
      found: false,
      partialMatch: false,
      message: 'No PIONEER/rekordbox folder here — this drive was not exported by rekordbox.',
    };
  }

  let legacyHandle: FileSystemFileHandle | undefined;
  let legacyPath: string | undefined;
  let hasLegacy = false;

  try {
    const rekordboxDir = await pioneerDir.getDirectoryHandle('rekordbox', { create: false });
    for (const name of ['export.pdb', 'exportExt.pdb', 'exportext.pdb']) {
      try {
        legacyHandle = await rekordboxDir.getFileHandle(name, { create: false });
        legacyPath = `PIONEER/rekordbox/${name}`;
        hasLegacy = true;
        break;
      } catch {
        // try the next name
      }
    }
  } catch {
    // No rekordbox subfolder.
  }

  let hasPlus = false;
  for (const name of ['DeviceLibraryPlus', 'devicelibraryplus']) {
    try {
      await pioneerDir.getDirectoryHandle(name, { create: false });
      hasPlus = true;
      break;
    } catch {
      // not present
    }
  }

  const libraries = { hasLegacy, hasPlus };

  if (hasLegacy && legacyHandle) {
    return { found: true, handle: legacyHandle, path: legacyPath, libraries };
  }

  if (hasPlus) {
    return {
      found: false,
      partialMatch: true,
      message:
        'This drive only has Device Library Plus, which this app cannot read yet. It works on OPUS-QUAD, OMNIS-DUO, XDJ-AZ and CDJ-3000X, but older CDJs need the legacy export.pdb.',
      libraries,
    };
  }

  return {
    found: false,
    partialMatch: true,
    message: 'Found a PIONEER folder but no rekordbox library inside it.',
    libraries,
  };
}

export async function fullScanForDatabase(directoryHandle: FileSystemDirectoryHandle): Promise<{
  found: boolean;
  handle?: FileSystemFileHandle;
  path?: string;
}> {
  const MAX_DEPTH = 8;

  async function search(
    dir: FileSystemDirectoryHandle,
    path: string,
    depth: number
  ): Promise<{ found: boolean; handle?: FileSystemFileHandle; path?: string }> {
    if (depth > MAX_DEPTH) return { found: false };

    const subdirectories: [string, FileSystemDirectoryHandle][] = [];
    for await (const [name, handle] of dir.entries()) {
      const lower = name.toLowerCase();
      if (handle.kind === 'file' && (lower === 'export.pdb' || lower === 'exportext.pdb')) {
        return { found: true, handle: handle as FileSystemFileHandle, path: `${path}/${name}` };
      }
      if (handle.kind === 'directory') {
        subdirectories.push([name, handle as FileSystemDirectoryHandle]);
      }
    }

    // Breadth first: the database is almost always shallow.
    for (const [name, handle] of subdirectories) {
      const result = await search(handle, `${path}/${name}`, depth + 1);
      if (result.found) return result;
    }
    return { found: false };
  }

  return search(directoryHandle, '', 0);
}

/* -------------------------------------------------------------------- parsing */

export async function parseRekordboxDatabase(
  fileHandle: FileSystemFileHandle
): Promise<RekordboxDatabase> {
  return parseRekordboxDatabaseFromFile(await fileHandle.getFile());
}

export async function parseRekordboxDatabaseFromFile(file: File): Promise<RekordboxDatabase> {
  if (file.size > MAX_FILE_SIZE) {
    throw new PdbFormatError(
      `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB — far larger than any rekordbox database.`
    );
  }
  return parseRekordboxDatabaseFromBuffer(await file.arrayBuffer());
}

export function parseRekordboxDatabaseFromBuffer(buffer: ArrayBuffer): RekordboxDatabase {
  const view = new DataView(buffer);
  const header = readFileHeader(view);

  const artists = new Map<number, string>();
  const albums = new Map<number, string>();
  const genres = new Map<number, string>();
  const keys = new Map<number, string>();
  const labels = new Map<number, string>();

  const readRows = (
    type: number,
    onRow: (rowStart: number, pageEnd: number) => void
  ): void => {
    for (const table of header.tables) {
      if (table.type !== type) continue;
      for (const page of walkTablePages(view, header, table)) {
        const pageEnd = page.offset + header.lenPage;
        for (const rowStart of readPresentRowOffsets(view, header.lenPage, page)) {
          try {
            onRow(rowStart, pageEnd);
          } catch {
            // A single malformed row must not sink the whole library.
          }
        }
      }
    }
  };

  // Lookup tables first — track rows reference them by id.
  readRows(PAGE_TYPE.ARTISTS, (row, end) => readNamedRow(view, row, end, 0x04, 0x09, artists));
  readRows(PAGE_TYPE.ALBUMS, (row, end) => readNamedRow(view, row, end, 0x0c, 0x15, albums));
  readRows(PAGE_TYPE.GENRES, (row, end) => readIdNameRow(view, row, end, 0x04, genres));
  readRows(PAGE_TYPE.LABELS, (row, end) => readIdNameRow(view, row, end, 0x04, labels));
  readRows(PAGE_TYPE.KEYS, (row, end) => readIdNameRow(view, row, end, 0x08, keys));

  const playlistTree = new Map<
    number,
    { name: string; parentId: number; isFolder: boolean; sortOrder: number }
  >();
  readRows(PAGE_TYPE.PLAYLIST_TREE, (row, end) => {
    if (row + 0x14 > end) return;
    const id = view.getUint32(row + 0x0c, true);
    if (id === 0) return;
    const name = decodeDeviceSqlString(view, row + 0x14, end);
    if (!name?.text) return;
    playlistTree.set(id, {
      name: name.text,
      parentId: view.getUint32(row, true),
      isFolder: view.getUint32(row + 0x10, true) !== 0,
      sortOrder: view.getUint32(row + 0x08, true),
    });
  });

  const playlistEntries = new Map<number, { trackId: number; position: number }[]>();
  readRows(PAGE_TYPE.PLAYLIST_ENTRIES, (row, end) => {
    if (row + 0x0c > end) return;
    const trackId = view.getUint32(row + 0x04, true);
    const playlistId = view.getUint32(row + 0x08, true);
    if (trackId === 0 || playlistId === 0) return;
    const entries = playlistEntries.get(playlistId);
    const entry = { trackId, position: view.getUint32(row, true) };
    if (entries) entries.push(entry);
    else playlistEntries.set(playlistId, [entry]);
  });

  const trackData = new Map<number, Track>();
  readRows(PAGE_TYPE.TRACKS, (row, end) =>
    readTrackRow(view, row, end, { artists, albums, genres, keys, labels }, trackData)
  );

  return {
    tracks: [...trackData.values()],
    playlists: buildPlaylistTree(playlistTree, playlistEntries),
  };
}

/* ---------------------------------------------------------------- row readers */

/**
 * Artist and album rows: an id, then a name whose offset is either a byte near
 * the row start or — when `subtype & 0x04` is set — a 16-bit offset that can
 * reach further into the page heap.
 */
function readNamedRow(
  view: DataView,
  row: number,
  pageEnd: number,
  idOffset: number,
  nearOffset: number,
  into: Map<number, string>
): void {
  if (row + nearOffset + 1 > pageEnd) return;

  const subtype = view.getUint16(row, true);
  const id = view.getUint32(row + idOffset, true);
  if (id === 0) return;

  let nameOffset: number;
  if ((subtype & 0x04) === 0x04) {
    const farOffset = nearOffset + 1;
    if (row + farOffset + 2 > pageEnd) return;
    nameOffset = view.getUint16(row + farOffset, true);
  } else {
    nameOffset = view.getUint8(row + nearOffset);
  }

  if (nameOffset === 0) return;
  const name = decodeDeviceSqlString(view, row + nameOffset, pageEnd);
  if (name?.text) into.set(id, name.text);
}

/** Genre, label and key rows: a fixed-size id block, then the name inline. */
function readIdNameRow(
  view: DataView,
  row: number,
  pageEnd: number,
  nameOffset: number,
  into: Map<number, string>
): void {
  if (row + nameOffset > pageEnd) return;
  const id = view.getUint32(row, true);
  if (id === 0) return;
  const name = decodeDeviceSqlString(view, row + nameOffset, pageEnd);
  if (name?.text) into.set(id, name.text);
}

/**
 * Track row. Fixed fields up to 0x5E, then 21 u16 string offsets relative to
 * the row start. Index 17 is the title, 20 the file path, 10 the date added.
 */
const TRACK_ROW_MIN_SIZE = 0x88;
const STRING_OFFSET_BASE = 0x5e;
const STRING_INDEX = { dateAdded: 10, title: 17, filePath: 20 } as const;

function readTrackRow(
  view: DataView,
  row: number,
  pageEnd: number,
  lookups: {
    artists: Map<number, string>;
    albums: Map<number, string>;
    genres: Map<number, string>;
    keys: Map<number, string>;
    labels: Map<number, string>;
  },
  into: Map<number, Track>
): void {
  if (row + TRACK_ROW_MIN_SIZE > pageEnd) return;

  const id = view.getUint32(row + 0x48, true);
  if (id === 0) return;

  const readString = (index: number): string => {
    const offset = view.getUint16(row + STRING_OFFSET_BASE + index * 2, true);
    if (offset === 0) return '';
    return decodeDeviceSqlString(view, row + offset, pageEnd)?.text ?? '';
  };

  const tempo = view.getUint32(row + 0x38, true);
  const duration = view.getUint16(row + 0x54, true);
  const bitrate = view.getUint32(row + 0x30, true);
  const year = view.getUint16(row + 0x50, true);

  const dateAdded = readString(STRING_INDEX.dateAdded);
  const parsedDate = dateAdded ? new Date(dateAdded) : null;

  into.set(id, {
    id,
    title: readString(STRING_INDEX.title) || 'Unknown Title',
    artist: lookups.artists.get(view.getUint32(row + 0x44, true)) || 'Unknown Artist',
    album: lookups.albums.get(view.getUint32(row + 0x40, true)) || '',
    genre: lookups.genres.get(view.getUint32(row + 0x3c, true)) || '',
    key: lookups.keys.get(view.getUint32(row + 0x20, true)) || '',
    label: lookups.labels.get(view.getUint32(row + 0x28, true)) || '',
    // Implausible values mean we misread the row; show nothing rather than nonsense.
    duration: duration <= 36_000 ? duration : 0,
    bpm: tempo <= 50_000 ? tempo / 100 : 0,
    bitrate: bitrate <= 10_000 ? bitrate : 0,
    year: year >= 1900 && year <= 2200 ? year : undefined,
    rating: view.getUint8(row + 0x59) & 0x0f,
    filePath: readString(STRING_INDEX.filePath),
    dateAdded: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date(0),
  });
}

/* ------------------------------------------------------------- tree assembly */

function buildPlaylistTree(
  tree: Map<number, { name: string; parentId: number; isFolder: boolean; sortOrder: number }>,
  entries: Map<number, { trackId: number; position: number }[]>
): Playlist[] {
  const byId = new Map<number, Playlist>();

  for (const [id, node] of tree) {
    const rows = (entries.get(id) ?? []).sort((a, b) => a.position - b.position);
    byId.set(id, {
      id,
      name: node.name,
      parentId: node.parentId === 0 ? null : node.parentId,
      isFolder: node.isFolder,
      children: [],
      trackIds: rows.map((row) => row.trackId),
    });
  }

  const bySortOrder = (a: Playlist, b: Playlist) =>
    (tree.get(a.id)?.sortOrder ?? 0) - (tree.get(b.id)?.sortOrder ?? 0);

  const roots: Playlist[] = [];
  for (const playlist of byId.values()) {
    const parent = playlist.parentId === null ? null : byId.get(playlist.parentId);
    if (parent) parent.children.push(playlist);
    else roots.push(playlist);
  }

  for (const playlist of byId.values()) playlist.children.sort(bySortOrder);
  return roots.sort(bySortOrder);
}

/* -------------------------------------------------------------- file browsing */

export async function listDirectory(
  directoryHandle: FileSystemDirectoryHandle
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  for await (const [name, handle] of directoryHandle.entries()) {
    const entry: FileEntry = {
      name,
      path: name,
      isDirectory: handle.kind === 'directory',
      handle,
    };

    if (handle.kind === 'file') {
      try {
        entry.size = (await (handle as FileSystemFileHandle).getFile()).size;
      } catch {
        entry.size = 0;
      }
    }

    entries.push(entry);
  }

  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/* ---------------------------------------------------------------- formatting */

export function formatDuration(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return '--:--';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export function formatBpm(bpm: number): string {
  if (!bpm || Number.isNaN(bpm)) return '--';
  return bpm.toFixed(1);
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
