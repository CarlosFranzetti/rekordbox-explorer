import { useCallback, useMemo, useState } from 'react';
import type { Playlist, RekordboxDatabase } from '@/types/rekordbox';
import {
  PlaylistEditError,
  addTracks as addTracksOp,
  createPlaylist as createPlaylistOp,
  deletePlaylist as deletePlaylistOp,
  diffDrafts,
  draftFromPlaylists,
  movePlaylist as movePlaylistOp,
  playlistsFromDraft,
  removeTracks as removeTracksOp,
  renamePlaylist as renamePlaylistOp,
  reorderTrack as reorderTrackOp,
  setTracks as setTracksOp,
  toPlaylistTables,
  type Draft,
} from '@/lib/playlist-draft';
import { useToast } from '@/hooks/use-toast';

/**
 * Draft state for the playlist editor, with undo/redo.
 *
 * Every operation is a pure function over the draft, so history is just an
 * array of drafts — no diffing, no inverse operations to get wrong.
 */
export function usePlaylistEditor(database: RekordboxDatabase) {
  const baseline = useMemo(() => draftFromPlaylists(database.playlists), [database.playlists]);
  const [history, setHistory] = useState<Draft[]>([baseline]);
  const [cursor, setCursor] = useState(0);
  const { toast } = useToast();

  const draft = history[cursor];

  const apply = useCallback(
    (operation: (current: Draft) => Draft, successMessage?: string) => {
      try {
        const next = operation(draft);
        if (next === draft) return true;
        setHistory((prev) => [...prev.slice(0, cursor + 1), next]);
        setCursor((prev) => prev + 1);
        if (successMessage) toast({ title: successMessage });
        return true;
      } catch (error) {
        toast({
          title: 'Cannot do that',
          description:
            error instanceof PlaylistEditError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Unknown error',
          variant: 'destructive',
        });
        return false;
      }
    },
    [cursor, draft, toast]
  );

  const changes = useMemo(() => diffDrafts(baseline, draft), [baseline, draft]);
  const playlists: Playlist[] = useMemo(() => playlistsFromDraft(draft), [draft]);

  const reset = useCallback(() => {
    setHistory([baseline]);
    setCursor(0);
  }, [baseline]);

  /** Call after a successful commit so the new state becomes the baseline. */
  const markCommitted = useCallback(() => {
    setHistory([draft]);
    setCursor(0);
  }, [draft]);

  return {
    draft,
    playlists,
    changes,
    isDirty: changes.length > 0,
    canUndo: cursor > 0,
    canRedo: cursor < history.length - 1,

    undo: useCallback(() => setCursor((c) => Math.max(0, c - 1)), []),
    redo: useCallback(() => setCursor((c) => Math.min(history.length - 1, c + 1)), [history.length]),
    reset,
    markCommitted,

    createPlaylist: useCallback(
      (options: { name: string; parentId?: number; isFolder?: boolean; trackIds?: number[] }) =>
        apply(
          (current) => createPlaylistOp(current, options).draft,
          `${options.isFolder ? 'Folder' : 'Playlist'} "${options.name}" created`
        ),
      [apply]
    ),
    renamePlaylist: useCallback(
      (id: number, name: string) => apply((current) => renamePlaylistOp(current, id, name)),
      [apply]
    ),
    deletePlaylist: useCallback(
      (id: number) => apply((current) => deletePlaylistOp(current, id)),
      [apply]
    ),
    movePlaylist: useCallback(
      (id: number, parentId: number) => apply((current) => movePlaylistOp(current, id, parentId)),
      [apply]
    ),
    addTracks: useCallback(
      (id: number, trackIds: number[]) => apply((current) => addTracksOp(current, id, trackIds)),
      [apply]
    ),
    removeTracks: useCallback(
      (id: number, trackIds: number[]) => apply((current) => removeTracksOp(current, id, trackIds)),
      [apply]
    ),
    reorderTrack: useCallback(
      (id: number, from: number, to: number) =>
        apply((current) => reorderTrackOp(current, id, from, to)),
      [apply]
    ),
    setTracks: useCallback(
      (id: number, trackIds: number[]) => apply((current) => setTracksOp(current, id, trackIds)),
      [apply]
    ),

    toTables: useCallback(() => toPlaylistTables(draft), [draft]),
  };
}

export type PlaylistEditorApi = ReturnType<typeof usePlaylistEditor>;
