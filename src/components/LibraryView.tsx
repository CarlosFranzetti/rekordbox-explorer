import { useState, useEffect } from 'react';
import { PlaylistSidebar } from './PlaylistSidebar';
import { TrackTable } from './TrackTable';
import { FileBrowser } from './FileBrowser';
import { SearchBar } from './SearchBar';
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

  // Load file entries when switching to files mode
  useEffect(() => {
    if (viewMode === 'files' && fileEntries.length === 0) {
      onLoadFileEntries();
    }
  }, [viewMode, fileEntries.length, onLoadFileEntries]);

  const currentPlaylistName = selectedPlaylist?.name || 'All Tracks';

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <PlaylistSidebar
        playlists={database.playlists}
        selectedPlaylist={selectedPlaylist}
        onSelectPlaylist={onSelectPlaylist}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        trackCount={database.tracks.length}
        onReset={onReset}
      />

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-foreground">
              {viewMode === 'files' ? 'File Browser' : currentPlaylistName}
            </h1>
            {viewMode === 'library' && (
              <span className="text-sm text-muted-foreground">
                {filteredTracks.length} track{filteredTracks.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          
          {viewMode === 'library' && (
            <div className="w-72">
              <SearchBar 
                value={searchQuery} 
                onChange={onSearchChange} 
              />
            </div>
          )}
        </header>

        {/* Content */}
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
    </div>
  );
}