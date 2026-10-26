import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { jsPDF } from 'jspdf';
import type { Track } from '@/types/rekordbox';

// The real jsPDF and autotable run here. The export loads them with import(), and a build
// or a type-check cannot show that the two still wire together — a miswired plugin only
// fails when somebody clicks the button. Only save() is replaced, because under Node it
// writes a file instead of starting a browser download.
type Captured = jsPDF & { lastAutoTable: { body: unknown[]; columns: unknown[] } };
const seen = vi.hoisted(() => ({ doc: null as Captured | null, saved: [] as string[] }));

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class CapturingPdf extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      seen.doc = this as unknown as Captured;
      Object.assign(this, {
        save: (filename: string) => {
          seen.saved.push(filename);
        },
      });
    }
  }
  return { ...actual, jsPDF: CapturingPdf };
});

import { exportTracksToPdf } from './pdf-export';

const track = (id: number, title: string, artist: string, key = ''): Track => ({
  id,
  title,
  artist,
  album: `Album ${id}`,
  genre: 'Techno',
  duration: 300 + id,
  bpm: 120 + id,
  key,
  rating: 0,
  bitrate: 1411,
  filePath: '',
  dateAdded: new Date(0),
  year: 2000 + id,
  label: 'Label',
});

// autotable's `columns[].raw` is {dataKey: n}, not the header text, so header order is
// read from the drawn page instead. Cells are emitted left to right, so comparing offsets
// in the content stream compares column positions.
function positionOf(text: string): number {
  return (seen.doc!.output() as string).indexOf(`(${text})`);
}

describe('exportTracksToPdf', () => {
  beforeEach(() => {
    seen.doc = null;
    seen.saved = [];
  });

  it('draws every track through the lazily loaded autotable and saves under a safe name', async () => {
    await exportTracksToPdf([track(1, 'Infinition', 'Quadrant'), track(2, 'Big Fun', 'Inner City')], 'Friday / Warm-up', []);

    expect(seen.saved).toEqual(['friday___warm_up.pdf']);
    // autoTable sets lastAutoTable itself, so its presence shows the plugin function ran.
    expect(seen.doc!.lastAutoTable.body).toHaveLength(2);

    const pdf = seen.doc!.output() as string;
    expect(pdf).toContain('(Infinition)');
    expect(pdf).toContain('(Inner City)');
  });

  it('keeps Title, Artist and Album even when every column is hidden', async () => {
    await exportTracksToPdf(
      [track(1, 'A', 'B')],
      'Set',
      ['title', 'artist', 'album', 'genre', 'bpm', 'key', 'label', 'year', 'duration']
    );
    expect(seen.doc!.lastAutoTable.columns).toHaveLength(3);
  });

  it('shows all nine columns when none are hidden', async () => {
    await exportTracksToPdf([track(1, 'A', 'B')], 'Set');
    expect(seen.doc!.lastAutoTable.columns).toHaveLength(9);
  });

  it('adds pages for a long playlist, so autotable is driving the same jsPDF instance', async () => {
    const tracks = Array.from({ length: 150 }, (_, i) => track(i + 1, `Track ${i + 1}`, 'Artist'));
    await exportTracksToPdf(tracks, 'Long', []);

    expect(seen.doc!.lastAutoTable.body).toHaveLength(150);
    expect(seen.doc!.getNumberOfPages()).toBeGreaterThan(1);
  });

  // The Key column is only useful next to the tempo — a DJ reads the two together.
  it('prints Key straight after BPM, with the value', async () => {
    await exportTracksToPdf([track(1, 'Afterglow', 'Artist', '8A')], 'Set', []);

    expect(positionOf('BPM')).toBeGreaterThan(-1);
    expect(positionOf('Key')).toBeGreaterThan(positionOf('BPM'));
    expect(positionOf('Label')).toBeGreaterThan(positionOf('Key'));
    expect(seen.doc!.output() as string).toContain('(8A)');
  });

  it('leaves Key out when the column is hidden, as the table does', async () => {
    await exportTracksToPdf([track(1, 'Afterglow', 'Artist', '8A')], 'Set', ['key']);

    expect(positionOf('Key')).toBe(-1);
    expect(seen.doc!.output() as string).not.toContain('(8A)');
    expect(seen.doc!.lastAutoTable.columns).toHaveLength(8);
  });
});
