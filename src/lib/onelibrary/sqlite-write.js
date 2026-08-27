/**
 * Vendored verbatim from the OneLibrary project.
 *   https://github.com/v1vendi/onelibrary — viewer/src/sqlite_write.js @ a31baa5
 *   Copyright (c) 2026 v1vendi. MIT licensed. See docs/THIRD-PARTY.md.
 *
 * Deliberately left as unmodified JavaScript so upstream fixes apply as a clean
 * diff. Types live beside it in `index.d.ts`; tsc does not check this file.
 */
/**
 * Serialise tables back into a SQLite file.
 *
 * The counterpart to `sqlite.js`. Editing a record in place is not practical --
 * changing a rating from 0 to 5 changes its serial type from "constant zero"
 * (zero bytes) to "8-bit integer" (one byte), so the record grows and the page
 * has to be laid out again. Rebuilding the file is simpler and always correct.
 *
 * What it emits: the 100-byte header, `sqlite_master`, one table b-tree per
 * table, and one index b-tree per index. Interior pages are produced when a
 * b-tree outgrows a single page. There is no overflow support -- a record
 * larger than a page raises rather than silently truncating.
 *
 * `PRAGMA integrity_check` on the result is the oracle this is tested against.
 */

const PAGE_SIZE = 4096;
const RESERVE = 80;             // SQLCipher's per-page reservation
const USABLE = PAGE_SIZE - RESERVE;
const ENC = new TextEncoder();

export class SQLiteWriteError extends Error {}

const LEAF_TABLE = 13, INTERIOR_TABLE = 5, LEAF_INDEX = 10, INTERIOR_INDEX = 2;

function varint(value) {
  let v = BigInt(value);
  if (v >= 0n && v <= 0x7fn) return [Number(v)];
  if (v < 0n) v = BigInt.asUintN(64, v);
  const parts = [];
  while (v > 0n) { parts.unshift(Number(v & 0x7fn)); v >>= 7n; }
  for (let i = 0; i < parts.length - 1; i++) parts[i] |= 0x80;
  return parts;
}

/** Encode one value, returning its serial type and bytes. */
function serialise(value) {
  if (value === null || value === undefined) return { type: 0, bytes: [] };
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value === 0) return { type: 8, bytes: [] };
    if (value === 1) return { type: 9, bytes: [] };
    const widths = [[1, 1], [2, 2], [3, 3], [4, 4], [6, 5], [8, 6]];
    for (const [bytes, type] of widths) {
      const bits = BigInt(bytes * 8 - 1);
      if (BigInt(value) >= -(2n ** bits) && BigInt(value) < 2n ** bits) {
        const out = [];
        let v = BigInt.asUintN(bytes * 8, BigInt(value));
        for (let i = bytes - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
        return { type, bytes: out };
      }
    }
  }
  if (typeof value === 'number') {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, value);
    return { type: 7, bytes: [...buf] };
  }
  if (value instanceof Uint8Array) return { type: 12 + value.length * 2, bytes: [...value] };
  const utf8 = ENC.encode(String(value));
  return { type: 13 + utf8.length * 2, bytes: [...utf8] };
}

/** Build a record body (header of serial types, then values). */
export function buildRecord(values) {
  const parts = values.map(serialise);
  const typeBytes = parts.flatMap((p) => varint(p.type));
  // The header length varint counts itself, so it may need a second pass.
  let headerLen = typeBytes.length + 1;
  if (varint(headerLen).length !== 1) headerLen = typeBytes.length + varint(typeBytes.length + 2).length;
  return Uint8Array.from([...varint(headerLen), ...typeBytes, ...parts.flatMap((p) => p.bytes)]);
}

/**
 * Pack cells into b-tree pages, adding interior pages until one page remains.
 *
 * @param {{key:bigint|number, payload:Uint8Array}[]} cells  in ascending key order
 * @returns {{pages:Map<number,Uint8Array>, root:number}}
 */
function buildTree(cells, allocPage, { leafType, interiorType, withRowid }) {
  const pages = new Map();
  const cellBytes = (c) =>
    withRowid
      ? Uint8Array.from([...varint(c.payload.length), ...varint(c.key), ...c.payload])
      : Uint8Array.from([...varint(c.payload.length), ...c.payload]);

  // Leaf level: fill pages until the next cell would not fit.
  const groups = [];
  let batch = [];
  let used = 8;
  for (const cell of cells) {
    const bytes = cellBytes(cell);
    if (bytes.length + 2 > USABLE - 12) {
      throw new SQLiteWriteError(`record of ${bytes.length} bytes needs an overflow page`);
    }
    if (used + bytes.length + 2 > USABLE) {
      groups.push(batch);
      batch = []; used = 8;
    }
    batch.push({ ...cell, bytes });
    used += bytes.length + 2;
  }
  groups.push(batch);

  let nodes = groups.map((items) => ({
    descriptor: { type: leafType, items: items.map((c) => c.bytes) },
    maxKey: items.length ? items.at(-1).key : 0,
  }));

  // Interior levels, until one node remains. Only that node's descriptor is
  // returned unplaced, so the caller can render a root wherever it needs to --
  // sqlite_master's root must live at offset 100 of page 1.
  while (nodes.length > 1) {
    const placed = nodes.map((n) => {
      const page = allocPage();
      pages.set(page, renderPage(n.descriptor));
      return { page, maxKey: n.maxKey };
    });
    const parents = [];
    const fanout = Math.max(2, Math.floor((USABLE - 12) / 13));
    for (let i = 0; i < placed.length; i += fanout) {
      const slice = placed.slice(i, i + fanout);
      const rightmost = slice.pop();
      const items = slice.map((child) =>
        Uint8Array.from([
          (child.page >>> 24) & 0xff, (child.page >>> 16) & 0xff,
          (child.page >>> 8) & 0xff, child.page & 0xff,
          ...varint(child.maxKey),
        ])
      );
      parents.push({
        descriptor: { type: interiorType, items, rightChild: rightmost.page },
        maxKey: rightmost.maxKey,
      });
    }
    nodes = parents;
  }
  return { pages, rootDescriptor: nodes[0].descriptor };
}

