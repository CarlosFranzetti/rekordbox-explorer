import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { PlaylistSidebar } from './PlaylistSidebar';
import { DriveCompatibilityBanner } from './DriveCompatibilityBanner';
import { TrackTable } from './TrackTable';
import { FileBrowser } from './FileBrowser';
import { SearchBar } from './SearchBar';
import { ExportMenu } from './ExportMenu';
import { PlaylistEditor } from './playlist/PlaylistEditor';
import { BackupsDialog } from './backup/BackupsDialog';
import { DevicesDialog } from './devices/DevicesDialog';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSettings } from '@/hooks/useSettings';
import { usePlaylistEditor } from '@/hooks/usePlaylistEditor';
import { supportsWriteAccess } from '@/lib/usb/fs';
import type {
  FileEntry,
  LibraryPresence,
  Playlist,
  RekordboxDatabase,
  SortColumn,
  SortDirection,
  Track,
  ViewMode,
  DriveReport,
} from '@/types/rekordbox';

interface LibraryViewProps {
  database: RekordboxDatabase;
  libraries?: LibraryPresence;
  drive?: DriveReport;
  rootHandle: FileSystemDirectoryHandle | null;
  selectedPlaylist: Playlist | null;
  onSelectPlaylist: (playlist: Playlist | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
  filteredTracks: Track[];
  fileEntries: FileEntry[];
  directoryPath: string[];
  onNavigateToDirectory: (handle: FileSystemDirectoryHandle, name: string) => void;
  onNavigateUp: () => void;
  onLoadFileEntries: () => void;
  onReset: () => void;
  onReload: () => void;
}

export function LibraryView({
  database,
  libraries,
  drive,
  rootHandle,
  selectedPlaylist,
  onSelectPlaylist,
  searchQuery,
  onSearchChange,
  sortColumn,
  sortDirection,
  onSort,
  filteredTracks,
  fileEntries,
  directoryPath,
  onNavigateToDirectory,
  onNavigateUp,
  onLoadFileEntries,
  onReset,
  onReload,
}: LibraryViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('library');
  const [editorOpen, setEditorOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);

  const isMobile = useIsMobile();
  const settings = useSettings();
  const editor = usePlaylistEditor(database);
  const canWrite = supportsWriteAccess() && rootHandle !== null;

  useEffect(() => {
    if (viewMode === 'files' && fileEntries.length === 0) onLoadFileEntries();
  }, [viewMode, fileEntries.length, onLoadFileEntries]);

  // The editor renders the draft, so the sidebar shows unsaved work immediately.
  const visiblePlaylists = editor.isDirty ? editor.playlists : database.playlists;
  const currentPlaylistName = selectedPlaylist?.name || 'All Tracks';

  const sidebar = (
    <PlaylistSidebar
      playlists={visiblePlaylists}
      libraries={libraries}
      selectedPlaylist={selectedPlaylist}
      onSelectPlaylist={(playlist) => {
        onSelectPlaylist(playlist);
      }}
      viewMode={viewMode}
      onViewModeChange={(mode) => {
        setViewMode(mode);
      }}
      trackCount={database.tracks.length}
      onReset={onReset}
      settings={settings}
      onOpenBackups={() => {
        setBackupsOpen(true);
      }}
      onOpenDevices={() => {
        setDevicesOpen(true);
      }}
    />
  );

  const content = (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {drive && <DriveCompatibilityBanner drive={drive} />}
      <header className="flex shrink-0 flex-col gap-2 border-b border-border bg-card px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
              {viewMode === 'files' ? 'File Browser' : currentPlaylistName}
            </h1>
            {viewMode === 'library' && (
              <span className="shrink-0 text-xs text-muted-foreground sm:text-sm">
                {filteredTracks.length}
              </span>
            )}
            {editor.isDirty && (
              <Badge variant="secondary" className="shrink-0">
                {editor.changes.length} unsaved
              </Badge>
            )}
          </div>

          {viewMode === 'library' && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant={editor.isDirty ? 'default' : 'outline'}
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setEditorOpen(true)}
                aria-label="Edit playlists"
              >
                <Pencil className="h-4 w-4" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              <ExportMenu
                tracks={filteredTracks}
                playlists={visiblePlaylists}
                playlistName={currentPlaylistName}
                columns={settings.exportColumns}
                pdfPageSize={settings.pdfPageSize}
                pdfOrientation={settings.pdfOrientation}
                pdfIncludeNumbers={settings.pdfIncludeNumbers}
                pdfIncludeFooter={settings.pdfIncludeFooter}
              />
            </div>
          )}
        </div>

        {viewMode === 'library' && (
          <div className={isMobile ? 'w-full' : 'w-72 max-w-[35vw] self-end'}>
            <SearchBar value={searchQuery} onChange={onSearchChange} />
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {viewMode === 'library' ? (
          <TrackTable
            tracks={filteredTracks}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={onSort}
            hiddenColumns={settings.hiddenColumns}
          />
        ) : (
          <FileBrowser
            entries={fileEntries}
            path={directoryPath}
            onNavigate={onNavigateToDirectory}
            onNavigateUp={onNavigateUp}
          />
        )}
      </main>
    </div>
  );

  return (
    <div className="h-[100dvh] bg-background">
      {/*
        One layout everywhere: playlists visible beside the tracks, on a phone as
        much as on a desktop. An earlier version put the sidebar behind a
        hamburger below 768px, which is the conventional mobile pattern but the
        wrong one here — the playlist tree *is* the app, and hiding it costs a
        tap on every navigation. The panel is resizable, so anyone who wants the
        table full-width can drag it there.
      */}
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel
          defaultSize={isMobile ? 40 : 24}
          minSize={isMobile ? 20 : 16}
          maxSize={isMobile ? 60 : 40}
          className="min-w-0"
        >
          {sidebar}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={isMobile ? 60 : 76} minSize={isMobile ? 40 : 45} className="min-w-0">
          {content}
        </ResizablePanel>
      </ResizablePanelGroup>

      <PlaylistEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editor={editor}
        tracks={database.tracks}
        root={rootHandle}
        canWrite={canWrite}
        backupLimit={settings.backupLimit}
        onCommitted={() => {
          setEditorOpen(false);
          onReload();
        }}
      />

      <BackupsDialog
        open={backupsOpen}
        onOpenChange={setBackupsOpen}
        root={rootHandle}
        canWrite={canWrite}
        backupLimit={settings.backupLimit}
        trackCount={database.tracks.length}
        playlistCount={database.playlists.length}
        onRestored={onReload}
      />

      <DevicesDialog open={devicesOpen} onOpenChange={setDevicesOpen} />
    </div>
  );
}
