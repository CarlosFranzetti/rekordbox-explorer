import { useState } from 'react';
import { RecoveryDialog } from './RecoveryDialog';
import {
  ChevronDown,
  ChevronRight,
  Files,
  Folder,
  FolderOpen,
  HardDrive,
  HelpCircle,
  ListMusic,
  Monitor,
  Music,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SettingsPanel } from './SettingsPanel';
import type { LibraryPresence, Playlist, ViewMode } from '@/types/rekordbox';
import type { SettingsApi } from '@/hooks/useSettings';

interface PlaylistSidebarProps {
  playlists: Playlist[];
  libraries?: LibraryPresence;
  selectedPlaylist: Playlist | null;
  onSelectPlaylist: (playlist: Playlist | null) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  trackCount: number;
  onReset: () => void;
  settings: SettingsApi;
  onOpenBackups: () => void;
  onOpenDevices: () => void;
  rootHandle?: FileSystemDirectoryHandle | null;
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
        type="button"
        onClick={() => {
          if (playlist.isFolder && hasChildren) setExpanded((value) => !value);
          onSelect(playlist);
        }}
        aria-expanded={hasChildren ? expanded : undefined}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isSelected && 'bg-sidebar-accent text-sidebar-accent-foreground'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {playlist.isFolder && hasChildren ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4" />
        )}

        {playlist.isFolder ? (
          expanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-primary" />
          )
        ) : (
          <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        <span className="truncate">{playlist.name}</span>

        {!playlist.isFolder && playlist.trackIds.length > 0 && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {playlist.trackIds.length}
          </span>
        )}
      </button>

      {expanded && hasChildren && (
        <div>
          {playlist.children.map((child) => (
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

function CompatibilityIndicator({ libraries }: { libraries?: LibraryPresence }) {
  if (!libraries) return null;

  let label = 'Unknown';
  let description = 'Unable to determine compatibility.';
  let icon = <HelpCircle className="h-4 w-4 text-muted-foreground" />;

  if (libraries.hasLegacy && libraries.hasPlus) {
    label = 'Universal';
    description =
      'Both library formats are present. Reads on everything from a CDJ-2000 to an OPUS-QUAD.';
    icon = <Monitor className="h-4 w-4 text-green-500" />;
  } else if (libraries.hasLegacy) {
    label = 'Legacy';
    description =
      'Works on CDJ-2000/900/NXS/NXS2, CDJ-3000 and XDJ series. Newer gear (OPUS-QUAD, OMNIS-DUO, XDJ-AZ, CDJ-3000X) can fall back to this, but re-exporting from rekordbox 6.6.11+ adds the OneLibrary database those decks prefer.';
    icon = <Monitor className="h-4 w-4 text-blue-500" />;
  } else if (libraries.hasPlus) {
    label = 'OneLibrary only';
    description =
      'OneLibrary only. Newer gear reads it; older CDJs will not see anything on this drive. Re-export from rekordbox with the legacy library enabled to fix that — both can live on one drive.';
    icon = <Monitor className="h-4 w-4 text-orange-500" />;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-10 items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {icon}
          <span className="font-medium text-muted-foreground">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72">
        <h4 className="font-medium leading-none">Player compatibility</h4>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </PopoverContent>
    </Popover>
  );
}

export function PlaylistSidebar({
  playlists,
  libraries,
  selectedPlaylist,
  onSelectPlaylist,
  viewMode,
  onViewModeChange,
  trackCount,
  onReset,
  settings,
  onOpenBackups,
  onOpenDevices,
  rootHandle,
}: PlaylistSidebarProps) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center justify-between border-b border-sidebar-border p-3">
        <h2 className="font-semibold text-sidebar-foreground">Library</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onReset}
          className="h-10 w-10 text-sidebar-foreground hover:bg-sidebar-accent"
          title="Change USB"
          aria-label="Change USB"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          <button
            type="button"
            onClick={() => {
              onViewModeChange('library');
              onSelectPlaylist(null);
            }}
            className={cn(
              'flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              viewMode === 'library' && !selectedPlaylist && 'bg-sidebar-accent text-sidebar-accent-foreground'
            )}
          >
            <Music className="h-4 w-4 text-primary" />
            <span>All Tracks</span>
            <span className="ml-auto text-xs text-muted-foreground">{trackCount}</span>
          </button>

          <button
            type="button"
            onClick={() => onViewModeChange('files')}
            className={cn(
              'flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              viewMode === 'files' && 'bg-sidebar-accent text-sidebar-accent-foreground'
            )}
          >
            <Files className="h-4 w-4 text-muted-foreground" />
            <span>Browse Files</span>
          </button>

          {playlists.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Playlists
              </p>
              {playlists.map((playlist) => (
                <PlaylistItem
                  key={playlist.id}
                  playlist={playlist}
                  depth={0}
                  selectedId={selectedPlaylist?.id ?? null}
                  onSelect={(selected) => {
                    onViewModeChange('library');
                    onSelectPlaylist(selected);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="space-y-1 border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={onOpenBackups}
          className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span>Backups &amp; recovery</span>
        </button>
        <button
          type="button"
          onClick={onOpenDevices}
          className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <span>My drives</span>
        </button>

        <div className="flex items-center gap-2 pt-1">
          <SettingsPanel settings={settings} />
          <RecoveryDialog root={rootHandle ?? null} />
          <CompatibilityIndicator libraries={libraries} />
        </div>
      </div>
    </div>
  );
}
