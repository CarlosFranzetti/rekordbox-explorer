import { useRekordbox } from '@/hooks/useRekordbox';
import { LandingScreen } from '@/components/LandingScreen';
import { LibraryView } from '@/components/LibraryView';

const Index = () => {
  const rekordbox = useRekordbox();

  if (rekordbox.status.type === 'valid') {
    return (
      <LibraryView
        database={rekordbox.status.database}
        libraries={rekordbox.status.libraries}
        rootHandle={rekordbox.rootHandle}
        selectedPlaylist={rekordbox.selectedPlaylist}
        onSelectPlaylist={rekordbox.setSelectedPlaylist}
        searchQuery={rekordbox.searchQuery}
        onSearchChange={rekordbox.setSearchQuery}
        sortColumn={rekordbox.sortColumn}
        sortDirection={rekordbox.sortDirection}
        onSort={rekordbox.handleSort}
        filteredTracks={rekordbox.getFilteredTracks()}
        fileEntries={rekordbox.fileEntries}
        directoryPath={rekordbox.directoryPath}
        onNavigateToDirectory={rekordbox.navigateToDirectory}
        onNavigateUp={rekordbox.navigateUp}
        onLoadFileEntries={rekordbox.loadFileEntries}
        onReset={rekordbox.reset}
        onReload={rekordbox.reload}
      />
    );
  }

  return (
    <LandingScreen
      status={rekordbox.status}
      onSelectFolder={rekordbox.selectFolder}
      onFullScan={rekordbox.performFullScan}
      onReset={rekordbox.reset}
      onSelectFile={rekordbox.triggerFileInput}
      fileInputRef={rekordbox.fileInputRef}
      onFileInput={rekordbox.handleFileInput}
    />
  );
};

export default Index;
