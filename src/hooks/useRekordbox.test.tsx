import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import type { ChangeEvent } from 'react';
import { useRekordbox } from './useRekordbox';
import * as parser from '@/lib/rekordbox-parser';
import { render, cleanup } from '@/test/render';
import type { Track } from '@/types/rekordbox';

// The parser has its own coverage. What matters here is what the hook does with
// the tracks once it has them.
vi.mock('@/lib/rekordbox-parser', async (importOriginal) => ({
  ...(await importOriginal<typeof parser>()),
  parseRekordboxDatabaseFromFile: vi.fn(),
}));

const track = (id: number, fields: Partial<Track> = {}): Track => ({
  id,
  title: `Track ${id}`,
  artist: '',
  album: '',
  genre: '',
  duration: 0,
  bpm: 0,
  key: '',
  rating: 0,
  bitrate: 0,
  filePath: '',
  dateAdded: new Date(0),
  ...fields,
});

let hook: ReturnType<typeof useRekordbox>;

function Probe() {
  hook = useRekordbox();
  return null;
}

async function loadLibrary(rows: Partial<Track>[]) {
  vi.mocked(parser.parseRekordboxDatabaseFromFile).mockResolvedValue({
    tracks: rows.map((fields, i) => track(i + 1, fields)),
    playlists: [],
  });
  render(<Probe />);

  // Just enough of a PDB header (the page length at 0x04) to pass the
  // wrong-file check; the parser itself is the mock above. A stand-in rather
  // than a real File because jsdom's Blob has no arrayBuffer().
  const head = new Uint8Array(256);
  new DataView(head.buffer).setUint32(0x04, 4096, true);
  const file = { name: 'export.pdb', slice: () => ({ arrayBuffer: async () => head.buffer }) } as unknown as File;

  await act(async () => {
    await hook.handleFileInput({ target: { files: [file], value: '' } } as unknown as ChangeEvent<HTMLInputElement>);
  });

  // Fail here, with the reason, rather than later as an unexplained empty list.
  expect(hook.status).toMatchObject({ type: 'valid' });
}

const keys = () => hook.getFilteredTracks().map((t) => t.key);

const sortByKey = () =>
  act(() => {
    hook.handleSort('key');
  });

describe('sorting by key', () => {
  afterEach(cleanup);

  it('runs Camelot keys by number, then letter, rather than as text', async () => {
    await loadLibrary(['10A', '2B', '1B', '8A', '11B', '2A'].map((key) => ({ key })));
    sortByKey();
    // Compared as plain text this would come out 10A, 11B, 1B, 2A, 2B, 8A.
    expect(keys()).toEqual(['1B', '2A', '2B', '8A', '10A', '11B']);
  });

  it('reverses on the second click', async () => {
    await loadLibrary(['10A', '2B', '1B', '8A', '11B', '2A'].map((key) => ({ key })));
    sortByKey();
    sortByKey();
    expect(keys()).toEqual(['11B', '10A', '8A', '2B', '2A', '1B']);
  });

  it('still orders keys written as note names', async () => {
    await loadLibrary(['Fm', 'Am', 'C', 'Abm'].map((key) => ({ key })));
    sortByKey();
    expect(keys()).toEqual(['Abm', 'Am', 'C', 'Fm']);
  });
});

// Both of these headers were clickable and sorted nothing: handleSort set the
// column, the comparator had no case for it, and `comparison` stayed 0. The
// arrow moved and the rows did not. Nothing failed, which is why it survived.
describe('sorting by year', () => {
  afterEach(cleanup);

  const years = () => hook.getFilteredTracks().map((t) => t.year);

  it('orders numerically, not as text', async () => {
    await loadLibrary([{ year: 1999 }, { year: 2024 }, { year: 1988 }, { year: 2003 }]);
    act(() => hook.handleSort('year'));
    expect(years()).toEqual([1988, 1999, 2003, 2024]);
  });

  it('reverses on the second click', async () => {
    await loadLibrary([{ year: 1999 }, { year: 2024 }, { year: 1988 }]);
    act(() => hook.handleSort('year'));
    act(() => hook.handleSort('year'));
    expect(years()).toEqual([2024, 1999, 1988]);
  });

  it('puts a missing year first ascending, where an unanalysed BPM goes', async () => {
    await loadLibrary([{ year: 1999 }, {}, { year: 1988 }]);
    act(() => hook.handleSort('year'));
    expect(years()).toEqual([undefined, 1988, 1999]);
  });
});

describe('sorting by label', () => {
  afterEach(cleanup);

  const labels = () => hook.getFilteredTracks().map((t) => t.label);

  it('orders alphabetically', async () => {
    await loadLibrary([{ label: 'Warp' }, { label: 'Axis' }, { label: 'Peacefrog' }]);
    act(() => hook.handleSort('label'));
    expect(labels()).toEqual(['Axis', 'Peacefrog', 'Warp']);
  });

  it('does not throw on a missing label, and sorts it first', async () => {
    await loadLibrary([{ label: 'Warp' }, {}, { label: 'Axis' }]);
    act(() => hook.handleSort('label'));
    expect(labels()).toEqual([undefined, 'Axis', 'Warp']);
  });
});
