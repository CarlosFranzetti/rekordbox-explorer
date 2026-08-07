/**
 * Playlist row codecs and the additive playlist writer.
 *
 * Row layouts (see `structure.ts` for the surrounding page format):
 *
 *   playlist_tree_row               playlist_entry_row
 *     0x00 u4 parent_id               0x00 u4 entry_index
 *     0x04 u4 unknown                 0x04 u4 track_id
 *     0x08 u4 sort_order              0x08 u4 playlist_id
 *     0x0C u4 id
 *     0x10 u4 raw_is_folder
 *     0x14    name (DeviceSQL string)
 *
 * WRITE STRATEGY — the whole safety argument lives here.
 *
 * We never overwrite an existing page. Both playlist tables are re-encoded into
 * brand-new pages appended past the old end of file, and only a handful of
 * pointer fields in already-written bytes are patched:
 *
 *   - the file header's `sequence` and `next_unused_page`
 *   - each playlist table pointer's `first_page` / `last_page`
 *   - at most one existing page's `next_page`, to graft the new chain on
 *
 * Every original row therefore survives byte-for-byte in the output. The old
 * pages are simply orphaned — unreferenced but intact — which means a failed
 * write leaves recoverable data, and it means track, artist, album, artwork
 * and analysis data are provably untouched.
 */

import {
  PAGE_HEADER_SIZE,
  PAGE_TYPE,
  ROWS_PER_GROUP,
  ROW_GROUP_SIZE,
  PdbFormatError,
  readFileHeader,
  readPageHeader,
  readPresentRowOffsets,
  walkTablePages,
  type PdbFileHeader,
  type PdbTablePointer,
} from './structure';
import { decodeDeviceSqlString, encodeDeviceSqlString } from './devicesql';

const TREE_ROW_FIXED_SIZE = 0x14;
const ENTRY_ROW_SIZE = 0x0c;

/** Row alignment. Row bodies open with u32 fields and the heap starts at a
 *  4-byte boundary, so keeping rows 4-aligned keeps those reads aligned on the
 *  16-bit-era hardware this format was designed for. */
const ROW_ALIGNMENT = 4;

/** Default when we cannot sample flags from an existing page. 0x24 and 0x34 are
 *  both observed on data pages; 0x24 is the common case. */
const DEFAULT_DATA_PAGE_FLAGS = 0x24;

export interface PdbPlaylistNode {
  id: number;
  parentId: number;
  sortOrder: number;
  isFolder: boolean;
  name: string;
}

export interface PdbPlaylistEntry {
  playlistId: number;
  trackId: number;
  entryIndex: number;
}

export interface PlaylistTables {
  nodes: PdbPlaylistNode[];
  entries: PdbPlaylistEntry[];
}

export interface WriteResult {
  buffer: ArrayBuffer;
  pagesAppended: number;
  bytesAdded: number;
  newSequence: number;
}

/* ------------------------------------------------------------------ codecs */

function encodeTreeRow(node: PdbPlaylistNode): Uint8Array {
  const name = encodeDeviceSqlString(node.name);
  const row = new Uint8Array(TREE_ROW_FIXED_SIZE + name.length);
  const view = new DataView(row.buffer);
  view.setUint32(0x00, node.parentId >>> 0, true);
  view.setUint32(0x04, 0, true);
  view.setUint32(0x08, node.sortOrder >>> 0, true);
  view.setUint32(0x0c, node.id >>> 0, true);
  view.setUint32(0x10, node.isFolder ? 1 : 0, true);
  row.set(name, TREE_ROW_FIXED_SIZE);
  return row;
}

function encodeEntryRow(entry: PdbPlaylistEntry): Uint8Array {
  const row = new Uint8Array(ENTRY_ROW_SIZE);
  const view = new DataView(row.buffer);
  view.setUint32(0x00, entry.entryIndex >>> 0, true);
  view.setUint32(0x04, entry.trackId >>> 0, true);
  view.setUint32(0x08, entry.playlistId >>> 0, true);
  return row;
}

/* ------------------------------------------------------------------ reading */

function findTable(header: PdbFileHeader, type: number): PdbTablePointer {
  const table = header.tables.find((t) => t.type === type);
  if (!table) throw new PdbFormatError(`Database has no table of type ${type}`);
  return table;
}