/** Lay a node out into a fresh page, or into an existing buffer at `offset`. */
function renderPage({ type, items, rightChild }, buffer = null, offset = 0) {
  const page = buffer || new Uint8Array(PAGE_SIZE);
  const headerLen = rightChild === undefined ? 8 : 12;
  const dv = new DataView(page.buffer, page.byteOffset + offset);
  page[offset] = type;
  dv.setUint16(3, items.length);
  if (rightChild !== undefined) dv.setUint32(8, rightChild);

  let contentStart = USABLE;
  const cellArrayEnd = offset + headerLen + items.length * 2;
  items.forEach((bytes, i) => {
    contentStart -= bytes.length;
    if (contentStart < cellArrayEnd) {
      throw new SQLiteWriteError('b-tree node overflowed its page');
    }
    page.set(bytes, contentStart);
    dv.setUint16(headerLen + i * 2, contentStart);
  });
  // Always the real offset. A zero here means 65536 per the file format, which
  // on a 4096-byte page makes SQLite report free-space corruption -- the bug
  // that shows up only on empty tables, whose pages hold no cells at all.
  dv.setUint16(5, contentStart);
  return page;
}

/** Place a tree and return its root page number. */
function placeTree(result, pages, allocPage) {
  for (const [n, p] of result.pages) pages.set(n, p);
  const root = allocPage();
  pages.set(root, renderPage(result.rootDescriptor));
  return root;
}

/**
 * Write a complete SQLite image.
 *
 * @param {{name:string, sql:string, rows:object[], columns:string[]}[]} tables
 * @param {{name:string, sql:string, table:string, column:string}[]} indexes
 */
export function writeDatabase(tables, indexes = []) {
  let nextPage = 2;                       // page 1 is the header + sqlite_master
  const allocPage = () => nextPage++;
  const pages = new Map();
  const master = [];

  for (const table of tables) {
    const cells = table.rows.map((row, i) => ({
      key: row.__rowid ?? i + 1,
      payload: buildRecord(
        table.columns.map((c) => {
          const v = row[c] ?? null;
          // An INTEGER PRIMARY KEY is stored as NULL; the rowid carries it.
          return c === table.rowidAlias ? null : v;
        })
      ),
    }));
    cells.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const root = placeTree(
      buildTree(cells, allocPage, {
        leafType: LEAF_TABLE, interiorType: INTERIOR_TABLE, withRowid: true,
      }), pages, allocPage);
    master.push(['table', table.name, table.name, root, table.sql]);
  }

  for (const idx of indexes) {
    const table = tables.find((t) => t.name === idx.table);
    if (!table) continue;
    const entries = table.rows
      .map((row, i) => ({ value: row[idx.column] ?? null, rowid: row.__rowid ?? i + 1 }))
      .sort((a, b) =>
        a.value === b.value ? a.rowid - b.rowid : (a.value ?? -Infinity) < (b.value ?? -Infinity) ? -1 : 1
      );
    const cells = entries.map((e) => ({
      key: e.rowid,
      payload: buildRecord([e.value, e.rowid]),
    }));
    const root = placeTree(
      buildTree(cells, allocPage, {
        leafType: LEAF_INDEX, interiorType: INTERIOR_INDEX, withRowid: false,
      }), pages, allocPage);
    master.push(['index', idx.name, idx.table, root, idx.sql]);
  }

  // sqlite_master lives on page 1, after the 100-byte file header.
  const masterCells = master.map((row, i) => ({ key: i + 1, payload: buildRecord(row) }));
  const page1 = new Uint8Array(PAGE_SIZE);
  const dv1 = new DataView(page1.buffer);
  page1.set(ENC.encode('SQLite format 3\0'), 0);
  dv1.setUint16(16, PAGE_SIZE);
  page1[18] = 1; page1[19] = 1;          // write/read version: legacy
  page1[20] = RESERVE;
  page1[21] = 64; page1[22] = 32; page1[23] = 32;
  dv1.setUint32(24, 1);                   // file change counter
  dv1.setUint32(40, 1);                   // schema cookie
  dv1.setUint32(44, 4);                   // schema format 4
  dv1.setUint32(56, 1);                   // text encoding: UTF-8
  dv1.setUint32(92, 1);                   // version-valid-for
  dv1.setUint32(96, 3045001);             // SQLite version that wrote this

  {
    // sqlite_master's root sits at offset 100, sharing page 1 with the file
    // header, so it is rendered in place rather than given its own page. When
    // the schema outgrows one page this root is an interior node.
    const tree = buildTree(masterCells, allocPage, {
      leafType: LEAF_TABLE, interiorType: INTERIOR_TABLE, withRowid: true,
    });
    for (const [n, p] of tree.pages) pages.set(n, p);
    renderPage(tree.rootDescriptor, page1, 100);
  }

  const total = nextPage - 1;
  dv1.setUint32(28, total);               // database size in pages
  const out = new Uint8Array(total * PAGE_SIZE);
  out.set(page1, 0);
  for (const [n, p] of pages) out.set(p, (n - 1) * PAGE_SIZE);
  return out;
}
