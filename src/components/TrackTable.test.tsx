import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { TrackTable } from './TrackTable';
import { render, cleanup } from '@/test/render';
import type { Track } from '@/types/rekordbox';

const track = (id: number, key: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  album: 'Album',
  genre: 'House',
  duration: 300,
  bpm: 124,
  key,
  rating: 0,
  bitrate: 320,
  filePath: `/Contents/${id}.mp3`,
  dateAdded: new Date(0),
});

const props = {
  tracks: [track(1, '8A'), track(2, '11B'), track(3, 'Fm')],
  sortColumn: 'title' as const,
  sortDirection: 'asc' as const,
  onSort: vi.fn(),
  hiddenColumns: [] as string[],
};

const headers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);

const header = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('thead th')).find((th) => th.textContent === label) as HTMLElement;

describe('TrackTable Key column', () => {
  beforeEach(() => {
    localStorage.clear();
    props.onSort.mockClear();
  });
  afterEach(cleanup);

  it('sits straight after BPM, with each track under its own key', () => {
    const { container } = render(<TrackTable {...props} />);
    const head = headers(container);
    expect(head.indexOf('Key')).toBe(head.indexOf('BPM') + 1);

    // A header with no matching cell renderer would leave this column empty
    // and shove everything after it under the wrong heading.
    const at = head.indexOf('Key');
    const cells = Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.children[at].textContent);
    expect(cells).toEqual(['8A', '11B', 'Fm']);
  });

  it('can be hidden like the other optional columns', () => {
    const { container } = render(<TrackTable {...props} hiddenColumns={['key']} />);
    const head = headers(container);
    expect(head).not.toContain('Key');
    expect(head).toContain('BPM');
    // The rows have to lose the cell as well, or the table skews.
    expect(container.querySelectorAll('tbody tr:first-child td')).toHaveLength(head.length);
  });

  it('asks to sort by key when its header is clicked', () => {
    const { container } = render(<TrackTable {...props} />);
    act(() => {
      header(container, 'Key').click();
    });
    expect(props.onSort).toHaveBeenCalledWith('key');
  });

  it('shows the sort direction on its header while it is the sort column', () => {
    const { container } = render(<TrackTable {...props} sortColumn="key" sortDirection="desc" />);
    expect(header(container, 'Key').querySelector('.lucide-arrow-down')).not.toBeNull();
    expect(header(container, 'Title').querySelector('.lucide-arrow-down')).toBeNull();
  });

  describe('for someone whose layout was saved before it existed', () => {
    const ORDER_KEY = 'rekordbox-column-order';
    const WIDTHS_KEY = 'rekordbox-column-widths';
    const before = ['title', 'artist', 'album', 'genre', 'duration', 'bpm', 'year', 'label'];

    it('puts Key beside BPM instead of at the far end', () => {
      localStorage.setItem(ORDER_KEY, JSON.stringify(before));
      const { container } = render(<TrackTable {...props} />);
      expect(headers(container).slice(5)).toEqual(['BPM', 'Key', 'Year', 'Label']);
    });

    it('keeps it with BPM wherever they have dragged BPM', () => {
      localStorage.setItem(
        ORDER_KEY,
        JSON.stringify(['bpm', 'title', 'artist', 'album', 'genre', 'duration', 'year', 'label'])
      );
      const { container } = render(<TrackTable {...props} />);
      expect(headers(container).slice(0, 3)).toEqual(['BPM', 'Key', 'Title']);
    });

    it('saves the completed order, so a column that was missing can be dragged', () => {
      // handleDrop ignores any column it cannot find in the saved order.
      localStorage.setItem(ORDER_KEY, JSON.stringify(before));
      render(<TrackTable {...props} />);
      expect(JSON.parse(localStorage.getItem(ORDER_KEY) as string)).toContain('key');
    });

    it('starts a resize from its real width rather than a guess', () => {
      localStorage.setItem(
        WIDTHS_KEY,
        JSON.stringify({ title: 280, artist: 200, album: 200, genre: 140, duration: 90, bpm: 80, year: 60, label: 150 })
      );
      const { container } = render(<TrackTable {...props} />);
      const col = container.querySelectorAll('colgroup col')[headers(container).indexOf('Key')] as HTMLElement;
      const start = Number.parseInt(col.style.width, 10);

      const handle = header(container, 'Key').querySelector('.cursor-col-resize') as HTMLElement;
      act(() => {
        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
      });
      act(() => {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 105 }));
      });
      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup'));
      });

      // Five pixels of drag is five pixels of growth, with no jump on the first move.
      expect(Number.parseInt(col.style.width, 10)).toBe(start + 5);
    });
  });
});
