import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  FolderPlus,
  ListMusic,
  ListPlus,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatBpm, formatDuration } from '@/lib/rekordbox-parser';
import { ROOT_PARENT_ID, type DraftNode } from '@/lib/playlist-draft';
import type { PlaylistEditorApi } from '@/hooks/usePlaylistEditor';
import type { Track } from '@/types/rekordbox';
import { CommitDialog } from './CommitDialog';

interface PlaylistEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: PlaylistEditorApi;
  tracks: Track[];
  root: FileSystemDirectoryHandle | null;
  canWrite: boolean;
  backupLimit: number;
  onCommitted: (backupId: string) => void;
}

export function PlaylistEditor({
  open,
  onOpenChange,
  editor,
  tracks,
  root,
  canWrite,
  backupLimit,
  onCommitted,
}: PlaylistEditorProps) {
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);

  const selected = editor.draft.nodes.find((n) => n.id === selectedId) ?? null;
  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  const body = (
    <div className={cn('grid min-h-0 flex-1 gap-4', isMobile ? 'grid-cols-1' : 'grid-cols-[280px_1fr]')}>
      {!isMobile && (
        <PlaylistTree editor={editor} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {isMobile ? (
        <Tabs defaultValue="playlists" className="flex min-h-0 flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="playlists">Playlists</TabsTrigger>
            <TabsTrigger value="tracks" disabled={!selected || selected.isFolder}>
              Tracks{selected && !selected.isFolder ? ` (${selected.trackIds.length})` : ''}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="playlists" className="min-h-0 flex-1">
            <PlaylistTree editor={editor} selectedId={selectedId} onSelect={setSelectedId} />
          </TabsContent>
          <TabsContent value="tracks" className="min-h-0 flex-1">
            <TrackEditor
              editor={editor}
              node={selected}
              trackById={trackById}
              allTracks={tracks}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <TrackEditor editor={editor} node={selected} trackById={trackById} allTracks={tracks} />
      )}
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[min(96vw,1100px)] max-w-none flex-col gap-4 overflow-hidden p-4 sm:p-6">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <ListMusic className="h-5 w-5" />
              Playlist editor
              {editor.isDirty && (
                <Badge variant="secondary">
                  {editor.changes.length} unsaved change{editor.changes.length === 1 ? '' : 's'}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Edits stay in the browser until you save. Saving backs the drive up to two locations
              first, then verifies what it wrote.
            </DialogDescription>
          </DialogHeader>

          {body}

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={editor.undo}
              disabled={!editor.canUndo}
              aria-label="Undo"
              className="gap-1.5"
            >
              <Undo2 className="h-4 w-4" />
              <span className="hidden sm:inline">Undo</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={editor.redo}
              disabled={!editor.canRedo}
              aria-label="Redo"
              className="gap-1.5"
            >
              <Redo2 className="h-4 w-4" />
              <span className="hidden sm:inline">Redo</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={editor.reset}
              disabled={!editor.isDirty}
              aria-label="Discard all changes"
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">Discard</span>
            </Button>

            <div className="ml-auto flex items-center gap-2">
              {!canWrite && (
                <span className="max-w-[46ch] text-right text-xs text-muted-foreground">
                  {root
                    ? 'This browser cannot write to drives — use Chrome, Edge or Opera on desktop.'
                    : 'Saving needs the whole USB folder. Reopen it with "Select USB or Folder", or export instead.'}
                </span>
              )}
              <Button
                size="sm"
                className="gap-2"
                disabled={!editor.isDirty || !canWrite || !root}
                onClick={() => setCommitting(true)}
              >
                <Save className="h-4 w-4" />
                Save to USB
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {root && (
        <CommitDialog
          open={committing}
          onOpenChange={setCommitting}
          root={root}
          tables={editor.toTables()}
          changes={editor.changes}
          trackCount={tracks.length}
          backupLimit={backupLimit}
          onCommitted={(backupId) => {
            editor.markCommitted();
            onCommitted(backupId);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------- the tree */

function PlaylistTree({
  editor,
  selectedId,
  onSelect,
}: {
  editor: PlaylistEditorApi;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState<'playlist' | 'folder' | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const selected = editor.draft.nodes.find((n) => n.id === selectedId) ?? null;
  const targetParent = selected?.isFolder ? selected.id : (selected?.parentId ?? ROOT_PARENT_ID);

  const rows = useMemo(() => layoutTree(editor.draft.nodes), [editor.draft.nodes]);

  const submitCreate = () => {
    if (!creating || !newName.trim()) return;
    if (editor.createPlaylist({ name: newName, parentId: targetParent, isFolder: creating === 'folder' })) {
      setNewName('');
      setCreating(null);
    }
  };

  const submitRename = (id: number) => {
    if (renameValue.trim() && editor.renamePlaylist(id, renameValue)) setRenamingId(null);
  };

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-border">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2"
          onClick={() => setCreating('playlist')}
        >
          <ListPlus className="h-4 w-4" />
          Playlist
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2"
          onClick={() => setCreating('folder')}
        >
          <FolderPlus className="h-4 w-4" />
          Folder
        </Button>
      </div>

      {creating && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border p-2">
          <Input
            autoFocus
            value={newName}
            placeholder={creating === 'folder' ? 'Folder name' : 'Playlist name'}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate();
              if (e.key === 'Escape') setCreating(null);
            }}
            className="h-9"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={submitCreate} aria-label="Create">
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0"
            onClick={() => setCreating(null)}
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1">
          {rows.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">
              No playlists yet. Create one above.
            </p>
          )}
          {rows.map(({ node, depth }) => (
            <div key={node.id} className="group flex items-center gap-1">
              {renamingId === node.id ? (
                <div className="flex flex-1 items-center gap-1 p-1">
                  <Input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(node.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="h-8"
                  />
                  <Button
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => submitRename(node.id)}
                    aria-label="Save name"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelect(node.id)}
                    style={{ paddingLeft: `${depth * 14 + 8}px` }}
                    className={cn(
                      'flex min-h-11 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
                      'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selectedId === node.id && 'bg-accent'
                    )}
                  >
                    {node.isFolder ? (
                      <FolderPlus className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{node.name}</span>
                    {!node.isFolder && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {node.trackIds.length}
                      </span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => {
                      setRenamingId(node.id);
                      setRenameValue(node.name);
                    }}
                    aria-label={`Rename ${node.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-destructive opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => editor.deletePlaylist(node.id)}
                    aria-label={`Delete ${node.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function layoutTree(nodes: DraftNode[]): { node: DraftNode; depth: number }[] {
  const byParent = new Map<number, DraftNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }

  const rows: { node: DraftNode; depth: number }[] = [];
  const walk = (parentId: number, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      rows.push({ node, depth });
      if (node.isFolder) walk(node.id, depth + 1);
    }
  };
  walk(ROOT_PARENT_ID, 0);
  return rows;
}

/* ------------------------------------------------------------- track editing */

function TrackEditor({
  editor,
  node,
  trackById,
  allTracks,
}: {
  editor: PlaylistEditorApi;
  node: DraftNode | null;
  trackById: Map<number, Track>;
  allTracks: Track[];
}) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const candidates = useMemo(() => {
    if (!adding) return [];
    const trimmed = query.trim().toLowerCase();
    const inPlaylist = new Set(node?.trackIds ?? []);
    return allTracks
      .filter((t) => !inPlaylist.has(t.id))
      .filter(
        (t) =>
          trimmed.length === 0 ||
          t.title.toLowerCase().includes(trimmed) ||
          t.artist.toLowerCase().includes(trimmed) ||
          t.album.toLowerCase().includes(trimmed)
      )
      .slice(0, 300);
  }, [adding, allTracks, node?.trackIds, query]);

  if (!node) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Pick a playlist to edit its tracks.
      </div>
    );
  }

  if (node.isFolder) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        "{node.name}" is a folder. Folders hold playlists, not tracks.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
        <span className="truncate px-1 text-sm font-medium">{node.name}</span>
        <span className="text-xs text-muted-foreground">
          {node.trackIds.length} track{node.trackIds.length === 1 ? '' : 's'}
        </span>
        <Button
          size="sm"
          variant={adding ? 'default' : 'outline'}
          className="ml-auto h-9 gap-1.5"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-4 w-4" />
          {adding ? 'Done adding' : 'Add tracks'}
        </Button>
      </div>

      {adding && (
        <div className="flex min-h-0 flex-1 flex-col border-b border-border">
          <div className="relative shrink-0 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the library…"
              className="h-10 pl-8"
            />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-1">
              {candidates.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {query ? 'Nothing matches.' : 'Every track is already in this playlist.'}
                </p>
              )}
              {candidates.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => editor.addTracks(node.id, [track.id])}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{track.title}</span>
                    <span className="text-muted-foreground"> — {track.artist}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatBpm(track.bpm)}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <ol className="p-1">
          {node.trackIds.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Empty playlist. Use "Add tracks" above.
            </p>
          )}
          {node.trackIds.map((trackId, index) => {
            const track = trackById.get(trackId);
            return (
              <li
                key={`${trackId}-${index}`}
                className="group flex min-h-11 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/60"
              >
                <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {track ? (
                    <>
                      <span className="font-medium">{track.title}</span>
                      <span className="text-muted-foreground"> — {track.artist}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Track {trackId} (not in this library)
                    </span>
                  )}
                </span>
                {track && (
                  <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                    {formatDuration(track.duration)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={index === 0}
                  onClick={() => editor.reorderTrack(node.id, index, index - 1)}
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={index === node.trackIds.length - 1}
                  onClick={() => editor.reorderTrack(node.id, index, index + 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-destructive"
                  onClick={() => editor.removeTracks(node.id, [trackId])}
                  aria-label="Remove from playlist"
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ol>
      </ScrollArea>
    </div>
  );
}
