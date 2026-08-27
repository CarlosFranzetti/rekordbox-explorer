/**
 * Read a OneLibrary device database into the app's own model.
 *
 * OneLibrary (formerly Device Library Plus) is the format AlphaTheta shipped in
 * October 2025 for the CDJ-3000X, XDJ-AZ, OPUS-QUAD, OMNIS-DUO and CDJ-3000 on
 * firmware 3.15+. It is a SQLCipher-encrypted SQLite database at
 * `PIONEER/rekordbox/exportLibrary.db`.
 *
 * It does **not** replace the legacy tree — rekordbox writes `export.pdb`
 * alongside it, and AlphaTheta's own UI says that when a device carries both,
 * OneLibrary wins. So a drive can have either, or both, and the two can
 * disagree. `loadOneLibrary` reads one file; deciding which library a device
 * should present is the caller's job.
 *
 * Decryption is WebCrypto only — no WASM, no native module, no server. See
 * `sqlcipher.ts`.
 *
 * ## The WAL trap
 *
 * rekordbox leaves most of a fresh export in the write-ahead log. A 118 KB
 * `exportLibrary.db` beside a 1.1 MB `exportLibrary.db-wal` is normal, and
 * opening the main file alone reports a nearly empty library **with no error**.
 * We cannot replay a WAL here, so `loadOneLibrary` reports the `-wal` size it
 * was told about and callers surface it: a silently-empty library is a far
 * worse outcome than an honest warning.
 */

import { decrypt, DEFAULT_KEY, DecryptError } from '@/lib/onelibrary/sqlcipher';
import { SQLiteDatabase } from '@/lib/onelibrary/sqlite';
import type { Track, Playlist, RekordboxDatabase } from '@/types/rekordbox';

export const ONELIBRARY_RELPATH = ['PIONEER', 'rekordbox', 'exportLibrary.db'] as const;

export class OneLibraryError extends Error {}

/** A row of `content`, as far as we rely on it. */
interface ContentRow {
  content_id: number;
  title: string | null;
  bpmx100: number | null;
  length: number | null;
  rating: number | null;
  path: string | null;
  bitrate: number | null;
  releaseYear: number | null;
  dateAdded: string | null;
  artist_id_artist: number | null;
  album_id: number | null;
  genre_id: number | null;
  label_id: number | null;
  key_id: number | null;
}

export interface OneLibraryLoadResult {
  database: RekordboxDatabase;
  /** Set when a `-wal` file exists, so the caller can warn about missing rows. */
  walWarning?: string;
}

/** Build an id -> name map from one of the lookup tables. */
function lookup(db: SQLiteDatabase, table: string, idCol: string, nameCol: string): Map<number, string> {
  const out = new Map<number, string>();
  try {
    for (const row of db.select(table) as Record<string, unknown>[]) {
      const id = row[idCol];
      const name = row[nameCol];
      if (typeof id === 'number' && typeof name === 'string') out.set(id, name);
    }
  } catch {
    // Lookup tables hold only values referenced by exported tracks, and an
    // export with no labels legitimately has no rows. A missing table is not
    // worth failing a whole library over.
  }
  return out;
}

