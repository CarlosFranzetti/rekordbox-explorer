import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Music, ListMusic, Files, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Playlist, ViewMode } from '@/types/rekordbox';

interface PlaylistSidebarProps {
  playlists: Playlist[];
  selectedPlaylist: Playlist | null;
  onSelectPlaylist: (playlist: Playlist | null) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  trackCount: number;
  onReset: () => void;
}

interface PlaylistItemProps {
  playlist: Playlist;
  depth: number;
  selectedId: number | null;
  onSelect: (playlist: Playlist) => void;
}

function PlaylistItem({ playlist, depth, selectedId, onSelect }: PlaylistItemProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedId === playlist.id;
  const hasChildren = playlist.children.length > 0;

  return (
    <div>
      <button
        onClick={() => {
          if (playlist.isFolder && hasChildren) {
            setExpanded(!expanded);
          }
          onSelect(playlist);
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isSelected && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {playlist.isFolder && hasChildren ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4" />
        )}
        
        {playlist.isFolder ? (
          expanded ? (
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-primary" />
          ) : (
            <Folder className="h-4 w-4 flex-shrink-0 text-primary" />
          )
        ) : (
          <ListMusic className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
        
        <span className="truncate">{playlist.name}</span>
        
        {!playlist.isFolder && playlist.trackIds.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {playlist.trackIds.length}
          </span>
        )}
      </button>
      
      {expanded && hasChildren && (
        <div>
          {playlist.children.map(child => (
            <PlaylistItem
              key={child.id}
              playlist={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PlaylistSidebar({
  playlists,
  selectedPlaylist,
  onSelectPlaylist,
  viewMode,
  onViewModeChange,
  trackCount,
  onReset
}: PlaylistSidebarProps) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border p-3">
        <h2 className="font-semibold text-sidebar-foreground">Library</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onReset}
          className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
          title="Change USB"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* All Tracks */}
          <button
            onClick={() => {
              onViewModeChange('library');
              onSelectPlaylist(null);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              viewMode === 'library' && !selectedPlaylist && "bg-sidebar-accent text-sidebar-accent-foreground"
            )}
          >
            <Music className="h-4 w-4 text-primary" />
            <span>All Tracks</span>
            <span className="ml-auto text-xs text-muted-foreground">{trackCount}</span>
          </button>

          {/* Browse Files */}
          <button
            onClick={() => onViewModeChange('files')}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              viewMode === 'files' && "bg-sidebar-accent text-sidebar-accent-foreground"
            )}
          >
            <Files className="h-4 w-4 text-muted-foreground" />
            <span>Browse Files</span>
          </button>

          {/* Playlists Section */}
          {playlists.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Playlists
              </p>
              {playlists.map(playlist => (
                <PlaylistItem
                  key={playlist.id}
                  playlist={playlist}
                  depth={0}
                  selectedId={selectedPlaylist?.id ?? null}
                  onSelect={(p) => {
                    onViewModeChange('library');
                    onSelectPlaylist(p);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}