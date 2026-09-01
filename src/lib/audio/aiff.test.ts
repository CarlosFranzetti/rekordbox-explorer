import { describe, it, expect } from 'vitest';
import { decodeAiff, isAiff, AiffError, playsNatively, needsManualDecode } from './aiff';

/**
 * Build a valid AIFF in memory. Chrome cannot decode this format at all — not
 * through `<audio>` and not through `decodeAudioData` — so these tests are the
 * only proof the decoder works.
 */
function makeAiff(opts: {
  channels?: number;
  frames?: number;
  bitDepth?: number;
  sampleRate?: number;
  compression?: string;
  form?: string;
  samples?: number[][];
}): Uint8Array {
  const channels = opts.channels ?? 1;
  const frames = opts.frames ?? 4;
  const bitDepth = opts.bitDepth ?? 16;
  const sampleRate = opts.sampleRate ?? 44100;
  const bps = bitDepth / 8;
  const compression = opts.compression;

  const commSize = compression ? 18 + 4 + 2 : 18;
  const ssndSize = 8 + frames * channels * bps;
  const bodySize = 4 + (8 + commSize + (commSize % 2)) + (8 + ssndSize + (ssndSize % 2));
  const buf = new Uint8Array(8 + bodySize);
  const view = new DataView(buf.buffer);
  const write4 = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(o + i, s.charCodeAt(i));
  };

  write4(0, 'FORM');
  view.setUint32(4, bodySize);
  write4(8, opts.form ?? (compression ? 'AIFC' : 'AIFF'));

  let p = 12;
  write4(p, 'COMM');
  view.setUint32(p + 4, commSize);
  view.setUint16(p + 8, channels);
  view.setUint32(p + 10, frames);
  view.setUint16(p + 14, bitDepth);
  // 80-bit extended, integer sample rates only.
  let exp = 16383 + 31;
  let mant = sampleRate;
  while (mant && !(mant & 0x80000000)) {
    mant = (mant << 1) >>> 0;
    exp -= 1;
  }
  view.setUint16(p + 16, exp);
  view.setUint32(p + 18, mant >>> 0);
  view.setUint32(p + 22, 0);
  if (compression) {
    write4(p + 26, compression);
    view.setUint16(p + 30, 0);
  }
  p += 8 + commSize + (commSize % 2);

  write4(p, 'SSND');
  view.setUint32(p + 4, ssndSize);
  view.setUint32(p + 8, 0); // offset
  view.setUint32(p + 12, 0); // blockSize
  let at = p + 16;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const v = opts.samples?.[c]?.[f] ?? 0;
      if (bps === 2) view.setInt16(at, v);
      else if (bps === 1) view.setInt8(at, v);
      else if (bps === 3) {
        view.setUint8(at, (v >> 16) & 0xff);
        view.setUint8(at + 1, (v >> 8) & 0xff);
        view.setUint8(at + 2, v & 0xff);
      } else view.setInt32(at, v);
      at += bps;
    }
  }
  return buf;
}

