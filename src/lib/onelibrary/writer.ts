/**
 * Apply playlist changes to a OneLibrary database.
 *
 * ## Why this cannot be additive
 *
 * The PDB writer's first invariant is that a write only ever *appends* — the
 * original bytes are never disturbed, so a half-finished write leaves a library
 * that still parses. SQLite gives us no such move. Changing one row can change
 * its serial type (a rating of 0 occupies zero bytes; a rating of 5 occupies
 * one), which grows the record, which re-lays-out the page, which can split the
 * b-tree. Editing in place is not meaningfully safer than rebuilding, and it is
 * far easier to get wrong.
 *
 * So OneLibrary writes **rebuild the whole file**. Invariant 1 does not hold
 * here and pretending otherwise would be dishonest. Everything else still does,
 * and matters more because of it:
 *
 * 2. No write without a verified backup in at least one vault.
 * 3. A failed write rolls back automatically.
 * 4. A restore is itself snapshotted first.
 * 5. A damaged backup never overwrites a good library.
 * 6. Malformed input never hangs or throws out of the parser.
 *
 * The compensating control is that a rebuild is verified before it is allowed
 * near the drive: {@link applyPlaylistChanges} decrypts its own output and
 * re-reads it, so a database that would not open is caught in memory.
 *
 * ## What is deliberately not touched
 *
 * Only `playlist` and `playlist_content` are modified. Track rows, cues, ANLZ
 * references, myTag, history and the browse-UI configuration tables are copied
 * through byte-for-byte. Cues in particular are **not** in this database at all
 * — rekordbox leaves the `cue` table empty and puts them in the ANLZ files — so
 * there is nothing here to lose, and equally nothing here that can fix them.
 */

import { decrypt, encrypt, DEFAULT_KEY, PAGE_SIZE } from '@/lib/onelibrary/sqlcipher';
import { SQLiteDatabase } from '@/lib/onelibrary/sqlite';
import { writeDatabase } from '@/lib/onelibrary/sqlite-write';
import { readOneLibraryImage, OneLibraryError } from './reader';
import type { RekordboxDatabase } from '@/types/rekordbox';

/** A playlist as the editor hands it to us: a name and an ordered track list. */
export interface OneLibraryPlaylistDraft {
  /** Omit to create; supply an existing `playlist_id` to replace its contents. */
  id?: number;
  name: string;
  /** `content_id` values, in the order they should appear on the player. */
  trackIds: number[];
  /** Parent folder's `playlist_id`, or null/0 for top level. */
  parentId?: number | null;
}

export interface ApplyResult {
  /** The re-encrypted database, ready to write to the drive. */
  encrypted: Uint8Array;
  /** What the result parses back as — the caller should show this, not assume. */
  verified: RekordboxDatabase;
  playlistCount: number;
  entryCount: number;
}

interface TableSpec {
  name: string;
  sql: string;
  columns: string[];
  rowidAlias: string | null;
  rows: Record<string, unknown>[];
}

/**
 * Read every table out of an image so it can be handed back to the writer.
 *
 * Carrying the rowid across is not optional. Where a table has an
 * `INTEGER PRIMARY KEY`, that column *is* the rowid — SQLite stores NULL in the
 * record and recovers the value from the b-tree key. The writer defaults an
 * absent `__rowid` to the row's position, so a table whose ids have gaps (and
 * several of OneLibrary's browse-config tables do) would be silently
 * renumbered: `category_id` 26 becomes 21, and every reference to it now points
 * at the wrong row. Pinning `__rowid` to the declared id keeps them stable.
 */
function snapshotTables(db: SQLiteDatabase): TableSpec[] {
  const out: TableSpec[] = [];
  for (const name of db.tableNames()) {
    const meta = db.tables.get(name);
    if (!meta) continue;
    const rows = db.select(name) as Record<string, unknown>[];
    if (meta.rowidAlias) {
      for (const row of rows) {
        const id = row[meta.rowidAlias];
        if (typeof id === 'number') row.__rowid = id;
      }
    }
    out.push({
      name,
      sql: meta.sql,
      columns: meta.columns,
      rowidAlias: meta.rowidAlias,
      rows,
    });
  }
  return out;
}

function requireTable(tables: TableSpec[], name: string): TableSpec {
  const t = tables.find((x) => x.name === name);
  if (!t) {
    throw new OneLibraryError(
      `This OneLibrary database has no "${name}" table, so playlists cannot be edited. ` +
        'Your drive has not been touched.'
    );
  }
  return t;
}

