import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeAiff, needsManualDecode, extensionOf } from '@/lib/audio/aiff';
import type { Track } from '@/types/rekordbox';

/**
 * Audition tracks straight off the USB.
 *
 * Two playback engines, chosen per file:
 *
 * - **`<audio>`** for anything the browser decodes itself (MP3, FLAC, WAV, M4A).
 *   Streams, so a 60 MB file starts instantly and costs no memory.
 * - **Web Audio** for AIFF, which Chrome cannot decode at all. `aiff.ts` turns
 *   it into float samples and this plays them through an `AudioBufferSourceNode`.
 *
 * The split matters because of an awkward bind: the File System Access API is
 * Chrome-only, and Chrome is precisely the browser that will not play AIFF. On
 * a vinyl-leaning library that is most of the collection.
 *
 * A buffer source cannot be paused, only stopped, so position is tracked by
 * hand: remember where playback started in context time, and recreate the node
 * on resume. That is the standard shape and the reason this hook is not simply
 * a wrapper around `<audio>`.
 */

export interface AuditionState {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  /** Seconds elapsed. */
  position: number;
  /** Seconds total, 0 until known. */
  duration: number;
  error: string | null;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** Walk a `/Contents/Artist/Album/Track.aiff` path down from the drive root. */
async function fileAtPath(
  root: FileSystemDirectoryHandle,
  filePath: string
): Promise<File | null> {
  const parts = filePath.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  let dir = root;
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create: false });
    } catch {
      return null;
    }
  }
  try {
    return await (await dir.getFileHandle(name, { create: false })).getFile();
  } catch {
    return null;
  }
}

export function useAudition(root: FileSystemDirectoryHandle | null, queue: Track[]) {
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  /** Context time at which the current segment started, minus its offset. */
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const index = track ? queue.findIndex((t) => t.id === track.id) : -1;

  const stopBufferSource = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
      } catch {
        // Already stopped; nothing to do.
      }
      sourceRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    stopBufferSource();
    bufferRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [stopBufferSource]);

  // Drive the position readout for the Web Audio path, which has no timeupdate.
  useEffect(() => {
    if (!playing || !bufferRef.current || !ctxRef.current) return;
    const tick = () => {
      const ctx = ctxRef.current;
      const buffer = bufferRef.current;
      if (!ctx || !buffer) return;
      const elapsed = ctx.currentTime - startedAtRef.current;
      setPosition(Math.min(elapsed, buffer.duration));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing]);

  useEffect(() => teardown, [teardown]);

  const startBufferAt = useCallback((seconds: number) => {
    const ctx = ctxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;
    stopBufferSource();
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.onended = () => {
      // Distinguish "reached the end" from "stopped for a seek".
      if (sourceRef.current === node) {
        sourceRef.current = null;
        setPlaying(false);
        setPosition(buffer.duration);
      }
    };
    node.start(0, Math.max(0, Math.min(seconds, buffer.duration)));
    sourceRef.current = node;
    startedAtRef.current = ctx.currentTime - seconds;
    offsetRef.current = seconds;
    setPlaying(true);
  }, [stopBufferSource]);

  const play = useCallback(
    async (next: Track) => {
      if (!root) {
        setError('Open the USB drive before auditioning tracks.');
        return;
      }
      teardown();
      setTrack(next);
      setError(null);
      setLoading(true);
      setPosition(0);
      setDuration(next.duration || 0);

      try {
        const file = await fileAtPath(root, next.filePath);
        if (!file) {
          setError(
            `That file is not on this drive — the library lists it at ${next.filePath}, ` +
              'but nothing is there. The database and the audio have gone out of sync.'
          );
          setLoading(false);
          setPlaying(false);
          return;
        }

        if (needsManualDecode(next.filePath)) {
          // Chrome cannot decode AIFF, so do it ourselves.
          const bytes = new Uint8Array(await file.arrayBuffer());
          const decoded = decodeAiff(bytes);
          const ctx =
            ctxRef.current ??
            new (window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          ctxRef.current = ctx;
          if (ctx.state === 'suspended') await ctx.resume();

          const buffer = ctx.createBuffer(
            decoded.channels.length,
            decoded.frames,
            decoded.sampleRate
          );
          for (let c = 0; c < decoded.channels.length; c++) {
            // `channelData` is a view into the AudioBuffer; writing through it
            // sidesteps copyToChannel's stricter ArrayBuffer typing.
            buffer.getChannelData(c).set(decoded.channels[c]);
          }
          bufferRef.current = buffer;
          setDuration(buffer.duration);
          setLoading(false);
          startBufferAt(0);
          return;
        }

        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onloadedmetadata = () => setDuration(audio.duration || next.duration || 0);
        audio.ontimeupdate = () => setPosition(audio.currentTime);
        audio.onended = () => setPlaying(false);
        audio.onerror = () => {
          setError(
            `This browser cannot play ${extensionOf(next.filePath).toUpperCase() || 'this format'}. ` +
              'The file itself is fine.'
          );
          setPlaying(false);
          setLoading(false);
        };
        await audio.play();
        setPlaying(true);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That track could not be played.');
        setPlaying(false);
        setLoading(false);
      }
    },
    [root, teardown, startBufferAt]
  );

  const toggle = useCallback(async () => {
    if (!track) return;
    if (bufferRef.current) {
      if (playing) {
        // A buffer source cannot pause; stop it and remember where we were.
        const ctx = ctxRef.current;
        if (ctx) offsetRef.current = ctx.currentTime - startedAtRef.current;
        stopBufferSource();
        setPlaying(false);
      } else {
        startBufferAt(offsetRef.current);
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      await audio.play();
      setPlaying(true);
    }
  }, [track, playing, stopBufferSource, startBufferAt]);

  const seek = useCallback(
    (seconds: number) => {
      if (bufferRef.current) {
        offsetRef.current = seconds;
        setPosition(seconds);
        if (playing) startBufferAt(seconds);
        return;
      }
      if (audioRef.current) {
        audioRef.current.currentTime = seconds;
        setPosition(seconds);
      }
    },
    [playing, startBufferAt]
  );

  const skip = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const next = queue[index + delta];
      if (next) void play(next);
    },
    [index, queue, play]
  );

  const stop = useCallback(() => {
    teardown();
    setTrack(null);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setError(null);
  }, [teardown]);

  const state: AuditionState = {
    track,
    playing,
    loading,
    position,
    duration,
    error,
    hasPrevious: index > 0,
    hasNext: index >= 0 && index < queue.length - 1,
  };

  return { ...state, play, toggle, seek, stop, next: () => skip(1), previous: () => skip(-1) };
}
