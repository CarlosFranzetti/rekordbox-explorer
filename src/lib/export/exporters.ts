/**
 * Text-format exporters. All pure functions: string in, string out, so every
 * escaping rule below is directly unit-testable.
 */

import type { Playlist, Track } from '@/types/rekordbox';
import { APP_NAME, APP_VERSION } from '@/lib/version';
import { formatBpm, formatDuration } from '@/lib/rekordbox-parser';

export const EXPORT_COLUMNS = [
  'title',
  'artist',
  'album',
  'genre',
  'bpm',
  'key',
  'duration',
  'label',
  'year',
  'rating',
  'bitrate',
  'filePath',
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export const EXPORT_COLUMN_LABEL: Record<ExportColumn, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  genre: 'Genre',
  bpm: 'BPM',
  key: 'Key',
  duration: 'Duration',
  label: 'Label',
  year: 'Year',
  rating: 'Rating',
  bitrate: 'Bitrate',
  filePath: 'File Path',
};

export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = [
  'title',
  'artist',
  'album',
  'genre',
  'bpm',
  'key',
  'duration',
];

export function cellValue(track: Track, column: ExportColumn): string {
  switch (column) {
    case 'title':
      return track.title || '';
    case 'artist':
      return track.artist || '';
    case 'album':
      return track.album || '';
    case 'genre':
      return track.genre || '';
    case 'bpm':
      return track.bpm ? formatBpm(track.bpm) : '';
    case 'key':
      return track.key || '';
    case 'duration':
      return track.duration ? formatDuration(track.duration) : '';
    case 'label':
      return track.label || '';
    case 'year':
      return track.year ? String(track.year) : '';
    case 'rating':
      return track.rating ? String(track.rating) : '';
    case 'bitrate':
      return track.bitrate ? `${track.bitrate} kbps` : '';
    case 'filePath':
      return track.filePath || '';
  }
}

/* ---------------------------------------------------------------------- CSV */

/**
 * Escape a CSV cell.
 *
 * Note the leading apostrophe on cells starting with `= + - @`: track metadata
 * comes from a file we did not write, and spreadsheet apps happily execute a
 * cell beginning with `=` as a formula. Neutralising that is not optional.
 */
export function escapeCsvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function tracksToCsv(tracks: Track[], columns: ExportColumn[] = DEFAULT_EXPORT_COLUMNS): string {
  const header = columns.map((c) => escapeCsvCell(EXPORT_COLUMN_LABEL[c])).join(',');
  const rows = tracks.map((track) =>
    columns.map((column) => escapeCsvCell(cellValue(track, column))).join(',')
  );
  return [header, ...rows].join('\r\n');
}

/* --------------------------------------------------------------------- M3U8 */

/** Extended M3U — readable by Serato, VirtualDJ, Traktor, VLC, Engine DJ. */
export function tracksToM3u8(tracks: Track[], playlistName: string): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${sanitiseLine(playlistName)}`];
  for (const track of tracks) {
    const seconds = Math.round(track.duration || 0);
    const artist = sanitiseLine(track.artist || 'Unknown Artist');
    const title = sanitiseLine(track.title || 'Unknown Title');
    lines.push(`#EXTINF:${seconds},${artist} - ${title}`);
    lines.push(sanitiseLine(track.filePath || `${artist} - ${title}`));
  }
  return lines.join('\n') + '\n';
}

/** Strip newlines so a malicious field cannot forge extra playlist entries. */
function sanitiseLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/* ---------------------------------------------------------------------- TXT */

