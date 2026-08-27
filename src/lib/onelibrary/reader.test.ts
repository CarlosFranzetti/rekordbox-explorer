import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decrypt, encrypt, DEFAULT_KEY, DecryptError, PAGE_SIZE } from '@/lib/onelibrary/sqlcipher';
import { loadOneLibrary, readOneLibraryImage, OneLibraryError } from './reader';

/**
 * A real SQLCipher-encrypted OneLibrary export, three tracks and one playlist.
 * Audio is Kevin MacLeod, CC BY 4.0. Encrypted with the stock rekordbox
 * passphrase, so this exercises the actual production key path.
 */
const SAMPLE = new Uint8Array(
  readFileSync(resolve(__dirname, '../../test/fixtures/onelibrary-sample.db'))
);

describe('OneLibrary SQLCipher', () => {
  it('decrypts a real export with the stock passphrase', async () => {
    const image = await decrypt(SAMPLE, DEFAULT_KEY);
    expect(new TextDecoder().decode(image.subarray(0, 15))).toBe('SQLite format 3');
    // The decrypted header must describe the geometry used to decrypt it.
    const view = new DataView(image.buffer, image.byteOffset);
    expect(view.getUint16(16)).toBe(PAGE_SIZE);
    expect(image[20]).toBe(80); // reserve = 16-byte IV + 64-byte HMAC-SHA512
  });

  it('rejects a wrong passphrase loudly rather than yielding noise', async () => {
    await expect(decrypt(SAMPLE, 'x'.repeat(64))).rejects.toBeInstanceOf(DecryptError);
  });

  it('round-trips through encrypt without changing the plaintext', async () => {
    const image = await decrypt(SAMPLE, DEFAULT_KEY);
    // Reuse the original salt so the derived key stays valid.
    const reencrypted = await encrypt(image, DEFAULT_KEY, { salt: SAMPLE.subarray(0, 16) });
    expect(reencrypted.length).toBe(SAMPLE.length);
    const again = await decrypt(reencrypted, DEFAULT_KEY);
    expect(Array.from(again)).toEqual(Array.from(image));
  });

  it('refuses a file that is not a whole number of pages', async () => {
    await expect(decrypt(SAMPLE.subarray(0, PAGE_SIZE + 5), DEFAULT_KEY)).rejects.toBeInstanceOf(
      DecryptError
    );
  });
});

describe('readOneLibraryImage', () => {
  it('maps content rows onto tracks with the right units', async () => {
    const { database } = await loadOneLibrary(SAMPLE);
    expect(database.tracks).toHaveLength(3);

    const byTitle = new Map(database.tracks.map((t) => [t.title, t]));
    const electro = byTitle.get('Electrodoodle')!;
    expect(electro).toBeDefined();
    // bpmx100 is centi-BPM: 12000 -> 120.00
    expect(electro.bpm).toBe(120);
    // length is whole seconds, used directly
    expect(electro.duration).toBe(166);
    // rating is already 0-5 here, NOT the PDB's 0/51/102/153/204/255
    expect(electro.rating).toBe(5);
    expect(electro.artist).toBe('Kevin MacLeod');
    expect(electro.album).toBe('Incompetech');
    expect(electro.filePath).toBe('/Contents/Kevin MacLeod/Incompetech/electrodoodle.mp3');

    expect(byTitle.get('Cipher')!.bpm).toBe(150);
    expect(byTitle.get('Cold Funk')!.bpm).toBe(112);
  });

  it('reads the playlist tree with membership in sequence order', async () => {
    const { database } = await loadOneLibrary(SAMPLE);
    expect(database.playlists).toHaveLength(1);
    const pl = database.playlists[0];
    expect(pl.name).toBe('Sample Library');
    expect(pl.parentId).toBeNull();
    expect(pl.isFolder).toBe(false);
    // playlist_content carries (playlist_id, content_id, sequenceNo)
    expect(pl.trackIds).toEqual([1, 2, 3]);
  });

  it('reports no WAL warning when there is no -wal file', async () => {
    const { walWarning } = await loadOneLibrary(SAMPLE);
    expect(walWarning).toBeUndefined();
  });

  it('warns about an unflushed WAL, because the silent failure is worse', async () => {
    const { walWarning } = await loadOneLibrary(SAMPLE, { walBytes: 1_100_000 });
    expect(walWarning).toMatch(/write-ahead log/);
    expect(walWarning).toMatch(/missing/);
    // Must reassure: reading never writes.
    expect(walWarning).toMatch(/Nothing has been written/);
  });

  it('explains a decryption failure without blaming the drive', async () => {
    await expect(loadOneLibrary(SAMPLE, { passphrase: 'wrong'.padEnd(64, 'x') })).rejects.toThrow(
      OneLibraryError
    );
    await expect(
      loadOneLibrary(SAMPLE, { passphrase: 'wrong'.padEnd(64, 'x') })
    ).rejects.toThrow(/drive is untouched/);
  });

  it('throws a typed error rather than crashing on a non-SQLite image', () => {
    expect(() => readOneLibraryImage(new Uint8Array(4096))).toThrow(OneLibraryError);
  });
});
