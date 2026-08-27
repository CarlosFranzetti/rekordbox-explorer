/**
 * Work out what is actually wrong with a database file.
 *
 * Written against a real casualty: a drive pulled without ejecting, whose three
 * rekordbox databases all stopped at **exactly 32 KB**. Nothing was scrambled —
 * the bytes were simply never written. That distinction is the whole point of
 * this module, because it decides what can be done:
 *
 * - **Truncated / unwritten** — the data is gone. No repair exists. Look for
 *   another copy (see `scan.ts`).
 * - **Damaged but complete** — pages are present but inconsistent. Worth
 *   walking with a forgiving reader, which often recovers most rows.
 *
 * Telling a DJ "your file is corrupt" when it is actually 96% absent sends them
 * hunting for a repair tool that cannot possibly work.
 */

export type Health = 'ok' | 'damaged' | 'truncated' | 'unwritten' | 'unreadable';

export interface Assessment {
  health: Health;
  /** Fraction of the file's own declared size that is actually present, 0–1. */
  completeness: number;
  pagesPresent: number;
  pagesExpected: number;
  /** Pages that are entirely zero — allocated but never written. */
  pagesBlank: number;
  /** Human-readable, written for someone who needs to act, not diagnose. */
  summary: string;
  /** Detail lines worth showing under a "why?" disclosure. */
  detail: string[];
}

const PDB_HEADER_MIN = 0x2c;

