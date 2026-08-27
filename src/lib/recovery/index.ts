/**
 * Attempt USB recovery.
 *
 * The strategy, learned from an actual casualty rather than invented: **do not
 * try to repair a broken library. Find an intact one.**
 *
 * A rekordbox stick usually carries several databases, written at different
 * times by different software. When a drive is pulled mid-write, whichever file
 * was open loses its unflushed pages while the others are untouched. On the
 * drive this was built for, all three rekordbox databases were 93–96% unwritten
 * and the Engine DJ library — last written four days earlier — was 99.4%
 * intact. All 52 playlists came back from it.
 *
 * So this scans every library it can find, scores each by how much is genuinely
 * readable, and rebuilds from the healthiest. The output is a rekordbox XML,
 * never a hand-built device database — see `xml.ts` for why.
 *
 * Everything here is **read-only**. Recovery never writes to the drive.
 */

import { assessPdb, assessSqlite, describeSidecar, type Assessment } from './assess';
import { readEngineLibrary, ENGINE_DB_RELPATH, type EngineLibrary } from './engine';
import { toRekordboxXml, countEntries } from './xml';
import { parseRekordboxDatabaseFromFile } from '@/lib/rekordbox-parser';
import { decrypt, DEFAULT_KEY } from '@/lib/onelibrary/sqlcipher';
import { readOneLibraryImage } from '@/lib/onelibrary/reader';
import type { RekordboxDatabase } from '@/types/rekordbox';

export type SourceKind = 'legacy' | 'onelibrary' | 'engine';

export interface RecoverySource {
  kind: SourceKind;
  label: string;
  path: string;
  bytes: number;
  assessment: Assessment;
  /** Notes about a sibling `-journal` / `-wal`. */
  sidecarNotes: string[];
  /** Populated when the source could actually be read. */
  library?: RekordboxDatabase;
  trackCount?: number;
  playlistCount?: number;
  /** Why this source could not be read, when it could not. */
  error?: string;
}

export interface RecoveryReport {
  sources: RecoverySource[];
  /** The source with the most recoverable playlists, if any. */
  best?: RecoverySource;
  /** True when at least one source yielded playlists. */
  recovered: boolean;
  /** Ready-to-download rekordbox XML, when something was recovered. */
  xml?: string;
  summary: string;
  /** What the user should do next, in order. */
  advice: string[];
}

const LEGACY_FILES = [
  { path: ['PIONEER', 'rekordbox', 'export.pdb'], label: 'rekordbox legacy library' },
  { path: ['PIONEER', 'rekordbox', 'EXPORT.PDB'], label: 'rekordbox legacy library' },
  { path: ['PIONEER', 'rekordbox', 'exportExt.pdb'], label: 'rekordbox extension library' },
];
const ONELIBRARY_FILES = [
  { path: ['PIONEER', 'rekordbox', 'exportLibrary.db'], label: 'OneLibrary database' },
];

async function getFile(
  root: FileSystemDirectoryHandle,
  parts: readonly string[]
): Promise<File | null> {
  const names = [...parts];
  const name = names.pop();
  if (!name) return null;
  let dir = root;
  for (const part of names) {
    try {
      dir = await dir.getDirectoryHandle(part, { create: false });
    } catch {
      return null;
    }
  }
  try {
    return await (await dir.getFileHandle(name, { create: false })).getFile();
  } catch {
    return null;
  }
}

async function sidecarNotes(
  root: FileSystemDirectoryHandle,
  parts: readonly string[]
): Promise<string[]> {
  const notes: string[] = [];
  for (const suffix of ['-journal', '-wal']) {
    const sibling = [...parts];
    sibling[sibling.length - 1] += suffix;
    const file = await getFile(root, sibling);
    if (!file) continue;
    const note = describeSidecar(sibling[sibling.length - 1], file.size);
    if (note) notes.push(note);
  }
  return notes;
}

function countPlaylists(db: RekordboxDatabase): number {
  let n = 0;
  const walk = (list: typeof db.playlists) => {
    for (const p of list) {
      if (!p.isFolder) n++;
      walk(p.children);
    }
  };
  walk(db.playlists);
  return n;
}

/**
 * Scan a drive for every library on it and try to read each one.
 *
 * Never throws for a damaged source — a source that cannot be read is reported
 * with its error so the user can see *all* the evidence, which is the point.
 */
