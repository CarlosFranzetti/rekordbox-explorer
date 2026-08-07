/**
 * Builds synthetic `.pdb` images for testing.
 *
 * This encoder is deliberately written *independently* of
 * `src/lib/pdb/playlists.ts` — it packs rows tightly instead of 4-byte aligned,
 * and lays out pages by hand. That way the round-trip tests cross-check two
 * implementations rather than confirming the writer agrees with itself.
 */

import { encodeDeviceSqlString } from '@/lib/pdb/devicesql';
import type { PdbPlaylistEntry, PdbPlaylistNode } from '@/lib/pdb/playlists';

const PAGE_HEADER_SIZE = 0x28;
const ROW_GROUP_SIZE = 0x24;
const ROWS_PER_GROUP = 16;

export const TYPE_TRACKS = 0;
export const TYPE_GENRES = 1;
export const TYPE_ARTISTS = 2;
export const TYPE_ALBUMS = 3;
export const TYPE_LABELS = 4;
export const TYPE_KEYS = 5;
export const TYPE_PLAYLIST_TREE = 7;
export const TYPE_PLAYLIST_ENTRIES = 8;

/* ------------------------------------------------------------- row encoders */

export function encodeTreeRow(node: PdbPlaylistNode): Uint8Array {
  const name = encodeDeviceSqlString(node.name);
  const row = new Uint8Array(0x14 + name.length);
  const view = new DataView(row.buffer);
  view.setUint32(0x00, node.parentId, true);
  view.setUint32(0x08, node.sortOrder, true);
  view.setUint32(0x0c, node.id, true);
  view.setUint32(0x10, node.isFolder ? 1 : 0, true);
  row.set(name, 0x14);
  return row;
}

export function encodeEntryRow(entry: PdbPlaylistEntry): Uint8Array {
  const row = new Uint8Array(0x0c);
  const view = new DataView(row.buffer);
  view.setUint32(0x00, entry.entryIndex, true);
  view.setUint32(0x04, entry.trackId, true);
  view.setUint32(0x08, entry.playlistId, true);
  return row;
}

/**
 * Artist row: subtype, index_shift, id, 0x03, ofs_name_near — with the name
 * placed either right after the header (near) or past padding (far).
 */
export function encodeArtistRow(
  id: number,
  name: string,
  options: { far?: boolean } = {}
): Uint8Array {
  const encoded = encodeDeviceSqlString(name);
  const headerSize = options.far ? 0x0c : 0x0a;
  const padding = options.far ? 40 : 0;
  const nameOffset = headerSize + padding;

  const row = new Uint8Array(nameOffset + encoded.length);
  const view = new DataView(row.buffer);
  view.setUint16(0x00, options.far ? 0x64 : 0x60, true);
  view.setUint32(0x04, id, true);
  view.setUint8(0x08, 0x03);
  if (options.far) view.setUint16(0x0a, nameOffset, true);
  else view.setUint8(0x09, nameOffset);
  row.set(encoded, nameOffset);
  return row;
}

/** Album row: id at 0x0C, ofs_name_near at 0x15, ofs_name_far (u2) at 0x16. */
export function encodeAlbumRow(
  id: number,
  name: string,
  options: { far?: boolean } = {}
): Uint8Array {
  const encoded = encodeDeviceSqlString(name);
  const headerSize = options.far ? 0x18 : 0x16;
  const padding = options.far ? 40 : 0;
  const nameOffset = headerSize + padding;

  const row = new Uint8Array(nameOffset + encoded.length);
  const view = new DataView(row.buffer);
  view.setUint16(0x00, options.far ? 0x84 : 0x80, true);
  view.setUint32(0x0c, id, true);
  view.setUint8(0x14, 0x03);
  if (options.far) view.setUint16(0x16, nameOffset, true);
  else view.setUint8(0x15, nameOffset);
  row.set(encoded, nameOffset);
  return row;
}

