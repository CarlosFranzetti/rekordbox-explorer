import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '@/test/fixtures/memory-fs';
import { buildFixturePdb, sampleLibrary } from '@/test/fixtures/pdb-fixture';
import { RECOVERY_NOTE_FILENAME } from './recovery-note';
import {
  DEFAULT_BACKUP_LIMIT,
  createBackup,
  deleteBackup,
  listBackups,
  pruneBackups,
  restoreBackup,
  verifyBackup,
} from './backup';

const DB_PATH = 'PIONEER/rekordbox/export.pdb';
const EXT_PATH = 'PIONEER/rekordbox/exportExt.pdb';

function makeDrive(options: { withExt?: boolean } = {}) {
  const fs = new MemoryFileSystem();
  fs.seed(DB_PATH, new Uint8Array(buildFixturePdb(sampleLibrary())));
  if (options.withExt) fs.seed(EXT_PATH, new Uint8Array([1, 2, 3, 4, 5]));
  return fs;
}

describe('createBackup', () => {
  let fs: MemoryFileSystem;

  beforeEach(() => {
    fs = makeDrive({ withExt: true });
  });

  it('writes a verified copy to both vaults', async () => {
    const result = await createBackup(fs.root, { reason: 'manual', label: 'test' });

    expect(result.verifiedVaults).toEqual(['primary', 'mirror']);
    expect(result.warnings).toEqual([]);
    expect(result.set.files.map((f) => f.name).sort()).toEqual([
      'export.pdb',
      'exportExt.pdb',
    ]);

    expect(fs.peek(`RBXPLORER_BACKUPS/${result.set.id}/export.pdb`)).not.toBeNull();
    expect(
      fs.peek(`PIONEER/rekordbox/RBXPLORER_SAFETY/${result.set.id}/export.pdb`)
    ).not.toBeNull();
  });

  it('stores byte-identical copies', async () => {
    const original = fs.peek(DB_PATH)!;
    const { set } = await createBackup(fs.root, { reason: 'manual' });

    expect(fs.peek(`RBXPLORER_BACKUPS/${set.id}/export.pdb`)).toEqual(original);
    expect(
      fs.peek(`PIONEER/rekordbox/RBXPLORER_SAFETY/${set.id}/export.pdb`)
    ).toEqual(original);
  });

  it('writes the recovery note at the drive root', async () => {
    await createBackup(fs.root, { reason: 'manual' });
    const note = fs.peek(RECOVERY_NOTE_FILENAME);
    expect(note).not.toBeNull();

    const text = new TextDecoder().decode(note!);
    expect(text).toContain('WHAT TO DO IF THIS WENT TO SHIT');
    expect(text).toContain('/RBXPLORER_BACKUPS');
    expect(text).toContain('/PIONEER/rekordbox/RBXPLORER_SAFETY');
  });

  it('records track and playlist counts when provided', async () => {
    const { set } = await createBackup(fs.root, {
      reason: 'pre-write',
      stats: { tracks: 1200, playlists: 42 },
    });
    expect(set.stats).toEqual({ tracks: 1200, playlists: 42 });
  });

  it('still succeeds with one vault when the other cannot be created', async () => {
    fs.faults.failMkdirMatching = /RBXPLORER_SAFETY/;

    const result = await createBackup(fs.root, { reason: 'manual' });
    expect(result.verifiedVaults).toEqual(['primary']);
    expect(result.warnings.join(' ')).toMatch(/no mirror/i);
  });

  it('refuses to report success when copies do not verify', async () => {
    fs.faults.corruptWritesMatching = /export\.pdb$/;

    await expect(createBackup(fs.root, { reason: 'pre-write' })).rejects.toThrow(
      /Backup failed in every location/
    );
  });

  it('throws when there is no database to back up', async () => {
    const empty = new MemoryFileSystem();
    empty.seed('PIONEER/rekordbox/readme.txt', new Uint8Array([1]));
    await expect(createBackup(empty.root, { reason: 'manual' })).rejects.toThrow(
      /No rekordbox database/
    );
  });

  it('throws when the drive has no PIONEER folder', async () => {
    const empty = new MemoryFileSystem();
    await expect(createBackup(empty.root, { reason: 'manual' })).rejects.toThrow(
      /PIONEER\/rekordbox/
    );
  });
});

