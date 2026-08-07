import { describe, expect, it } from 'vitest';
import {
  TYPE_ALBUMS,
  TYPE_ARTISTS,
  TYPE_GENRES,
  TYPE_KEYS,
  TYPE_LABELS,
  TYPE_PLAYLIST_ENTRIES,
  TYPE_PLAYLIST_TREE,
  TYPE_TRACKS,
  buildPdb,
  encodeAlbumRow,
  encodeArtistRow,
  encodeEntryRow,
  encodeIdNameRow,
  encodeTrackRow,
  encodeTreeRow,
  type TrackFixture,
} from '@/test/fixtures/pdb-fixture';
import {
  formatBpm,
  formatDuration,
  formatFileSize,
  parseRekordboxDatabaseFromBuffer,
} from './rekordbox-parser';

function libraryWith(tracks: TrackFixture[], extra: Parameters<typeof buildPdb>[0] = []) {
  return parseRekordboxDatabaseFromBuffer(
    buildPdb([{ type: TYPE_TRACKS, rows: tracks.map(encodeTrackRow) }, ...extra])
  );
}

describe('track rows', () => {
  it('reads the core fields', () => {
    const db = libraryWith([
      {
        id: 7,
        title: 'Windowlicker',
        filePath: '/Contents/AFX/windowlicker.mp3',
        bpm: 132.5,
        duration: 366,
        bitrate: 320,
        year: 1999,
        rating: 4,
      },
    ]);

    expect(db.tracks).toHaveLength(1);
    expect(db.tracks[0]).toMatchObject({
      id: 7,
      title: 'Windowlicker',
      filePath: '/Contents/AFX/windowlicker.mp3',
      bpm: 132.5,
      duration: 366,
      bitrate: 320,
      year: 1999,
      rating: 4,
    });
  });

  it('resolves artist, album, genre, key and label by id', () => {
    const db = libraryWith(
      [{ id: 1, title: 'Track', artistId: 11, albumId: 22, genreId: 33, keyId: 44, labelId: 55 }],
      [
        { type: TYPE_ARTISTS, rows: [encodeArtistRow(11, 'Aphex Twin')] },
        { type: TYPE_ALBUMS, rows: [encodeAlbumRow(22, 'Selected Ambient Works')] },
        { type: TYPE_GENRES, rows: [encodeIdNameRow(33, 'IDM')] },
        { type: TYPE_KEYS, rows: [encodeIdNameRow(44, '8A', 8)] },
        { type: TYPE_LABELS, rows: [encodeIdNameRow(55, 'Warp')] },
      ]
    );

    expect(db.tracks[0]).toMatchObject({
      artist: 'Aphex Twin',
      album: 'Selected Ambient Works',
      genre: 'IDM',
      key: '8A',
      label: 'Warp',
    });
  });

  it('reads names stored at a far (16-bit) offset', () => {
    const db = libraryWith(
      [{ id: 1, title: 'Track', artistId: 11, albumId: 22 }],
      [
        { type: TYPE_ARTISTS, rows: [encodeArtistRow(11, 'Far Artist', { far: true })] },
        { type: TYPE_ALBUMS, rows: [encodeAlbumRow(22, 'Far Album', { far: true })] },
      ]
    );

    expect(db.tracks[0].artist).toBe('Far Artist');
    expect(db.tracks[0].album).toBe('Far Album');
  });

  it('falls back to placeholders for missing lookups', () => {
    const db = libraryWith([{ id: 1, title: 'Orphan', artistId: 999, albumId: 999 }]);
    expect(db.tracks[0].artist).toBe('Unknown Artist');
    expect(db.tracks[0].album).toBe('');
  });

  it('handles unicode titles', () => {
    const db = libraryWith([{ id: 1, title: 'Björk — Jóga 🎧' }]);
    expect(db.tracks[0].title).toBe('Björk — Jóga 🎧');
  });

  it('skips rows with a zero id', () => {
    const db = libraryWith([{ id: 0, title: 'Ghost' }, { id: 5, title: 'Real' }]);
    expect(db.tracks.map((t) => t.title)).toEqual(['Real']);
  });

  it('zeroes implausible numeric fields instead of showing nonsense', () => {
    const db = libraryWith([
      { id: 1, title: 'Bad', bpm: 9000, duration: 60000, bitrate: 999999, year: 65535 },
    ]);
    expect(db.tracks[0]).toMatchObject({ bpm: 0, duration: 0, bitrate: 0, year: undefined });
  });

  it('parses dateAdded and tolerates a malformed one', () => {
    const good = libraryWith([{ id: 1, title: 'A', dateAdded: '2026-01-31' }]);
    expect(good.tracks[0].dateAdded.getUTCFullYear()).toBe(2026);

    const bad = libraryWith([{ id: 2, title: 'B', dateAdded: 'not a date' }]);
    expect(Number.isNaN(bad.tracks[0].dateAdded.getTime())).toBe(false);
  });

  it('reads a library spread over many pages', () => {
    const tracks: TrackFixture[] = Array.from({ length: 400 }, (_, i) => ({
      id: i + 1,
      title: `Track ${i + 1}`,
      bpm: 120 + (i % 20),
    }));

    const db = libraryWith(tracks);
    expect(db.tracks).toHaveLength(400);
    expect(db.tracks.map((t) => t.id).sort((a, b) => a - b)[399]).toBe(400);
  });

  it('keeps the last row when a track id repeats', () => {
    const db = libraryWith([
      { id: 1, title: 'First' },
      { id: 1, title: 'Second' },
    ]);
    expect(db.tracks).toHaveLength(1);
    expect(db.tracks[0].title).toBe('Second');
  });
});

