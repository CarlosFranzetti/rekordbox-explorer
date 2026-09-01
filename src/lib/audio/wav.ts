/**
 * Decode WAV to raw samples.
 *
 * Chrome plays ordinary 16-bit PCM WAV, but a DJ library is not ordinary: vinyl
 * rips land as 24-bit, mastering chains emit 32-bit float, and anything above
 * two channels or written by a pro tool tends to use `WAVE_FORMAT_EXTENSIBLE`,
 * which several browsers refuse. Rather than guess which variant a given
 * browser tolerates, the player tries native playback first and falls back
 * here — so this only runs when the browser has already said no.
 *
 * Same container idea as AIFF, opposite byte order:
 *
 * ```
 * RIFF <size> WAVE
 *   fmt  <size> format(u16) channels(u16) sampleRate(u32) ... bitDepth(u16)
 *   data <size> <interleaved little-endian PCM>
 * ```
 */

import type { DecodedAudio } from './aiff';

export class WavError extends Error {}

const FORMAT_PCM = 0x0001;
const FORMAT_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/** Is this buffer a RIFF/WAVE container? */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return fourCC(view, 0) === 'RIFF' && fourCC(view, 8) === 'WAVE';
}

/**
 * Decode a WAV buffer into planar float samples.
 *
 * Throws {@link WavError} with a message worth showing a user.
 */
export function decodeWav(bytes: Uint8Array): DecodedAudio {
  if (!isWav(bytes)) throw new WavError('This file is not a WAV.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = fourCC(view, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;

    if (id === 'fmt ') {
      if (body + 16 > bytes.length) throw new WavError('This WAV is truncated — its header is incomplete.');
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitDepth = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE hides the real format in a GUID whose first two
      // bytes are the original format tag.
      if (format === FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= bytes.length) {
        format = view.getUint16(body + 24, true);
      }
    } else if (id === 'data') {
      dataOffset = body;
      // Clamp to what is present: a file rescued off a half-written drive
      // declares its original length.
      dataLength = Math.max(0, Math.min(size, bytes.length - body));
    }

    pos = body + size + (size % 2); // chunks are word-aligned
  }

  if (!channels || !sampleRate) throw new WavError('This WAV has no readable format header.');
  if (dataOffset < 0) throw new WavError('This WAV contains no audio data.');
  if (format !== FORMAT_PCM && format !== FORMAT_FLOAT) {
    throw new WavError(
      `This WAV uses a compressed format (0x${format.toString(16)}) that cannot be played here. ` +
        'The track itself is fine — only previewing it in the browser is not possible.'
    );
  }

  const bytesPerSample = Math.ceil(bitDepth / 8);
  if (![1, 2, 3, 4].includes(bytesPerSample)) {
    throw new WavError(`This WAV uses an unsupported bit depth (${bitDepth}).`);
  }
  const isFloat = format === FORMAT_FLOAT;

  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  if (frames <= 0) throw new WavError('This WAV contains no audio data.');

  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) out.push(new Float32Array(frames));

  for (let f = 0; f < frames; f++) {
    const frameBase = dataOffset + f * bytesPerSample * channels;
    for (let c = 0; c < channels; c++) {
      const at = frameBase + c * bytesPerSample;
      let value: number;
      if (isFloat) {
        value = bytesPerSample === 8 ? view.getFloat64(at, true) : view.getFloat32(at, true);
      } else if (bytesPerSample === 1) {
        // 8-bit WAV is UNSIGNED, unlike 8-bit AIFF. Getting this backwards
        // produces a loud DC offset rather than an obvious failure.
        value = (view.getUint8(at) - 128) / 128;
      } else if (bytesPerSample === 2) {
        value = view.getInt16(at, true) / 32768;
      } else if (bytesPerSample === 3) {
        const b0 = view.getUint8(at);
        const b1 = view.getUint8(at + 1);
        const b2 = view.getUint8(at + 2);
        let raw = b0 | (b1 << 8) | (b2 << 16); // little-endian
        if (raw & 0x800000) raw -= 0x1000000;
        value = raw / 8388608;
      } else {
        value = view.getInt32(at, true) / 2147483648;
      }
      out[c][f] = value;
    }
  }

  return { channels: out, sampleRate, frames };
}
