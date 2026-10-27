import { describe, it, expect } from 'vitest';
import { toRekordboxXml, countEntries } from './xml';
import type { Playlist, RekordboxDatabase, Track } from '@/types/rekordbox';

/**
 * This emitter is the only thing recovery produces — the whole feature ends at
 * a file a DJ imports into rekordbox. A silent defect here is a library that
 * comes back wrong rather than not at all, which is harder to notice and worse
 * to live with.
 */

const track = (fields: Partial<Track> = {}): Track => ({
  id: 1,
  title: 'Afterglow',
  artist: 'Quadrant',
  album: 'In Order To Dance',
  genre: 'Techno',
  duration: 463,
  bpm: 128,
  key: '8A',
  rating: 0,
  bitrate: 1411,
  filePath: '/Contents/Quadrant/Afterglow.aiff',
  dateAdded: new Date(0),
  ...fields,
});

const playlist = (fields: Partial<Playlist> = {}): Playlist => ({
  id: 1,
  name: 'Friday',
  parentId: null,
  isFolder: false,
  children: [],
  trackIds: [1],
  ...fields,
});

const build = (db: Partial<RekordboxDatabase>, volumeName = 'LOS02') =>
  toRekordboxXml({ tracks: [], playlists: [], ...db } as RekordboxDatabase, { volumeName });

const ratingOf = (xml: string) => Number(/Rating="(\d+)"/.exec(xml)![1]);

describe('rating encoding', () => {
  // rekordbox XML stores stars as 0/51/102/153/204/255. export.pdb already uses
  // that encoding; OneLibrary and Engine DJ both store a plain 0-5 count. Passed
  // through unchanged, a five-star track recovered from Engine reached rekordbox
  // as zero stars — and Engine is what recovered the drive this was built for.
  it('scales a 0-5 star count to the encoding rekordbox reads', () => {
    expect(ratingOf(build({ tracks: [track({ rating: 5 })] }))).toBe(255);
    expect(ratingOf(build({ tracks: [track({ rating: 3 })] }))).toBe(153);
    expect(ratingOf(build({ tracks: [track({ rating: 1 })] }))).toBe(51);
  });

  it('leaves an already-encoded PDB rating alone', () => {
    expect(ratingOf(build({ tracks: [track({ rating: 255 })] }))).toBe(255);
    expect(ratingOf(build({ tracks: [track({ rating: 153 })] }))).toBe(153);
    expect(ratingOf(build({ tracks: [track({ rating: 51 })] }))).toBe(51);
  });

  it('treats zero and a missing rating as unrated either way', () => {
    expect(ratingOf(build({ tracks: [track({ rating: 0 })] }))).toBe(0);
    expect(ratingOf(build({ tracks: [track({ rating: undefined })] }))).toBe(0);
  });

  it('never emits a value a player would reject', () => {
    // Whatever a damaged source hands us, the attribute stays in range.
    for (const rating of [0, 1, 5, 6, 51, 255, 300, -2, 4.4]) {
      const value = ratingOf(build({ tracks: [track({ rating })] }));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('toRekordboxXml', () => {
  it('declares entry counts that match the elements it writes', () => {
    const xml = build({
      tracks: [track({ id: 1 }), track({ id: 2 })],
      playlists: [playlist({ trackIds: [1, 2] })],
    });
    expect(/<COLLECTION Entries="(\d+)"/.exec(xml)![1]).toBe('2');
    expect(/<NODE Name="Friday" Type="1" KeyType="0" Entries="(\d+)"/.exec(xml)![1]).toBe('2');
  });

  it('escapes metadata that would otherwise break the document', () => {
    const xml = build({ tracks: [track({ title: 'Fish & Chips <mix>', artist: 'A "B"' })] });
    expect(xml).toContain('Fish &amp; Chips &lt;mix&gt;');
    expect(xml).not.toContain('<mix>');
    expect(xml).toContain('&quot;B&quot;');
  });

  it('strips control characters, which XML 1.0 cannot carry even escaped', () => {
    const xml = build({ tracks: [track({ title: 'Bad\u0001Title\u0008' })] });
    expect(xml).toContain('BadTitle');
    // Matching them is the assertion, same as in xml.ts itself.
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)).toBe(false);
  });

  it('builds a volume-absolute location with each path segment encoded', () => {
    const xml = build({ tracks: [track({ filePath: '/Contents/Some Artist/Track #1.aiff' })] }, 'MY DRIVE');
    expect(xml).toContain('Location="file://localhost/Volumes/MY%20DRIVE/Contents/Some%20Artist/Track%20%231.aiff"');
    // Separators must survive encoding, or every track imports as missing.
    expect(xml).not.toContain('%2F');
  });

  it('nests folders so the playlist tree survives the round trip', () => {
    const xml = build({
      tracks: [track()],
      playlists: [
        playlist({
          id: 10,
          name: 'Gigs',
          isFolder: true,
          trackIds: [],
          children: [playlist({ id: 11, name: 'Berlin', trackIds: [1] })],
        }),
      ],
    });
    expect(xml.indexOf('Name="Gigs"')).toBeLessThan(xml.indexOf('Name="Berlin"'));
    expect(xml).toContain('<TRACK Key="1"/>');
  });

  it('emits a parseable document', () => {
    const xml = build({ tracks: [track()], playlists: [playlist()] });
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('COLLECTION > TRACK')).toHaveLength(1);
  });
});

describe('countEntries', () => {
  it('counts track references through nested folders', () => {
    expect(
      countEntries([
        playlist({ id: 1, trackIds: [1, 2] }),
        playlist({
          id: 2,
          isFolder: true,
          trackIds: [],
          children: [playlist({ id: 3, trackIds: [3, 4, 5] })],
        }),
      ])
    ).toBe(5);
  });
});