function blankPageCount(bytes: Uint8Array, pageSize: number, limit: number): number {
  let blank = 0;
  for (let i = 0; i < limit; i++) {
    const start = i * pageSize;
    let allZero = true;
    for (let j = start; j < start + pageSize; j++) {
      if (bytes[j] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) blank++;
  }
  return blank;
}

/**
 * Assess a legacy `export.pdb` / `exportExt.pdb`.
 *
 * The file header states `len_page` and `next_unused_page`; multiplied, that is
 * how large the file should be. A real drive gave 8 pages where the header
 * claimed 184 — and the pages holding the playlists started at page 15.
 */
export function assessPdb(bytes: Uint8Array): Assessment {
  const detail: string[] = [];
  if (bytes.length < PDB_HEADER_MIN) {
    return {
      health: 'unreadable',
      completeness: 0,
      pagesPresent: 0,
      pagesExpected: 0,
      pagesBlank: 0,
      summary: 'This file is too small to be a rekordbox database.',
      detail,
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lenPage = view.getUint32(0x04, true);
  const numTables = view.getUint32(0x08, true);
  const nextUnused = view.getUint32(0x0c, true);
  const sequence = view.getUint32(0x14, true);

  if (lenPage < 512 || lenPage > 1024 * 1024 || (lenPage & (lenPage - 1)) !== 0) {
    return {
      health: 'unreadable',
      completeness: 0,
      pagesPresent: 0,
      pagesExpected: 0,
      pagesBlank: 0,
      summary: 'This file does not have a readable rekordbox header.',
      detail: [`Declared page size ${lenPage} is not plausible.`],
    };
  }

  const present = Math.floor(bytes.length / lenPage);
  const expected = nextUnused || present;
  const blank = blankPageCount(bytes, lenPage, present);
  const completeness = expected > 0 ? Math.min(1, present / expected) : 1;

  detail.push(`Header: page size ${lenPage}, ${numTables} tables, ${expected} pages, sequence ${sequence}.`);
  detail.push(`File holds ${present} pages (${bytes.length.toLocaleString()} bytes).`);
  if (blank > 0) detail.push(`${blank} of those pages are entirely blank.`);

  if (present >= expected && blank === 0) {
    return {
      health: 'ok',
      completeness: 1,
      pagesPresent: present,
      pagesExpected: expected,
      pagesBlank: blank,
      summary: 'This database looks complete.',
      detail,
    };
  }

  const missing = expected - present;
  if (missing > 0) {
    const pct = Math.round(completeness * 100);
    detail.push(
      'A file that stops on a page boundary was not corrupted — it was never finished being written. ' +
        'That is what happens when a drive is unplugged without ejecting.'
    );
    return {
      health: 'truncated',
      completeness,
      pagesPresent: present,
      pagesExpected: expected,
      pagesBlank: blank,
      summary:
        `Only ${pct}% of this database was written to the drive — ${missing} of its ${expected} pages are missing. ` +
        'The rest was never saved, so it cannot be repaired from this file.',
      detail,
    };
  }

  return {
    health: blank > present / 2 ? 'unwritten' : 'damaged',
    completeness: (present - blank) / present,
    pagesPresent: present,
    pagesExpected: expected,
    pagesBlank: blank,
    summary:
      blank > present / 2
        ? `Most of this database is blank — ${blank} of ${present} pages were never written.`
        : 'This database is the right size but some pages look damaged.',
    detail,
  };
}

/**
 * Assess a SQLite file — a decrypted OneLibrary image, or an Engine DJ `m.db`.
 *
 * SQLite records its page count in the header at offset 28. A file whose header
 * claims more pages than it holds is truncated; one that is the right length but
 * mostly zero pages was extended and then never filled, which is exactly what a
 * yanked drive produces.
 */
export function assessSqlite(bytes: Uint8Array): Assessment {
  const detail: string[] = [];
  if (bytes.length < 100) {
    return {
      health: 'unreadable',
      completeness: 0,
      pagesPresent: 0,
      pagesExpected: 0,
      pagesBlank: 0,
      summary: 'This file is too small to be a database.',
      detail,
    };
  }

  const header = String.fromCharCode(...bytes.subarray(0, 15));
  if (header !== 'SQLite format 3') {
    return {
      health: 'unreadable',
      completeness: 0,
      pagesPresent: 0,
      pagesExpected: 0,
      pagesBlank: 0,
      summary: 'This is not a readable SQLite database.',
      detail: ['If it is a OneLibrary file it must be decrypted first.'],
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Page size 1 means 65536, per the SQLite format.
  const raw = view.getUint16(16);
  const pageSize = raw === 1 ? 65536 : raw;
  const declared = view.getUint32(28);

  const present = Math.floor(bytes.length / pageSize);
  const expected = declared || present;
  const blank = blankPageCount(bytes, pageSize, present);
  const live = present - blank;
  const completeness = expected > 0 ? Math.min(1, live / expected) : 1;

  detail.push(`SQLite header: page size ${pageSize}, ${expected} pages declared.`);
  detail.push(`File holds ${present} pages, ${blank} of them blank.`);

  if (present >= expected && blank === 0) {
    return {
      health: 'ok',
      completeness: 1,
      pagesPresent: present,
      pagesExpected: expected,
      pagesBlank: blank,
      summary: 'This database looks complete.',
      detail,
    };
  }

  if (blank > present / 2) {
    detail.push(
      'The file was grown to its full size but the contents never reached the drive. ' +
        'Blank pages are unwritten, not damaged — there is nothing here to repair.'
    );
    return {
      health: 'unwritten',
      completeness,
      pagesPresent: present,
      pagesExpected: expected,
      pagesBlank: blank,
      summary: `${blank} of this database's ${present} pages were never written. Its contents are gone.`,
      detail,
    };
  }

  if (present < expected) {
    return {
      health: 'truncated',
      completeness,
      pagesPresent: present,
      pagesExpected: expected,
      pagesBlank: blank,
      summary:
        `This database is ${expected - present} pages short of its declared size. ` +
        'Most of it is still readable, so it is worth salvaging.',
      detail,
    };
  }

  return {
    health: 'damaged',
    completeness,
    pagesPresent: present,
    pagesExpected: expected,
    pagesBlank: blank,
    summary: 'This database is the right size but parts of it are unreadable.',
    detail,
  };
}

/**
 * What a sibling journal or write-ahead log tells us.
 *
 * A **zero-length** `-journal` is the common case and means nothing is pending —
 * SQLite truncates it on commit. A non-empty one means a transaction was in
 * flight; we cannot replay or roll back either kind here, so the honest move is
 * to say so rather than silently reading a half-committed database.
 */
export function describeSidecar(name: string, bytes: number): string | null {
  if (name.endsWith('-journal')) {
    if (bytes === 0) return null; // Committed and truncated; nothing to say.
    return (
      `There is a ${Math.round(bytes / 1024)} KB rollback journal beside this database, so a change was ` +
      'in progress when the drive was removed. Some of what you see may be half-applied.'
    );
  }
  if (name.endsWith('-wal')) {
    if (bytes === 0) return null;
    return (
      `There is a ${Math.round(bytes / 1024)} KB write-ahead log beside this database that cannot be ` +
      'replayed here, so recent changes may be missing. Ejecting the drive properly from rekordbox flushes it.'
    );
  }
  return null;
}