describe('listBackups', () => {
  it('merges snapshots across vaults without duplicating them', async () => {
    const fs = makeDrive();
    const a = await createBackup(fs.root, { reason: 'manual', label: 'one' });
    const b = await createBackup(fs.root, { reason: 'pre-write', label: 'two' });

    const health = await listBackups(fs.root);
    const ids = health.sets.map((s) => s.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(a.set.id);
    expect(ids).toContain(b.set.id);
    expect(health.sets.every((s) => s.vaults.length === 2)).toBe(true);
    expect(health.singleCopyIds).toEqual([]);
  });

  it('flags snapshots that exist in only one vault', async () => {
    const fs = makeDrive();
    const { set } = await createBackup(fs.root, { reason: 'manual' });

    const safety = await fs.root.getDirectoryHandle('PIONEER');
    const rb = await safety.getDirectoryHandle('rekordbox');
    const vault = await rb.getDirectoryHandle('RBXPLORER_SAFETY');
    await vault.removeEntry(set.id, { recursive: true });

    const health = await listBackups(fs.root);
    expect(health.singleCopyIds).toEqual([set.id]);
    expect(health.sets[0].vaults).toEqual(['primary']);
  });

  it('survives a snapshot folder with a corrupt manifest', async () => {
    const fs = makeDrive();
    const { set } = await createBackup(fs.root, { reason: 'manual' });
    fs.seed(`RBXPLORER_BACKUPS/${set.id}/backup.json`, new TextEncoder().encode('{not json'));

    const health = await listBackups(fs.root);
    expect(health.warnings.join(' ')).toMatch(/corrupt manifest/i);
    // Still discoverable via the mirror.
    expect(health.sets.map((s) => s.id)).toContain(set.id);
  });

  it('works with no manifest.json index at all', async () => {
    const fs = makeDrive();
    await createBackup(fs.root, { reason: 'manual' });

    const vault = await fs.root.getDirectoryHandle('RBXPLORER_BACKUPS');
    await vault.removeEntry('manifest.json');

    const health = await listBackups(fs.root);
    expect(health.sets).toHaveLength(1);
  });

  it('returns nothing for a drive with no vaults', async () => {
    const fs = makeDrive();
    const health = await listBackups(fs.root);
    expect(health.sets).toEqual([]);
  });
});

describe('verifyBackup', () => {
  it('passes for an intact snapshot', async () => {
    const fs = makeDrive({ withExt: true });
    const { set } = await createBackup(fs.root, { reason: 'manual' });

    const report = await verifyBackup(fs.root, set);
    expect(report.ok).toBe(true);
    expect(report.checked.every((c) => c.ok)).toBe(true);
  });

  it('detects a tampered copy but stays ok while a good copy remains', async () => {
    const fs = makeDrive();
    const { set } = await createBackup(fs.root, { reason: 'manual' });
    fs.seed(`RBXPLORER_BACKUPS/${set.id}/export.pdb`, new Uint8Array([9, 9, 9]));

    const report = await verifyBackup(fs.root, set);
    expect(report.checked.some((c) => !c.ok)).toBe(true);
    expect(report.ok).toBe(true); // mirror still good
  });

  it('fails when every copy is damaged', async () => {
    const fs = makeDrive();
    const { set } = await createBackup(fs.root, { reason: 'manual' });
    fs.seed(`RBXPLORER_BACKUPS/${set.id}/export.pdb`, new Uint8Array([9]));
    fs.seed(
      `PIONEER/rekordbox/RBXPLORER_SAFETY/${set.id}/export.pdb`,
      new Uint8Array([8])
    );

    expect((await verifyBackup(fs.root, set)).ok).toBe(false);
  });
});

describe('restoreBackup', () => {
  it('puts the saved database back and snapshots the current state first', async () => {
    const fs = makeDrive();
    const original = fs.peek(DB_PATH)!;
    const { set } = await createBackup(fs.root, { reason: 'manual' });

    // Simulate a later, different state on the drive.
    fs.seed(DB_PATH, new Uint8Array(buildFixturePdb({ nodes: [], entries: [] })));
    expect(fs.peek(DB_PATH)).not.toEqual(original);

    const result = await restoreBackup(fs.root, set);

    expect(result.restored).toEqual(['export.pdb']);
    expect(fs.peek(DB_PATH)).toEqual(original);
    expect(result.safetySnapshotId).toBeTruthy();
  });

  it('the pre-restore snapshot can itself be restored', async () => {
    const fs = makeDrive();
    const first = await createBackup(fs.root, { reason: 'manual' });

    const changed = new Uint8Array(buildFixturePdb({ nodes: [], entries: [] }));
    fs.seed(DB_PATH, changed);

    const result = await restoreBackup(fs.root, first.set);
    const health = await listBackups(fs.root);
    const safety = health.sets.find((s) => s.id === result.safetySnapshotId)!;

    await restoreBackup(fs.root, safety);
    expect(fs.peek(DB_PATH)).toEqual(changed);
  });

  it('aborts without touching the database when the source fails its checksum', async () => {
    const fs = makeDrive();
    const { set } = await createBackup(fs.root, { reason: 'manual' });

    const live = new Uint8Array(buildFixturePdb({ nodes: [], entries: [] }));
    fs.seed(DB_PATH, live);
    fs.seed(`RBXPLORER_BACKUPS/${set.id}/export.pdb`, new Uint8Array([1, 2, 3]));
    fs.seed(
      `PIONEER/rekordbox/RBXPLORER_SAFETY/${set.id}/export.pdb`,
      new Uint8Array([4, 5, 6])
    );

    await expect(restoreBackup(fs.root, set)).rejects.toThrow(/fails its checksum/);
    expect(fs.peek(DB_PATH)).toEqual(live);
  });

  it('recovers from the mirror when the primary copy is damaged', async () => {
    const fs = makeDrive();
    const original = fs.peek(DB_PATH)!;
    const { set } = await createBackup(fs.root, { reason: 'manual' });

    fs.seed(`RBXPLORER_BACKUPS/${set.id}/export.pdb`, new Uint8Array([0, 0, 0]));
    fs.seed(DB_PATH, new Uint8Array([7, 7, 7]));

    await restoreBackup(fs.root, set);
    expect(fs.peek(DB_PATH)).toEqual(original);
  });
});

describe('rotation', () => {
  it('keeps only the configured number of snapshots', async () => {
    const fs = makeDrive();

    for (let i = 0; i < DEFAULT_BACKUP_LIMIT + 3; i++) {
      // Vary content so each snapshot is distinguishable.
      fs.seed(DB_PATH, new Uint8Array(buildFixturePdb({ nodes: [], entries: [], sequence: i })));
      await createBackup(fs.root, { reason: 'manual', label: `run ${i}` });
    }

    const health = await listBackups(fs.root);
    expect(health.sets.length).toBeLessThanOrEqual(DEFAULT_BACKUP_LIMIT);
  });

  it('never prunes the snapshot just created', async () => {
    const fs = makeDrive();
    let latestId = '';
    for (let i = 0; i < 8; i++) {
      fs.seed(DB_PATH, new Uint8Array(buildFixturePdb({ nodes: [], entries: [], sequence: i })));
      latestId = (await createBackup(fs.root, { reason: 'manual', limit: 3 })).set.id;
    }

    const health = await listBackups(fs.root);
    expect(health.sets.map((s) => s.id)).toContain(latestId);
    expect(health.sets.length).toBeLessThanOrEqual(3);
  });

  it('clamps an absurd limit into range', async () => {
    const fs = makeDrive();
    for (let i = 0; i < 6; i++) {
      fs.seed(DB_PATH, new Uint8Array(buildFixturePdb({ nodes: [], entries: [], sequence: i })));
      await createBackup(fs.root, { reason: 'manual', limit: 0 });
    }
    const health = await listBackups(fs.root);
    // limit 0 is clamped up to MIN_BACKUP_LIMIT (3), not down to zero.
    expect(health.sets.length).toBe(3);
  });

  it('prunes from both vaults', async () => {
    const fs = makeDrive();
    for (let i = 0; i < 6; i++) {
      fs.seed(DB_PATH, new Uint8Array(buildFixturePdb({ nodes: [], entries: [], sequence: i })));
      await createBackup(fs.root, { reason: 'manual', limit: 3 });
    }

    const primaryDirs = fs.paths().filter((p) => p.startsWith('RBXPLORER_BACKUPS/'));
    const mirrorDirs = fs.paths().filter((p) => p.includes('RBXPLORER_SAFETY/'));
    const setCount = (paths: string[]) =>
      new Set(paths.map((p) => p.split('/').slice(0, -1).join('/'))).size;

    // Each vault has 3 snapshot folders plus its manifest.json at the top.
    expect(setCount(primaryDirs)).toBe(4);
    expect(setCount(mirrorDirs)).toBe(4);
  });

  it('pruneBackups reports what it removed', async () => {
    const fs = makeDrive();
    for (let i = 0; i < 5; i++) {
      fs.seed(DB_PATH, new Uint8Array(buildFixturePdb({ nodes: [], entries: [], sequence: i })));
      await createBackup(fs.root, { reason: 'manual', limit: 20 });
    }

    const removed = await pruneBackups(fs.root, 3);
    expect(removed).toHaveLength(2);
    expect((await listBackups(fs.root)).sets).toHaveLength(3);
  });
});

describe('deleteBackup', () => {
  it('removes a snapshot from both vaults', async () => {
    const fs = makeDrive();
    const { set } = await createBackup(fs.root, { reason: 'manual' });

    await deleteBackup(fs.root, set.id);

    expect((await listBackups(fs.root)).sets).toHaveLength(0);
    expect(fs.paths().some((p) => p.includes(set.id))).toBe(false);
  });

  it('throws for an unknown snapshot', async () => {
    const fs = makeDrive();
    await createBackup(fs.root, { reason: 'manual' });
    await expect(deleteBackup(fs.root, 'nope')).rejects.toThrow(/not found/);
  });
});
