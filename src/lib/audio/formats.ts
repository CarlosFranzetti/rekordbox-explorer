/**
 * What can this browser actually play, and what do we decode ourselves?
 *
 * rekordbox accepts MP3, AAC (in M4A/MP4), WAV, AIFF, FLAC and ALAC. No browser
 * plays all six, and which ones fail is not fixed — it varies by browser *and*
 * by build. Chrome ships AAC; a plain Chromium compiled without proprietary
 * codecs does not, and reports the same `""` from `canPlayType` that it does for
 * a format nobody supports.
 *
 * So capability is **probed at runtime** rather than hardcoded. A hardcoded list
 * would be wrong on somebody's machine, and the failure mode is silence, which
 * is the worst possible way to be wrong.
 *
 * Three outcomes per format:
 *
 * - `native`   — hand it to `<audio>`, which streams and costs no memory.
 * - `decode`   — we parse it ourselves into samples (AIFF, awkward WAVs).
 * - `unsupported` — say so precisely, naming the format.
 */

export type Playback = 'native' | 'decode' | 'unsupported';

export interface FormatInfo {
  /** Lower-case extension, without the dot. */
  extension: string;
  /** What rekordbox calls it, for messages. */
  label: string;
  playback: Playback;
}

/** MIME types worth asking `canPlayType` about, per extension. */
const PROBES: Record<string, { label: string; mimes: string[]; decodable: boolean }> = {
  mp3: { label: 'MP3', mimes: ['audio/mpeg'], decodable: false },
  m4a: { label: 'AAC/ALAC', mimes: ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4'], decodable: false },
  mp4: { label: 'AAC', mimes: ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4'], decodable: false },
  aac: { label: 'AAC', mimes: ['audio/aac', 'audio/mp4; codecs="mp4a.40.2"'], decodable: false },
  wav: { label: 'WAV', mimes: ['audio/wav', 'audio/x-wav'], decodable: true },
  wave: { label: 'WAV', mimes: ['audio/wav'], decodable: true },
  aif: { label: 'AIFF', mimes: ['audio/aiff', 'audio/x-aiff'], decodable: true },
  aiff: { label: 'AIFF', mimes: ['audio/aiff', 'audio/x-aiff'], decodable: true },
  aifc: { label: 'AIFF-C', mimes: ['audio/aiff', 'audio/x-aiff'], decodable: true },
  flac: { label: 'FLAC', mimes: ['audio/flac', 'audio/x-flac'], decodable: false },
  ogg: { label: 'Ogg', mimes: ['audio/ogg'], decodable: false },
  oga: { label: 'Ogg', mimes: ['audio/ogg'], decodable: false },
  opus: { label: 'Opus', mimes: ['audio/ogg; codecs="opus"'], decodable: false },
};

export function extensionOf(path: string): string {
  return (path.split('.').pop() ?? '').toLowerCase();
}

/** Ask the browser, once, whether it can play a MIME type. */
function canPlay(mimes: string[]): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.createElement('audio');
  return mimes.some((m) => el.canPlayType(m) !== '');
}

const cache = new Map<string, FormatInfo>();

/**
 * Decide how to play a file.
 *
 * Native support wins where it exists: `<audio>` streams, so a 90 MB WAV starts
 * immediately, where decoding reads the whole file into memory first.
 */
export function formatFor(path: string): FormatInfo {
  const extension = extensionOf(path);
  const hit = cache.get(extension);
  if (hit) return hit;

  const probe = PROBES[extension];
  let info: FormatInfo;

  if (!probe) {
    info = { extension, label: extension.toUpperCase() || 'this file', playback: 'unsupported' };
  } else if (canPlay(probe.mimes)) {
    info = { extension, label: probe.label, playback: 'native' };
  } else if (probe.decodable) {
    info = { extension, label: probe.label, playback: 'decode' };
  } else {
    info = { extension, label: probe.label, playback: 'unsupported' };
  }

  cache.set(extension, info);
  return info;
}

/**
 * Why a format cannot be previewed, in terms a DJ can act on.
 *
 * Never implies the file is broken: an unplayable format is a browser
 * limitation, and the track will load on a CDJ perfectly well.
 */
export function unsupportedMessage(info: FormatInfo): string {
  if (info.extension === 'm4a' || info.extension === 'mp4' || info.extension === 'aac') {
    return (
      `This browser cannot preview ${info.label} files. The track itself is fine and will play ` +
      'on a CDJ. Apple Lossless (ALAC) is never previewable in a browser; if this is AAC, Chrome ' +
      'and Edge can play it while some Linux builds of Chromium cannot.'
    );
  }
  return (
    `This browser cannot preview ${info.label} files. The track itself is fine and will play ` +
    'on a CDJ — only the in-browser preview is unavailable.'
  );
}

/** Everything rekordbox accepts, for documentation and the settings screen. */
export const REKORDBOX_FORMATS = ['mp3', 'm4a', 'wav', 'aiff', 'aif', 'flac'] as const;
