import { describe, it, expect, beforeEach, vi } from 'vitest';
import autoTable from 'jspdf-autotable';
import { exportTracksToPdf } from './pdf-export';
import type { Track } from '@/types/rekordbox';

// Nothing here needs a real PDF; what is checked is the table handed to jsPDF.
vi.mock('jspdf', () => ({
  jsPDF: class {
    setFontSize() {}
    setTextColor() {}
    text() {}
    save() {}
  },
}));
vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));

const tracks: Track[] = [
  {
    id: 1,
    title: 'Afterglow',
    artist: 'Artist',
    album: 'Album',
    genre: 'House',
    duration: 300,
    bpm: 124,
    key: '8A',
    rating: 0,
    bitrate: 320,
    filePath: '/Contents/Afterglow.mp3',
    dateAdded: new Date(0),
  },
];

function tableFor(hiddenColumns: string[]) {
  exportTracksToPdf(tracks, 'Set', hiddenColumns);
  const { head, body } = vi.mocked(autoTable).mock.calls[0][1];
  return { head: head?.[0] as string[], row: body[0] as string[] };
}

describe('exportTracksToPdf Key column', () => {
  beforeEach(() => {
    vi.mocked(autoTable).mockClear();
  });

  it('prints the key straight after BPM', () => {
    const { head, row } = tableFor([]);
    expect(head.indexOf('Key')).toBe(head.indexOf('BPM') + 1);
    expect(row[head.indexOf('Key')]).toBe('8A');
  });

  it('leaves it out when the column is hidden, as the table does', () => {
    const { head, row } = tableFor(['key']);
    expect(head).not.toContain('Key');
    expect(row).toHaveLength(head.length);
  });
});
