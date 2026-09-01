import { describe, it, expect } from 'vitest';
import { decodeWav, isWav, WavError } from './wav';

/**
 * The decoder only runs when the browser has already refused a file, so these
 * cover the awkward variants rather than plain 16-bit PCM: 24-bit vinyl rips,
 * 32-bit float masters, and WAVE_FORMAT_EXTENSIBLE from professional tools.
 */
function makeWav(opts: {
  format?: number;
  channels?: number;
  frames?: number;
  bitDepth?: number;
  sampleRate?: number;
  extensible?: number;
  samples?: number[][];
}): Uint8Array {
  const format = opts.extensible !== undefined ? 0xfffe : (opts.format ?? 1);
  const channels = opts.channels ?? 1;
  const frames = opts.frames ?? 4;
  const bitDepth = opts.bitDepth ?? 16;
  const sampleRate = opts.sampleRate ?? 44100;
  const bps = bitDepth / 8;
  const fmtSize = opts.extensible !== undefined ? 40 : 16;
  const dataSize = frames * channels * bps;
  const total = 12 + 8 + fmtSize + 8 + dataSize;

  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  const write4 = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(o + i, s.charCodeAt(i));
  };

  write4(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  write4(8, 'WAVE');

  write4(12, 'fmt ');
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bps, true);
  view.setUint16(32, channels * bps, true);
  view.setUint16(34, bitDepth, true);
  if (opts.extensible !== undefined) {
    view.setUint16(36, 22, true); // cbSize
    view.setUint16(38, bitDepth, true);
    view.setUint32(40, 0, true); // channel mask
    view.setUint16(44, opts.extensible, true); // real format tag, start of GUID
  }

  const dataAt = 12 + 8 + fmtSize;
  write4(dataAt, 'data');
  view.setUint32(dataAt + 4, dataSize, true);
  let at = dataAt + 8;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const v = opts.samples?.[c]?.[f] ?? 0;
      if (format === 3 || opts.extensible === 3) view.setFloat32(at, v, true);
      else if (bps === 1) view.setUint8(at, v);
      else if (bps === 2) view.setInt16(at, v, true);
      else if (bps === 3) {
        view.setUint8(at, v & 0xff);
        view.setUint8(at + 1, (v >> 8) & 0xff);
        view.setUint8(at + 2, (v >> 16) & 0xff);
      } else view.setInt32(at, v, true);
      at += bps;
    }
  }
  return buf;
}

describe('isWav', () => {
  it('accepts RIFF/WAVE and rejects everything else', () => {
    expect(isWav(makeWav({}))).toBe(true);
    expect(isWav(new Uint8Array([0x46, 0x4f, 0x52, 0x4d]))).toBe(false); // FORM/AIFF
    expect(isWav(new Uint8Array(0))).toBe(false);
  });
});

describe('decodeWav', () => {
  it('decodes 16-bit PCM', () => {
    const out = decodeWav(makeWav({ samples: [[0, 16384, -16384, 32767]] }));
    expect(out.sampleRate).toBe(44100);
    expect(out.frames).toBe(4);
    expect(out.channels[0][1]).toBeCloseTo(0.5, 4);
    expect(out.channels[0][2]).toBeCloseTo(-0.5, 4);
  });

  it('treats 8-bit as UNSIGNED, the opposite of AIFF', () => {
    // Getting this backwards yields a loud DC offset rather than an obvious bug.
    const out = decodeWav(makeWav({ bitDepth: 8, frames: 2, samples: [[192, 64]] }));
    expect(out.channels[0][0]).toBeCloseTo(0.5, 4);
    expect(out.channels[0][1]).toBeCloseTo(-0.5, 4);
  });

  it('decodes 24-bit, which is what vinyl rips usually are', () => {
    const out = decodeWav(makeWav({ bitDepth: 24, frames: 2, samples: [[0x400000, -0x400000]] }));
    expect(out.channels[0][0]).toBeCloseTo(0.5, 4);
    expect(out.channels[0][1]).toBeCloseTo(-0.5, 4);
  });

  it('decodes 32-bit float', () => {
    const out = decodeWav(
      makeWav({ format: 3, bitDepth: 32, frames: 3, samples: [[0.25, -0.75, 1]] })
    );
    expect(out.channels[0][0]).toBeCloseTo(0.25, 5);
    expect(out.channels[0][1]).toBeCloseTo(-0.75, 5);
  });

  it('unwraps WAVE_FORMAT_EXTENSIBLE to find the real format', () => {
    const out = decodeWav(
      makeWav({ extensible: 3, bitDepth: 32, frames: 2, samples: [[0.5, -0.5]] })
    );
    expect(out.channels[0][0]).toBeCloseTo(0.5, 5);
  });

  it('deinterleaves stereo', () => {
    const out = decodeWav(
      makeWav({ channels: 2, frames: 2, samples: [[1000, 2000], [-1000, -2000]] })
    );
    expect(out.channels).toHaveLength(2);
    expect(out.channels[1][1]).toBeCloseTo(-2000 / 32768, 5);
  });

  it('explains a compressed WAV rather than emitting noise', () => {
    const w = makeWav({ format: 0x0011 }); // IMA ADPCM
    expect(() => decodeWav(w)).toThrow(WavError);
    expect(() => decodeWav(w)).toThrow(/track itself is fine/);
  });

  it('decodes what survived of a truncated file', () => {
    const full = makeWav({ frames: 100 });
    const cut = full.slice(0, full.length - 120);
    const out = decodeWav(cut);
    expect(out.frames).toBeGreaterThan(0);
    expect(out.frames).toBeLessThan(100);
  });

  it('refuses a file that is not a WAV', () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a WAV/);
  });
});
