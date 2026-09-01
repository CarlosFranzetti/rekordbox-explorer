/**
 * Decode AIFF to raw samples, because the browser will not.
 *
 * This app needs the File System Access API to read a USB, which means Chrome,
 * Edge or Opera. Those browsers cannot play AIFF — `canPlayType('audio/aiff')`
 * returns `""` and `decodeAudioData` throws `EncodingError`. Safari decodes AIFF
 * happily but has no folder picker. So on the one browser that can open a
 * rekordbox stick, the format most of a vinyl-leaning library is stored in is
 * unplayable.
 *
 * AIFF is uncompressed PCM in a chunked container, so decoding it is a small
 * amount of arithmetic rather than a codec. That turns "auditioning does not
 * work for most of your library" into "it works".
 *
 * Layout:
 *
 * ```
 * FORM <size> AIFF
 *   COMM <size> channels(u16) frames(u32) bitDepth(u16) sampleRate(80-bit float)
 *   SSND <size> offset(u32) blockSize(u32) <interleaved big-endian PCM>
 * ```
 *
 * AIFC (compressed AIFF) uses the same container with a codec id appended to
 * COMM. Only the uncompressed variants are handled; anything else is reported
 * rather than silently producing noise.
 */

export class AiffError extends Error {}

export interface DecodedAudio {
  /** One Float32Array per channel, each `frames` long, samples in -1..1. */
  channels: Float32Array[];
  sampleRate: number;
  frames: number;
}

/** Codec ids that mean "not actually compressed". */
const UNCOMPRESSED = new Set(['NONE', 'sowt', 'twos', 'fl32', 'FL32', 'fl64', 'in24', 'in32']);

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/**
 * Read an IEEE 754 80-bit extended float — the format AIFF stores sample rates
 * in, and the only reason this file needs any floating-point work at all.
 */
function readExtended80(view: DataView, offset: number): number {
  const exponent = view.getUint16(offset);
  const hi = view.getUint32(offset + 2);
  const lo = view.getUint32(offset + 6);
  const sign = exponent & 0x8000 ? -1 : 1;
  const e = exponent & 0x7fff;
  if (e === 0 && hi === 0 && lo === 0) return 0;
  // The mantissa is explicit (no implied leading bit), hence the -16383-63.
  return sign * (hi * 2 ** 32 + lo) * 2 ** (e - 16383 - 63);
}

/** Is this buffer an AIFF/AIFC container? */
export function isAiff(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourCC(view, 0) !== 'FORM') return false;
  const form = fourCC(view, 8);
  return form === 'AIFF' || form === 'AIFC';
}

/**
 * Decode an AIFF buffer into planar float samples.
 *
 * Throws {@link AiffError} with a message worth showing a user — a compressed
 * AIFC or a truncated file is a normal thing to meet on a real drive.
 */
export function decodeAiff(bytes: Uint8Array): DecodedAudio {
  if (!isAiff(bytes)) throw new AiffError('This file is not an AIFF.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let channels = 0;
  let frames = 0;
  let bitDepth = 0;
  let sampleRate = 0;
  let compression = 'NONE';
  let ssndOffset = -1;
  let ssndLength = 0;

  // Walk the chunk list. Chunks are padded to even lengths.
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = fourCC(view, pos);
    const size = view.getUint32(pos + 4);
    const body = pos + 8;

    if (id === 'COMM') {
      if (body + 18 > bytes.length) throw new AiffError('This AIFF is truncated — its header is incomplete.');
      channels = view.getUint16(body);
      frames = view.getUint32(body + 2);
      bitDepth = view.getUint16(body + 6);
      sampleRate = readExtended80(view, body + 8);
      if (size >= 22 && body + 22 <= bytes.length) compression = fourCC(view, body + 18);
    } else if (id === 'SSND') {
      if (body + 8 > bytes.length) throw new AiffError('This AIFF is truncated — its audio data is missing.');
      const dataOffset = view.getUint32(body);
      ssndOffset = body + 8 + dataOffset;
      // Clamp to what is actually in the buffer, not what the chunk header
      // claims. A truncated file — the normal state of anything rescued off a
      // drive that was pulled mid-write — declares its original length, and
      // trusting that reads past the end.
      ssndLength = Math.max(0, Math.min(size - 8 - dataOffset, bytes.length - ssndOffset));
    }

    pos = body + size + (size % 2); // pad byte
  }

  if (!channels || !sampleRate) throw new AiffError('This AIFF has no readable format header.');
  if (ssndOffset < 0) throw new AiffError('This AIFF contains no audio data.');
  if (!UNCOMPRESSED.has(compression)) {
    throw new AiffError(
      `This is a compressed AIFF (${compression}), which cannot be played here. ` +
        'The track itself is fine — only previewing it in the browser is not possible.'
    );
  }

  const bytesPerSample = Math.ceil(bitDepth / 8);
  if (![1, 2, 3, 4].includes(bytesPerSample)) {
    throw new AiffError(`This AIFF uses an unsupported bit depth (${bitDepth}).`);
  }

  // Trust whichever is smaller: the declared frame count or what is present.
  const available = Math.floor(ssndLength / (bytesPerSample * channels));
  const total = Math.min(frames, available);
  if (total <= 0) throw new AiffError('This AIFF contains no audio data.');

  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) out.push(new Float32Array(total));

  // `sowt` is the little-endian variant; everything else here is big-endian.
  const littleEndian = compression === 'sowt';
  const isFloat = compression === 'fl32' || compression === 'FL32';

  for (let f = 0; f < total; f++) {
    const frameBase = ssndOffset + f * bytesPerSample * channels;
    for (let c = 0; c < channels; c++) {
      const at = frameBase + c * bytesPerSample;
      let value: number;
      if (isFloat) {
        value = view.getFloat32(at, littleEndian);
      } else if (bytesPerSample === 1) {
        // 8-bit AIFF is signed, unlike 8-bit WAV.
        value = view.getInt8(at) / 128;
      } else if (bytesPerSample === 2) {
        value = view.getInt16(at, littleEndian) / 32768;
      } else if (bytesPerSample === 3) {
        // No getInt24; assemble it and sign-extend.
        const b0 = view.getUint8(at);
        const b1 = view.getUint8(at + 1);
        const b2 = view.getUint8(at + 2);
        let raw = littleEndian ? b0 | (b1 << 8) | (b2 << 16) : (b0 << 16) | (b1 << 8) | b2;
        if (raw & 0x800000) raw -= 0x1000000;
        value = raw / 8388608;
      } else {
        value = view.getInt32(at, littleEndian) / 2147483648;
      }
      out[c][f] = value;
    }
  }

  return { channels: out, sampleRate, frames: total };
}

/**
 * Formats the browser can play natively, by extension.
 *
 * Deliberately conservative: guessing wrong means a silent failure, and the
 * fallback path costs only a decode.
 */
const NATIVE = new Set(['mp3', 'm4a', 'mp4', 'wav', 'flac', 'ogg', 'oga', 'opus', 'aac']);

export function extensionOf(path: string): string {
  return (path.split('.').pop() ?? '').toLowerCase();
}

/** True when `<audio src>` is likely to work for this file. */
export function playsNatively(path: string): boolean {
  return NATIVE.has(extensionOf(path));
}

/** True when we need to decode it ourselves. */
export function needsManualDecode(path: string): boolean {
  const ext = extensionOf(path);
  return ext === 'aif' || ext === 'aiff' || ext === 'aifc';
}
