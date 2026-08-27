/**
 * On-USB backup vaults.
 *
 * DESIGN RULES (the reason this file exists at all)
 *
 *  1. Two vaults, two directory trees. Every snapshot is written to BOTH
 *     `/RBXPLORER_BACKUPS` and `/PIONEER/rekordbox/RBXPLORER_SAFETY`. Deleting
 *     or corrupting one folder cannot take the history with it.
 *
 *  2. Nothing is trusted until it is read back. Every copied file is re-read
 *     from the drive and SHA-256'd against the source. A snapshot that fails
 *     verification is not counted, and a write that depends on it is aborted.
 *
 *  3. The manifest is a convenience, never a dependency. Listing works by
 *     scanning directories, so a lost or corrupt `manifest.json` costs you
 *     nothing. Each snapshot self-describes via its own `backup.json`.
 *
 *  4. Rotation deletes only after a successful new snapshot exists, and never
 *     drops the last surviving copy of anything.
 */

import { APP_VERSION, BACKUP_FORMAT_VERSION } from '@/lib/version';
import {
  UsbAccessError,
  getDirectory,
  listDirectoryNames,
  readFileBytes,
  readTextFile,
  removeEntry,
  sha256Hex,
  timestampSlug,
  writeFileBytes,
  writeTextFile,
} from './fs';
import { RECOVERY_NOTE_FILENAME, buildRecoveryNote } from './recovery-note';

export const DATABASE_DIR = ['PIONEER', 'rekordbox'];
export const DATABASE_FILES = ['export.pdb', 'exportExt.pdb'] as const;

export const PRIMARY_VAULT_PATH = ['RBXPLORER_BACKUPS'];
export const MIRROR_VAULT_PATH = ['PIONEER', 'rekordbox', 'RBXPLORER_SAFETY'];

export const VAULTS = [
  { id: 'primary' as const, path: PRIMARY_VAULT_PATH, label: 'Primary (drive root)' },
  { id: 'mirror' as const, path: MIRROR_VAULT_PATH, label: 'Mirror (inside PIONEER)' },
];

export type VaultId = (typeof VAULTS)[number]['id'];

/**
 * How many backup sets are kept per drive before the oldest is pruned.
 *
 * Every set is stored twice — once in each vault — so ten sets is twenty copies
 * of `export.pdb` on the drive. A typical library is a few MB, so that is
 * comfortably affordable; a very large one on a nearly-full drive is the case
 * to watch, which is why the limit stays adjustable.
 */
export const DEFAULT_BACKUP_LIMIT = 10;
export const MIN_BACKUP_LIMIT = 3;
export const MAX_BACKUP_LIMIT = 20;

const SET_MANIFEST_FILE = 'backup.json';
const VAULT_INDEX_FILE = 'manifest.json';

export type BackupReason = 'manual' | 'pre-write' | 'pre-restore' | 'first-open';

export const BACKUP_REASON_LABEL: Record<BackupReason, string> = {
  manual: 'Manual',
  'pre-write': 'Before playlist write',
  'pre-restore': 'Before restore',
  'first-open': 'First time opening drive',
};

export interface BackupFileRecord {
  name: string;
  size: number;
  sha256: string;
}

export interface BackupSet {
  id: string;
  createdAt: string;
  reason: BackupReason;
  label?: string;
  files: BackupFileRecord[];
  stats?: { tracks?: number; playlists?: number };
  appVersion: string;
  formatVersion: number;
}

export interface StoredBackup extends BackupSet {
  /** Which vaults actually hold a readable copy of this snapshot. */
  vaults: VaultId[];
}

export interface BackupHealth {
  /** Snapshots present and readable in at least one vault. */
  sets: StoredBackup[];
  /** Snapshots that exist in only one vault — still usable, worth flagging. */
  singleCopyIds: string[];
  /** Problems worth surfacing but not worth blocking on. */
  warnings: string[];
}

function isBackupSet(value: unknown): value is BackupSet {
  if (typeof value !== 'object' || value === null) return false;
  const set = value as Partial<BackupSet>;
  return (
    typeof set.id === 'string' &&
    typeof set.createdAt === 'string' &&
    Array.isArray(set.files) &&
    set.files.every(
      (f) =>
        typeof f?.name === 'string' &&
        typeof f?.size === 'number' &&
        typeof f?.sha256 === 'string'
    )
  );
}

/* ------------------------------------------------------------------ reading */

