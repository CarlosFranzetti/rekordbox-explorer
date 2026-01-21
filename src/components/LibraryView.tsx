import { useState, useEffect } from 'react';
import { FileDown } from 'lucide-react';
import { PlaylistSidebar } from './PlaylistSidebar';
import { TrackTable } from './TrackTable';
import { FileBrowser } from './FileBrowser';
import { SearchBar } from './SearchBar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/hooks/useSettings';
import { exportTracksToPdf } from '@/lib/pdf-export';
import type { RekordboxDatabase, Playlist, Track, ViewMode, SortColumn, SortDirection, FileEntry } from '@/types/rekordbox';

interface LibraryViewProps {
  database: RekordboxDatabase;
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
}

export function LibraryView({
  database,
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
  onReset
}: LibraryViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('library');
  const { colorScheme, fontSize, setColorScheme, setFontSize } = useSettings();

  // Load file entries when switching to files mode
  useEffect(() => {
    if (viewMode === 'files' && fileEntries.length === 0) {
      onLoadFileEntries();
    }
  }, [viewMode, fileEntries.length, onLoadFileEntries]);

  const currentPlaylistName = selectedPlaylist?.name || 'All Tracks';

  return (
    <div className="h-screen bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={24} minSize={16} maxSize={40} className="min-w-0">
          <PlaylistSidebar
            playlists={database.playlists}
            selectedPlaylist={selectedPlaylist}
            onSelectPlaylist={onSelectPlaylist}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            trackCount={database.tracks.length}
            onReset={onReset}
            colorScheme={colorScheme}
            onColorSchemeChange={setColorScheme}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={76} minSize={60} className="min-w-0">
          <div className="flex h-full flex-col overflow-hidden">
            <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <div className="flex min-w-0 items-center gap-4">
                <h1 className="truncate text-lg font-semibold text-foreground">
                  {viewMode === 'files' ? 'File Browser' : currentPlaylistName}
                </h1>
                {viewMode === 'library' && (
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {filteredTracks.length} track{filteredTracks.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {viewMode === 'library' && (
                <div className="flex items-center gap-2">
                  <div className="w-72 max-w-[35vw]">
                    <SearchBar value={searchQuery} onChange={onSearchChange} />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => exportTracksToPdf(filteredTracks, currentPlaylistName)}
                    title="Export to PDF"
                  >
                    <FileDown className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </header>

            <main className="flex-1 overflow-hidden">
              {viewMode === 'library' ? (
                <TrackTable
                  tracks={filteredTracks}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
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
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
