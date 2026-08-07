import { describe, expect, it } from 'vitest';
import {
  SHORT_ASCII_MAX_BYTES,
  decodeDeviceSqlString,
  encodeDeviceSqlString,
  encodedDeviceSqlLength,
} from './devicesql';

function roundTrip(text: string) {
  const encoded = encodeDeviceSqlString(text);
  const padded = new Uint8Array(encoded.length + 8);
  padded.set(encoded, 4); // place at a nonzero offset to catch offset bugs
  const view = new DataView(padded.buffer);
  return decodeDeviceSqlString(view, 4, padded.length);
}

describe('DeviceSQL string codec', () => {
  it('round-trips short ASCII', () => {
    const decoded = roundTrip('Peak Time');
    expect(decoded?.text).toBe('Peak Time');
    expect(decoded?.byteLength).toBe('Peak Time'.length + 1);
  });

  it('uses the short form up to the header limit', () => {
    const text = 'x'.repeat(SHORT_ASCII_MAX_BYTES);
    const encoded = encodeDeviceSqlString(text);
    expect(encoded[0] & 1).toBe(1);
    expect(encoded[0]).toBe(255);
    expect(roundTrip(text)?.text).toBe(text);
  });

  it('switches to long ASCII past the short limit', () => {
    const text = 'y'.repeat(SHORT_ASCII_MAX_BYTES + 1);
    const encoded = encodeDeviceSqlString(text);
    expect(encoded[0]).toBe(0x40);
    expect(roundTrip(text)?.text).toBe(text);
  });

  it('encodes non-ASCII as UTF-16LE', () => {
    const text = 'Björk — Homogénic ♥';
    const encoded = encodeDeviceSqlString(text);
    expect(encoded[0]).toBe(0x90);
    expect(roundTrip(text)?.text).toBe(text);
  });

  it('round-trips astral-plane characters', () => {
    const text = 'set 🎧 one';
    expect(roundTrip(text)?.text).toBe(text);
  });

  it('reports the same length it will encode', () => {
    for (const text of ['a', 'Peak Time', 'z'.repeat(200), 'ü', '🎧']) {
      expect(encodedDeviceSqlLength(text)).toBe(encodeDeviceSqlString(text).length);
    }
  });

  it('refuses to read past the supplied limit', () => {
    const encoded = encodeDeviceSqlString('truncated string here');
    const view = new DataView(encoded.buffer);
    expect(decodeDeviceSqlString(view, 0, 4)).toBeNull();
  });

  it('returns null for an unrecognised kind byte', () => {
    const bytes = new Uint8Array([0x02, 0, 0, 0, 0]);
    expect(decodeDeviceSqlString(new DataView(bytes.buffer), 0, bytes.length)).toBeNull();
  });

  it('honours a DataView with a nonzero byteOffset', () => {
    const encoded = encodeDeviceSqlString('offset safe');
    const backing = new Uint8Array(encoded.length + 16);
    backing.set(encoded, 16);
    const view = new DataView(backing.buffer, 16);
    expect(decodeDeviceSqlString(view, 0, view.byteLength)?.text).toBe('offset safe');
  });
});
