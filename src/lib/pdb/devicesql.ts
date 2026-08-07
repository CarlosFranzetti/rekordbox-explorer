/**
 * DeviceSQL variable-length string codec.
 *
 * Three encodings, discriminated by the first byte:
 *   - odd byte  : short ASCII. `len = byte >> 1` counts the header byte itself,
 *                 so the payload is `len - 1` bytes at `offset + 1`.
 *   - 0x40      : long ASCII.  u16 `len` at +1, pad byte at +3, payload at +4
 *                 of `len - 4` bytes. `len` counts the 4-byte header.
 *   - 0x90      : long UTF-16LE. Same framing as 0x40, payload is `len - 4`
 *                 bytes = (len - 4) / 2 code units.
 *
 * Reference: Deep-Symmetry/crate-digger `rekordbox_pdb.ksy`.
 */

export const SHORT_ASCII_MAX_BYTES = 126; // ((126 + 1) << 1) | 1 === 255

const KIND_LONG_ASCII = 0x40;
const KIND_LONG_UTF16LE = 0x90;

const asciiDecoder = new TextDecoder('ascii');
const utf16Decoder = new TextDecoder('utf-16le');

/** Result of decoding: the text plus how many bytes the field occupied. */
export interface DecodedString {
  text: string;
  byteLength: number;
}

function slice(view: DataView, offset: number, length: number): Uint8Array {
  // Honour the view's own byteOffset so this stays correct for sub-views.
  return new Uint8Array(view.buffer, view.byteOffset + offset, length);
}

/**
 * Decode a DeviceSQL string. Returns `null` when the field is malformed or
 * would read past `limit` — callers treat that as "absent" rather than fatal,
 * because rows flagged absent in a page index can contain arbitrary bytes.
 */
export function decodeDeviceSqlString(
  view: DataView,
  offset: number,
  limit: number = view.byteLength
): DecodedString | null {
  if (offset < 0 || offset + 1 > limit) return null;

  const kind = view.getUint8(offset);

  if (kind === KIND_LONG_ASCII || kind === KIND_LONG_UTF16LE) {
    if (offset + 4 > limit) return null;
    const byteLength = view.getUint16(offset + 1, true);
    if (byteLength < 4 || offset + byteLength > limit) return null;

    const payload = slice(view, offset + 4, byteLength - 4);
    const text =
      kind === KIND_LONG_ASCII ? asciiDecoder.decode(payload) : utf16Decoder.decode(payload);
    return { text, byteLength };
  }

  if ((kind & 1) === 1) {
    const byteLength = kind >> 1;
    if (byteLength < 1 || offset + byteLength > limit) return null;
    const payload = slice(view, offset + 1, byteLength - 1);
    return { text: asciiDecoder.decode(payload), byteLength };
  }

  return null;
}

/** Convenience wrapper for read paths that only care about the text. */
export function readDeviceSqlString(view: DataView, offset: number, limit?: number): string {
  return decodeDeviceSqlString(view, offset, limit)?.text ?? '';
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/**
 * Encode a string using the narrowest representation that fits, mirroring what
 * rekordbox itself emits: short ASCII for ordinary names, long ASCII when the
 * text is ASCII but too long for the 1-byte header, UTF-16LE otherwise.
 */
export function encodeDeviceSqlString(text: string): Uint8Array {
  if (isAscii(text)) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);

    if (bytes.length <= SHORT_ASCII_MAX_BYTES) {
      const out = new Uint8Array(bytes.length + 1);
      out[0] = ((bytes.length + 1) << 1) | 1;
      out.set(bytes, 1);
      return out;
    }

    const byteLength = bytes.length + 4;
    if (byteLength > 0xffff) throw new RangeError('DeviceSQL string too long');
    const out = new Uint8Array(byteLength);
    out[0] = KIND_LONG_ASCII;
    out[1] = byteLength & 0xff;
    out[2] = (byteLength >> 8) & 0xff;
    out[3] = 0;
    out.set(bytes, 4);
    return out;
  }

  const units = Array.from(text);
  const utf16: number[] = [];
  for (const ch of units) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      // Surrogate pair — emit both units.
      const adjusted = code - 0x10000;
      utf16.push(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    } else {
      utf16.push(code);
    }
  }

  const byteLength = utf16.length * 2 + 4;
  if (byteLength > 0xffff) throw new RangeError('DeviceSQL string too long');
  const out = new Uint8Array(byteLength);
  out[0] = KIND_LONG_UTF16LE;
  out[1] = byteLength & 0xff;
  out[2] = (byteLength >> 8) & 0xff;
  out[3] = 0;
  for (let i = 0; i < utf16.length; i++) {
    out[4 + i * 2] = utf16[i] & 0xff;
    out[5 + i * 2] = (utf16[i] >> 8) & 0xff;
  }
  return out;
}

/** Byte length `encodeDeviceSqlString` would produce, without allocating. */
export function encodedDeviceSqlLength(text: string): number {
  if (isAscii(text)) {
    return text.length <= SHORT_ASCII_MAX_BYTES ? text.length + 1 : text.length + 4;
  }
  let units = 0;
  for (const ch of Array.from(text)) units += ch.codePointAt(0)! > 0xffff ? 2 : 1;
  return units * 2 + 4;
}
