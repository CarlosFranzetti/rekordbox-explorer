/**
 * Emit a rekordbox XML from a recovered library.
 *
 * This is deliberately the *only* thing recovery produces. It would be possible
 * to synthesise an `export.pdb` directly, and tempting, because it looks like a
 * one-step fix. It is not one:
 *
 * - A from-scratch PDB means writing the track, artist, album, genre, key and
 *   playlist tables with every DeviceSQL string offset correct.
 * - There is no way to validate the result short of a CDJ. "It parses in our
 *   own reader" is not "a player accepts it in a booth."
 *
 * rekordbox XML is the format AlphaTheta document and support. Importing it
 * rebuilds the playlists *and* has rekordbox write both device databases itself,
 * reusing the analysis files already on the drive. Slower by one step, and
 * correct.
 */

import type { RekordboxDatabase, Playlist, Track } from '@/types/rekordbox';

/**
 * XML 1.0 cannot represent most control characters at all - not even escaped -
 * so they are stripped rather than encoded. Matching them is the entire point
 * here, hence the disabled rule.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(ILLEGAL, '');
}

function kindOf(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'mp3':
      return 'MP3 File';
    case 'aif':
    case 'aiff':
      return 'AIFF File';
    case 'wav':
      return 'WAV File';
    case 'flac':
      return 'FLAC File';
    case 'm4a':
      return 'M4A File';
    default:
      return 'Unknown';
  }
}

/**
 * rekordbox wants an absolute `file://localhost/...` URL, so the drive's mount
 * point has to be supplied. Getting it wrong means every track imports as
 * missing — recoverable by relocating in rekordbox, but worth getting right.
 */
function location(volumeName: string, filePath: string): string {
  const rel = filePath.replace(/^\/+/, '');
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return `file://localhost/Volumes/${encodeURIComponent(volumeName)}/${encoded}`;
}

function trackElement(t: Track, volumeName: string): string {
  return (
    `    <TRACK TrackID="${t.id}" Name="${esc(t.title)}" Artist="${esc(t.artist)}"` +
    ` Album="${esc(t.album)}" Genre="${esc(t.genre)}" Kind="${kindOf(t.filePath)}"` +
    ` TotalTime="${Math.round(t.duration || 0)}"` +
    ` AverageBpm="${t.bpm ? t.bpm.toFixed(2) : ''}"` +
    ` Year="${t.year ?? ''}" Rating="${t.rating || 0}"` +
    ` Location="${location(volumeName, t.filePath)}"/>`
  );
}

function playlistNodes(pl: Playlist, indent: number, out: string[]): void {
  const pad = ' '.repeat(indent);
  const own = pl.trackIds;

  if (pl.children.length > 0) {
    // rekordbox models a folder and a playlist as different node types, and a
    // folder cannot hold tracks. Engine allows both, so a node with children
    // *and* tracks gets its tracks as a same-named playlist inside the folder
    // rather than losing them.
    const count = pl.children.length + (own.length > 0 ? 1 : 0);
    out.push(`${pad}<NODE Name="${esc(pl.name)}" Type="0" Count="${count}">`);
    for (const child of pl.children) playlistNodes(child, indent + 2, out);
    if (own.length > 0) {
      out.push(`${pad}  <NODE Name="${esc(pl.name)}" Type="1" KeyType="0" Entries="${own.length}">`);
      for (const id of own) out.push(`${pad}    <TRACK Key="${id}"/>`);
      out.push(`${pad}  </NODE>`);
    }
    out.push(`${pad}</NODE>`);
    return;
  }

  out.push(`${pad}<NODE Name="${esc(pl.name)}" Type="1" KeyType="0" Entries="${own.length}">`);
  for (const id of own) out.push(`${pad}  <TRACK Key="${id}"/>`);
  out.push(`${pad}</NODE>`);
}

export interface XmlOptions {
  /** The drive's volume name, e.g. `LOS02`, used to build absolute paths. */
  volumeName: string;
}

/** Serialise a library as a rekordbox XML document. */
export function toRekordboxXml(db: RekordboxDatabase, opts: XmlOptions): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<DJ_PLAYLISTS Version="1.0.0">');
  out.push('  <PRODUCT Name="rekordbox" Version="6.0.0" Company="AlphaTheta"/>');
  out.push(`  <COLLECTION Entries="${db.tracks.length}">`);
  for (const t of db.tracks) out.push(trackElement(t, opts.volumeName));
  out.push('  </COLLECTION>');
  out.push('  <PLAYLISTS>');
  out.push(`    <NODE Type="0" Name="ROOT" Count="${db.playlists.length}">`);
  for (const pl of db.playlists) playlistNodes(pl, 6, out);
  out.push('    </NODE>');
  out.push('  </PLAYLISTS>');
  out.push('</DJ_PLAYLISTS>');
  return out.join('\n') + '\n';
}

/** Count the track references a document will contain, for reporting. */
export function countEntries(playlists: Playlist[]): number {
  let total = 0;
  const walk = (list: Playlist[]) => {
    for (const pl of list) {
      total += pl.trackIds.length;
      walk(pl.children);
    }
  };
  walk(playlists);
  return total;
}
