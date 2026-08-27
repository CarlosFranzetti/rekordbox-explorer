/**
 * Read an Engine DJ library.
 *
 * Not because this app supports Denon gear, but because **a drive that carries
 * more than one library rarely loses both at once.** On the drive this module
 * was written for, all three rekordbox databases were 93–96% unwritten while
 * `Engine Library/Database2/m.db` was four pages short of six hundred and
 * twenty. Every playlist came back from it.
 *
 * Engine stores a plain, unencrypted SQLite database — no key, no WAL games —
 * which makes it the most salvageable thing on a typical dual-format stick.
 *
 * Layout, as of Engine DJ 3.x:
 *
 * ```
 * Engine Library/Database2/
 *   m.db     the library: Track, Playlist, PlaylistEntity
 *   hm.db    history
 *   sm.db    smartlists
 *   stm.db   smartlist state
 * ```
 *
 * `Track.path` is stored relative to the `Engine Library` folder, so a track at
 * `/Contents/A/B.aiff` on the drive appears here as `../Contents/A/B.aiff`.
 */

import { SQLiteDatabase } from '@/lib/onelibrary/sqlite';
import type { Track, Playlist, RekordboxDatabase } from '@/types/rekordbox';

export const ENGINE_DB_RELPATH = ['Engine Library', 'Database2', 'm.db'] as const;

export class EngineError extends Error {}

interface EngineTrack {
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  length: number | null;
  bpm: number | null;
  year: number | null;
  rating: number | null;
  bitrate: number | null;
  path: string | null;
  filename: string | null;
  /** The `sequence` of the `export.pdb` this library was imported from, if any. */
  pdbImportKey: number | null;
}

interface EnginePlaylist {
  id: number;
  title: string | null;
  parentListId: number | null;
}

interface EngineEntity {
  listId: number;
  trackId: number;
}

/** Engine's `Track.path` is relative to `Engine Library/`; make it drive-relative. */
export function normaliseEnginePath(path: string | null): string {
  if (!path) return '';
  const cleaned = path.replace(/^\.\.\//, '');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

export interface EngineLibrary extends RekordboxDatabase {
  /**
   * The `export.pdb` sequence this library was imported from. When it matches
   * the sequence in a damaged `export.pdb`, the two are provably the same
   * library — which is how we know a salvage is not somebody else's music.
   */
  pdbImportKey?: number;
}

/**
 * Parse `m.db` into the app's model.
 *
 * Uses the forgiving b-tree walker rather than a real SQLite engine on purpose:
 * a truncated database is rejected outright by SQLite (`database disk image is
 * malformed`) while the walker simply reads the pages that survived. That
 * difference is what made the original recovery possible.
 */
export function readEngineLibrary(image: Uint8Array): EngineLibrary {
  let db: SQLiteDatabase;
  try {
    db = new SQLiteDatabase(image);
  } catch (err) {
    throw new EngineError(`This Engine library could not be read (${(err as Error).message}).`);
  }

  const table = <T,>(name: string): T[] => {
    try {
      return db.select(name) as unknown as T[];
    } catch {
      // A damaged file may lose one table and keep the rest. Losing the
      // playlists is survivable; losing the tracks is not, and the caller
      // notices that from an empty result.
      return [];
    }
  };

  const engineTracks = table<EngineTrack>('Track');
  const enginePlaylists = table<EnginePlaylist>('Playlist');
  const engineEntities = table<EngineEntity>('PlaylistEntity');

  const tracks: Track[] = engineTracks.map((t) => ({
    id: t.id,
    title: t.title ?? '',
    artist: t.artist ?? '',
    album: t.album ?? '',
    genre: t.genre ?? '',
    duration: Math.round(t.length ?? 0),
    bpm: t.bpm ?? 0,
    // Engine stores key as an index into its own table, not a name; leaving it
    // blank is more honest than emitting a number a DJ cannot read.
    key: '',
    rating: t.rating ?? 0,
    bitrate: t.bitrate ?? 0,
    filePath: normaliseEnginePath(t.path),
    dateAdded: new Date(0),
    year: t.year ?? undefined,
  }));

  const known = new Set(tracks.map((t) => t.id));
  const members = new Map<number, number[]>();
  for (const e of engineEntities) {
    if (!known.has(e.trackId)) continue; // Never point a playlist at a missing track.
    const list = members.get(e.listId) ?? [];
    list.push(e.trackId);
    members.set(e.listId, list);
  }

  const flat = new Map<number, Playlist>();
  for (const p of enginePlaylists) {
    flat.set(p.id, {
      id: p.id,
      name: p.title ?? '',
      parentListId: undefined,
      parentId: p.parentListId && p.parentListId !== 0 ? p.parentListId : null,
      // Engine has no folder flag: a list with children behaves as one.
      isFolder: enginePlaylists.some((q) => q.parentListId === p.id),
      children: [],
      trackIds: members.get(p.id) ?? [],
    } as Playlist);
  }

  const roots: Playlist[] = [];
  for (const pl of flat.values()) {
    const parent = pl.parentId != null ? flat.get(pl.parentId) : undefined;
    if (parent) parent.children.push(pl);
    else roots.push(pl);
  }

  const byName = (a: Playlist, b: Playlist) => a.name.localeCompare(b.name);
  roots.sort(byName);
  for (const pl of flat.values()) pl.children.sort(byName);

  const pdbImportKey = engineTracks.find((t) => t.pdbImportKey)?.pdbImportKey ?? undefined;

  return { tracks, playlists: roots, pdbImportKey: pdbImportKey ?? undefined };
}
