/**
 * Local registry of every drive this browser has seen.
 *
 * Answers "which stick has that track on it?" without plugging anything in.
 * Backed by IndexedDB rather than localStorage because a handful of libraries
 * at a few thousand tracks each blows straight past the 5 MB string quota.
 *
 * Stays entirely on-device — this is an index of your own drives, and it never
 * leaves the browser.
 */

import type { RekordboxDatabase, LibraryPresence, Track } from '@/types/rekordbox';

const DB_NAME = 'rekordbox-explorer';
const DB_VERSION = 1;
const DEVICE_STORE = 'devices';
const INDEX_STORE = 'trackIndex';

/** Tracks sampled for the fingerprint. Low IDs are the most stable over time. */
const FINGERPRINT_SAMPLE = 64;

export interface DeviceRecord {
  id: string;
  name: string;
  volumeName: string;
  firstSeen: string;
  lastSeen: string;
  trackCount: number;
  playlistCount: number;
  libraries: LibraryPresence;
  backupCount: number;
  notes?: string;
}

export interface IndexedTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  bpm: number;
  genre: string;
}

export interface DeviceTrackIndex {
  deviceId: string;
  tracks: IndexedTrack[];
}

export interface SearchHit {
  device: DeviceRecord;
  track: IndexedTrack;
}

export interface DuplicateGroup {
  key: string;
  title: string;
  artist: string;
  devices: { deviceId: string; deviceName: string }[];
}

/* ------------------------------------------------------------------- idb glue */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so the device registry is unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEVICE_STORE)) {
        db.createObjectStore(DEVICE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(INDEX_STORE)) {
        db.createObjectStore(INDEX_STORE, { keyPath: 'deviceId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local database'));
  });

  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  const result = await promisify(fn(tx.objectStore(store)));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* --------------------------------------------------------------- fingerprint */

/**
 * Identify a drive without writing anything to it.
 *
 * Volume name plus the lowest track IDs: rekordbox assigns IDs monotonically,
 * so the oldest tracks in a library keep their IDs as the library grows, which
 * makes this stable across ordinary use while still distinguishing two sticks
 * that happen to share a name.
 */
export async function computeDeviceId(
  volumeName: string,
  tracks: Track[]
): Promise<string> {
  const sample = tracks
    .map((t) => t.id)
    .sort((a, b) => a - b)
    .slice(0, FINGERPRINT_SAMPLE)
    .join(',');

  const payload = `${volumeName}|${tracks.length >= FINGERPRINT_SAMPLE ? sample : `${sample}|${tracks.length}`}`;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `fallback:${volumeName}:${tracks.length}`;

  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* --------------------------------------------------------------------- CRUD */

export async function listDevices(): Promise<DeviceRecord[]> {
  const devices = await withStore<DeviceRecord[]>(DEVICE_STORE, 'readonly', (s) =>
    s.getAll() as IDBRequest<DeviceRecord[]>
  );
  return devices.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export async function getDevice(id: string): Promise<DeviceRecord | undefined> {
  return withStore<DeviceRecord | undefined>(DEVICE_STORE, 'readonly', (s) => s.get(id));
}

export async function getTrackIndex(deviceId: string): Promise<DeviceTrackIndex | undefined> {
  return withStore<DeviceTrackIndex | undefined>(INDEX_STORE, 'readonly', (s) => s.get(deviceId));
}

/** Record (or refresh) a drive after a successful library load. */
export async function rememberDevice(options: {
  volumeName: string;
  database: RekordboxDatabase;
  libraries: LibraryPresence;
  backupCount?: number;
}): Promise<DeviceRecord> {
  const { volumeName, database, libraries } = options;
  const id = await computeDeviceId(volumeName, database.tracks);
  const existing = await getDevice(id);
  const now = new Date().toISOString();

  const countPlaylists = (list: RekordboxDatabase['playlists']): number =>
    list.reduce((sum, p) => sum + 1 + countPlaylists(p.children), 0);

  const record: DeviceRecord = {
    id,
    name: existing?.name ?? volumeName,
    volumeName,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    trackCount: database.tracks.length,
    playlistCount: countPlaylists(database.playlists),
    libraries,
    backupCount: options.backupCount ?? existing?.backupCount ?? 0,
    notes: existing?.notes,
  };

  await withStore(DEVICE_STORE, 'readwrite', (s) => s.put(record));
  await withStore(INDEX_STORE, 'readwrite', (s) =>
    s.put({
      deviceId: id,
      tracks: database.tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        bpm: t.bpm,
        genre: t.genre,
      })),
    } satisfies DeviceTrackIndex)
  );

  return record;
}

export async function renameDevice(id: string, name: string): Promise<void> {
  const device = await getDevice(id);
  if (!device) return;
  await withStore(DEVICE_STORE, 'readwrite', (s) => s.put({ ...device, name: name.trim() || device.volumeName }));
}

export async function setDeviceNotes(id: string, notes: string): Promise<void> {
  const device = await getDevice(id);
  if (!device) return;
  await withStore(DEVICE_STORE, 'readwrite', (s) => s.put({ ...device, notes }));
}

export async function forgetDevice(id: string): Promise<void> {
  await withStore(DEVICE_STORE, 'readwrite', (s) => s.delete(id));
  await withStore(INDEX_STORE, 'readwrite', (s) => s.delete(id));
}

