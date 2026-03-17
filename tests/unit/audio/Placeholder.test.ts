// BlastSimulator2026 — Placeholder sounds unit tests (11.2)
// Verifies each sound synthesizes a non-silent AudioBuffer.

import { describe, it, expect, vi } from 'vitest';
import type { SoundId } from '../../../src/audio/Placeholder.js';

// ── Minimal AudioContext mock that supports createBuffer ──

function makeRealAudioBuffer(sampleRate: number, durationS: number): AudioBuffer {
  const length = Math.floor(sampleRate * durationS);
  const data = new Float32Array(length);
  // The buffer's getChannelData returns a reference to data we can inspect
  return {
    sampleRate,
    duration: durationS,
    length,
    numberOfChannels: 1,
    getChannelData: (ch: number) => {
      if (ch !== 0) throw new Error('only 1 channel');
      return data;
    },
  } as unknown as AudioBuffer;
}

const mockCtx = {
  sampleRate: 44100,
  createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
    return makeRealAudioBuffer(sampleRate, length / sampleRate);
  }),
} as unknown as AudioContext;

import { SoundLibrary } from '../../../src/audio/Placeholder.js';

const ALL_SOUND_IDS: SoundId[] = [
  'beep', 'boom', 'rumble', 'chime', 'ambient', 'engine', 'drill', 'rain', 'thud',
];

describe('SoundLibrary / Placeholder sounds (11.2)', () => {
  it('get() returns an AudioBuffer for every sound ID', () => {
    const lib = new SoundLibrary(mockCtx);
    for (const id of ALL_SOUND_IDS) {
      const buf = lib.get(id);
      expect(buf).toBeDefined();
      expect(buf.length).toBeGreaterThan(0);
    }
  });

  it('buffers are cached (same reference returned)', () => {
    const lib = new SoundLibrary(mockCtx);
    const a = lib.get('boom');
    const b = lib.get('boom');
    expect(a).toBe(b);
  });

  it('each sound fills the buffer with non-zero data', () => {
    const lib = new SoundLibrary(mockCtx);
    for (const id of ALL_SOUND_IDS) {
      const buf = lib.get(id);
      const data = buf.getChannelData(0);
      // Check a middle slice — envelope-based sounds start at 0, ramp up mid-buffer
      const mid = Math.floor(data.length / 4);
      const hasSound = Array.from(data.slice(mid, mid + 1000)).some(v => Math.abs(v) > 1e-6);
      expect(hasSound, `${id} should not be silent`).toBe(true);
    }
  });

  it('preload() populates all sounds', () => {
    const lib = new SoundLibrary(mockCtx);
    vi.spyOn(lib, 'get');
    lib.preload();
    for (const id of ALL_SOUND_IDS) {
      expect(lib.get).toHaveBeenCalledWith(id);
    }
  });

  it('sounds have reasonable durations', () => {
    const lib = new SoundLibrary(mockCtx);
    // beep should be short (<0.5s), ambient should be longer (>1s)
    expect(lib.get('beep').duration).toBeLessThan(0.5);
    expect(lib.get('ambient').duration).toBeGreaterThan(1.0);
    expect(lib.get('boom').duration).toBeGreaterThan(0.5);
  });
});
