import { describe, it, expect } from 'vitest';
import {
  checkDrive,
  describeCompatibility,
  comparePlaylists,
  type DriveCheck,
} from './library-check';
import type { RekordboxDatabase, Playlist } from '@/types/rekordbox';

/* ---------- a minimal in-memory File System Access tree ---------- */

interface Node {
  [name: string]: Node | number; // directory | file size
}

function makeDir(tree: Node, name = 'root'): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async getDirectoryHandle(child: string) {
      const next = tree[child];
      if (next === undefined || typeof next === 'number') throw new Error('NotFound');
      return makeDir(next, child);
    },
    async getFileHandle(child: string) {
      const entry = tree[child];
      if (entry === undefined || typeof entry !== 'number') throw new Error('NotFound');
      return { kind: 'file', name: child, async getFile() { return { size: entry }; } };
    },
    async *entries() {
      for (const [k, v] of Object.entries(tree)) {
        yield [k, typeof v === 'number' ? { kind: 'file' } : { kind: 'directory' }];
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

const legacyOnly = makeDir({ PIONEER: { rekordbox: { 'export.pdb': 40960 } } });
const oneLibraryOnly = makeDir({ PIONEER: { rekordbox: { 'exportLibrary.db': 102400 } } });
const both = makeDir({
  PIONEER: { rekordbox: { 'export.pdb': 40960, 'exportLibrary.db': 102400 } },
});
const withWal = makeDir({
  PIONEER: {
    rekordbox: { 'export.pdb': 40960, 'exportLibrary.db': 118000, 'exportLibrary.db-wal': 1_100_000 },
  },
});
const librarySubfolder = makeDir({
  PIONEER: { rekordbox: { library: { 'something.db': 51200 } } },
});
const emptyPioneer = makeDir({ PIONEER: {} });
const notRekordbox = makeDir({ Music: { 'a.mp3': 100 } });

describe('checkDrive', () => {
  it('finds the legacy library', async () => {
    const c = await checkDrive(legacyOnly);
    expect(c.legacy?.path).toBe('PIONEER/rekordbox/export.pdb');
    expect(c.legacy?.bytes).toBe(40960);
    expect(c.oneLibrary).toBeNull();
  });

  it('finds OneLibrary at the documented path', async () => {
    const c = await checkDrive(oneLibraryOnly);
    expect(c.oneLibrary?.path).toBe('PIONEER/rekordbox/exportLibrary.db');
    expect(c.legacy).toBeNull();
  });

  it('finds a .db inside a library/ subfolder', async () => {
    // Reported in the wild; not in the spec. Detection is permissive because a
    // false negative tells a DJ their stick is legacy-only when it is not.
    const c = await checkDrive(librarySubfolder);
    expect(c.oneLibrary?.path).toBe('PIONEER/rekordbox/library/something.db');
  });

  it('picks up an unflushed write-ahead log', async () => {
    const c = await checkDrive(withWal);
    expect(c.walBytes).toBe(1_100_000);
  });

  it('reports a PIONEER folder with nothing in it', async () => {
    const c = await checkDrive(emptyPioneer);
    expect(c.hasPioneerFolder).toBe(true);
    expect(c.legacy).toBeNull();
    expect(c.oneLibrary).toBeNull();
  });

  it('does not throw on a drive that is not a rekordbox USB', async () => {
    const c = await checkDrive(notRekordbox);
    expect(c.hasPioneerFolder).toBe(false);
  });
});

describe('describeCompatibility', () => {
  const report = async (dir: FileSystemDirectoryHandle) =>
    describeCompatibility(await checkDrive(dir));

  it('warns loudly when a OneLibrary-only stick will not work in older decks', async () => {
    const r = await report(oneLibraryOnly);
    expect(r.olderPlayers).toBe('no');
    expect(r.newerPlayers).toBe('yes');
    expect(r.headline).toMatch(/NOT show up on older CDJs/);
    // Must say how to fix it, not just what is wrong.
    expect(r.warnings.join(' ')).toMatch(/export to this device again/);
  });

  it('passes a drive carrying both libraries', async () => {
    const r = await report(both);
    expect(r.olderPlayers).toBe('yes');
    expect(r.newerPlayers).toBe('yes');
    expect(r.warnings).toHaveLength(0);
  });

  it('accepts a legacy-only drive as working everywhere, with a note', async () => {
    const r = await report(legacyOnly);
    expect(r.olderPlayers).toBe('yes');
    expect(r.newerPlayers).toBe('yes');
    expect(r.warnings.join(' ')).toMatch(/OPUS-QUAD/);
  });

  it('flags an unflushed WAL on a drive that is otherwise fine', async () => {
    const r = await report(withWal);
    expect(r.olderPlayers).toBe('yes');
    expect(r.warnings.join(' ')).toMatch(/write-ahead log/);
    expect(r.warnings.join(' ')).toMatch(/Eject the drive properly/);
  });

  it('says plainly when there is no library at all', async () => {
    const r = await report(emptyPioneer);
    expect(r.olderPlayers).toBe('no');
    expect(r.newerPlayers).toBe('no');
    expect(r.headline).toMatch(/No rekordbox library found/);
  });

  it('distinguishes "not a rekordbox USB" from "empty rekordbox USB"', async () => {
    const r = await report(notRekordbox);
    expect(r.headline).toMatch(/not a rekordbox USB/i);
  });
});

/* ---------- playlist equivalence ---------- */

const pl = (name: string, trackIds: number[], children: Playlist[] = []): Playlist => ({
  id: name.length,
  name,
  parentId: null,
  isFolder: false,
  children,
  trackIds,
});

const folder = (name: string, children: Playlist[]): Playlist => ({
  ...pl(name, []),
  isFolder: true,
  children,
});

const db = (playlists: Playlist[]): RekordboxDatabase => ({ tracks: [], playlists });

describe('comparePlaylists', () => {
  it('reports equivalence when both libraries agree', () => {
    const a = db([pl('Warm Up', [1, 2, 3]), pl('Peak', [4, 5])]);
    const b = db([pl('Peak', [9, 8]), pl('Warm Up', [7, 6, 5])]);
    const r = comparePlaylists(a, b);
    expect(r.equivalent).toBe(true);
    expect(r.summary).toMatch(/same 2 playlists/);
  });

  it('catches a playlist that only older players will see', () => {
    const r = comparePlaylists(db([pl('A', [1]), pl('Secret', [1, 2])]), db([pl('A', [1])]));
    expect(r.equivalent).toBe(false);
    expect(r.onlyInLegacy).toEqual(['Secret']);
    expect(r.summary).toMatch(/different playlists depending on which player/);
  });

  it('catches a playlist that only newer players will see', () => {
    const r = comparePlaylists(db([pl('A', [1])]), db([pl('A', [1]), pl('New', [3])]));
    expect(r.onlyInOneLibrary).toEqual(['New']);
    expect(r.equivalent).toBe(false);
  });

  it('catches the same playlist holding different numbers of tracks', () => {
    const r = comparePlaylists(db([pl('Set', [1, 2, 3])]), db([pl('Set', [1, 2])]));
    expect(r.differingCounts).toEqual([{ name: 'Set', legacyCount: 3, oneLibraryCount: 2 }]);
    expect(r.equivalent).toBe(false);
  });

  it('looks inside folders and ignores the folders themselves', () => {
    const a = db([folder('Crates', [pl('Deep', [1, 2])])]);
    const b = db([pl('Deep', [5, 6])]);
    expect(comparePlaylists(a, b).equivalent).toBe(true);
  });

  it('handles two empty libraries without claiming a match it cannot see', () => {
    const r = comparePlaylists(db([]), db([]));
    expect(r.equivalent).toBe(true);
    expect(r.summary).toMatch(/Neither library has any playlists/);
  });

  it('sums duplicate names so a mismatch surfaces as a count difference', () => {
    // rekordbox allows two playlists with the same name; picking one at random
    // would hide a real difference.
    const a = db([pl('Dupe', [1]), pl('Dupe', [2])]);
    const b = db([pl('Dupe', [1])]);
    const r = comparePlaylists(a, b);
    expect(r.differingCounts).toEqual([{ name: 'Dupe', legacyCount: 2, oneLibraryCount: 1 }]);
  });
});
