/**
 * Which decks will this stick actually work in?
 *
 * rekordbox writes two independent libraries and a drive can carry either, both,
 * or a mismatched pair. Players do not fall back:
 *
 * - Older gear reads **only** `PIONEER/rekordbox/export.pdb`.
 * - CDJ-3000X, XDJ-AZ, OPUS-QUAD, OMNIS-DUO and CDJ-3000 on firmware 3.15+
 *   read **OneLibrary**, and prefer it whenever it is present.
 *
 * So the two ways a stick "just doesn't work" in a booth are both detectable
 * before you leave the house:
 *
 * 1. **OneLibrary only** — the drive is invisible to every older CDJ.
 * 2. **Legacy only** — newer gear will read it, but you lose whatever the
 *    newer export would have carried, and some hardware is fussier about it.
 *
 * The third and nastiest case is a drive with **both** where the two disagree,
 * because then the same stick shows different playlists depending on which deck
 * you plug it into. {@link comparePlaylists} exists for that.
 */

import type { RekordboxDatabase, Playlist } from '@/types/rekordbox';

/** Where a library was found, and how big it is. */
export interface LibraryLocation {
  path: string;
  bytes: number;
}

export interface DriveCheck {
  /** `PIONEER/rekordbox/export.pdb` (or `exportExt.pdb`). */
  legacy: LibraryLocation | null;
  /** The OneLibrary database, wherever it turned up. */
  oneLibrary: LibraryLocation | null;
  /** Size of an unflushed `-wal`; non-zero means the OneLibrary read is incomplete. */
  walBytes: number;
  /** True when a `PIONEER` folder exists at all. */
  hasPioneerFolder: boolean;
}

export type PlayerSupport = 'yes' | 'no';

export interface CompatibilityReport {
  /** Older CDJs/XDJs: CDJ-2000NXS2, CDJ-3000, XDJ-1000MK2, XDJ-RX2, XDJ-XZ. */
  olderPlayers: PlayerSupport;
  /** CDJ-3000X, XDJ-AZ, OPUS-QUAD, OMNIS-DUO, CDJ-3000 fw 3.15+. */
  newerPlayers: PlayerSupport;
  /** One line, written for someone standing at a booth. */
  headline: string;
  /** Things worth acting on, most urgent first. Empty when the drive is fine. */
  warnings: string[];
}

/**
 * Every place a OneLibrary database has been observed.
 *
 * The spec says `PIONEER/rekordbox/exportLibrary.db`, but drives in the wild
 * also turn up with a `PIONEER/rekordbox/library/` directory, and older notes
 * referenced `PIONEER/DeviceLibraryPlus/`. Detection is deliberately permissive:
 * a false negative here tells a DJ their stick is legacy-only when it is not,
 * which is exactly the failure this module exists to prevent.
 */
const ONELIBRARY_DIRS: string[][] = [
  ['PIONEER', 'rekordbox'],
  ['PIONEER', 'rekordbox', 'library'],
  ['PIONEER', 'DeviceLibraryPlus'],
];

const LEGACY_NAMES = ['export.pdb', 'exportExt.pdb', 'exportext.pdb'];

async function getDirectory(
  root: FileSystemDirectoryHandle,
  path: string[]
): Promise<FileSystemDirectoryHandle | null> {
  let dir = root;
  for (const part of path) {
    try {
      dir = await dir.getDirectoryHandle(part, { create: false });
    } catch {
      return null;
    }
  }
  return dir;
}

async function sizeOf(dir: FileSystemDirectoryHandle, name: string): Promise<number | null> {
  try {
    const handle = await dir.getFileHandle(name, { create: false });
    const file = await handle.getFile();
    return file.size;
  } catch {
    return null;
  }
}

/**
 * Inspect a drive and report which libraries are on it.
 *
 * Reads only sizes and names — nothing is parsed, decrypted or written here, so
 * this is safe to run the moment a folder is picked.
 */
export async function checkDrive(root: FileSystemDirectoryHandle): Promise<DriveCheck> {
  const rekordboxDir = await getDirectory(root, ['PIONEER', 'rekordbox']);
  const pioneerDir = await getDirectory(root, ['PIONEER']);

  let legacy: LibraryLocation | null = null;
  if (rekordboxDir) {
    for (const name of LEGACY_NAMES) {
      const bytes = await sizeOf(rekordboxDir, name);
      if (bytes !== null) {
        legacy = { path: `PIONEER/rekordbox/${name}`, bytes };
        break;
      }
    }
  }

  let oneLibrary: LibraryLocation | null = null;
  let walBytes = 0;

  for (const dirPath of ONELIBRARY_DIRS) {
    const dir = await getDirectory(root, dirPath);
    if (!dir) continue;

    // The documented name first, then any other .db in the directory — a
    // `library/` folder may name it something we have not seen.
    const bytes = await sizeOf(dir, 'exportLibrary.db');
    if (bytes !== null) {
      oneLibrary = { path: `${dirPath.join('/')}/exportLibrary.db`, bytes };
      walBytes = (await sizeOf(dir, 'exportLibrary.db-wal')) ?? 0;
      break;
    }

    let found: string | null = null;
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file' && name.toLowerCase().endsWith('.db')) {
          found = name;
          break;
        }
      }
    } catch {
      // Directory listing can fail on a permission-limited handle; not fatal.
    }
    if (found) {
      oneLibrary = {
        path: `${dirPath.join('/')}/${found}`,
        bytes: (await sizeOf(dir, found)) ?? 0,
      };
      walBytes = (await sizeOf(dir, `${found}-wal`)) ?? 0;
      break;
    }
  }

  return { legacy, oneLibrary, walBytes, hasPioneerFolder: pioneerDir !== null };
}

