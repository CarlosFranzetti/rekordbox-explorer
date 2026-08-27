import { describe, it, expect } from 'vitest';
import { identifyFile } from './file-sniff';

/** Build a buffer from a list of ASCII strings / byte arrays. */
function bytes(...parts: (string | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
}

/** Pad to at least `n` bytes so the 16-byte minimum check passes. */
function pad(b: Uint8Array, n = 64): Uint8Array {
  const out = new Uint8Array(Math.max(b.length, n));
  out.set(b);
  return out;
}

describe('identifyFile', () => {
  it('names the AIFF file from the production bug report', () => {
    // The exact shape that produced "Invalid number of tables: 1179011393".
    const aiff = pad(bytes('FORM', [0x00, 0x1d, 0x4c, 0x86], 'AIFF'));

    // Confirm the premise: those bytes really do read as that table count.
    const view = new DataView(aiff.buffer);
    expect(view.getUint32(0x08, true)).toBe(1179011393);

    const id = identifyFile(aiff, 'Some Track.aiff');
    expect(id.parseable).toBe(false);
    expect(id.kind).toBe('aiff');
    expect(id.message).toContain('AIFF audio file');
    expect(id.message).toContain('export.pdb');
    // The number the user saw must not survive into the message.
    expect(id.message).not.toContain('1179011393');
  });

  it.each([
    ['wav', pad(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))],
    ['mp3', pad(bytes('ID3', [3, 0, 0]))],
    ['mp3', pad(bytes([0xff, 0xfb, 0x90, 0x00]))],
    ['flac', pad(bytes('fLaC'))],
    ['mp4', pad(bytes([0, 0, 0, 0x20], 'ftypM4A '))],
    ['ogg', pad(bytes('OggS'))],
  ])('rejects %s as the wrong file', (kind, buf) => {
    const id = identifyFile(buf, 'track');
    expect(id.parseable).toBe(false);
    expect(id.kind).toBe(kind);
    expect(id.message).toMatch(/audio file/);
  });

  it('recognises a OneLibrary database by name, since it is encrypted', () => {
    const encrypted = pad(bytes([0xbc, 0x6e, 0xa9, 0x5d, 0xa2, 0x52, 0x53, 0x4e]));
    const id = identifyFile(encrypted, 'exportLibrary.db');
    expect(id.kind).toBe('onelibrary');
    expect(id.message).toContain('OneLibrary');
  });

  it('distinguishes a plain SQLite file from a rekordbox export', () => {
    const id = identifyFile(pad(bytes('SQLite format 3\0')), 'master.db');
    expect(id.kind).toBe('sqlite');
    expect(id.parseable).toBe(false);
  });

  it('accepts something shaped like a real PDB', () => {
    // Page length 4096 at offset 0x04 is the only thing the sniffer asks for.
    const pdb = new Uint8Array(64);
    new DataView(pdb.buffer).setUint32(0x04, 4096, true);
    const id = identifyFile(pdb, 'export.pdb');
    expect(id.parseable).toBe(true);
    expect(id.kind).toBe('pdb');
  });

  it('rejects an empty or truncated file without throwing', () => {
    expect(identifyFile(new Uint8Array(0), 'x').parseable).toBe(false);
    expect(identifyFile(new Uint8Array(4), 'x').kind).toBe('empty');
  });

  it('honours DataView byteOffset when handed a subarray', () => {
    // A sliced view must not be read from the start of its backing buffer.
    const backing = new Uint8Array(128);
    backing.set(bytes('FORM', [0, 0, 0, 0], 'AIFF'), 32);
    const slice = backing.subarray(32);
    expect(identifyFile(slice, 'x').kind).toBe('aiff');
  });
});
