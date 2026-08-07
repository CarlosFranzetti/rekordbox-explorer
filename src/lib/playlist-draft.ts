/**
 * Pure, immutable playlist-editing model.
 *
 * The editor never mutates the parsed database. It builds a draft, the user
 * pushes it around, and only the commit step turns it into bytes. Keeping this
 * layer pure means every edit operation is unit-testable without a browser, a
 * drive, or a mock filesystem.
 */

import type { Playlist } from '@/types/rekordbox';
import type { PlaylistTables } from '@/lib/pdb/playlists';

export const ROOT_PARENT_ID = 0;
export const MAX_NAME_LENGTH = 120;

export interface DraftNode {
  id: number;
  parentId: number;
  isFolder: boolean;
  name: string;
  /** Ordered, may contain the same track twice — rekordbox allows duplicates. */
  trackIds: number[];
}

export interface Draft {
  nodes: DraftNode[];
  nextId: number;
}

export interface DraftChange {
  kind: 'added' | 'removed' | 'renamed' | 'moved' | 'tracks-changed';
  id: number;
  name: string;
  detail?: string;
}

/* -------------------------------------------------------------- construction */

function flatten(playlists: Playlist[], into: DraftNode[]): void {
  for (const playlist of playlists) {
    into.push({
      id: playlist.id,
      parentId: playlist.parentId ?? ROOT_PARENT_ID,
      isFolder: playlist.isFolder,
      name: playlist.name,
      trackIds: [...playlist.trackIds],
    });
    if (playlist.children.length > 0) flatten(playlist.children, into);
  }
}

export function draftFromPlaylists(playlists: Playlist[]): Draft {
  const nodes: DraftNode[] = [];
  flatten(playlists, nodes);
  const maxId = nodes.reduce((max, node) => Math.max(max, node.id), 0);
  return { nodes, nextId: maxId + 1 };
}

/** Rebuild the nested shape the sidebar renders from a flat draft. */
export function playlistsFromDraft(draft: Draft): Playlist[] {
  const byId = new Map<number, Playlist>();
  for (const node of draft.nodes) {
    byId.set(node.id, {
      id: node.id,
      name: node.name,
      parentId: node.parentId === ROOT_PARENT_ID ? null : node.parentId,
      isFolder: node.isFolder,
      children: [],
      trackIds: [...node.trackIds],
    });
  }

  const roots: Playlist[] = [];
  for (const node of draft.nodes) {
    const playlist = byId.get(node.id)!;
    const parent = node.parentId === ROOT_PARENT_ID ? null : byId.get(node.parentId);
    if (parent) parent.children.push(playlist);
    else roots.push(playlist);
  }
  return roots;
}

/** Flatten a draft into the row sets the PDB writer consumes. */
export function toPlaylistTables(draft: Draft): PlaylistTables {
  const order = new Map<number, number>();
  const siblingCounts = new Map<number, number>();
  for (const node of draft.nodes) {
    const index = siblingCounts.get(node.parentId) ?? 0;
    order.set(node.id, index);
    siblingCounts.set(node.parentId, index + 1);
  }

  return {
    nodes: draft.nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      sortOrder: order.get(node.id) ?? 0,
      isFolder: node.isFolder,
      name: node.name,
    })),
    entries: draft.nodes.flatMap((node) =>
      node.isFolder
        ? []
        : node.trackIds.map((trackId, index) => ({
            playlistId: node.id,
            trackId,
            entryIndex: index,
          }))
    ),
  };
}

/* ---------------------------------------------------------------- operations */

export class PlaylistEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaylistEditError';
  }
}