/** Read the current playlist tree and entries out of an image. */
export function readPlaylistTables(source: ArrayBuffer): PlaylistTables {
  const view = new DataView(source);
  const header = readFileHeader(view);

  const nodes: PdbPlaylistNode[] = [];
  const entries: PdbPlaylistEntry[] = [];

  for (const page of walkTablePages(view, header, findTable(header, PAGE_TYPE.PLAYLIST_TREE))) {
    for (const rowStart of readPresentRowOffsets(view, header.lenPage, page)) {
      const pageEnd = page.offset + header.lenPage;
      if (rowStart + TREE_ROW_FIXED_SIZE > pageEnd) continue;
      const name = decodeDeviceSqlString(view, rowStart + TREE_ROW_FIXED_SIZE, pageEnd);
      if (!name) continue;
      const id = view.getUint32(rowStart + 0x0c, true);
      if (id === 0) continue;
      nodes.push({
        id,
        parentId: view.getUint32(rowStart, true),
        sortOrder: view.getUint32(rowStart + 0x08, true),
        isFolder: view.getUint32(rowStart + 0x10, true) !== 0,
        name: name.text,
      });
    }
  }

  for (const page of walkTablePages(view, header, findTable(header, PAGE_TYPE.PLAYLIST_ENTRIES))) {
    for (const rowStart of readPresentRowOffsets(view, header.lenPage, page)) {
      if (rowStart + ENTRY_ROW_SIZE > page.offset + header.lenPage) continue;
      const trackId = view.getUint32(rowStart + 0x04, true);
      const playlistId = view.getUint32(rowStart + 0x08, true);
      if (trackId === 0 || playlistId === 0) continue;
      entries.push({ entryIndex: view.getUint32(rowStart, true), trackId, playlistId });
    }
  }

  return { nodes, entries };
}

/* ------------------------------------------------------------------ writing */

interface BuiltPage {
  index: number;
  bytes: Uint8Array;
}

/** Pack rows into freshly built data pages, greedily filling each one. */
function buildPages(
  rows: Uint8Array[],
  lenPage: number,
  type: number,
  firstPageIndex: number,
  sequence: number,
  pageFlags: number
): BuiltPage[] {
  const pages: BuiltPage[] = [];
  let cursor = 0;

  do {
    const bytes = new Uint8Array(lenPage);
    const view = new DataView(bytes.buffer);
    const pageIndex = firstPageIndex + pages.length;

    let used = 0;
    let count = 0;

    while (cursor < rows.length) {
      const row = rows[cursor];
      const padded = Math.ceil(row.length / ROW_ALIGNMENT) * ROW_ALIGNMENT;
      const groups = Math.floor(count / ROWS_PER_GROUP) + 1;

      if (PAGE_HEADER_SIZE + used + padded + groups * ROW_GROUP_SIZE > lenPage) {
        if (count === 0) {
          throw new PdbFormatError(
            `Playlist row of ${row.length} bytes does not fit in a ${lenPage}-byte page`
          );
        }
        break;
      }

      const rowOffset = used; // relative to end of page header
      if (rowOffset > 0xffff) throw new PdbFormatError('Row offset exceeds 16 bits');
      bytes.set(row, PAGE_HEADER_SIZE + rowOffset);

      const group = Math.floor(count / ROWS_PER_GROUP);
      const within = count % ROWS_PER_GROUP;
      const base = lenPage - group * ROW_GROUP_SIZE;
      view.setUint16(base - 6 - within * 2, rowOffset, true);
      view.setUint16(base - 4, view.getUint16(base - 4, true) | (1 << within), true);

      used += padded;
      count++;
      cursor++;
    }

    const groups = Math.max(1, Math.ceil(count / ROWS_PER_GROUP));

    view.setUint32(0x04, pageIndex, true);
    view.setUint32(0x08, type, true);
    view.setUint32(0x0c, 0, true); // next_page, patched by the caller
    view.setUint32(0x10, sequence, true);
    // 0x18: num_row_offsets (13 bits) | num_rows (11 bits) | page_flags (8 bits)
    view.setUint32(0x18, (count & 0x1fff) | ((count & 0x7ff) << 13) | (pageFlags << 24), true);
    view.setUint16(0x1c, lenPage - PAGE_HEADER_SIZE - used - groups * ROW_GROUP_SIZE, true);
    view.setUint16(0x1e, used, true);

    pages.push({ index: pageIndex, bytes });
  } while (cursor < rows.length);

  return pages;
}

