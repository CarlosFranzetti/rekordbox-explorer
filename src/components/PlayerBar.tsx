import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Loader2 } from 'lucide-react';
import type { AuditionState } from '@/hooks/useAudition';

/**
 * The audition transport, pinned to the bottom.
 *
 * Publishes its own measured height as `--player-h` so the track table can
 * reserve space rather than hiding its last rows under the bar — the bar's
 * height changes when an error line appears, so a constant would be wrong.
 *
 * The **surface** spans the viewport so it reads as a bar, but its **contents**
 * are capped and centred. Left full-width on a wide monitor the seek control
 * stretched past 2000px, where one pixel is a fifth of a second: visually it
 * dominated the layout, and the precision was far beyond anything a person aims
 * for when scrubbing. Below the cap — phones, narrow windows — the constraint
 * does nothing and the bar fills the width as before.
 */

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface PlayerBarProps extends AuditionState {
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function PlayerBar({
  track,
  playing,
  loading,
  position,
  duration,
  error,
  hasPrevious,
  hasNext,
  onToggle,
  onSeek,
  onNext,
  onPrevious,
  onClose,
}: PlayerBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  // While dragging, the thumb follows the finger and the playhead does not move
  // until release — so the readout must show the drag position, not the real one.
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    // Measure to the bottom of the viewport, not just the bar's height: the bar
    // floats clear of the edge, so the table has to clear that gap too.
    const publish = () => {
      const gap = window.innerHeight - el.getBoundingClientRect().top;
      document.documentElement.style.setProperty('--player-h', `${Math.ceil(gap)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener('resize', publish);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      document.documentElement.style.setProperty('--player-h', '0px');
    };
  }, [track]);

  if (!track) return null;

  const shown = scrubbing ?? position;
  const length = duration || track.duration || 0;
  const percent = length > 0 ? Math.min(100, (shown / length) * 100) : 0;
  const subtitle = [track.artist, track.album].filter(Boolean).join(' — ');

  const control =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground ' +
    'transition-colors hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div
      ref={barRef}
      className="player-live player-inset fixed inset-x-2 z-50 overflow-hidden rounded-xl border border-primary/70 bg-background/95 backdrop-blur-lg sm:inset-x-3"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 pt-2.5">
        <span className="w-10 shrink-0 text-right text-[0.625rem] tabular-nums text-muted-foreground">
          {clock(shown)}
        </span>
        <input
          type="range"
          min={0}
          max={length || 1}
          step={1}
          value={shown}
          disabled={length <= 0}
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onPointerUp={() => {
            if (scrubbing !== null) onSeek(scrubbing);
            setScrubbing(null);
          }}
          onKeyUp={() => {
            if (scrubbing !== null) onSeek(scrubbing);
            setScrubbing(null);
          }}
          aria-label="Seek"
          style={{ '--progress': `${percent}%` } as React.CSSProperties}
          className="player-range min-w-0 flex-1"
        />
        <span className="w-10 shrink-0 text-[0.625rem] tabular-nums text-muted-foreground">
          {clock(length)}
        </span>
      </div>

      <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-2 pb-2.5">
        <button onClick={onPrevious} disabled={!hasPrevious} aria-label="Previous track" className={control}>
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          onClick={onToggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className={`${control} bg-primary text-primary-foreground hover:bg-primary/90`}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </button>
        <button onClick={onNext} disabled={!hasNext} aria-label="Next track" className={control}>
          <SkipForward className="h-4 w-4" />
        </button>

        <div className="mx-2 min-w-0 flex-1">
          <p className="truncate text-xs font-medium leading-tight text-foreground">{track.title}</p>
          <p
            className={`truncate text-[0.625rem] leading-tight ${
              error ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {error ?? subtitle}
          </p>
        </div>

        <button onClick={onClose} aria-label="Close player" className={control}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
