/**
 * Structural model of a DeviceSQL `.pdb` image: file header, table pointers,
 * page headers and row indexes. This is the layer the writer mutates; the
 * high-level track/playlist reader lives in `src/lib/rekordbox-parser.ts`.
 *
 * Layout reference: Deep-Symmetry/crate-digger `rekordbox_pdb.ksy`.
 *
 *   File header
 *     0x00 u4  zero
 *     0x04 u4  len_page
 *     0x08 u4  num_tables
 *     0x0C u4  next_unused_page
 *     0x10 u4  unknown
 *     0x14 u4  sequence          (incremented on every edit)
 *     0x18 u4  gap (zero)
 *     0x1C     table pointers, 16 bytes each
 *
 *   Table pointer
 *     +0x00 u4 type
 *     +0x04 u4 empty_candidate
 *     +0x08 u4 first_page
 *     +0x0C u4 last_page
 *
 *   Page header (0x28 bytes, heap follows)
 *     0x00 u4  zero
 *     0x04 u4  page_index
 *     0x08 u4  type
 *     0x0C u4  next_page
 *     0x10 u4  sequence
 *     0x14 u4  unknown
 *     0x18 b13 num_row_offsets, b11 num_rows   (packed LE within 3 bytes)
 *     0x1B u1  page_flags        (bit 0x40 set => not a data page)
 *     0x1C u2  free_size
 *     0x1E u2  used_size
 *     0x20 u2  transaction_row_count
 *     0x22 u2  transaction_row_index
 *     0x24 u2  unknown
 *     0x26 u2  unknown
 *
 *   Row index, built backwards from the end of the page in 0x24-byte groups of
 *   up to 16 rows. For group g, base = len_page - g * 0x24:
 *     base - 6 - 2*i : u2 offset of row i, relative to the end of the header
 *     base - 4       : u2 row_present_flags
 *     base - 2       : u2 transaction_row_flags
 */

export const PAGE_TYPE = {
  TRACKS: 0,
  GENRES: 1,
  ARTISTS: 2,
  ALBUMS: 3,
  LABELS: 4,
  KEYS: 5,
  COLORS: 6,
  PLAYLIST_TREE: 7,
  PLAYLIST_ENTRIES: 8,
  HISTORY_PLAYLISTS: 11,
  HISTORY_ENTRIES: 12,
  ARTWORK: 13,
  COLUMNS: 16,
  HISTORY: 19,
} as const;

export const FILE_HEADER_SIZE = 0x1c;
export const TABLE_POINTER_SIZE = 16;
export const PAGE_HEADER_SIZE = 0x28;
export const ROW_GROUP_SIZE = 0x24;
export const ROWS_PER_GROUP = 16;

/** Page flag bit that marks a page as *not* holding parsable rows. */
export const PAGE_FLAG_NON_DATA = 0x40;

/** Guards against absurd values in a corrupt or hostile file. */
export const MIN_PAGE_LEN = 512;
export const MAX_PAGE_LEN = 1024 * 1024;
export const MAX_TABLES = 64;
export const MAX_PAGES = 200_000;

export interface PdbTablePointer {
  type: number;
  emptyCandidate: number;
  firstPage: number;
  lastPage: number;
  /** Absolute byte offset of this pointer in the file, for in-place patching. */
  pointerOffset: number;
}

export interface PdbFileHeader {
  lenPage: number;
  numTables: number;
  nextUnusedPage: number;
  sequence: number;
  tables: PdbTablePointer[];
}

export interface PdbPageHeader {
  index: number;
  offset: number;
  type: number;
  nextPage: number;
  sequence: number;
  numRowOffsets: number;
  numRows: number;
  pageFlags: number;
  freeSize: number;
  usedSize: number;
  isDataPage: boolean;
}

export class PdbFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdbFormatError';
  }
}

export function readFileHeader(view: DataView): PdbFileHeader {
  if (view.byteLength < FILE_HEADER_SIZE + TABLE_POINTER_SIZE) {
    throw new PdbFormatError('File too small to be a DeviceSQL database');
  }

  const lenPage = view.getUint32(0x04, true);
  if (lenPage < MIN_PAGE_LEN || lenPage > MAX_PAGE_LEN || view.byteLength % lenPage !== 0) {
    throw new PdbFormatError(`Implausible page length: ${lenPage}`);
  }

  const numTables = view.getUint32(0x08, true);
  if (numTables === 0 || numTables > MAX_TABLES) {
    throw new PdbFormatError(`Implausible table count: ${numTables}`);
  }
  if (FILE_HEADER_SIZE + numTables * TABLE_POINTER_SIZE > view.byteLength) {
    throw new PdbFormatError('Table pointers extend past end of file');
  }

  const pageCount = view.byteLength / lenPage;
  const tables: PdbTablePointer[] = [];

  for (let i = 0; i < numTables; i++) {
    const pointerOffset = FILE_HEADER_SIZE + i * TABLE_POINTER_SIZE;
    const firstPage = view.getUint32(pointerOffset + 0x08, true);
    const lastPage = view.getUint32(pointerOffset + 0x0c, true);
    if (firstPage >= pageCount || lastPage >= pageCount) continue;

    tables.push({
      type: view.getUint32(pointerOffset, true),
      emptyCandidate: view.getUint32(pointerOffset + 0x04, true),
      firstPage,
      lastPage,
      pointerOffset,
    });
  }

  return {
    lenPage,
    numTables,
    nextUnusedPage: view.getUint32(0x0c, true),
    sequence: view.getUint32(0x14, true),
    tables,
  };
}