/**
 * Rebuild a OneLibrary database with the given playlists applied.
 *
 * Verifies its own output by decrypting and re-reading it before returning, so
 * a database that would not open never reaches the caller — let alone the drive.
 *
 * @param encrypted the current `exportLibrary.db` bytes
 * @param drafts    playlists to create or replace
 * @param opts.passphrase override the stock rekordbox passphrase
 * @param opts.removePlaylistIds playlists to delete outright
 */
export async function applyPlaylistChanges(
  encrypted: Uint8Array,
  drafts: OneLibraryPlaylistDraft[],
  opts: { passphrase?: string; removePlaylistIds?: number[] } = {}
): Promise<ApplyResult> {
  const passphrase = opts.passphrase ?? DEFAULT_KEY;
  const salt = encrypted.subarray(0, 16);

  const image = await decrypt(encrypted, passphrase);
  const db = new SQLiteDatabase(image);
  const tables = snapshotTables(db);

  const playlist = requireTable(tables, 'playlist');
  const playlistContent = requireTable(tables, 'playlist_content');
  const content = requireTable(tables, 'content');

  // Every referenced track must exist, or the player shows a playlist of
  // entries that resolve to nothing.
  const knownContent = new Set(content.rows.map((r) => r.content_id as number));
  for (const d of drafts) {
    for (const id of d.trackIds) {
      if (!knownContent.has(id)) {
        throw new OneLibraryError(
          `Playlist "${d.name}" refers to track ${id}, which is not on this drive. ` +
            'Nothing has been written.'
        );
      }
    }
  }

  const removals = new Set(opts.removePlaylistIds ?? []);
  for (const d of drafts) if (d.id != null) removals.add(d.id);

  const keptPlaylists = playlist.rows.filter((r) => !removals.has(r.playlist_id as number));
  const keptEntries = playlistContent.rows.filter(
    (r) => !removals.has(r.playlist_id as number)
  );

  let nextId = Math.max(0, ...playlist.rows.map((r) => (r.playlist_id as number) ?? 0)) + 1;
  let nextSeq = Math.max(0, ...playlist.rows.map((r) => (r.sequenceNo as number) ?? 0)) + 1;

  for (const draft of drafts) {
    const id = draft.id ?? nextId++;
    keptPlaylists.push({
      playlist_id: id,
      sequenceNo: nextSeq++,
      name: draft.name,
      image_id: null,
      // 0 is what rekordbox writes for an ordinary playlist. Folder semantics
      // are undocumented, so we only ever create leaves.
      attribute: 0,
      playlist_id_parent: draft.parentId ?? 0,
    });
    draft.trackIds.forEach((contentId, i) => {
      keptEntries.push({
        playlist_id: id,
        content_id: contentId,
        sequenceNo: i + 1, // sequenceNo is 1-based
      });
    });
  }

  playlist.rows = keptPlaylists;
  playlistContent.rows = keptEntries;

  // `playlist_content` has no INTEGER PRIMARY KEY, so its rowids are positional
  // and must be renumbered after edits or the writer will collide them.
  playlistContent.rows.forEach((r, i) => {
    r.__rowid = i + 1;
  });
  playlist.rows.forEach((r) => {
    r.__rowid = r.playlist_id as number;
  });

  const rebuilt = writeDatabase(
    tables.map((t) => ({
      name: t.name,
      sql: t.sql,
      rows: t.rows,
      columns: t.columns,
      rowidAlias: t.rowidAlias,
    }))
  );

  if (rebuilt.length % PAGE_SIZE !== 0) {
    throw new OneLibraryError(
      'The rebuilt database is not a whole number of pages. Nothing has been written.'
    );
  }

  // Reuse the original salt so the passphrase-derived key stays valid.
  const out = await encrypt(rebuilt, passphrase, { salt });

  // Verify in memory before anyone writes this to a drive.
  let verified: RekordboxDatabase;
  try {
    const check = await decrypt(out, passphrase);
    verified = readOneLibraryImage(check);
  } catch (err) {
    throw new OneLibraryError(
      `The rebuilt database failed its own verification (${(err as Error).message}). ` +
        'Nothing has been written to your drive.'
    );
  }

  return {
    encrypted: out,
    verified,
    playlistCount: keptPlaylists.length,
    entryCount: keptEntries.length,
  };
}