/** Turn a {@link DriveCheck} into something worth showing a DJ. */
export function describeCompatibility(check: DriveCheck): CompatibilityReport {
  const { legacy, oneLibrary, walBytes } = check;
  const warnings: string[] = [];

  if (!legacy && !oneLibrary) {
    return {
      olderPlayers: 'no',
      newerPlayers: 'no',
      headline: check.hasPioneerFolder
        ? 'No rekordbox library found on this drive — it will not appear on any player.'
        : 'This is not a rekordbox USB. No PIONEER folder.',
      warnings: check.hasPioneerFolder
        ? ['There is a PIONEER folder but no database inside it. Re-export the drive from rekordbox.']
        : [],
    };
  }

  if (legacy && oneLibrary) {
    if (walBytes > 0) {
      warnings.push(
        `The OneLibrary database has ${Math.round(walBytes / 1024)} KB of unsaved changes in its ` +
          'write-ahead log. Eject the drive properly from rekordbox so they get written, or newer ' +
          'players may not see your most recent edits.'
      );
    }
    return {
      olderPlayers: 'yes',
      newerPlayers: 'yes',
      headline: 'This drive works in both older and newer players.',
      warnings,
    };
  }

  if (oneLibrary && !legacy) {
    warnings.push(
      'To fix it: in rekordbox, export to this device again with the legacy library enabled. ' +
        'Both can live on the same drive at once.'
    );
    if (walBytes > 0) {
      warnings.push(
        `There are also ${Math.round(walBytes / 1024)} KB of unsaved changes in the write-ahead log. ` +
          'Eject the drive properly from rekordbox.'
      );
    }
    return {
      olderPlayers: 'no',
      newerPlayers: 'yes',
      headline:
        'This drive will NOT show up on older CDJs. It only has the newer OneLibrary database.',
      warnings,
    };
  }

  // Legacy only.
  return {
    olderPlayers: 'yes',
    newerPlayers: 'yes',
    headline: 'This drive works in older players, and newer players can read it too.',
    warnings: [
      'It has no OneLibrary database, so on an OPUS-QUAD, OMNIS-DUO, XDJ-AZ or CDJ-3000X it ' +
        'falls back to the legacy library. That normally works, but re-exporting from ' +
        'rekordbox 6.6.11+ adds the newer database if you want the best support.',
    ],
  };
}

/* ------------------------------------------------------------------------- */

export interface PlaylistDifference {
  name: string;
  legacyCount: number;
  oneLibraryCount: number;
}

export interface PlaylistComparison {
  equivalent: boolean;
  /** Playlists present in `export.pdb` but missing from OneLibrary. */
  onlyInLegacy: string[];
  /** Playlists present in OneLibrary but missing from `export.pdb`. */
  onlyInOneLibrary: string[];
  /** Playlists in both, with different track counts. */
  differingCounts: PlaylistDifference[];
  /** One line summarising the result. */
  summary: string;
}

/** Flatten a playlist tree to `name -> track count`, folders excluded. */
function flatten(playlists: Playlist[], into = new Map<string, number>()): Map<string, number> {
  for (const pl of playlists) {
    if (!pl.isFolder) {
      // Duplicate names are legal in rekordbox; sum them so a comparison
      // reports a count mismatch rather than silently picking one.
      into.set(pl.name, (into.get(pl.name) ?? 0) + pl.trackIds.length);
    }
    if (pl.children.length) flatten(pl.children, into);
  }
  return into;
}

/**
 * Compare the playlists in the two databases on one drive.
 *
 * A drive carrying both libraries can carry two different sets of playlists —
 * and because newer players prefer OneLibrary while older ones can only read
 * the legacy file, the same stick then behaves differently in different booths.
 * That is a genuinely confusing failure, and it is invisible without a check
 * like this.
 *
 * Compares by name and track count. It deliberately does not compare track
 * *identity*: the two databases use different id spaces, so equal ids would
 * mean nothing, and matching on file paths is a bigger job than this is worth.
 */
export function comparePlaylists(
  legacy: RekordboxDatabase,
  oneLibrary: RekordboxDatabase
): PlaylistComparison {
  const a = flatten(legacy.playlists);
  const b = flatten(oneLibrary.playlists);

  const onlyInLegacy = [...a.keys()].filter((n) => !b.has(n)).sort();
  const onlyInOneLibrary = [...b.keys()].filter((n) => !a.has(n)).sort();
  const differingCounts: PlaylistDifference[] = [...a.keys()]
    .filter((n) => b.has(n) && a.get(n) !== b.get(n))
    .sort()
    .map((name) => ({
      name,
      legacyCount: a.get(name) ?? 0,
      oneLibraryCount: b.get(name) ?? 0,
    }));

  const equivalent =
    onlyInLegacy.length === 0 && onlyInOneLibrary.length === 0 && differingCounts.length === 0;

  if (equivalent) {
    return {
      equivalent,
      onlyInLegacy,
      onlyInOneLibrary,
      differingCounts,
      summary:
        a.size === 0
          ? 'Neither library has any playlists.'
          : `Both libraries have the same ${a.size} playlist${a.size === 1 ? '' : 's'}.`,
    };
  }

  const parts: string[] = [];
  if (onlyInLegacy.length) parts.push(`${onlyInLegacy.length} only on older players`);
  if (onlyInOneLibrary.length) parts.push(`${onlyInOneLibrary.length} only on newer players`);
  if (differingCounts.length) parts.push(`${differingCounts.length} with different track counts`);

  return {
    equivalent,
    onlyInLegacy,
    onlyInOneLibrary,
    differingCounts,
    summary:
      `The two libraries on this drive do not match — ${parts.join(', ')}. ` +
      'The same stick will show different playlists depending on which player you use.',
  };
}