export function readPageHeader(view: DataView, lenPage: number, index: number): PdbPageHeader {
  const offset = index * lenPage;
  if (offset < 0 || offset + PAGE_HEADER_SIZE > view.byteLength) {
    throw new PdbFormatError(`Page ${index} lies outside the file`);
  }

  const packed = view.getUint32(offset + 0x18, true);
  const pageFlags = (packed >>> 24) & 0xff;

  return {
    index,
    offset,
    type: view.getUint32(offset + 0x08, true),
    nextPage: view.getUint32(offset + 0x0c, true),
    sequence: view.getUint32(offset + 0x10, true),
    numRowOffsets: packed & 0x1fff,
    numRows: (packed >>> 13) & 0x7ff,
    pageFlags,
    freeSize: view.getUint16(offset + 0x1c, true),
    usedSize: view.getUint16(offset + 0x1e, true),
    isDataPage: (pageFlags & PAGE_FLAG_NON_DATA) === 0,
  };
}

/**
 * Walk a table's page chain, yielding each page header exactly once.
 *
 * Termination follows the spec's guidance: stop after `last_page`, when
 * `next_page` leaves the file, or when it lands on a page belonging to a
 * different table. A visited-set guards against cycles in a damaged file.
 */
export function* walkTablePages(
  view: DataView,
  header: PdbFileHeader,
  table: PdbTablePointer
): Generator<PdbPageHeader> {
  const pageCount = view.byteLength / header.lenPage;
  const visited = new Set<number>();
  let index = table.firstPage;

  while (index < pageCount && !visited.has(index) && visited.size < MAX_PAGES) {
    visited.add(index);

    let page: PdbPageHeader;
    try {
      page = readPageHeader(view, header.lenPage, index);
    } catch {
      return;
    }

    if (page.type !== table.type) return;
    yield page;

    // `last_page` is inclusive: yield it, then stop.
    if (index === table.lastPage) return;
    if (page.nextPage === 0 || page.nextPage >= pageCount) return;
    index = page.nextPage;
  }
}

/** Byte offset of the row-index slot for `rowIndex` within a page. */
function rowOffsetSlot(pageOffset: number, lenPage: number, rowIndex: number): number {
  const group = Math.floor(rowIndex / ROWS_PER_GROUP);
  const withinGroup = rowIndex % ROWS_PER_GROUP;
  const base = pageOffset + lenPage - group * ROW_GROUP_SIZE;
  return base - 6 - withinGroup * 2;
}

function rowPresentFlagsSlot(pageOffset: number, lenPage: number, group: number): number {
  return pageOffset + lenPage - group * ROW_GROUP_SIZE - 4;
}

/**
 * Absolute file offsets of every row the page's index marks as present.
 *
 * Rows flagged absent are skipped: per the format docs they "do not contain
 * valid (or even necessarily well-formed) data".
 */
export function readPresentRowOffsets(
  view: DataView,
  lenPage: number,
  page: PdbPageHeader
): number[] {
  if (!page.isDataPage || page.numRowOffsets === 0) return [];

  const heapStart = page.offset + PAGE_HEADER_SIZE;
  const pageEnd = page.offset + lenPage;
  const groupCount = Math.ceil(page.numRowOffsets / ROWS_PER_GROUP);
  const offsets: number[] = [];

  for (let group = 0; group < groupCount; group++) {
    const flagsSlot = rowPresentFlagsSlot(page.offset, lenPage, group);
    if (flagsSlot < heapStart || flagsSlot + 2 > pageEnd) continue;
    const presentFlags = view.getUint16(flagsSlot, true);

    for (let within = 0; within < ROWS_PER_GROUP; within++) {
      const rowIndex = group * ROWS_PER_GROUP + within;
      if (rowIndex >= page.numRowOffsets) break;
      if (((presentFlags >> within) & 1) === 0) continue;

      const slot = rowOffsetSlot(page.offset, lenPage, rowIndex);
      if (slot < heapStart || slot + 2 > pageEnd) continue;

      const rowStart = heapStart + view.getUint16(slot, true);
      if (rowStart < heapStart || rowStart >= pageEnd) continue;
      offsets.push(rowStart);
    }
  }

  return offsets;
}

/** How many rows of `rowBytes` each fit in one page, accounting for the index. */
export function rowsPerPage(lenPage: number, rowBytes: number): number {
  let count = 0;
  let used = 0;
  for (;;) {
    const groups = Math.floor(count / ROWS_PER_GROUP) + 1;
    if (PAGE_HEADER_SIZE + used + rowBytes + groups * ROW_GROUP_SIZE > lenPage) return count;
    used += rowBytes;
    count++;
  }
}
