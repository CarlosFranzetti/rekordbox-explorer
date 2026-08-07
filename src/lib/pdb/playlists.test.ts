import { describe, expect, it } from 'vitest';
import { buildFixturePdb, sampleLibrary } from '@/test/fixtures/pdb-fixture';
import { readFileHeader } from './structure';
import {
  readPlaylistTables,
  verifyWrittenPlaylists,
  writePlaylistTables,
  type PdbPlaylistEntry,
  type PdbPlaylistNode,
} from './playlists';

function sortNodes(nodes: PdbPlaylistNode[]) {
  return [...nodes].sort((a, b) => a.id - b.id);
}

function sortEntries(entries: PdbPlaylistEntry[]) {
  return [...entries].sort(
    (a, b) => a.playlistId - b.playlistId || a.entryIndex - b.entryIndex || a.trackId - b.trackId
  );
}

describe('reading playlist tables', () => {
  it('reads back exactly what the fixture encoded', () => {
    const { nodes, entries } = sampleLibrary();
    const pdb = buildFixturePdb({ nodes, entries });

    const read = readPlaylistTables(pdb);
    expect(sortNodes(read.nodes)).toEqual(sortNodes(nodes));
    expect(sortEntries(read.entries)).toEqual(sortEntries(entries));
  });

  it('reads rows that live in the table first page', () => {
    const { nodes, entries } = sampleLibrary();
    const pdb = buildFixturePdb({ nodes, entries, rowsInFirstPage: true });

    const read = readPlaylistTables(pdb);
    expect(sortNodes(read.nodes)).toEqual(sortNodes(nodes));
    expect(read.entries).toHaveLength(entries.length);
  });

  it('reads a library spanning many pages', () => {
    const nodes: PdbPlaylistNode[] = [
      { id: 1, parentId: 0, sortOrder: 0, isFolder: false, name: 'Big' },
    ];
    const entries: PdbPlaylistEntry[] = Array.from({ length: 5000 }, (_, i) => ({
      playlistId: 1,
      entryIndex: i,
      trackId: i + 1,
    }));

    const read = readPlaylistTables(buildFixturePdb({ nodes, entries }));
    expect(read.entries).toHaveLength(5000);
    expect(sortEntries(read.entries)[4999].trackId).toBe(5000);
  });
});

