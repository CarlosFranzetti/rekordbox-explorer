/**
 * Thin, defensive wrappers over the File System Access API.
 *
 * Everything that touches the user's USB goes through here so permission
 * handling, atomic writes and hashing are done one way, in one place.
 */

export class UsbAccessError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'UsbAccessError';
  }
}

/** True when this browser can write to a picked directory at all. */
export function supportsWriteAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  );
}

/**
 * Ensure we hold readwrite permission on a handle, prompting once if needed.
 * Returns false when the user declines — callers must treat that as "abort",
 * never as "try anyway".
 */
export async function ensureReadWritePermission(
  handle: FileSystemDirectoryHandle | FileSystemFileHandle
): Promise<boolean> {
  const target = handle as unknown as {
    queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };

  if (!target.queryPermission || !target.requestPermission) {
    // Older implementations grant readwrite at pick time.
    return true;
  }

  if ((await target.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await target.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Resolve a path relative to `root`, optionally creating missing directories. */
export async function getDirectory(
  root: FileSystemDirectoryHandle,
  path: string[],
  options: { create?: boolean } = {}
): Promise<FileSystemDirectoryHandle | null> {
  let dir = root;
  for (const segment of path) {
    try {
      dir = await dir.getDirectoryHandle(segment, { create: options.create ?? false });
    } catch (error) {
      if (options.create) {
        throw new UsbAccessError(`Could not create folder "${segment}" on the drive`, error);
      }
      return null;
    }
  }
  return dir;
}

export async function getFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemFileHandle | null> {
  try {
    return await dir.getFileHandle(name, { create: false });
  } catch {
    return null;
  }
}

export async function readFileBytes(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<ArrayBuffer | null> {
  const handle = await getFile(dir, name);
  if (!handle) return null;
  const file = await handle.getFile();
  return file.arrayBuffer();
}

/**
 * Write bytes to `name` inside `dir`.
 *
 * `createWritable()` writes through a swap file and swaps it in on close, so a
 * crash mid-write leaves the original file intact rather than half-written.
 */
export async function writeFileBytes(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: ArrayBuffer | Uint8Array
): Promise<void> {
  let handle: FileSystemFileHandle;
  try {
    handle = await dir.getFileHandle(name, { create: true });
  } catch (error) {
    throw new UsbAccessError(`Could not open "${name}" for writing`, error);
  }

  let writable: FileSystemWritableFileStream;
  try {
    writable = await handle.createWritable();
  } catch (error) {
    throw new UsbAccessError(
      `The drive rejected the write to "${name}". It may be read-only, full, or write-protected.`,
      error
    );
  }

  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    try {
      await writable.close();
    } catch {
      /* the close failure is already the interesting one */
    }
    throw new UsbAccessError(`Writing "${name}" failed partway through`, error);
  }
}

export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string
): Promise<void> {
  await writeFileBytes(dir, name, new TextEncoder().encode(text));
}

export async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<string | null> {
  const bytes = await readFileBytes(dir, name);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

export async function removeEntry(
  dir: FileSystemDirectoryHandle,
  name: string,
  options: { recursive?: boolean } = {}
): Promise<void> {
  const target = dir as unknown as {
    removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>;
  };
  if (!target.removeEntry) {
    throw new UsbAccessError('This browser cannot delete files from the drive');
  }
  await target.removeEntry(name, { recursive: options.recursive ?? false });
}

export async function listDirectoryNames(
  dir: FileSystemDirectoryHandle
): Promise<{ name: string; kind: 'file' | 'directory' }[]> {
  const out: { name: string; kind: 'file' | 'directory' }[] = [];
  for await (const [name, handle] of dir.entries()) {
    out.push({ name, kind: handle.kind });
  }
  return out;
}

/** SHA-256 as lowercase hex. Used to prove a backup copy matches its source. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new UsbAccessError(
      'Secure hashing is unavailable. Open the app over HTTPS so backups can be verified.'
    );
  }
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const bytes = new Uint8Array(view);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Filesystem-safe slug for names derived from user or file data. */
export function safeFileName(input: string, fallback = 'export'): string {
  const cleaned = input
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * `2026-08-05T00-30-12-345Z` — sorts lexicographically and is path-safe.
 *
 * Milliseconds are kept deliberately: backup folder names are derived from
 * this, and two snapshots in the same second (a manual one immediately
 * followed by a pre-write one) must not collide.
 */
export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Trigger a browser download for generated bytes. */
export function downloadBytes(data: ArrayBuffer | Uint8Array, filename: string, mime: string): void {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const blob = new Blob([new Uint8Array(view)], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(filename, 'download');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the download a tick to start before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
