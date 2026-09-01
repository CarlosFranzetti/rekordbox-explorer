/**
 * A throwaway harness that renders the REAL TrackTable and PlayerBar with fixed
 * props, so the player can be looked at without a USB attached.
 *
 * Not part of the app: `preview.html` is not referenced by `index.html` and this
 * entry is excluded from the production build.
 */
/* eslint-disable react-refresh/only-export-components */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { TrackTable } from '@/components/TrackTable';
import { PlayerBar } from '@/components/PlayerBar';
import type { Track } from '@/types/rekordbox';
import './index.css';

const make = (
  id: number,
  title: string,
  artist: string,
  album: string,
  genre: string,
  bpm: number,
  duration: number,
  year: number,
  ext = 'aiff'
): Track => ({
  id,
  title,
  artist,
  album,
  genre,
  duration,
  bpm,
  key: '',
  rating: 0,
  bitrate: 1411,
  filePath: `/Contents/${artist}/${album}/${artist} - ${title}.${ext}`,
  dateAdded: new Date(0),
  year,
  label: album,
});

const tracks: Track[] = [
  make(1, 'Infinition', 'Quadrant', 'In Order To Dance 5', 'Techno', 128, 463, 1994),
  make(2, 'Big Fun', 'Inner City', 'Techno! The New Dance Sound Of Detroit', 'Techno', 120, 463, 1988),
  make(3, 'Techno Music', 'Juan', 'Techno! The New Dance Sound Of Detroit', 'Techno', 122, 388, 1988),
  make(4, 'Cold Funk', 'Funkorama', 'Funkorama', 'Funk / Soul', 112, 288, 1995),
  make(5, 'Camargue', 'CJ Bolland', 'The Sound Of Belgium', 'Techno', 131, 402, 1992),
  make(6, 'Encore', 'Latex', 'Essential Underground Vol. 03', 'Acid', 134, 351, 2001),
  make(7, 'Hammajang', 'Noah Skelton', 'Anabiosis EP', 'Minimal / Deep Tech', 126, 377, 2024, 'mp3'),
  make(8, 'Ride Em Boy', 'Blake Baxter', 'Techno! The New Dance Sound Of Detroit', 'Detroit', 118, 340, 1988),
  make(9, 'Oubliettes', 'RWN', 'Abduction005', 'Techno', 137, 396, 2023),
  make(10, 'Lucid Dream', 'Valen', 'Timeline EP', 'Deep House', 124, 421, 2024, 'flac'),
];

function Preview() {
  const [index, setIndex] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(126);
  const track = tracks[index];

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-3">
        <h1 className="text-lg font-semibold text-foreground">All Tracks</h1>
        <span className="text-sm text-muted-foreground">{tracks.length}</span>
      </header>

      <main
        className="min-h-0 flex-1 overflow-hidden"
        style={{ paddingBottom: 'var(--player-h, 0px)' }}
      >
        <TrackTable
          tracks={tracks}
          sortColumn="title"
          sortDirection="asc"
          onSort={() => {}}
          hiddenColumns={[]}
          onPlay={(t) => {
            setIndex(tracks.indexOf(t));
            setPosition(0);
            setPlaying(true);
          }}
          nowPlayingId={track.id}
        />
      </main>

      <PlayerBar
        track={track}
        playing={playing}
        loading={false}
        position={position}
        duration={track.duration}
        error={null}
        hasPrevious={index > 0}
        hasNext={index < tracks.length - 1}
        onToggle={() => setPlaying((p) => !p)}
        onSeek={setPosition}
        onNext={() => setIndex((i) => Math.min(i + 1, tracks.length - 1))}
        onPrevious={() => setIndex((i) => Math.max(i - 1, 0))}
        onClose={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