async function readVaultSets(
  root: FileSystemDirectoryHandle,
  vaultPath: string[]
): Promise<{ sets: BackupSet[]; warnings: string[] }> {
  const warnings: string[] = [];
  const vault = await getDirectory(root, vaultPath);
  if (!vault) return { sets: [], warnings };

  const sets: BackupSet[] = [];
  for (const entry of await listDirectoryNames(vault)) {
    if (entry.kind !== 'directory') continue;

    const setDir = await getDirectory(vault, [entry.name]);
    if (!setDir) continue;

    const raw = await readTextFile(setDir, SET_MANIFEST_FILE);
    if (raw === null) {
      warnings.push(`Snapshot "${entry.name}" has no ${SET_MANIFEST_FILE} and was skipped.`);
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isBackupSet(parsed)) {
        warnings.push(`Snapshot "${entry.name}" has an unreadable manifest.`);
        continue;
      }
      sets.push({ ...parsed, id: entry.name });
    } catch {
      warnings.push(`Snapshot "${entry.name}" has a corrupt manifest.`);
    }
  }

  return { sets, warnings };
}

/** Enumerate every snapshot on the drive, merging both vaults. */
export async function listBackups(root: FileSystemDirectoryHandle): Promise<BackupHealth> {
  const merged = new Map<string, StoredBackup>();
  const warnings: string[] = [];

  for (const vault of VAULTS) {
    const { sets, warnings: vaultWarnings } = await readVaultSets(root, vault.path);
    warnings.push(...vaultWarnings.map((w) => `${vault.label}: ${w}`));

    for (const set of sets) {
      const existing = merged.get(set.id);
      if (existing) {
        existing.vaults.push(vault.id);
      } else {
        merged.set(set.id, { ...set, vaults: [vault.id] });
      }
    }
  }

  const sets = [...merged.values()].sort((a, b) => b.id.localeCompare(a.id));
  return {
    sets,
    singleCopyIds: sets.filter((s) => s.vaults.length < VAULTS.length).map((s) => s.id),
    warnings,
  };
}

/** Read one file out of a snapshot, preferring the vault that verifies. */
export async function readBackupFile(
  root: FileSystemDirectoryHandle,
  setId: string,
  fileName: string,
  expected?: BackupFileRecord
): Promise<ArrayBuffer | null> {
  for (const vault of VAULTS) {
    const dir = await getDirectory(root, [...vault.path, setId]);
    if (!dir) continue;
    const bytes = await readFileBytes(dir, fileName);
    if (!bytes) continue;
    if (!expected) return bytes;
    if (bytes.byteLength === expected.size && (await sha256Hex(bytes)) === expected.sha256) {
      return bytes;
    }
  }
  return null;
}

export interface VerificationReport {
  ok: boolean;
  checked: { vault: VaultId; file: string; ok: boolean; detail?: string }[];
}

/** Re-hash every file of a snapshot in every vault that claims to hold it. */
export async function verifyBackup(
  root: FileSystemDirectoryHandle,
  set: StoredBackup
): Promise<VerificationReport> {
  const checked: VerificationReport['checked'] = [];

  for (const vaultId of set.vaults) {
    const vault = VAULTS.find((v) => v.id === vaultId)!;
    const dir = await getDirectory(root, [...vault.path, set.id]);
    if (!dir) {
      checked.push({ vault: vaultId, file: '(folder)', ok: false, detail: 'folder missing' });
      continue;
    }

    for (const record of set.files) {
      const bytes = await readFileBytes(dir, record.name);
      if (!bytes) {
        checked.push({ vault: vaultId, file: record.name, ok: false, detail: 'file missing' });
        continue;
      }
      if (bytes.byteLength !== record.size) {
        checked.push({
          vault: vaultId,
          file: record.name,
          ok: false,
          detail: `size ${bytes.byteLength}, expected ${record.size}`,
        });
        continue;
      }
      const hash = await sha256Hex(bytes);
      checked.push({
        vault: vaultId,
        file: record.name,
        ok: hash === record.sha256,
        detail: hash === record.sha256 ? undefined : 'checksum mismatch',
      });
    }
  }

  // A snapshot is usable if every file verifies in at least one vault.
  const ok = set.files.every((record) =>
    checked.some((c) => c.file === record.name && c.ok)
  );
  return { ok, checked };
}

/**
 * Guarantee a snapshot folder name nobody is using yet. Timestamps carry
 * milliseconds, so this only ever fires on genuinely simultaneous writes.
 */
async function uniqueBackupId(
  root: FileSystemDirectoryHandle,
  candidate: string
): Promise<string> {
  const taken = new Set((await listBackups(root)).sets.map((s) => s.id));
  if (!taken.has(candidate)) return candidate;
  for (let suffix = 2; suffix < 100; suffix++) {
    const next = `${candidate}-${suffix}`;
    if (!taken.has(next)) return next;
  }
  throw new UsbAccessError('Could not allocate a unique backup name');
}

