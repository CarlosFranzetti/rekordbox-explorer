import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extensionOf, REKORDBOX_FORMATS } from './formats';

describe('extensionOf', () => {
  it('reads the extension, case-insensitively', () => {
    expect(extensionOf('/Contents/A/B.AIFF')).toBe('aiff');
    expect(extensionOf("/Contents/A/B - remix (12in).mp3")).toBe('mp3');
  });
});

describe('formatFor', () => {
  // canPlayType is probed once per extension and cached, so each case needs a
  // fresh module instance.
  async function withCanPlay(answer: (mime: string) => CanPlayTypeResult) {
    vi.resetModules();
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(answer);
    return import('./formats');
  }

  beforeEach(() => vi.restoreAllMocks());

  it('uses native playback when the browser says it can', async () => {
    const { formatFor } = await withCanPlay(() => 'probably' as CanPlayTypeResult);
    expect(formatFor('/a/b.mp3').playback).toBe('native');
    expect(formatFor('/a/b.flac').playback).toBe('native');
  });

  it('falls back to decoding for AIFF and WAV when the browser refuses', async () => {
    const { formatFor } = await withCanPlay(() => '' as CanPlayTypeResult);
    expect(formatFor('/a/b.aiff').playback).toBe('decode');
    expect(formatFor('/a/b.wav').playback).toBe('decode');
  });

  it('reports formats it can neither play nor decode', async () => {
    const { formatFor, unsupportedMessage } = await withCanPlay(() => '' as CanPlayTypeResult);
    const m4a = formatFor('/a/b.m4a');
    expect(m4a.playback).toBe('unsupported');
    // Must never suggest the file is broken.
    expect(unsupportedMessage(m4a)).toMatch(/track itself is fine/);
    expect(unsupportedMessage(m4a)).toMatch(/ALAC/);
  });

  it('adapts to a build that lacks AAC while keeping MP3', async () => {
    // A Chromium without proprietary codecs — the real reason this is probed
    // at runtime rather than hardcoded.
    const { formatFor } = await withCanPlay((m) =>
      (m.startsWith('audio/mpeg') ? 'probably' : '') as CanPlayTypeResult
    );
    expect(formatFor('/a/b.mp3').playback).toBe('native');
    expect(formatFor('/a/b.m4a').playback).toBe('unsupported');
    expect(formatFor('/a/b.aiff').playback).toBe('decode');
  });

  it('treats an unknown extension as unsupported rather than guessing', async () => {
    const { formatFor } = await withCanPlay(() => 'probably' as CanPlayTypeResult);
    expect(formatFor('/a/b.xyz').playback).toBe('unsupported');
  });

  it('covers every format rekordbox accepts', async () => {
    const { formatFor } = await withCanPlay(
      (m) => (m.includes('aiff') || m.includes('mp4') ? '' : 'probably') as CanPlayTypeResult
    );
    for (const ext of REKORDBOX_FORMATS) {
      const info = formatFor(`/a/b.${ext}`);
      // Either we play it or we say precisely why not — never silence.
      expect(['native', 'decode', 'unsupported']).toContain(info.playback);
      expect(info.label).toBeTruthy();
    }
    // Only the M4A container should be left unsupported in this configuration.
    expect(formatFor('/a/b.aiff').playback).toBe('decode');
    expect(formatFor('/a/b.wav').playback).toBe('native');
    expect(formatFor('/a/b.m4a').playback).toBe('unsupported');
  });
});
