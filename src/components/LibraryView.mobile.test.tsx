/**
 * The mobile layout is a product decision, not an implementation detail.
 *
 * An earlier version followed the usual mobile convention and put the playlist
 * tree behind a hamburger, while cutting the track table down to three
 * flexible-width columns. On a real phone that rendered as a single stretched
 * "Title" column with no playlists in sight, and it was rejected: the playlist
 * tree *is* the app, and BPM is exactly what you check on a phone.
 *
 * These tests pin the decision so a future "mobile optimisation" cannot quietly
 * reintroduce it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LibraryView } from './LibraryView';
import { MOBILE_BREAKPOINT } from '@/hooks/use-mobile';
import { render, cleanup } from '@/test/render';
import type { RekordboxDatabase, Playlist, Track } from '@/types/rekordbox';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: width < MOBILE_BREAKPOINT,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const track = (id: number, title: string): Track => ({
  id,
  title,
  artist: 'Artist',
  album: 'Album',
  genre: 'House',
  duration: 300,
  bpm: 124,
  key: '8A',
  rating: 4,
  bitrate: 320,
  filePath: `/Contents/${title}.mp3`,
  dateAdded: new Date(0),
});

const playlist = (id: number, name: string): Playlist => ({
  id,
  name,
  parentId: null,
  isFolder: false,
  children: [],
  trackIds: [1],
});

const database: RekordboxDatabase = {
  tracks: [track(1, 'Afterglow'), track(2, '420 High')],
  playlists: [playlist(1, 'MP3'), playlist(2, 'Sifting')],
};

const props = {
  database,
  libraries: { hasLegacy: true, hasPlus: false },
  rootHandle: null,
  selectedPlaylist: null,
  onSelectPlaylist: vi.fn(),
  searchQuery: '',
  onSearchChange: vi.fn(),
  sortColumn: 'title' as const,
  sortDirection: 'asc' as const,
  onSort: vi.fn(),
  filteredTracks: database.tracks,
  fileEntries: [],
  directoryPath: [],
  onNavigateToDirectory: vi.fn(),
  onNavigateUp: vi.fn(),
  onLoadFileEntries: vi.fn(),
  onReset: vi.fn(),
};

// Scoped to the header row: these words also appear as cell values.
const headers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);

/** What a person can actually read: the text of elements with no element children. */
const visibleText = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('*'))
    .filter((el) => el.children.length === 0)
    .map((el) => el.textContent);

describe('LibraryView on a phone-sized viewport', () => {
  beforeEach(() => {
    localStorage.clear();
    // iPhone-ish width, comfortably below the 768px breakpoint.
    setViewportWidth(390);
  });
  afterEach(cleanup);

  it('shows the playlists without needing a menu tap', () => {
    const { container } = render(<LibraryView {...props} />);
    expect(visibleText(container)).toContain('MP3');
    expect(visibleText(container)).toContain('Sifting');
  });

  it('has no hamburger — the sidebar is not hidden behind one', () => {
    const { container } = render(<LibraryView {...props} />);
    const labels = Array.from(container.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label'));
    expect(labels.some((label) => /open library menu/i.test(label as string))).toBe(false);
  });

  it('shows the full column set, not a reduced mobile one', () => {
    const { container } = render(<LibraryView {...props} />);
    expect(headers(container)).toEqual(
      expect.arrayContaining([
        // The three that were the entire mobile set before...
        'Title',
        'Artist',
        'Album',
        // ...and the ones a DJ actually reaches for, which used to be dropped.
        'BPM',
        'Key',
        'Genre',
        'Duration',
      ])
    );
  });

  it('renders the same columns on a phone as on a desktop', () => {
    const { container } = render(<LibraryView {...props} />);
    const mobileHeaders = headers(container);
    cleanup();

    setViewportWidth(1440);
    const desktop = render(<LibraryView {...props} />);
    const desktopHeaders = headers(desktop.container);

    expect(mobileHeaders).toEqual(desktopHeaders);
    expect(mobileHeaders.length).toBeGreaterThan(3);
  });

  it('gives columns real widths so the table scrolls instead of collapsing', () => {
    const { container } = render(<LibraryView {...props} />);
    // A colgroup with widths is what stops Title stretching to fill the screen.
    const cols = container.querySelectorAll('colgroup col');
    expect(cols.length).toBeGreaterThan(3);
    const table = container.querySelector('table');
    expect(table?.className).toContain('table-fixed');
    expect(table?.style.minWidth).toBeTruthy();
  });
});