describe('isAiff', () => {
  it('accepts AIFF and AIFC', () => {
    expect(isAiff(makeAiff({}))).toBe(true);
    expect(isAiff(makeAiff({ compression: 'NONE' }))).toBe(true);
  });

  it('rejects anything else without throwing', () => {
    expect(isAiff(new Uint8Array(0))).toBe(false);
    expect(isAiff(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false); // RIFF/WAV
  });
});

describe('decodeAiff', () => {
  it('decodes 16-bit mono with correct sample values', () => {
    const aiff = makeAiff({ samples: [[0, 16384, -16384, 32767]] });
    const out = decodeAiff(aiff);
    expect(out.sampleRate).toBe(44100);
    expect(out.frames).toBe(4);
    expect(out.channels).toHaveLength(1);
    expect(out.channels[0][0]).toBeCloseTo(0, 5);
    expect(out.channels[0][1]).toBeCloseTo(0.5, 4);
    expect(out.channels[0][2]).toBeCloseTo(-0.5, 4);
    expect(out.channels[0][3]).toBeCloseTo(1, 3);
  });

  it('deinterleaves stereo into separate channels', () => {
    const aiff = makeAiff({
      channels: 2,
      frames: 3,
      samples: [
        [1000, 2000, 3000],
        [-1000, -2000, -3000],
      ],
    });
    const out = decodeAiff(aiff);
    expect(out.channels).toHaveLength(2);
    expect(out.channels[0][1]).toBeCloseTo(2000 / 32768, 5);
    expect(out.channels[1][1]).toBeCloseTo(-2000 / 32768, 5);
  });

  it('reads a non-standard sample rate from the 80-bit field', () => {
    expect(decodeAiff(makeAiff({ sampleRate: 48000 })).sampleRate).toBeCloseTo(48000, 0);
    expect(decodeAiff(makeAiff({ sampleRate: 96000 })).sampleRate).toBeCloseTo(96000, 0);
  });

  it('handles 24-bit, which is common on vinyl rips', () => {
    const aiff = makeAiff({ bitDepth: 24, frames: 2, samples: [[0x400000, -0x400000]] });
    const out = decodeAiff(aiff);
    expect(out.channels[0][0]).toBeCloseTo(0.5, 4);
    expect(out.channels[0][1]).toBeCloseTo(-0.5, 4);
  });

  it('handles 8-bit as signed, unlike WAV', () => {
    const out = decodeAiff(makeAiff({ bitDepth: 8, frames: 2, samples: [[64, -64]] }));
    expect(out.channels[0][0]).toBeCloseTo(0.5, 4);
    expect(out.channels[0][1]).toBeCloseTo(-0.5, 4);
  });

  it('explains a compressed AIFC rather than emitting noise', () => {
    const aiff = makeAiff({ compression: 'ima4' });
    expect(() => decodeAiff(aiff)).toThrow(AiffError);
    expect(() => decodeAiff(aiff)).toThrow(/compressed AIFF/);
    // Must reassure that the file itself is fine.
    expect(() => decodeAiff(aiff)).toThrow(/track itself is fine/);
  });

  it('accepts sowt, which is just little-endian PCM', () => {
    // Only checks it is not rejected as compressed; byte order is exercised by
    // the value assertions above for the big-endian case.
    expect(() => decodeAiff(makeAiff({ compression: 'sowt' }))).not.toThrow();
  });

  it('refuses a file that is not an AIFF', () => {
    expect(() => decodeAiff(new Uint8Array([1, 2, 3, 4]))).toThrow(/not an AIFF/);
  });

  it('reports a truncated file instead of reading past the end', () => {
    const full = makeAiff({ frames: 100 });
    // Cut the audio data in half; the header still claims 100 frames.
    const cut = full.slice(0, full.length - 100);
    const out = decodeAiff(cut);
    // Decodes what survived rather than throwing — a partial preview beats none.
    expect(out.frames).toBeGreaterThan(0);
    expect(out.frames).toBeLessThan(100);
  });

  it('does not hang or throw on a header with zero channels', () => {
    expect(() => decodeAiff(makeAiff({ channels: 0 }))).toThrow(AiffError);
  });
});

describe('format routing', () => {
  it('sends AIFF down the manual path', () => {
    expect(needsManualDecode('/Contents/A/B.aiff')).toBe(true);
    expect(needsManualDecode('/Contents/A/B.AIF')).toBe(true);
    expect(playsNatively('/Contents/A/B.aiff')).toBe(false);
  });

  it('lets the browser handle what it can', () => {
    expect(playsNatively('/Contents/A/B.mp3')).toBe(true);
    expect(playsNatively('/Contents/A/B.flac')).toBe(true);
    expect(needsManualDecode('/Contents/A/B.mp3')).toBe(false);
  });
});