describe('writing playlist tables', () => {
  it('preserves every original byte and only appends', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries });
    const before = new Uint8Array(source.slice(0));

    const result = writePlaylistTables(source, {
      nodes: [...nodes, { id: 9, parentId: 0, sortOrder: 9, isFolder: false, name: 'New Set' }],
      entries: [...entries, { playlistId: 9, entryIndex: 0, trackId: 777 }],
    });

    // The source buffer itself must be untouched.
    expect(new Uint8Array(source)).toEqual(before);

    // Output grows; the original region changes only in known pointer fields.
    expect(result.buffer.byteLength).toBeGreaterThan(source.byteLength);
    expect(result.bytesAdded % readFileHeader(new DataView(source)).lenPage).toBe(0);

    const after = new Uint8Array(result.buffer, 0, source.byteLength);
    const changed: number[] = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== after[i]) changed.push(i);
    }

    const lenPage = readFileHeader(new DataView(source)).lenPage;
    for (const offset of changed) {
      const withinPage = offset % lenPage;
      const isHeaderPage = offset < lenPage;
      const isFileHeaderField =
        isHeaderPage && ((offset >= 0x0c && offset < 0x10) || (offset >= 0x14 && offset < 0x18));
      const isTablePointer = isHeaderPage && offset >= 0x1c && offset < 0x1c + 2 * 16;
      // next_page / sequence of a grafted chain head
      const isChainGraft = !isHeaderPage && withinPage >= 0x0c && withinPage < 0x14;

      expect(
        isFileHeaderField || isTablePointer || isChainGraft,
        `unexpected byte change at ${offset} (page offset 0x${withinPage.toString(16)})`
      ).toBe(true);
    }
  });

  it('round-trips an unchanged library', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries });

    const result = writePlaylistTables(source, { nodes, entries });
    const read = readPlaylistTables(result.buffer);

    expect(sortNodes(read.nodes)).toEqual(sortNodes(nodes));
    expect(sortEntries(read.entries)).toEqual(sortEntries(entries));
  });

  it('adds a playlist and reads it back', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries });

    const nextNodes = [
      ...nodes,
      { id: 10, parentId: 1, sortOrder: 2, isFolder: false, name: 'Closing 🎧' },
    ];
    const nextEntries = [
      ...entries,
      { playlistId: 10, entryIndex: 0, trackId: 501 },
      { playlistId: 10, entryIndex: 1, trackId: 502 },
    ];

    const result = writePlaylistTables(source, { nodes: nextNodes, entries: nextEntries });
    const read = readPlaylistTables(result.buffer);

    const added = read.nodes.find((n) => n.id === 10);
    expect(added).toMatchObject({ name: 'Closing 🎧', parentId: 1, isFolder: false });
    expect(read.entries.filter((e) => e.playlistId === 10).map((e) => e.trackId)).toEqual([
      501, 502,
    ]);
  });

  it('removes a playlist and its entries', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries });

    const nextNodes = nodes.filter((n) => n.id !== 4);
    const nextEntries = entries.filter((e) => e.playlistId !== 4);

    const read = readPlaylistTables(
      writePlaylistTables(source, { nodes: nextNodes, entries: nextEntries }).buffer
    );

    expect(read.nodes.find((n) => n.id === 4)).toBeUndefined();
    expect(read.entries.some((e) => e.playlistId === 4)).toBe(false);
    expect(read.nodes).toHaveLength(3);
  });

  it('writes an empty playlist table without corrupting the file', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries });

    const result = writePlaylistTables(source, { nodes: [], entries: [] });
    const read = readPlaylistTables(result.buffer);

    expect(read.nodes).toEqual([]);
    expect(read.entries).toEqual([]);
  });

  it('spans multiple pages when a playlist is large', () => {
    const nodes: PdbPlaylistNode[] = [
      { id: 1, parentId: 0, sortOrder: 0, isFolder: false, name: 'Everything' },
    ];
    const source = buildFixturePdb({ nodes, entries: [] });

    const entries: PdbPlaylistEntry[] = Array.from({ length: 4000 }, (_, i) => ({
      playlistId: 1,
      entryIndex: i,
      trackId: i + 1,
    }));

    const result = writePlaylistTables(source, { nodes, entries });
    expect(result.pagesAppended).toBeGreaterThan(10);

    const read = readPlaylistTables(result.buffer);
    expect(read.entries).toHaveLength(4000);
    expect(sortEntries(read.entries).map((e) => e.trackId)).toEqual(
      entries.map((e) => e.trackId)
    );
  });

  it('bumps the file sequence and next_unused_page', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries, sequence: 7 });

    const result = writePlaylistTables(source, { nodes, entries });
    const header = readFileHeader(new DataView(result.buffer));

    expect(header.sequence).toBe(8);
    expect(header.nextUnusedPage).toBe(result.buffer.byteLength / header.lenPage);
  });

  it('keeps names intact across encodings', () => {
    const nodes: PdbPlaylistNode[] = [
      { id: 1, parentId: 0, sortOrder: 0, isFolder: false, name: 'plain' },
      { id: 2, parentId: 0, sortOrder: 1, isFolder: false, name: 'Ω unicode ✓' },
      { id: 3, parentId: 0, sortOrder: 2, isFolder: false, name: 'L'.repeat(200) },
    ];
    const source = buildFixturePdb({ nodes: [], entries: [] });

    const read = readPlaylistTables(
      writePlaylistTables(source, { nodes, entries: [] }).buffer
    );
    expect(sortNodes(read.nodes).map((n) => n.name)).toEqual([
      'plain',
      'Ω unicode ✓',
      'L'.repeat(200),
    ]);
  });
});