/** Sample the page flags rekordbox used for this table, so we match its style. */
function sampleDataPageFlags(
  view: DataView,
  header: PdbFileHeader,
  table: PdbTablePointer
): number {
  for (const page of walkTablePages(view, header, table)) {
    if (page.isDataPage && page.numRowOffsets > 0) return page.pageFlags;
  }
  return DEFAULT_DATA_PAGE_FLAGS;
}

/**
 * Does this table's first page hold rows? Chains normally begin with an empty
 * placeholder page, which we keep as the chain head; if it does hold rows we
 * re-encode them and repoint `first_page` instead.
 */
function firstPageHoldsRows(
  view: DataView,
  header: PdbFileHeader,
  table: PdbTablePointer
): boolean {
  try {
    const page = readPageHeader(view, header.lenPage, table.firstPage);
    return page.isDataPage && readPresentRowOffsets(view, header.lenPage, page).length > 0;
  } catch {
    return true; // Unreadable head — don't try to reuse it.
  }
}

/**
 * Rewrite both playlist tables with the supplied contents, appending new pages
 * and returning a fresh buffer. The source buffer is not modified.
 */
export function writePlaylistTables(
  source: ArrayBuffer,
  tables: PlaylistTables
): WriteResult {
  const sourceView = new DataView(source);
  const header = readFileHeader(sourceView);
  const { lenPage } = header;

  if (lenPage > 0x10000) {
    throw new PdbFormatError(`Page size ${lenPage} exceeds the 16-bit row-offset limit`);
  }

  const treeTable = findTable(header, PAGE_TYPE.PLAYLIST_TREE);
  const entryTable = findTable(header, PAGE_TYPE.PLAYLIST_ENTRIES);

  validate(tables);

  // Sort entries into playlist order so each playlist's rows sit together, the
  // way rekordbox lays them out.
  const orderedEntries = [...tables.entries].sort(
    (a, b) => a.playlistId - b.playlistId || a.entryIndex - b.entryIndex
  );

  const treeRows = tables.nodes.map(encodeTreeRow);
  const entryRows = orderedEntries.map(encodeEntryRow);

  const originalPageCount = source.byteLength / lenPage;
  const newSequence = (header.sequence + 1) >>> 0;

  const treeReusesHead = !firstPageHoldsRows(sourceView, header, treeTable);
  const entryReusesHead = !firstPageHoldsRows(sourceView, header, entryTable);

  const treePages = buildPages(
    treeRows,
    lenPage,
    PAGE_TYPE.PLAYLIST_TREE,
    originalPageCount,
    newSequence,
    sampleDataPageFlags(sourceView, header, treeTable)
  );
  const entryPages = buildPages(
    entryRows,
    lenPage,
    PAGE_TYPE.PLAYLIST_ENTRIES,
    originalPageCount + treePages.length,
    newSequence,
    sampleDataPageFlags(sourceView, header, entryTable)
  );

  const totalPages = originalPageCount + treePages.length + entryPages.length;

  // A `next_page` past the end of the file terminates a chain.
  for (const pages of [treePages, entryPages]) {
    pages.forEach((page, i) => {
      const next = i + 1 < pages.length ? pages[i + 1].index : totalPages;
      new DataView(page.bytes.buffer).setUint32(0x0c, next, true);
    });
  }

  // Assemble: original bytes verbatim, then the appended pages.
  const out = new Uint8Array(totalPages * lenPage);
  out.set(new Uint8Array(source), 0);
  for (const page of [...treePages, ...entryPages]) {
    out.set(page.bytes, page.index * lenPage);
  }

  const outView = new DataView(out.buffer);
  outView.setUint32(0x0c, totalPages, true); // next_unused_page
  outView.setUint32(0x14, newSequence, true); // sequence

  graftChain(outView, lenPage, treeTable, treePages, treeReusesHead);
  graftChain(outView, lenPage, entryTable, entryPages, entryReusesHead);

  return {
    buffer: out.buffer,
    pagesAppended: treePages.length + entryPages.length,
    bytesAdded: out.byteLength - source.byteLength,
    newSequence,
  };
}