describe('playlists', () => {
  const nodes = [
    { id: 1, parentId: 0, sortOrder: 1, isFolder: true, name: 'Gigs' },
    { id: 2, parentId: 1, sortOrder: 1, isFolder: false, name: 'Second Child' },
    { id: 3, parentId: 1, sortOrder: 0, isFolder: false, name: 'First Child' },
    { id: 4, parentId: 0, sortOrder: 0, isFolder: false, name: 'Root Playlist' },
  ];

  const build = (entries: { playlistId: number; trackId: number; entryIndex: number }[]) =>
    parseRekordboxDatabaseFromBuffer(
      buildPdb([
        { type: TYPE_TRACKS, rows: [] },
        { type: TYPE_PLAYLIST_TREE, rows: nodes.map(encodeTreeRow) },
        { type: TYPE_PLAYLIST_ENTRIES, rows: entries.map(encodeEntryRow) },
      ])
    );

  it('nests children under their folder', () => {
    const db = build([]);
    expect(db.playlists.map((p) => p.name)).toEqual(['Root Playlist', 'Gigs']);
    const gigs = db.playlists.find((p) => p.name === 'Gigs')!;
    expect(gigs.isFolder).toBe(true);
    expect(gigs.children.map((c) => c.name)).toEqual(['First Child', 'Second Child']);
  });

  it('sorts by the stored sort order, not by id', () => {
    const db = build([]);
    expect(db.playlists[0].name).toBe('Root Playlist');
  });

  it('orders tracks by entry index, not file order', () => {
    const db = build([
      { playlistId: 2, trackId: 30, entryIndex: 2 },
      { playlistId: 2, trackId: 10, entryIndex: 0 },
      { playlistId: 2, trackId: 20, entryIndex: 1 },
    ]);

    const gigs = db.playlists.find((p) => p.name === 'Gigs')!;
    const child = gigs.children.find((c) => c.id === 2)!;
    expect(child.trackIds).toEqual([10, 20, 30]);
  });

  it('ignores entries referencing playlist 0 or track 0', () => {
    const db = build([
      { playlistId: 0, trackId: 5, entryIndex: 0 },
      { playlistId: 2, trackId: 0, entryIndex: 0 },
      { playlistId: 2, trackId: 9, entryIndex: 1 },
    ]);

    const child = db.playlists
      .find((p) => p.name === 'Gigs')!
      .children.find((c) => c.id === 2)!;
    expect(child.trackIds).toEqual([9]);
  });
});

describe('malformed input', () => {
  it('rejects a file that is too small', () => {
    expect(() => parseRekordboxDatabaseFromBuffer(new ArrayBuffer(8))).toThrow(/too small/i);
  });

  it('rejects an implausible page size', () => {
    const buffer = new ArrayBuffer(4096);
    new DataView(buffer).setUint32(0x04, 3, true);
    expect(() => parseRekordboxDatabaseFromBuffer(buffer)).toThrow(/page length/i);
  });

  it('returns an empty library rather than throwing on a truncated row', () => {
    const buffer = buildPdb([{ type: TYPE_TRACKS, rows: [encodeTrackRow({ id: 1, title: 'A' })] }]);
    const view = new DataView(buffer);
    // Point the row offset at the very end of the page so the row overruns.
    const lenPage = view.getUint32(0x04, true);
    view.setUint16(2 * lenPage + lenPage - 6, lenPage - 0x30, true);

    expect(() => parseRekordboxDatabaseFromBuffer(buffer)).not.toThrow();
  });

  it('ignores rows the presence bitmap marks as absent', () => {
    const buffer = buildPdb([
      {
        type: TYPE_TRACKS,
        rows: [encodeTrackRow({ id: 1, title: 'Kept' }), encodeTrackRow({ id: 2, title: 'Dropped' })],
      },
    ]);
    const view = new DataView(buffer);
    const lenPage = view.getUint32(0x04, true);
    // Clear bit 1 of the row-present flags on the data page.
    const flagsAt = 2 * lenPage + lenPage - 4;
    view.setUint16(flagsAt, view.getUint16(flagsAt, true) & ~0b10, true);

    const db = parseRekordboxDatabaseFromBuffer(buffer);
    expect(db.tracks.map((t) => t.title)).toEqual(['Kept']);
  });

  it('survives a page chain that loops back on itself', () => {
    const tracks: TrackFixture[] = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      title: `T${i}`,
    }));
    const buffer = buildPdb([{ type: TYPE_TRACKS, rows: tracks.map(encodeTrackRow) }]);
    const view = new DataView(buffer);
    const lenPage = view.getUint32(0x04, true);
    view.setUint32(3 * lenPage + 0x0c, 1, true); // page 3 -> page 1

    expect(() => parseRekordboxDatabaseFromBuffer(buffer)).not.toThrow();
  });

  it('handles a database with no tables of interest', () => {
    const db = parseRekordboxDatabaseFromBuffer(buildPdb([{ type: 99, rows: [] }]));
    expect(db.tracks).toEqual([]);
    expect(db.playlists).toEqual([]);
  });
});

describe('formatters', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('--:--');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3600)).toBe('60:00');
  });

  it('formats BPM', () => {
    expect(formatBpm(0)).toBe('--');
    expect(formatBpm(128)).toBe('128.0');
  });

  it('formats file sizes', () => {
    expect(formatFileSize(0)).toBe('--');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });
});