describe('write validation', () => {
  const source = () => buildFixturePdb(sampleLibrary());

  it('rejects duplicate playlist ids', () => {
    expect(() =>
      writePlaylistTables(source(), {
        nodes: [
          { id: 1, parentId: 0, sortOrder: 0, isFolder: false, name: 'a' },
          { id: 1, parentId: 0, sortOrder: 1, isFolder: false, name: 'b' },
        ],
        entries: [],
      })
    ).toThrow(/Duplicate playlist id/);
  });

  it('rejects a dangling parent reference', () => {
    expect(() =>
      writePlaylistTables(source(), {
        nodes: [{ id: 1, parentId: 99, sortOrder: 0, isFolder: false, name: 'orphan' }],
        entries: [],
      })
    ).toThrow(/missing parent/);
  });

  it('rejects entries pointing at an unknown playlist', () => {
    expect(() =>
      writePlaylistTables(source(), {
        nodes: [{ id: 1, parentId: 0, sortOrder: 0, isFolder: false, name: 'a' }],
        entries: [{ playlistId: 5, entryIndex: 0, trackId: 1 }],
      })
    ).toThrow(/unknown playlist/);
  });

  it('rejects an empty playlist name', () => {
    expect(() =>
      writePlaylistTables(source(), {
        nodes: [{ id: 1, parentId: 0, sortOrder: 0, isFolder: false, name: '' }],
        entries: [],
      })
    ).toThrow(/name cannot be empty/);
  });

  it('rejects a zero track id', () => {
    expect(() =>
      writePlaylistTables(source(), {
        nodes: [{ id: 1, parentId: 0, sortOrder: 0, isFolder: false, name: 'a' }],
        entries: [{ playlistId: 1, entryIndex: 0, trackId: 0 }],
      })
    ).toThrow(/Invalid track id/);
  });
});

describe('verifyWrittenPlaylists', () => {
  it('passes for a correctly written image', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries });
    const result = writePlaylistTables(source, { nodes, entries });

    expect(verifyWrittenPlaylists(result.buffer, { nodes, entries })).toEqual({ ok: true });
  });

  it('fails when the image does not contain what was intended', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries });
    const result = writePlaylistTables(source, { nodes, entries });

    const verdict = verifyWrittenPlaylists(result.buffer, {
      nodes: [...nodes, { id: 88, parentId: 0, sortOrder: 8, isFolder: false, name: 'ghost' }],
      entries,
    });
    expect(verdict.ok).toBe(false);
  });

  it('fails on a truncated image rather than throwing', () => {
    const { nodes, entries } = sampleLibrary();
    const source = buildFixturePdb({ nodes, entries });
    const verdict = verifyWrittenPlaylists(source.slice(0, 16), { nodes, entries });
    expect(verdict.ok).toBe(false);
  });
});

describe('malformed input handling', () => {
  it('rejects a file that is too small', () => {
    expect(() => readPlaylistTables(new ArrayBuffer(8))).toThrow(/too small/i);
  });

  it('rejects an implausible page length', () => {
    const buffer = new ArrayBuffer(4096);
    new DataView(buffer).setUint32(0x04, 7, true);
    expect(() => readPlaylistTables(buffer)).toThrow(/page length/i);
  });

  it('rejects an implausible table count', () => {
    const buffer = new ArrayBuffer(4096);
    const view = new DataView(buffer);
    view.setUint32(0x04, 4096, true);
    view.setUint32(0x08, 99999, true);
    expect(() => readPlaylistTables(buffer)).toThrow(/table count/i);
  });

  it('does not hang on a page chain that loops', () => {
    const { nodes, entries } = sampleLibrary();
    const buffer = buildFixturePdb({ nodes, entries });
    const view = new DataView(buffer);
    const lenPage = view.getUint32(0x04, true);
    // Point page 2's next_page back at page 1, and widen last_page so the walk
    // would follow the cycle forever if the visited-set guard were missing.
    view.setUint32(2 * lenPage + 0x0c, 1, true);
    view.setUint32(0x1c + 0x0c, 4, true);

    expect(() => readPlaylistTables(buffer)).not.toThrow();
    expect(readPlaylistTables(buffer).nodes.length).toBeGreaterThan(0);
  });
});