/* ------------------------------------------------------------------ writing */

export interface CreateBackupOptions {
  reason: BackupReason;
  label?: string;
  stats?: { tracks?: number; playlists?: number };
  limit?: number;
}

export interface CreateBackupResult {
  set: StoredBackup;
  /** Vaults that received a fully verified copy. */
  verifiedVaults: VaultId[];
  warnings: string[];
  prunedIds: string[];
}

/**
 * Snapshot the live database into both vaults and verify every byte.
 *
 * Throws when no vault ends up holding a verified copy — the caller must treat
 * that as "do not proceed with the write".
 */
export async function createBackup(
  root: FileSystemDirectoryHandle,
  options: CreateBackupOptions
): Promise<CreateBackupResult> {
  const dbDir = await getDirectory(root, DATABASE_DIR);
  if (!dbDir) {
    throw new UsbAccessError('Could not find PIONEER/rekordbox on this drive');
  }

  // Gather the live files and their hashes first.
  const sources: { name: string; bytes: ArrayBuffer; record: BackupFileRecord }[] = [];
  for (const name of DATABASE_FILES) {
    const bytes = await readFileBytes(dbDir, name);
    if (!bytes) continue;
    sources.push({
      name,
      bytes,
      record: { name, size: bytes.byteLength, sha256: await sha256Hex(bytes) },
    });
  }

  if (sources.length === 0) {
    throw new UsbAccessError('No rekordbox database found to back up');
  }

  const createdAt = new Date();
  const id = await uniqueBackupId(root, `${timestampSlug(createdAt)}_${options.reason}`);

  const set: BackupSet = {
    id,
    createdAt: createdAt.toISOString(),
    reason: options.reason,
    label: options.label,
    files: sources.map((s) => s.record),
    stats: options.stats,
    appVersion: APP_VERSION,
    formatVersion: BACKUP_FORMAT_VERSION,
  };

  const warnings: string[] = [];
  const verifiedVaults: VaultId[] = [];

  for (const vault of VAULTS) {
    try {
      const setDir = await getDirectory(root, [...vault.path, id], { create: true });
      if (!setDir) throw new UsbAccessError('vault folder unavailable');

      for (const source of sources) {
        await writeFileBytes(setDir, source.name, source.bytes);
      }
      await writeTextFile(setDir, SET_MANIFEST_FILE, JSON.stringify(set, null, 2));

      // Read back and prove it matches before counting this vault.
      let allMatch = true;
      for (const source of sources) {
        const written = await readFileBytes(setDir, source.name);
        if (
          !written ||
          written.byteLength !== source.record.size ||
          (await sha256Hex(written)) !== source.record.sha256
        ) {
          allMatch = false;
          warnings.push(`${vault.label}: "${source.name}" did not verify after writing.`);
          break;
        }
      }

      if (allMatch) verifiedVaults.push(vault.id);
    } catch (error) {
      warnings.push(
        `${vault.label}: backup failed — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (verifiedVaults.length === 0) {
    throw new UsbAccessError(
      `Backup failed in every location, so nothing was changed. ${warnings.join(' ')}`
    );
  }

  if (verifiedVaults.length < VAULTS.length) {
    warnings.push(
      'Only one of the two backup copies could be written. The snapshot is usable but has no mirror.'
    );
  }

  const stored: StoredBackup = { ...set, vaults: verifiedVaults };
  const prunedIds = await pruneBackups(root, options.limit ?? DEFAULT_BACKUP_LIMIT, id);
  await refreshVaultIndexes(root);
  await writeRecoveryNote(root);

  return { set: stored, verifiedVaults, warnings, prunedIds };
}

/** Delete the oldest snapshots beyond `limit`, never touching `protectedId`. */
export async function pruneBackups(
  root: FileSystemDirectoryHandle,
  limit: number,
  protectedId?: string
): Promise<string[]> {
  const bounded = Math.min(Math.max(limit, MIN_BACKUP_LIMIT), MAX_BACKUP_LIMIT);
  const { sets } = await listBackups(root);

  const doomed = sets
    .filter((s) => s.id !== protectedId)
    .slice(Math.max(0, bounded - (protectedId ? 1 : 0)));

  const removed: string[] = [];
  for (const set of doomed) {
    try {
      await deleteBackup(root, set.id);
      removed.push(set.id);
    } catch {
      // A snapshot we cannot delete is a nuisance, not a failure.
    }
  }
  return removed;
}

export async function deleteBackup(
  root: FileSystemDirectoryHandle,
  setId: string
): Promise<void> {
  let removedAny = false;
  for (const vault of VAULTS) {
    const vaultDir = await getDirectory(root, vault.path);
    if (!vaultDir) continue;
    try {
      await removeEntry(vaultDir, setId, { recursive: true });
      removedAny = true;
    } catch {
      // Not present in this vault.
    }
  }
  if (!removedAny) throw new UsbAccessError(`Backup "${setId}" was not found on the drive`);
  await refreshVaultIndexes(root);
}

export interface RestoreResult {
  restored: string[];
  safetySnapshotId: string | null;
  warnings: string[];
}

/**
 * Restore a snapshot over the live database.
 *
 * The current state is snapshotted first, so a restore is itself undoable.
 * Every source file is checksum-verified before anything is overwritten.
 */
export async function restoreBackup(
  root: FileSystemDirectoryHandle,
  set: StoredBackup,
  options: { limit?: number; skipSafetySnapshot?: boolean } = {}
): Promise<RestoreResult> {
  const warnings: string[] = [];

  // 1. Verify the source before touching anything.
  const payloads: { name: string; bytes: ArrayBuffer }[] = [];
  for (const record of set.files) {
    const bytes = await readBackupFile(root, set.id, record.name, record);
    if (!bytes) {
      throw new UsbAccessError(
        `"${record.name}" in backup ${set.id} is missing or fails its checksum in both copies. Restore aborted.`
      );
    }
    payloads.push({ name: record.name, bytes });
  }

  // 2. Snapshot where we are now, so this is reversible.
  let safetySnapshotId: string | null = null;
  if (!options.skipSafetySnapshot) {
    try {
      const safety = await createBackup(root, {
        reason: 'pre-restore',
        label: `Before restoring ${set.id}`,
        limit: options.limit,
      });
      safetySnapshotId = safety.set.id;
      warnings.push(...safety.warnings);
    } catch (error) {
      warnings.push(
        `Could not snapshot the current state first (${
          error instanceof Error ? error.message : String(error)
        }).`
      );
    }
  }

  // 3. Write the payloads over the live database.
  const dbDir = await getDirectory(root, DATABASE_DIR, { create: true });
  if (!dbDir) throw new UsbAccessError('Could not open PIONEER/rekordbox for writing');

  const restored: string[] = [];
  for (const payload of payloads) {
    await writeFileBytes(dbDir, payload.name, payload.bytes);
    const readBack = await readFileBytes(dbDir, payload.name);
    const expected = set.files.find((f) => f.name === payload.name)!;
    if (!readBack || (await sha256Hex(readBack)) !== expected.sha256) {
      throw new UsbAccessError(
        `"${payload.name}" did not verify after being restored. The drive may be failing — do not use it for a gig.`
      );
    }
    restored.push(payload.name);
  }

  await writeRecoveryNote(root);
  return { restored, safetySnapshotId, warnings };
}

/* -------------------------------------------------------- index + note files */

/** Human-readable vault index. Never read back as a source of truth. */
async function refreshVaultIndexes(root: FileSystemDirectoryHandle): Promise<void> {
  const { sets } = await listBackups(root);
  for (const vault of VAULTS) {
    const dir = await getDirectory(root, vault.path);
    if (!dir) continue;
    try {
      await writeTextFile(
        dir,
        VAULT_INDEX_FILE,
        JSON.stringify(
          {
            formatVersion: BACKUP_FORMAT_VERSION,
            vault: vault.id,
            updatedAt: new Date().toISOString(),
            note: 'Informational only. Each snapshot folder self-describes via backup.json.',
            sets: sets.map(({ id, createdAt, reason, label, files, stats }) => ({
              id,
              createdAt,
              reason,
              label,
              stats,
              files: files.map((f) => f.name),
            })),
          },
          null,
          2
        )
      );
    } catch {
      // An index we cannot write is cosmetic — listing scans directories.
    }
  }
}

/** (Re)write the recovery note at the drive root. */
export async function writeRecoveryNote(root: FileSystemDirectoryHandle): Promise<void> {
  try {
    const { sets } = await listBackups(root);
    await writeTextFile(
      root,
      RECOVERY_NOTE_FILENAME,
      buildRecoveryNote({
        writtenAt: new Date(),
        primaryVaultPath: `/${PRIMARY_VAULT_PATH.join('/')}`,
        mirrorVaultPath: `/${MIRROR_VAULT_PATH.join('/')}`,
        databasePath: `/${DATABASE_DIR.join('/')}`,
        backupIds: sets.map((s) => s.id),
      })
    );
  } catch {
    // Never let the note block a real operation.
  }
}