function toDate(value: string | null): Date {
  if (!value) return new Date(0);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

/**
 * Turn a decrypted OneLibrary image into tracks and playlists.
 *
 * Field semantics come from the OneLibrary spec:
 * - `bpmx100` is centi-BPM: 12400 is 124.00 BPM.
 * - `length` is whole seconds.
 * - `rating` is already 0–5, **not** the 0/51/…/255 encoding the PDB uses.
 * - `path` is device-relative POSIX, e.g. `/Contents/Artist/Album/Track.mp3`.
 */
export function readOneLibraryImage(image: Uint8Array): RekordboxDatabase {
  let db: SQLiteDatabase;
  try {
    db = new SQLiteDatabase(image);
  } catch (err) {
    throw new OneLibraryError(
      `The OneLibrary database decrypted but could not be read (${(err as Error).message}).`
    );
  }

  const artists = lookup(db, 'artist', 'artist_id', 'name');
  const albums = lookup(db, 'album', 'album_id', 'name');
  const genres = lookup(db, 'genre', 'genre_id', 'name');
  const labels = lookup(db, 'label', 'label_id', 'name');
  const keys = lookup(db, 'key', 'key_id', 'name');

  const contentRows = db.select('content') as unknown as ContentRow[];
  const tracks: Track[] = contentRows.map((r) => ({
    id: r.content_id,
    title: r.title ?? '',
    artist: (r.artist_id_artist != null && artists.get(r.artist_id_artist)) || '',
    album: (r.album_id != null && albums.get(r.album_id)) || '',
    genre: (r.genre_id != null && genres.get(r.genre_id)) || '',
    duration: r.length ?? 0,
    // centi-BPM -> BPM.
    bpm: r.bpmx100 ? r.bpmx100 / 100 : 0,
    key: (r.key_id != null && keys.get(r.key_id)) || '',
    // Already 0-5 here, unlike the PDB's 0/51/102/153/204/255.
    rating: r.rating ?? 0,
    bitrate: r.bitrate ?? 0,
    filePath: r.path ?? '',
    dateAdded: toDate(r.dateAdded),
    label: (r.label_id != null && labels.get(r.label_id)) || undefined,
    year: r.releaseYear ?? undefined,
  }));

  // Playlists: a self-referential tree plus an ordered membership table.
  const entries = new Map<number, { contentId: number; seq: number }[]>();
  try {
    for (const row of db.select('playlist_content') as Record<string, number>[]) {
      const list = entries.get(row.playlist_id) ?? [];
      list.push({ contentId: row.content_id, seq: row.sequenceNo ?? 0 });
      entries.set(row.playlist_id, list);
    }
  } catch {
    // A device with no playlists has no rows; not an error.
  }

  const flat = new Map<number, Playlist>();
  let playlistRows: Record<string, unknown>[] = [];
  try {
    playlistRows = db.select('playlist') as Record<string, unknown>[];
  } catch {
    playlistRows = [];
  }

  for (const row of playlistRows) {
    const id = row.playlist_id as number;
    const parentRaw = row.playlist_id_parent as number | null;
    const own = (entries.get(id) ?? []).sort((a, b) => a.seq - b.seq).map((e) => e.contentId);
    flat.set(id, {
      id,
      name: (row.name as string) ?? '',
      // rekordbox uses 0 (and sometimes null) for "top level".
      parentId: parentRaw && parentRaw !== 0 ? parentRaw : null,
      // `attribute` is the folder/leaf discriminator but its exact values are
      // undocumented, so infer: anything that owns tracks is a playlist.
      isFolder: own.length === 0 && playlistRows.some((r) => r.playlist_id_parent === id),
      children: [],
      trackIds: own,
    });
  }

  // Link children to parents, dropping parent references that do not resolve
  // rather than losing the playlist entirely.
  const roots: Playlist[] = [];
  for (const pl of flat.values()) {
    const parent = pl.parentId != null ? flat.get(pl.parentId) : undefined;
    if (parent) parent.children.push(pl);
    else roots.push({ ...pl, parentId: null });
  }
  // `roots` holds copies, so re-resolve children from the live map.
  const resolvedRoots = roots.map((r) => flat.get(r.id) ?? r);

  const bySeq = (a: Playlist, b: Playlist) => a.name.localeCompare(b.name);
  resolvedRoots.sort(bySeq);
  for (const pl of flat.values()) pl.children.sort(bySeq);

  return { tracks, playlists: resolvedRoots };
}

/**
 * Decrypt and read `exportLibrary.db`.
 *
 * @param encrypted raw bytes of the file
 * @param opts.passphrase override the built-in rekordbox passphrase
 * @param opts.walBytes  size of any sibling `exportLibrary.db-wal`, for the warning
 */
export async function loadOneLibrary(
  encrypted: Uint8Array,
  opts: { passphrase?: string; walBytes?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<OneLibraryLoadResult> {
  let image: Uint8Array;
  try {
    image = await decrypt(encrypted, opts.passphrase ?? DEFAULT_KEY, opts.onProgress);
  } catch (err) {
    if (err instanceof DecryptError) {
      throw new OneLibraryError(
        'This OneLibrary database could not be decrypted. Your drive is untouched. ' +
          'That usually means it was written by a newer rekordbox than this app knows about — ' +
          'the legacy export.pdb on the same drive should still open.'
      );
    }
    throw err;
  }

  const database = readOneLibraryImage(image);

  let walWarning: string | undefined;
  if (opts.walBytes && opts.walBytes > 0) {
    walWarning =
      `This library has an unflushed write-ahead log (${Math.round(opts.walBytes / 1024)} KB) ` +
      'that this app cannot replay, so some tracks or playlists may be missing from what you see. ' +
      'Re-eject the drive from rekordbox to flush it. Nothing has been written to your drive.';
  }

  return { database, walWarning };
}
