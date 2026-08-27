/**
 * Read a OneLibrary database off a mounted drive.
 *
 * Separated from `reader.ts` so that module stays pure — bytes in, model out —
 * and testable without a File System Access handle.
 */

import { loadOneLibrary } from './reader';
import type { RekordboxDatabase } from '@/types/rekordbox';

async function fileAt(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<File | null> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return null;

  let dir = root;
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create: false });
    } catch {
      return null;
    }
  }
  try {
    const handle = await dir.getFileHandle(name, { create: false });
    return await handle.getFile();
  } catch {
    return null;
  }
}

/**
 * Decrypt and parse the OneLibrary database at `path`.
 *
 * Returns `null` when the file is not there. Throws only when the file exists
 * but cannot be read, so callers can distinguish "no OneLibrary on this drive"
 * from "there is one and something is wrong with it".
 *
 * A sibling `-wal` is looked up so the caller can warn that the read may be
 * incomplete; we cannot replay a write-ahead log here.
 */
export async function readOneLibraryFromDrive(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<RekordboxDatabase | null> {
  const file = await fileAt(root, path);
  if (!file) return null;

  const wal = await fileAt(root, `${path}-wal`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { database } = await loadOneLibrary(bytes, { walBytes: wal?.size ?? 0 });
  return database;
}