export async function clearRegistry(): Promise<void> {
  await withStore(DEVICE_STORE, 'readwrite', (s) => s.clear());
  await withStore(INDEX_STORE, 'readwrite', (s) => s.clear());
}

/* ------------------------------------------------------------------ queries */

export function normaliseTrackKey(title: string, artist: string): string {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  return `${clean(artist)}::${clean(title)}`;
}

/** Search every indexed device at once. */
export async function searchAllDevices(query: string, limit = 200): Promise<SearchHit[]> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) return [];

  const devices = await listDevices();
  const hits: SearchHit[] = [];

  for (const device of devices) {
    const index = await getTrackIndex(device.id);
    if (!index) continue;
    for (const track of index.tracks) {
      if (
        track.title.toLowerCase().includes(trimmed) ||
        track.artist.toLowerCase().includes(trimmed) ||
        track.album.toLowerCase().includes(trimmed)
      ) {
        hits.push({ device, track });
        if (hits.length >= limit) return hits;
      }
    }
  }

  return hits;
}

/** Tracks that appear on more than one drive — candidates for consolidation. */
export async function findCrossDeviceDuplicates(minDevices = 2): Promise<DuplicateGroup[]> {
  const devices = await listDevices();
  const byKey = new Map<string, DuplicateGroup>();

  for (const device of devices) {
    const index = await getTrackIndex(device.id);
    if (!index) continue;
    const seenHere = new Set<string>();

    for (const track of index.tracks) {
      const key = normaliseTrackKey(track.title, track.artist);
      if (key === '::' || seenHere.has(key)) continue;
      seenHere.add(key);

      const group = byKey.get(key);
      if (group) {
        group.devices.push({ deviceId: device.id, deviceName: device.name });
      } else {
        byKey.set(key, {
          key,
          title: track.title,
          artist: track.artist,
          devices: [{ deviceId: device.id, deviceName: device.name }],
        });
      }
    }
  }

  return [...byKey.values()]
    .filter((g) => g.devices.length >= minDevices)
    .sort((a, b) => b.devices.length - a.devices.length);
}

export interface RegistryAdvice {
  severity: 'info' | 'warning';
  message: string;
  deviceId?: string;
}

/** Plain-language suggestions: what to back up, clone, or check on. */
export async function buildRegistryAdvice(): Promise<RegistryAdvice[]> {
  const devices = await listDevices();
  const advice: RegistryAdvice[] = [];
  const now = Date.now();

  if (devices.length === 0) {
    return [{ severity: 'info', message: 'No drives indexed yet. Open a USB to add it here.' }];
  }

  for (const device of devices) {
    if (device.backupCount === 0) {
      advice.push({
        severity: 'warning',
        deviceId: device.id,
        message: `"${device.name}" has no backups on it. Make one before your next gig.`,
      });
    }
    if (!device.libraries.hasPlus) {
      advice.push({
        severity: 'info',
        deviceId: device.id,
        message: `"${device.name}" has no OneLibrary database, so OPUS-QUAD, OMNIS-DUO, XDJ-AZ and CDJ-3000X fall back to the legacy library. Re-export from rekordbox 6.6.11+ if you want the database those decks prefer.`,
      });
    }
    const ageDays = (now - Date.parse(device.lastSeen)) / 86_400_000;
    if (ageDays > 90) {
      advice.push({
        severity: 'info',
        deviceId: device.id,
        message: `"${device.name}" has not been checked in ${Math.round(ageDays)} days. Flash drives do fail sitting in a bag.`,
      });
    }
  }

  if (devices.length === 1) {
    advice.push({
      severity: 'warning',
      message:
        'Only one drive is indexed. A cloned spare is the cheapest insurance in this whole hobby.',
    });
  }

  const duplicates = await findCrossDeviceDuplicates(devices.length);
  if (devices.length > 1 && duplicates.length === 0) {
    advice.push({
      severity: 'info',
      message: 'No track appears on every drive — your sticks have diverged. Consider a canonical one.',
    });
  }

  return advice;
}

/* -------------------------------------------------------- import and export */

export interface RegistryExport {
  version: 1;
  exportedAt: string;
  devices: DeviceRecord[];
  indexes: DeviceTrackIndex[];
}

export async function exportRegistry(includeTracks = true): Promise<RegistryExport> {
  const devices = await listDevices();
  const indexes: DeviceTrackIndex[] = [];
  if (includeTracks) {
    for (const device of devices) {
      const index = await getTrackIndex(device.id);
      if (index) indexes.push(index);
    }
  }
  return { version: 1, exportedAt: new Date().toISOString(), devices, indexes };
}

export async function importRegistry(payload: unknown): Promise<number> {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('That file is not a registry export.');
  }
  const data = payload as Partial<RegistryExport>;
  if (data.version !== 1 || !Array.isArray(data.devices)) {
    throw new Error('Unsupported registry file version.');
  }

  for (const device of data.devices) {
    if (typeof device?.id !== 'string') continue;
    await withStore(DEVICE_STORE, 'readwrite', (s) => s.put(device));
  }
  for (const index of data.indexes ?? []) {
    if (typeof index?.deviceId !== 'string' || !Array.isArray(index.tracks)) continue;
    await withStore(INDEX_STORE, 'readwrite', (s) => s.put(index));
  }
  return data.devices.length;
}