/** Genre / label style row: u4 id then the name inline. */
export function encodeIdNameRow(id: number, name: string, nameOffset = 4): Uint8Array {
  const encoded = encodeDeviceSqlString(name);
  const row = new Uint8Array(nameOffset + encoded.length);
  new DataView(row.buffer).setUint32(0, id, true);
  row.set(encoded, nameOffset);
  return row;
}

export interface TrackFixture {
  id: number;
  title?: string;
  filePath?: string;
  dateAdded?: string;
  artistId?: number;
  albumId?: number;
  genreId?: number;
  keyId?: number;
  labelId?: number;
  bpm?: number;
  duration?: number;
  bitrate?: number;
  year?: number;
  rating?: number;
}

const TRACK_FIXED_SIZE = 0x88;
const STRING_OFFSET_BASE = 0x5e;

export function encodeTrackRow(track: TrackFixture): Uint8Array {
  const strings: { index: number; bytes: Uint8Array }[] = [];
  const push = (index: number, value?: string) => {
    if (value) strings.push({ index, bytes: encodeDeviceSqlString(value) });
  };
  push(10, track.dateAdded);
  push(17, track.title);
  push(20, track.filePath);

  const total = strings.reduce((sum, s) => sum + s.bytes.length, TRACK_FIXED_SIZE);
  const row = new Uint8Array(total);
  const view = new DataView(row.buffer);

  view.setUint16(0x00, 0x24, true);
  view.setUint32(0x30, track.bitrate ?? 320, true);
  view.setUint32(0x38, Math.round((track.bpm ?? 0) * 100), true);
  view.setUint32(0x3c, track.genreId ?? 0, true);
  view.setUint32(0x40, track.albumId ?? 0, true);
  view.setUint32(0x44, track.artistId ?? 0, true);
  view.setUint32(0x20, track.keyId ?? 0, true);
  view.setUint32(0x28, track.labelId ?? 0, true);
  view.setUint32(0x48, track.id, true);
  view.setUint16(0x50, track.year ?? 0, true);
  view.setUint16(0x54, track.duration ?? 0, true);
  view.setUint8(0x59, track.rating ?? 0);

  let cursor = TRACK_FIXED_SIZE;
  for (const { index, bytes } of strings) {
    view.setUint16(STRING_OFFSET_BASE + index * 2, cursor, true);
    row.set(bytes, cursor);
    cursor += bytes.length;
  }

  return row;
}

/* ---------------------------------------------------------------- assembly */

export interface FixtureTable {
  type: number;
  rows: Uint8Array[];
  /** Skip the usual empty placeholder page at the head of the chain. */
  rowsInFirstPage?: boolean;
}

interface PlannedPage {
  type: number;
  rows: Uint8Array[];
}

function planPages(rows: Uint8Array[], type: number, lenPage: number): PlannedPage[] {
  const pages: PlannedPage[] = [];
  let current: Uint8Array[] = [];
  let used = 0;

  for (const row of rows) {
    const groups = Math.floor(current.length / ROWS_PER_GROUP) + 1;
    if (PAGE_HEADER_SIZE + used + row.length + groups * ROW_GROUP_SIZE > lenPage) {
      pages.push({ type, rows: current });
      current = [];
      used = 0;
    }
    current.push(row);
    used += row.length;
  }
  pages.push({ type, rows: current });
  return pages;
}

function writePage(
  out: Uint8Array,
  lenPage: number,
  pageIndex: number,
  page: PlannedPage,
  nextPage: number,
  sequence: number
): void {
  const base = pageIndex * lenPage;
  const view = new DataView(out.buffer, base, lenPage);

  view.setUint32(0x04, pageIndex, true);
  view.setUint32(0x08, page.type, true);
  view.setUint32(0x0c, nextPage, true);
  view.setUint32(0x10, sequence, true);

  let used = 0;
  page.rows.forEach((row, i) => {
    out.set(row, base + PAGE_HEADER_SIZE + used);
    const group = Math.floor(i / ROWS_PER_GROUP);
    const within = i % ROWS_PER_GROUP;
    const groupBase = lenPage - group * ROW_GROUP_SIZE;
    view.setUint16(groupBase - 6 - within * 2, used, true);
    view.setUint16(groupBase - 4, view.getUint16(groupBase - 4, true) | (1 << within), true);
    used += row.length;
  });

  const count = page.rows.length;
  const groups = Math.max(1, Math.ceil(count / ROWS_PER_GROUP));
  view.setUint32(0x18, (count & 0x1fff) | ((count & 0x7ff) << 13) | (0x24 << 24), true);
  view.setUint16(0x1c, lenPage - PAGE_HEADER_SIZE - used - groups * ROW_GROUP_SIZE, true);
  view.setUint16(0x1e, used, true);
}

