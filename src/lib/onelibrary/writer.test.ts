import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decrypt, DEFAULT_KEY } from '@/lib/onelibrary/sqlcipher';
import { SQLiteDatabase } from '@/lib/onelibrary/sqlite';
import { loadOneLibrary } from './reader';
import { applyPlaylistChanges } from './writer';
import { OneLibraryError } from './reader';

const SAMPLE = new Uint8Array(
  readFileSync(resolve(__dirname, '../../test/fixtures/onelibrary-sample.db'))
);

describe('applyPlaylistChanges', () => {
  it('adds a playlist that reads back with its tracks in order', async () => {
    const result = await applyPlaylistChanges(SAMPLE, [
      { name: 'Warm Up', trackIds: [3, 1] },
    ]);

    const added = result.verified.playlists.find((p) => p.name === 'Warm Up');
    expect(added).toBeDefined();
    // Order must be preserved exactly as given, not sorted.
    expect(added!.trackIds).toEqual([3, 1]);

    // The original playlist survives untouched.
    const original = result.verified.playlists.find((p) => p.name === 'Sample Library');
    expect(original!.trackIds).toEqual([1, 2, 3]);
    expect(result.playlistCount).toBe(2);
  });

  it('replaces an existing playlist when given its id', async () => {
    const before = await loadOneLibrary(SAMPLE);
    const existing = before.database.playlists[0];

    const result = await applyPlaylistChanges(SAMPLE, [
      { id: existing.id, name: 'Renamed', trackIds: [2] },
    ]);

    expect(result.playlistCount).toBe(1);
    const pl = result.verified.playlists[0];
    expect(pl.name).toBe('Renamed');
    expect(pl.trackIds).toEqual([2]);
  });

  it('removes a playlist without disturbing the tracks', async () => {
    const before = await loadOneLibrary(SAMPLE);
    const result = await applyPlaylistChanges(SAMPLE, [], {
      removePlaylistIds: [before.database.playlists[0].id],
    });
    expect(result.verified.playlists).toHaveLength(0);
    // Deleting a playlist must never delete music.
    expect(result.verified.tracks).toHaveLength(before.database.tracks.length);
  });

  it('leaves every track row byte-identical', async () => {
    const before = await loadOneLibrary(SAMPLE);
    const result = await applyPlaylistChanges(SAMPLE, [{ name: 'X', trackIds: [1] }]);
    expect(result.verified.tracks).toEqual(before.database.tracks);
  });

  it('does not touch tables it has no business in', async () => {
    const originalImage = await decrypt(SAMPLE, DEFAULT_KEY);
    const originalDb = new SQLiteDatabase(originalImage);

    const result = await applyPlaylistChanges(SAMPLE, [{ name: 'X', trackIds: [1] }]);
    const newDb = new SQLiteDatabase(await decrypt(result.encrypted, DEFAULT_KEY));

    // Same 22 tables, and every table except the two playlist ones is unchanged.
    expect(newDb.tableNames()).toEqual(originalDb.tableNames());
    for (const name of originalDb.tableNames()) {
      if (name === 'playlist' || name === 'playlist_content') continue;
      expect(newDb.select(name), `table ${name} changed`).toEqual(originalDb.select(name));
    }
  });

  it('refuses a playlist referencing a track that is not on the drive', async () => {
    await expect(
      applyPlaylistChanges(SAMPLE, [{ name: 'Ghost', trackIds: [1, 9999] }])
    ).rejects.toThrow(OneLibraryError);
    await expect(
      applyPlaylistChanges(SAMPLE, [{ name: 'Ghost', trackIds: [9999] }])
    ).rejects.toThrow(/Nothing has been written/);
  });

  it('produces output that is still a whole number of SQLCipher pages', async () => {
    const result = await applyPlaylistChanges(SAMPLE, [
      { name: 'A', trackIds: [1, 2, 3] },
      { name: 'B', trackIds: [3] },
    ]);
    expect(result.encrypted.length % 4096).toBe(0);
    expect(result.playlistCount).toBe(3);
    expect(result.entryCount).toBe(3 + 3 + 1);
  });

  it('survives many playlists, forcing the b-tree past one page', async () => {
    const drafts = Array.from({ length: 120 }, (_, i) => ({
      name: `Crate ${i}`,
      trackIds: [((i % 3) + 1)],
    }));
    const result = await applyPlaylistChanges(SAMPLE, drafts);
    expect(result.playlistCount).toBe(121);
    expect(result.verified.playlists.length).toBe(121);
    // Spot-check one that must have landed on a non-root page.
    const c119 = result.verified.playlists.find((p) => p.name === 'Crate 119');
    expect(c119!.trackIds).toEqual([3]);
  });
});
