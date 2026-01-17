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

export type USBStatus = 
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'valid'; database: RekordboxDatabase }
  | { type: 'partial'; message: string }
  | { type: 'invalid'; message: string }
  | { type: 'error'; message: string };

export type ViewMode = 'library' | 'files';

export type SortColumn = 'title' | 'artist' | 'album' | 'duration' | 'bpm' | 'key';
export type SortDirection = 'asc' | 'desc';