/** Point a table at its new pages, keeping the old head page when it is empty. */
function graftChain(
  view: DataView,
  lenPage: number,
  table: PdbTablePointer,
  pages: BuiltPage[],
  reuseHead: boolean
): void {
  const firstNew = pages[0].index;
  const lastNew = pages[pages.length - 1].index;

  if (reuseHead) {
    // Keep the original placeholder page as the head, chain the rest behind it.
    view.setUint32(table.firstPage * lenPage + 0x0c, firstNew, true);
    view.setUint32(table.firstPage * lenPage + 0x10, view.getUint32(0x14, true), true);
  } else {
    view.setUint32(table.pointerOffset + 0x08, firstNew, true);
  }

  view.setUint32(table.pointerOffset + 0x0c, lastNew, true);
}

function validate(tables: PlaylistTables): void {
  const ids = new Set<number>();
  for (const node of tables.nodes) {
    if (!Number.isInteger(node.id) || node.id <= 0 || node.id > 0xffffffff) {
      throw new PdbFormatError(`Invalid playlist id: ${node.id}`);
    }
    if (ids.has(node.id)) throw new PdbFormatError(`Duplicate playlist id: ${node.id}`);
    ids.add(node.id);
    if (node.name.length === 0) throw new PdbFormatError('Playlist name cannot be empty');
  }
  for (const node of tables.nodes) {
    if (node.parentId !== 0 && !ids.has(node.parentId)) {
      throw new PdbFormatError(`Playlist ${node.id} references missing parent ${node.parentId}`);
    }
  }
  for (const entry of tables.entries) {
    if (!ids.has(entry.playlistId)) {
      throw new PdbFormatError(`Entry references unknown playlist ${entry.playlistId}`);
    }
    if (!Number.isInteger(entry.trackId) || entry.trackId <= 0) {
      throw new PdbFormatError(`Invalid track id: ${entry.trackId}`);
    }
  }
}

/**
 * Read the playlist tables back out of a freshly written image and confirm they
 * match what we intended to write. This is the gate the commit flow runs before
 * anything touches the USB.
 */
export function verifyWrittenPlaylists(
  buffer: ArrayBuffer,
  expected: PlaylistTables
): { ok: true } | { ok: false; reason: string } {
  let actual: PlaylistTables;
  try {
    actual = readPlaylistTables(buffer);
  } catch (error) {
    return { ok: false, reason: `Re-parse failed: ${(error as Error).message}` };
  }

  if (actual.nodes.length !== expected.nodes.length) {
    return {
      ok: false,
      reason: `Playlist count mismatch: wrote ${expected.nodes.length}, read back ${actual.nodes.length}`,
    };
  }

  const byId = new Map(actual.nodes.map((n) => [n.id, n]));
  for (const want of expected.nodes) {
    const got = byId.get(want.id);
    if (!got) return { ok: false, reason: `Playlist ${want.id} missing after write` };
    if (got.name !== want.name) {
      return { ok: false, reason: `Playlist ${want.id} name mismatch: "${got.name}"` };
    }
    if (got.parentId !== want.parentId || got.isFolder !== want.isFolder) {
      return { ok: false, reason: `Playlist ${want.id} structure mismatch` };
    }
  }

  if (actual.entries.length !== expected.entries.length) {
    return {
      ok: false,
      reason: `Entry count mismatch: wrote ${expected.entries.length}, read back ${actual.entries.length}`,
    };
  }

  const key = (e: PdbPlaylistEntry) => `${e.playlistId}:${e.entryIndex}:${e.trackId}`;
  const actualKeys = new Set(actual.entries.map(key));
  for (const want of expected.entries) {
    if (!actualKeys.has(key(want))) {
      return {
        ok: false,
        reason: `Track ${want.trackId} missing from playlist ${want.playlistId}`,
      };
    }
  }

  return { ok: true };
}
