import { describe, it, expect } from 'vitest';
import { assessPdb, assessSqlite, describeSidecar } from './assess';

/**
 * These fixtures reproduce the exact failure shape of a real drive that was
 * pulled without ejecting: three databases that each stopped at 32 KB, and a
 * SQLite file grown to full size with its contents never written.
 *
 * They are synthesised rather than copied from that drive, because the real
 * files carry someone's library.
 */

const PAGE = 4096;

/** A PDB whose header claims `declaredPages` but whose file holds `actualPages`. */
function makePdb(actualPages: number, declaredPages: number, blankFrom = Infinity): Uint8Array {
  const bytes = new Uint8Array(actualPages * PAGE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x04, PAGE, true); // len_page
  view.setUint32(0x08, 20, true); // num_tables
  view.setUint32(0x0c, declaredPages, true); // next_unused_page
  view.setUint32(0x14, 7839, true); // sequence
  // Give every non-blank page a byte so it is not counted as unwritten.
  for (let p = 0; p < Math.min(actualPages, blankFrom); p++) bytes[p * PAGE + 0x30] = 0xaa;
  return bytes;
}

/** A SQLite image declaring `declaredPages`, holding `actualPages`, `blank` of them zeroed. */
function makeSqlite(actualPages: number, declaredPages: number, blank = 0): Uint8Array {
  const bytes = new Uint8Array(actualPages * PAGE);
  const enc = new TextEncoder().encode('SQLite format 3\0');
  bytes.set(enc, 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(16, PAGE); // page size, big-endian
  bytes[20] = 0; // reserve
  view.setUint32(28, declaredPages); // page count
  for (let p = 0; p < actualPages - blank; p++) bytes[p * PAGE + 0x50] = 0x0d;
  return bytes;
}

describe('assessPdb', () => {
  it('calls a healthy database complete', () => {
    const a = assessPdb(makePdb(184, 184));
    expect(a.health).toBe('ok');
    expect(a.completeness).toBe(1);
  });

  it('recognises the real casualty: 8 pages where the header claims 184', () => {
    const a = assessPdb(makePdb(8, 184));
    expect(a.health).toBe('truncated');
    expect(a.pagesPresent).toBe(8);
    expect(a.pagesExpected).toBe(184);
    expect(Math.round(a.completeness * 1000) / 10).toBeCloseTo(4.3, 1);
    // Must say it cannot be repaired, not just that it is broken.
    expect(a.summary).toMatch(/cannot be repaired/);
    expect(a.detail.join(' ')).toMatch(/never finished being written/);
  });

  it('does not call an unwritten file "corrupt"', () => {
    // The distinction that matters: absent data sends you looking for another
    // copy; corrupt data sends you looking for a repair tool that cannot work.
    const a = assessPdb(makePdb(8, 184));
    expect(a.summary).not.toMatch(/corrupt/i);
  });

  it('rejects a file with an implausible header rather than guessing', () => {
    const junk = new Uint8Array(4096);
    new DataView(junk.buffer).setUint32(0x04, 1179011393, true);
    expect(assessPdb(junk).health).toBe('unreadable');
  });

  it('survives a file too short to hold a header', () => {
    expect(assessPdb(new Uint8Array(4)).health).toBe('unreadable');
  });
});

describe('assessSqlite', () => {
  it('calls a healthy database complete', () => {
    expect(assessSqlite(makeSqlite(131, 131)).health).toBe('ok');
  });

  it('recognises a file grown to full size but never filled', () => {
    // exportLibrary.db on the real drive: 131 pages present, 122 all zero.
    const a = assessSqlite(makeSqlite(131, 131, 122));
    expect(a.health).toBe('unwritten');
    expect(a.pagesBlank).toBe(122);
    expect(a.summary).toMatch(/never written/);
  });

  it('recognises a slightly truncated file as worth salvaging', () => {
    // Engine's m.db: 616 pages of a declared 620 — the one that saved the day.
    const a = assessSqlite(makeSqlite(616, 620));
    expect(a.health).toBe('truncated');
    expect(a.summary).toMatch(/worth salvaging/);
    expect(a.completeness).toBeGreaterThan(0.99);
  });

  it('refuses a file that is not SQLite at all', () => {
    expect(assessSqlite(new Uint8Array(4096)).health).toBe('unreadable');
  });

  it('does not mistake an encrypted OneLibrary file for a readable one', () => {
    const encrypted = new Uint8Array(4096);
    encrypted.set([0xf4, 0x63, 0xe6, 0xf4], 0); // random-looking salt
    const a = assessSqlite(encrypted);
    expect(a.health).toBe('unreadable');
    expect(a.detail.join(' ')).toMatch(/decrypted first/);
  });
});

describe('describeSidecar', () => {
  it('stays quiet about an empty journal, which means nothing is pending', () => {
    expect(describeSidecar('exportLibrary.db-journal', 0)).toBeNull();
  });

  it('warns about a journal with contents', () => {
    const note = describeSidecar('exportLibrary.db-journal', 40960);
    expect(note).toMatch(/in progress/);
    expect(note).toMatch(/half-applied/);
  });

  it('warns that a write-ahead log cannot be replayed here', () => {
    const note = describeSidecar('exportLibrary.db-wal', 1_100_000);
    expect(note).toMatch(/cannot be/);
    expect(note).toMatch(/1074 KB|1100 KB|1074|1075/);
  });

  it('says nothing about an unrelated file', () => {
    expect(describeSidecar('export.pdb', 4096)).toBeNull();
  });
});
