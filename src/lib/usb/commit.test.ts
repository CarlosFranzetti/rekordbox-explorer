import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '@/test/fixtures/memory-fs';
import { buildFixturePdb, sampleLibrary } from '@/test/fixtures/pdb-fixture';
import { readPlaylistTables } from '@/lib/pdb/playlists';
import { listBackups } from './backup';
import { COMMIT_STEPS, CommitError, commitPlaylists, type CommitProgress } from './commit';

const DB_PATH = 'PIONEER/rekordbox/export.pdb';

function makeDrive() {
  const fs = new MemoryFileSystem();
  fs.seed(DB_PATH, new Uint8Array(buildFixturePdb(sampleLibrary())));
  return fs;
}

function withNewPlaylist() {
  const { nodes, entries } = sampleLibrary();
  return {
    nodes: [...nodes, { id: 50, parentId: 0, sortOrder: 5, isFolder: false, name: 'Committed' }],
    entries: [...entries, { playlistId: 50, entryIndex: 0, trackId: 4242 }],
  };
}

describe('commitPlaylists', () => {
  it('writes the new library and reports every step', async () => {
    const fs = makeDrive();
    const progress: CommitProgress[] = [];

    const result = await commitPlaylists({
      root: fs.root,
      tables: withNewPlaylist(),
      onProgress: (p) => progress.push(p),
    });

    expect(result.backup.id).toBeTruthy();
    expect(result.pagesAppended).toBeGreaterThan(0);

    const written = readPlaylistTables(fs.peek(DB_PATH)!.buffer.slice(0) as ArrayBuffer);
    expect(written.nodes.find((n) => n.name === 'Committed')).toBeDefined();
    expect(written.entries.some((e) => e.trackId === 4242)).toBe(true);

    // Every step ran and finished.
    for (const step of COMMIT_STEPS) {
      expect(progress.filter((p) => p.step === step && p.state === 'done')).toHaveLength(1);
    }
    expect(progress.some((p) => p.state === 'failed')).toBe(false);
  });

  it('takes a verified backup before writing', async () => {
    const fs = makeDrive();
    const before = fs.peek(DB_PATH)!;

    const result = await commitPlaylists({ root: fs.root, tables: withNewPlaylist() });

    const stored = fs.peek(`RBXPLORER_BACKUPS/${result.backup.id}/export.pdb`);
    expect(stored).toEqual(before);
    expect(
      fs.peek(`PIONEER/rekordbox/RBXPLORER_SAFETY/${result.backup.id}/export.pdb`)
    ).toEqual(before);
  });

  it('leaves existing playlists intact', async () => {
    const fs = makeDrive();
    const { nodes } = sampleLibrary();

    await commitPlaylists({ root: fs.root, tables: withNewPlaylist() });

    const written = readPlaylistTables(fs.peek(DB_PATH)!.buffer.slice(0) as ArrayBuffer);
    for (const original of nodes) {
      expect(written.nodes.find((n) => n.id === original.id)?.name).toBe(original.name);
    }
  });

  it('refreshes the recovery note', async () => {
    const fs = makeDrive();
    await commitPlaylists({ root: fs.root, tables: withNewPlaylist() });

    const note = new TextDecoder().decode(fs.peek('WHATTODOIFTHISWENTTOSHIT.txt')!);
    expect(note).toContain('WHAT TO DO IF THIS WENT TO SHIT');
  });

  it('aborts before writing when the backup cannot be verified', async () => {
    const fs = makeDrive();
    const before = fs.peek(DB_PATH)!;
    fs.faults.corruptWritesMatching = /export\.pdb$/;

    await expect(
      commitPlaylists({ root: fs.root, tables: withNewPlaylist() })
    ).rejects.toMatchObject({ step: 'backup' });

    // The live database is exactly as it was.
    expect(fs.peek(DB_PATH)).toEqual(before);
  });

  it('rolls back automatically when the drive fails verification after writing', async () => {
    const fs = makeDrive();
    const before = fs.peek(DB_PATH)!;

    // Let the backup succeed, then start corrupting the live database write.
    let backupDone = false;
    const error = await commitPlaylists({
      root: fs.root,
      tables: withNewPlaylist(),
      onProgress: (p) => {
        if (p.step === 'backup' && p.state === 'done') {
          backupDone = true;
          fs.faults.corruptWritesMatching = /^export\.pdb$/;
        }
        if (p.step === 'write' && p.state === 'done') {
          // Stop corrupting so the rollback restore can succeed.
          fs.faults.corruptWritesMatching = undefined;
        }
      },
    }).catch((e: CommitError) => e);

    expect(backupDone).toBe(true);
    expect(error).toBeInstanceOf(CommitError);
    expect((error as CommitError).step).toBe('verify-drive');
    expect((error as CommitError).rolledBack).toBe(true);
    expect(fs.peek(DB_PATH)).toEqual(before);
  });

  it('fails cleanly when the drive rejects the write', async () => {
    const fs = makeDrive();
    const before = fs.peek(DB_PATH)!;

    const error = await commitPlaylists({
      root: fs.root,
      tables: withNewPlaylist(),
      onProgress: (p) => {
        if (p.step === 'backup' && p.state === 'done') {
          fs.faults.failWritesMatching = /^export\.pdb$/;
        }
        if (p.step === 'write' && p.state === 'failed') {
          fs.faults.failWritesMatching = undefined;
        }
      },
    }).catch((e: CommitError) => e);

    expect((error as CommitError).step).toBe('write');
    expect(fs.peek(DB_PATH)).toEqual(before);
  });

  it('rejects an invalid draft before touching the drive', async () => {
    const fs = makeDrive();
    const before = fs.peek(DB_PATH)!;

    const error = await commitPlaylists({
      root: fs.root,
      tables: {
        nodes: [{ id: 1, parentId: 0, sortOrder: 0, isFolder: false, name: 'dup' }],
        entries: [{ playlistId: 999, entryIndex: 0, trackId: 1 }],
      },
    }).catch((e: CommitError) => e);

    expect((error as CommitError).step).toBe('build');
    expect(fs.peek(DB_PATH)).toEqual(before);
  });

  it('fails at read when there is no database', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('PIONEER/rekordbox/other.txt', new Uint8Array([1]));

    const error = await commitPlaylists({
      root: fs.root,
      tables: sampleLibrary(),
    }).catch((e: CommitError) => e);

    expect((error as CommitError).step).toBe('read');
  });

  it('keeps a usable backup history across repeated commits', async () => {
    const fs = makeDrive();

    for (let i = 0; i < 3; i++) {
      const { nodes, entries } = sampleLibrary();
      await commitPlaylists({
        root: fs.root,
        tables: {
          nodes: [
            ...nodes,
            { id: 60 + i, parentId: 0, sortOrder: 9, isFolder: false, name: `Run ${i}` },
          ],
          entries,
        },
      });
    }

    const health = await listBackups(fs.root);
    expect(health.sets.length).toBeGreaterThanOrEqual(3);
    expect(health.sets.every((s) => s.vaults.length === 2)).toBe(true);
  });
});