/** Build an image from arbitrary tables. */
export function buildPdb(tables: FixtureTable[], options: { lenPage?: number; sequence?: number } = {}): ArrayBuffer {
  const lenPage = options.lenPage ?? 4096;
  const sequence = options.sequence ?? 42;

  const layout: PlannedPage[] = [];
  const pointers: { type: number; first: number; last: number }[] = [];

  for (const table of tables) {
    const pages = planPages(table.rows, table.type, lenPage);
    const first = layout.length + 1;
    if (!table.rowsInFirstPage) layout.push({ type: table.type, rows: [] });
    layout.push(...pages);
    pointers.push({ type: table.type, first, last: layout.length });
  }

  const totalPages = layout.length + 1;
  const out = new Uint8Array(totalPages * lenPage);
  const view = new DataView(out.buffer);

  view.setUint32(0x04, lenPage, true);
  view.setUint32(0x08, pointers.length, true);
  view.setUint32(0x0c, totalPages, true);
  view.setUint32(0x14, sequence, true);

  pointers.forEach((pointer, i) => {
    const at = 0x1c + i * 16;
    view.setUint32(at, pointer.type, true);
    view.setUint32(at + 0x08, pointer.first, true);
    view.setUint32(at + 0x0c, pointer.last, true);
  });

  const lastPages = new Set(pointers.map((p) => p.last));
  layout.forEach((page, i) => {
    const pageIndex = i + 1;
    writePage(
      out,
      lenPage,
      pageIndex,
      page,
      lastPages.has(pageIndex) ? totalPages : pageIndex + 1,
      sequence
    );
  });

  return out.buffer;
}

export interface FixtureOptions {
  lenPage?: number;
  nodes?: PdbPlaylistNode[];
  entries?: PdbPlaylistEntry[];
  rowsInFirstPage?: boolean;
  sequence?: number;
}

/** Playlist-only image, used by the writer tests. */
export function buildFixturePdb(options: FixtureOptions = {}): ArrayBuffer {
  return buildPdb(
    [
      {
        type: TYPE_PLAYLIST_TREE,
        rows: (options.nodes ?? []).map(encodeTreeRow),
        rowsInFirstPage: options.rowsInFirstPage,
      },
      {
        type: TYPE_PLAYLIST_ENTRIES,
        rows: (options.entries ?? []).map(encodeEntryRow),
        rowsInFirstPage: options.rowsInFirstPage,
      },
    ],
    { lenPage: options.lenPage, sequence: options.sequence }
  );
}

/** A small, realistic library: one folder, three playlists, fifteen entries. */
export function sampleLibrary(): { nodes: PdbPlaylistNode[]; entries: PdbPlaylistEntry[] } {
  const nodes: PdbPlaylistNode[] = [
    { id: 1, parentId: 0, sortOrder: 0, isFolder: true, name: 'Gigs' },
    { id: 2, parentId: 1, sortOrder: 0, isFolder: false, name: 'Basement 2026-01-31' },
    { id: 3, parentId: 1, sortOrder: 1, isFolder: false, name: 'Warm Up' },
    { id: 4, parentId: 0, sortOrder: 1, isFolder: false, name: 'Peak Time' },
  ];

  const entries: PdbPlaylistEntry[] = [];
  for (const playlistId of [2, 3, 4]) {
    for (let i = 0; i < 5; i++) {
      entries.push({ playlistId, entryIndex: i, trackId: playlistId * 100 + i });
    }
  }
  return { nodes, entries };
}