export async function attemptRecovery(root: FileSystemDirectoryHandle): Promise<RecoveryReport> {
  const sources: RecoverySource[] = [];

  // 1. Legacy PDB databases.
  for (const { path, label } of LEGACY_FILES) {
    const file = await getFile(root, path);
    if (!file) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const source: RecoverySource = {
      kind: 'legacy',
      label,
      path: path.join('/'),
      bytes: file.size,
      assessment: assessPdb(bytes),
      sidecarNotes: await sidecarNotes(root, path),
    };
    try {
      const db = await parseRekordboxDatabaseFromFile(file);
      source.library = db;
      source.trackCount = db.tracks.length;
      source.playlistCount = countPlaylists(db);
    } catch (err) {
      source.error = err instanceof Error ? err.message : 'Could not be parsed.';
    }
    sources.push(source);
  }

  // 2. OneLibrary — decrypt, then walk whatever survived.
  for (const { path, label } of ONELIBRARY_FILES) {
    const file = await getFile(root, path);
    if (!file) continue;
    const encrypted = new Uint8Array(await file.arrayBuffer());
    const source: RecoverySource = {
      kind: 'onelibrary',
      label,
      path: path.join('/'),
      bytes: file.size,
      assessment: {
        health: 'unreadable',
        completeness: 0,
        pagesPresent: 0,
        pagesExpected: 0,
        pagesBlank: 0,
        summary: 'Not yet assessed.',
        detail: [],
      },
      sidecarNotes: await sidecarNotes(root, path),
    };
    try {
      const image = await decrypt(encrypted, DEFAULT_KEY);
      // Assess the *decrypted* image: encryption hides blank pages entirely.
      source.assessment = assessSqlite(image);
      const db = readOneLibraryImage(image);
      source.library = db;
      source.trackCount = db.tracks.length;
      source.playlistCount = countPlaylists(db);
    } catch (err) {
      source.error = err instanceof Error ? err.message : 'Could not be read.';
    }
    sources.push(source);
  }

  // 3. Engine DJ — the one that saved the drive this was written for.
  {
    const file = await getFile(root, ENGINE_DB_RELPATH);
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const source: RecoverySource = {
        kind: 'engine',
        label: 'Engine DJ library',
        path: ENGINE_DB_RELPATH.join('/'),
        bytes: file.size,
        assessment: assessSqlite(bytes),
        sidecarNotes: await sidecarNotes(root, ENGINE_DB_RELPATH),
      };
      try {
        const db: EngineLibrary = readEngineLibrary(bytes);
        source.library = db;
        source.trackCount = db.tracks.length;
        source.playlistCount = countPlaylists(db);
      } catch (err) {
        source.error = err instanceof Error ? err.message : 'Could not be read.';
      }
      sources.push(source);
    }
  }

  // Rank by playlists recovered, then tracks. Playlists are what cannot be
  // rebuilt by re-scanning a folder of audio; tracks can.
  const usable = sources.filter((s) => (s.playlistCount ?? 0) > 0 || (s.trackCount ?? 0) > 0);
  usable.sort(
    (a, b) => (b.playlistCount ?? 0) - (a.playlistCount ?? 0) || (b.trackCount ?? 0) - (a.trackCount ?? 0)
  );
  const best = usable[0];

  const advice: string[] = [];
  let summary: string;

  if (!sources.length) {
    summary = 'No rekordbox or Engine library was found on this drive.';
    advice.push('Check you selected the drive itself rather than a folder inside it.');
  } else if (!best) {
    summary = 'A library was found on this drive, but none of them could be read.';
    advice.push(
      'Stop writing to this drive. Take a full disk image before anything else — the previous ' +
        'working database may still exist in unallocated space, and every write risks overwriting it.'
    );
    advice.push('If your computer still has this collection in rekordbox, re-exporting is the fastest fix.');
  } else {
    const entries = countEntries(best.library!.playlists);
    summary =
      `Recovered ${best.playlistCount} playlist${best.playlistCount === 1 ? '' : 's'} ` +
      `and ${best.trackCount} tracks from the ${best.label}.`;
    advice.push(
      'Download the rekordbox XML below, then in rekordbox open Preferences → Advanced → Database → ' +
        'rekordbox xml, set it as the imported library, and drag the playlists across from the ' +
        '"rekordbox xml" tree.'
    );
    advice.push(
      'Do not re-export to this drive until you have the playlists back — writing to it can overwrite ' +
        'what is left of the damaged database.'
    );
    if (entries === 0) {
      advice.push('The playlists recovered are empty, so only the track list is usable.');
    }
  }

  const xml = best?.library
    ? toRekordboxXml(best.library, { volumeName: root.name || 'USB' })
    : undefined;

  return { sources, best, recovered: Boolean(best), xml, summary, advice };
}

export { assessPdb, assessSqlite, describeSidecar } from './assess';
export { readEngineLibrary, ENGINE_DB_RELPATH } from './engine';
export { toRekordboxXml, countEntries } from './xml';
export type { Assessment } from './assess';
