/**
 * Identify what a user actually handed us.
 *
 * The single most common failure in the wild is not a corrupt database — it is
 * the wrong file. On iOS there is no folder picker, so the app falls back to a
 * plain file input and the Files app cheerfully offers the user their music.
 * Picking a track used to produce:
 *
 *     Invalid number of tables: 1179011393
 *
 * That number is not random. `1179011393` is `0x46464941`, which little-endian
 * is the ASCII bytes `AIFF` — the AIFF magic, sitting at offset 0x08 exactly
 * where the PDB header keeps its table count. The parser was faithfully
 * reporting a number it read out of an audio file.
 *
 * A DJ ten minutes before doors cannot do anything with that sentence. So
 * before parsing, we look at the first bytes and say what the file actually is.
 */

/** What `PIONEER/rekordbox/export.pdb` and `exportExt.pdb` look like. */
const PDB_PAGE_LEN_MIN = 512;
const PDB_PAGE_LEN_MAX = 1024 * 1024;

export interface FileIdentification {
  /** Short machine-readable label, e.g. `aiff`, `sqlite`, `pdb`. */
  kind: string;
  /** True when this is something the parser should attempt. */
  parseable: boolean;
  /** What to show the user. Complete sentences, no jargon. */
  message: string;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

const WRONG_FILE_TAIL =
  'On the USB you want PIONEER/rekordbox/export.pdb — the database, not a song.';

/**
 * Audio containers, which is what people actually pick by mistake.
 * Keyed on real magic bytes rather than the file extension, because iOS
 * often hands over a file whose name tells you nothing.
 */
function identifyAudio(b: Uint8Array): FileIdentification | null {
  // AIFF / AIFC: "FORM" .... "AIFF" — the exact case from the bug report.
  if (ascii(b, 0, 4) === 'FORM' && (ascii(b, 8, 4) === 'AIFF' || ascii(b, 8, 4) === 'AIFC')) {
    return { kind: 'aiff', parseable: false, message: `That is an AIFF audio file. ${WRONG_FILE_TAIL}` };
  }
  // WAV: "RIFF" .... "WAVE"
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') {
    return { kind: 'wav', parseable: false, message: `That is a WAV audio file. ${WRONG_FILE_TAIL}` };
  }
  // MP3: an ID3 tag, or a raw MPEG frame sync.
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) {
    return { kind: 'mp3', parseable: false, message: `That is an MP3 audio file. ${WRONG_FILE_TAIL}` };
  }
  if (ascii(b, 0, 4) === 'fLaC') {
    return { kind: 'flac', parseable: false, message: `That is a FLAC audio file. ${WRONG_FILE_TAIL}` };
  }
  // MP4 family (m4a/aac/alac) and friends: [size]"ftyp"[brand]
  if (ascii(b, 4, 4) === 'ftyp') {
    return { kind: 'mp4', parseable: false, message: `That is an M4A/MP4 audio file. ${WRONG_FILE_TAIL}` };
  }
  if (ascii(b, 0, 4) === 'OggS') {
    return { kind: 'ogg', parseable: false, message: `That is an Ogg audio file. ${WRONG_FILE_TAIL}` };
  }
  return null;
}

/**
 * Inspect the head of a file and decide whether parsing it can possibly work.
 *
 * Only ever needs the first few hundred bytes, so callers can slice rather than
 * read a 60 MB track into memory to find out it is a 60 MB track.
 */
export function identifyFile(bytes: Uint8Array, fileName = ''): FileIdentification {
  if (bytes.length < 16) {
    return {
      kind: 'empty',
      parseable: false,
      message: 'That file is empty, or too small to be a rekordbox database.',
    };
  }

  const audio = identifyAudio(bytes);
  if (audio) return audio;

  // A OneLibrary database — encrypted, so it has no usable magic. Go on the
  // name, which rekordbox controls and never varies.
  if (/exportLibrary\.db$/i.test(fileName)) {
    return {
      kind: 'onelibrary',
      parseable: false,
      message:
        'That is a OneLibrary database (exportLibrary.db). Open the whole USB folder ' +
        'instead of a single file and it will be read automatically.',
    };
  }

  if (ascii(bytes, 0, 15) === 'SQLite format 3') {
    return {
      kind: 'sqlite',
      parseable: false,
      message:
        'That is an unencrypted SQLite database, not a rekordbox export. ' +
        'If you meant your rekordbox collection, that lives in master.db on your computer ' +
        'and this app does not read it.',
    };
  }

  // Common wrong-picks that are neither audio nor a database.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return { kind: 'zip', parseable: false, message: `That is a ZIP archive. ${WRONG_FILE_TAIL}` };
  }
  if (ascii(bytes, 0, 5) === '%PDF-') {
    return { kind: 'pdf', parseable: false, message: `That is a PDF. ${WRONG_FILE_TAIL}` };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', parseable: false, message: `That is an image file. ${WRONG_FILE_TAIL}` };
  }
  if (/^\s*<\?xml/i.test(ascii(bytes, 0, 32))) {
    return {
      kind: 'xml',
      parseable: false,
      message:
        'That is an XML file — probably a rekordbox collection export. ' +
        'This app reads the database from a USB, not XML.',
    };
  }

  // Looks like it could genuinely be a PDB: the page length at 0x04 has to be
  // a sane power-of-two-ish size. This is a smell test, not validation — the
  // parser still does the real work and is allowed to disagree.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lenPage = view.getUint32(0x04, true);
  if (lenPage >= PDB_PAGE_LEN_MIN && lenPage <= PDB_PAGE_LEN_MAX) {
    return { kind: 'pdb', parseable: true, message: '' };
  }

  return {
    kind: 'unknown',
    parseable: false,
    message:
      'That file is not a rekordbox database. Look for PIONEER/rekordbox/export.pdb on the USB.',
  };
}