export function normaliseName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) throw new PlaylistEditError('Give the playlist a name');
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new PlaylistEditError(`Name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  // Control characters would confuse both the players and the file listing.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new PlaylistEditError('Name contains characters the players cannot display');
  }
  return trimmed;
}

function assertParent(draft: Draft, parentId: number): void {
  if (parentId === ROOT_PARENT_ID) return;
  const parent = draft.nodes.find((n) => n.id === parentId);
  if (!parent) throw new PlaylistEditError('That folder no longer exists');
  if (!parent.isFolder) throw new PlaylistEditError('Playlists cannot be nested inside playlists');
}

function assertNameFree(draft: Draft, parentId: number, name: string, exceptId?: number): void {
  const clash = draft.nodes.some(
    (n) =>
      n.id !== exceptId &&
      n.parentId === parentId &&
      n.name.toLowerCase() === name.toLowerCase()
  );
  if (clash) throw new PlaylistEditError(`"${name}" already exists in this folder`);
}

export function createPlaylist(
  draft: Draft,
  options: { name: string; parentId?: number; isFolder?: boolean; trackIds?: number[] }
): { draft: Draft; id: number } {
  const name = normaliseName(options.name);
  const parentId = options.parentId ?? ROOT_PARENT_ID;
  assertParent(draft, parentId);
  assertNameFree(draft, parentId, name);

  const id = draft.nextId;
  const node: DraftNode = {
    id,
    parentId,
    isFolder: options.isFolder ?? false,
    name,
    trackIds: options.isFolder ? [] : [...(options.trackIds ?? [])],
  };

  return { draft: { nodes: [...draft.nodes, node], nextId: id + 1 }, id };
}

export function renamePlaylist(draft: Draft, id: number, rawName: string): Draft {
  const node = requireNode(draft, id);
  const name = normaliseName(rawName);
  if (name === node.name) return draft;
  assertNameFree(draft, node.parentId, name, id);
  return mapNode(draft, id, (n) => ({ ...n, name }));
}

/** Delete a node and, for folders, everything beneath it. */
export function deletePlaylist(draft: Draft, id: number): Draft {
  requireNode(draft, id);
  const doomed = new Set<number>([id]);

  let grew = true;
  while (grew) {
    grew = false;
    for (const node of draft.nodes) {
      if (!doomed.has(node.id) && doomed.has(node.parentId)) {
        doomed.add(node.id);
        grew = true;
      }
    }
  }

  return { ...draft, nodes: draft.nodes.filter((n) => !doomed.has(n.id)) };
}

export function movePlaylist(draft: Draft, id: number, parentId: number): Draft {
  const node = requireNode(draft, id);
  if (node.parentId === parentId) return draft;
  assertParent(draft, parentId);

  if (id === parentId || isDescendant(draft, parentId, id)) {
    throw new PlaylistEditError('A folder cannot be moved inside itself');
  }
  assertNameFree(draft, parentId, node.name, id);
  return mapNode(draft, id, (n) => ({ ...n, parentId }));
}

export function addTracks(draft: Draft, id: number, trackIds: number[]): Draft {
  const node = requirePlaylist(draft, id);
  const existing = new Set(node.trackIds);
  const additions = trackIds.filter((t) => t > 0 && !existing.has(t));
  if (additions.length === 0) return draft;
  return mapNode(draft, id, (n) => ({ ...n, trackIds: [...n.trackIds, ...additions] }));
}

export function removeTracks(draft: Draft, id: number, trackIds: number[]): Draft {
  requirePlaylist(draft, id);
  const doomed = new Set(trackIds);
  return mapNode(draft, id, (n) => ({
    ...n,
    trackIds: n.trackIds.filter((t) => !doomed.has(t)),
  }));
}

/** Move the track at `from` to index `to`, shifting the rest. */
export function reorderTrack(draft: Draft, id: number, from: number, to: number): Draft {
  const node = requirePlaylist(draft, id);
  if (from === to) return draft;
  if (from < 0 || from >= node.trackIds.length) {
    throw new PlaylistEditError('That track is no longer in the playlist');
  }

  const clamped = Math.max(0, Math.min(to, node.trackIds.length - 1));
  const trackIds = [...node.trackIds];
  const [moved] = trackIds.splice(from, 1);
  trackIds.splice(clamped, 0, moved);
  return mapNode(draft, id, (n) => ({ ...n, trackIds }));
}

export function setTracks(draft: Draft, id: number, trackIds: number[]): Draft {
  requirePlaylist(draft, id);
  return mapNode(draft, id, (n) => ({ ...n, trackIds: [...trackIds] }));
}

/* ------------------------------------------------------------------ helpers */

function requireNode(draft: Draft, id: number): DraftNode {
  const node = draft.nodes.find((n) => n.id === id);
  if (!node) throw new PlaylistEditError('That playlist no longer exists');
  return node;
}

function requirePlaylist(draft: Draft, id: number): DraftNode {
  const node = requireNode(draft, id);
  if (node.isFolder) throw new PlaylistEditError('Folders do not hold tracks directly');
  return node;
}

function mapNode(draft: Draft, id: number, fn: (node: DraftNode) => DraftNode): Draft {
  return { ...draft, nodes: draft.nodes.map((n) => (n.id === id ? fn(n) : n)) };
}

function isDescendant(draft: Draft, candidateId: number, ancestorId: number): boolean {
  let current = draft.nodes.find((n) => n.id === candidateId);
  const seen = new Set<number>();
  while (current && current.parentId !== ROOT_PARENT_ID) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = draft.nodes.find((n) => n.id === current!.parentId);
  }
  return false;
}

/** Human-readable summary of what a commit would change. */
export function diffDrafts(base: Draft, next: Draft): DraftChange[] {
  const changes: DraftChange[] = [];
  const baseById = new Map(base.nodes.map((n) => [n.id, n]));
  const nextById = new Map(next.nodes.map((n) => [n.id, n]));

  for (const node of next.nodes) {
    const before = baseById.get(node.id);
    if (!before) {
      changes.push({
        kind: 'added',
        id: node.id,
        name: node.name,
        detail: node.isFolder
          ? 'new folder'
          : `${node.trackIds.length} track${node.trackIds.length === 1 ? '' : 's'}`,
      });
      continue;
    }
    if (before.name !== node.name) {
      changes.push({ kind: 'renamed', id: node.id, name: node.name, detail: `was "${before.name}"` });
    }
    if (before.parentId !== node.parentId) {
      changes.push({ kind: 'moved', id: node.id, name: node.name, detail: 'moved to another folder' });
    }
    if (
      before.trackIds.length !== node.trackIds.length ||
      before.trackIds.some((t, i) => t !== node.trackIds[i])
    ) {
      const delta = node.trackIds.length - before.trackIds.length;
      changes.push({
        kind: 'tracks-changed',
        id: node.id,
        name: node.name,
        detail:
          delta === 0
            ? 'reordered'
            : `${delta > 0 ? '+' : ''}${delta} track${Math.abs(delta) === 1 ? '' : 's'}`,
      });
    }
  }

  for (const node of base.nodes) {
    if (!nextById.has(node.id)) {
      changes.push({
        kind: 'removed',
        id: node.id,
        name: node.name,
        detail: node.isFolder ? 'folder deleted' : 'playlist deleted',
      });
    }
  }

  return changes;
}

export function hasChanges(base: Draft, next: Draft): boolean {
  return diffDrafts(base, next).length > 0;
}
