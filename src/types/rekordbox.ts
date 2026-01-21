export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number; // in seconds
  bpm: number;
  key: string;
  rating: number;
  bitrate: number;
  filePath: string;
  dateAdded: Date;
  label?: string;
  year?: number;
}

export interface Playlist {
  id: number;
  name: string;
  parentId: number | null;
  isFolder: boolean;
  children: Playlist[];
  trackIds: number[];
}

export interface RekordboxDatabase {
  tracks: Track[];
  playlists: Playlist[];
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  handle: FileSystemHandle;
}

export interface LibraryPresence {
  hasLegacy: boolean;
  hasPlus: boolean;
}

export type USBStatus = 
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'valid'; database: RekordboxDatabase; libraries: LibraryPresence }
  | { type: 'partial'; message: string; libraries?: LibraryPresence }
  | { type: 'invalid'; message: string }
  | { type: 'error'; message: string };

export type ViewMode = 'library' | 'files';

export type SortColumn = 'title' | 'artist' | 'album' | 'genre' | 'duration' | 'bpm' | 'label' | 'year';
export type SortDirection = 'asc' | 'desc';