import { useRekordbox } from '@/hooks/useRekordbox';
import { LandingScreen } from '@/components/LandingScreen';
import { LibraryView } from '@/components/LibraryView';

const Index = () => {
  const {
    status,
    directoryPath,
    fileEntries,
    selectedPlaylist,
    searchQuery,
    sortColumn,
    sortDirection,
    selectFolder,
    performFullScan,
    navigateToDirectory,
    navigateUp,
    loadFileEntries,
    reset,
    setSelectedPlaylist,
    setSearchQuery,
    getFilteredTracks,
    handleSort
  } = useRekordbox();

  // Show library view when database is loaded
  if (status.type === 'valid') {
    return (
      <LibraryView
        database={status.database}
        selectedPlaylist={selectedPlaylist}
        onSelectPlaylist={setSelectedPlaylist}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={handleSort}
        filteredTracks={getFilteredTracks()}
        fileEntries={fileEntries}
        directoryPath={directoryPath}
        onNavigateToDirectory={navigateToDirectory}
        onNavigateUp={navigateUp}
        onLoadFileEntries={loadFileEntries}
        onReset={reset}
      />
    );
  }

  // Show landing screen for all other states
  return (
    <LandingScreen
      status={status}
      onSelectFolder={selectFolder}
      onFullScan={performFullScan}
      onReset={reset}
    />
  );
};

export default Index;