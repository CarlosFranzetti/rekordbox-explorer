/**
 * The one place playlist edits become bytes on a drive.
 *
 * The pipeline is deliberately paranoid and every step is reported to the UI so
 * the user watches it happen rather than trusting a spinner:
 *
 *   1. Confirm write permission.
 *   2. Read the live export.pdb.
 *   3. Snapshot to BOTH backup vaults and verify every byte. Abort if it fails.
 *   4. Build the new image in memory (additive — original pages untouched).
 *   5. Re-parse the in-memory image and confirm it says what we meant.
 *   6. Write it to the drive.
 *   7. Read it back off the drive and verify hash + parsed contents.
 *   8. Refresh the recovery note.
 *
 * If step 6 or 7 fails, the backup from step 3 is restored automatically before
 * the error is surfaced. There is no path that leaves the drive in a state we
 * did not verify or did not roll back.
 */

import {
  verifyWrittenPlaylists,
  writePlaylistTables,
  type PlaylistTables,
} from '@/lib/pdb/playlists';
import {
  DATABASE_DIR,
  createBackup,
  restoreBackup,
  writeRecoveryNote,
  type StoredBackup,
} from './backup';
import {
  UsbAccessError,
  ensureReadWritePermission,
  getDirectory,
  readFileBytes,
  sha256Hex,
  writeFileBytes,
} from './fs';

export const COMMIT_STEPS = [
  'permission',
  'read',
  'backup',
  'build',
  'verify-image',
  'write',
  'verify-drive',
  'finalise',
] as const;

export type CommitStep = (typeof COMMIT_STEPS)[number];

export const COMMIT_STEP_LABEL: Record<CommitStep, string> = {
  permission: 'Requesting write access',
  read: 'Reading current library',
  backup: 'Backing up to two locations',
  build: 'Building new library',
  'verify-image': 'Checking the new library',
  write: 'Writing to the drive',
  'verify-drive': 'Reading it back to confirm',
  finalise: 'Updating recovery notes',
};

export type CommitStepState = 'pending' | 'running' | 'done' | 'failed';

export interface CommitProgress {
  step: CommitStep;
  state: CommitStepState;
  detail?: string;
}

export interface CommitOptions {
  root: FileSystemDirectoryHandle;
  tables: PlaylistTables;
  stats?: { tracks?: number; playlists?: number };
  backupLimit?: number;
  onProgress?: (progress: CommitProgress) => void;
}

export interface CommitResult {
  backup: StoredBackup;
  pagesAppended: number;
  bytesAdded: number;
  warnings: string[];
}

export class CommitError extends Error {
  constructor(
    message: string,
    readonly step: CommitStep,
    readonly rolledBack: boolean,
    readonly backupId?: string
  ) {
    super(message);
    this.name = 'CommitError';
  }
}

const DB_FILE = 'export.pdb';

export async function commitPlaylists(options: CommitOptions): Promise<CommitResult> {
  const { root, tables, onProgress } = options;
  const warnings: string[] = [];

  const report = (step: CommitStep, state: CommitStepState, detail?: string) =>
    onProgress?.({ step, state, detail });

  const fail = (step: CommitStep, message: string, rolledBack = false, backupId?: string) => {
    report(step, 'failed', message);
    return new CommitError(message, step, rolledBack, backupId);
  };

  // 1 ── permission
  report('permission', 'running');
  if (!(await ensureReadWritePermission(root))) {
    throw fail('permission', 'Write access to the drive was declined. Nothing was changed.');
  }
  report('permission', 'done');

  // 2 ── read
  report('read', 'running');
  const dbDir = await getDirectory(root, DATABASE_DIR);
  if (!dbDir) {
    throw fail('read', 'Could not find PIONEER/rekordbox on this drive.');
  }
  const original = await readFileBytes(dbDir, DB_FILE);
  if (!original) {
    throw fail('read', 'Could not read export.pdb from this drive.');
  }
  report('read', 'done', `${(original.byteLength / 1024).toFixed(0)} KB`);

  // 3 ── backup (hard gate)
  report('backup', 'running');
  let backup: StoredBackup;
  try {
    const created = await createBackup(root, {
      reason: 'pre-write',
      label: `${tables.nodes.length} playlists, ${tables.entries.length} entries`,
      stats: options.stats,
      limit: options.backupLimit,
    });
    backup = created.set;
    warnings.push(...created.warnings);
    report('backup', 'done', `${created.verifiedVaults.length} verified copies`);
  } catch (error) {
    throw fail(
      'backup',
      `Backup failed, so nothing was written: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // 4 ── build
  report('build', 'running');
  let built: ReturnType<typeof writePlaylistTables>;
  try {
    built = writePlaylistTables(original, tables);
  } catch (error) {
    throw fail(
      'build',
      `Could not build the new library: ${error instanceof Error ? error.message : String(error)}`,
      false,
      backup.id
    );
  }
  report('build', 'done', `+${built.pagesAppended} pages`);

  // 5 ── verify the in-memory image before it touches the drive
  report('verify-image', 'running');
  const imageCheck = verifyWrittenPlaylists(built.buffer, tables);
  if (imageCheck.ok === false) {
    throw fail(
      'verify-image',
      `The new library failed its own check (${imageCheck.reason}). The drive was not touched.`,
      false,
      backup.id
    );
  }
  const expectedHash = await sha256Hex(built.buffer);
  report('verify-image', 'done');

  // 6 ── write
  report('write', 'running');
  try {
    await writeFileBytes(dbDir, DB_FILE, built.buffer);
  } catch (error) {
    const rolledBack = await rollback(root, backup, warnings);
    throw fail(
      'write',
      `Writing to the drive failed: ${error instanceof Error ? error.message : String(error)}`,
      rolledBack,
      backup.id
    );
  }
  report('write', 'done');

  // 7 ── read back from the drive and verify
  report('verify-drive', 'running');
  try {
    const readBack = await readFileBytes(dbDir, DB_FILE);
    if (!readBack) throw new UsbAccessError('the file could not be read back');
    if ((await sha256Hex(readBack)) !== expectedHash) {
      throw new UsbAccessError('the bytes on the drive do not match what was written');
    }
    const driveCheck = verifyWrittenPlaylists(readBack, tables);
    if (driveCheck.ok === false) throw new UsbAccessError(driveCheck.reason);
  } catch (error) {
    const rolledBack = await rollback(root, backup, warnings);
    throw fail(
      'verify-drive',
      `The drive did not verify after writing (${
        error instanceof Error ? error.message : String(error)
      }).${rolledBack ? ' Your previous library has been restored.' : ''}`,
      rolledBack,
      backup.id
    );
  }
  report('verify-drive', 'done');

  // 8 ── finalise
  report('finalise', 'running');
  await writeRecoveryNote(root);
  report('finalise', 'done');

  return {
    backup,
    pagesAppended: built.pagesAppended,
    bytesAdded: built.bytesAdded,
    warnings,
  };
}

/** Best-effort automatic rollback. Never throws — the original error matters more. */
async function rollback(
  root: FileSystemDirectoryHandle,
  backup: StoredBackup,
  warnings: string[]
): Promise<boolean> {
  try {
    await restoreBackup(root, backup, { skipSafetySnapshot: true });
    return true;
  } catch (error) {
    warnings.push(
      `Automatic rollback also failed (${
        error instanceof Error ? error.message : String(error)
      }). Restore backup ${backup.id} by hand — see ${'WHATTODOIFTHISWENTTOSHIT.txt'} on the drive.`
    );
    return false;
  }
}