export function tracksToText(
  tracks: Track[],
  playlistName: string,
  columns: ExportColumn[] = DEFAULT_EXPORT_COLUMNS
): string {
  const header = `${playlistName}\n${'='.repeat(playlistName.length)}\n${tracks.length} track${
    tracks.length === 1 ? '' : 's'
  } · exported ${new Date().toLocaleString()}\n`;

  const widthOf = (column: ExportColumn) =>
    Math.min(
      40,
      Math.max(
        EXPORT_COLUMN_LABEL[column].length,
        ...tracks.map((t) => cellValue(t, column).length),
        3
      )
    );
  const widths = new Map(columns.map((c) => [c, widthOf(c)] as const));

  const pad = (value: string, width: number) =>
    (value.length > width ? `${value.slice(0, width - 1)}…` : value).padEnd(width);

  const numberWidth = String(tracks.length).length;
  const head = `${' '.repeat(numberWidth + 2)}${columns
    .map((c) => pad(EXPORT_COLUMN_LABEL[c], widths.get(c)!))
    .join('  ')}`.trimEnd();

  const body = tracks.map((track, i) => {
    const number = `${String(i + 1).padStart(numberWidth)}. `;
    return `${number}${columns
      .map((c) => pad(sanitiseLine(cellValue(track, c)), widths.get(c)!))
      .join('  ')}`.trimEnd();
  });

  return [header, head, '-'.repeat(Math.max(head.length, 20)), ...body, ''].join('\n');
}

/* --------------------------------------------------------------------- JSON */

export function libraryToJson(tracks: Track[], playlists: Playlist[]): string {
  return JSON.stringify(
    {
      exportedBy: `${APP_NAME} ${APP_VERSION}`,
      exportedAt: new Date().toISOString(),
      trackCount: tracks.length,
      tracks: tracks.map((t) => ({ ...t, dateAdded: t.dateAdded?.toISOString?.() ?? null })),
      playlists,
    },
    null,
    2
  );
}

/* -------------------------------------------------------------- rekordbox XML */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip characters XML 1.0 cannot represent at all.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function trackLocation(filePath: string): string {
  if (!filePath) return '';
  const normalised = filePath.replace(/\\/g, '/');
  const withSlash = normalised.startsWith('/') ? normalised : `/${normalised}`;
  return `file://localhost${withSlash.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * rekordbox `collection.xml`, the format AlphaTheta documents for third-party
 * import. This is the safe interop path: rekordbox reads it directly, and no
 * binary database is involved.
 */
export function libraryToRekordboxXml(tracks: Track[], playlists: Playlist[]): string {
  const usedIds = new Set<number>();
  const collection = tracks
    .filter((track) => {
      if (usedIds.has(track.id)) return false;
      usedIds.add(track.id);
      return true;
    })
    .map((track) => {
      const attrs: [string, string][] = [
        ['TrackID', String(track.id)],
        ['Name', track.title || ''],
        ['Artist', track.artist || ''],
        ['Album', track.album || ''],
        ['Genre', track.genre || ''],
        ['Kind', 'MP3 File'],
        ['TotalTime', String(Math.round(track.duration || 0))],
        ['AverageBpm', track.bpm ? track.bpm.toFixed(2) : '0.00'],
        ['Tonality', track.key || ''],
        ['Label', track.label || ''],
        ['Rating', String(track.rating || 0)],
        ['BitRate', String(track.bitrate || 0)],
        ['Location', trackLocation(track.filePath)],
      ];
      if (track.year) attrs.push(['Year', String(track.year)]);

      return `    <TRACK ${attrs
        .map(([key, value]) => `${key}="${escapeXml(value)}"`)
        .join(' ')}/>`;
    })
    .join('\n');

  const renderNode = (playlist: Playlist, depth: number): string => {
    const indent = '  '.repeat(depth);
    const name = escapeXml(playlist.name);

    if (playlist.isFolder) {
      const children = playlist.children.map((c) => renderNode(c, depth + 1)).join('\n');
      return `${indent}<NODE Name="${name}" Type="0" Count="${playlist.children.length}">${
        children ? `\n${children}\n${indent}` : ''
      }</NODE>`;
    }

    const keys = playlist.trackIds
      .filter((id) => usedIds.has(id))
      .map((id) => `${indent}  <TRACK Key="${id}"/>`)
      .join('\n');
    return `${indent}<NODE Name="${name}" Type="1" KeyType="0" Entries="${
      playlist.trackIds.length
    }">${keys ? `\n${keys}\n${indent}` : ''}</NODE>`;
  };

  const nodes = playlists.map((p) => renderNode(p, 3)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="${escapeXml(APP_NAME)}" Version="${escapeXml(APP_VERSION)}" Company="rekordbox-explorer"/>
  <COLLECTION Entries="${usedIds.size}">
${collection}
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="${playlists.length}">
${nodes}
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>
`;
}
