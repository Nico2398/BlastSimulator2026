// BlastSimulator2026 — AudioHooks unit tests
// The blast's sounds are synthesized up front, not inside the detonate frame (#1603).

import { describe, it, expect, vi } from 'vitest';
import { AudioHooks } from '../../../src/audio/AudioHooks.js';
import type { AudioManager } from '../../../src/audio/AudioManager.js';

function fakeAudio() {
  const created: number[] = [];
  const played: AudioBuffer[] = [];
  const ctx = {
    sampleRate: 44100,
    createBuffer: (_channels: number, length: number, sampleRate: number) => {
      created.push(length);
      const data = new Float32Array(length);
      return { sampleRate, length, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
    },
  } as unknown as AudioContext;
  const audio = {
    getContext: () => ctx,
    resume: vi.fn(() => Promise.resolve()),
    playBuffer: vi.fn((buffer: AudioBuffer) => { played.push(buffer); }),
  } as unknown as AudioManager;
  return { audio, created, played };
}

describe('AudioHooks', () => {
  it('synthesizes the blast boom and rumble when constructed', () => {
    const { audio, created } = fakeAudio();
    new AudioHooks(audio);
    expect(created).toHaveLength(2);
  });

  it('onBlast plays the preloaded buffers without synthesizing again', async () => {
    const { audio, created, played } = fakeAudio();
    const hooks = new AudioHooks(audio);
    hooks.onBlast();
    await vi.waitFor(() => expect(played).toHaveLength(2));
    expect(created).toHaveLength(2);
  });

  it('other sounds are still synthesized on first use', async () => {
    const { audio, created } = fakeAudio();
    const hooks = new AudioHooks(audio);
    hooks.onUIClick();
    await vi.waitFor(() => expect(created).toHaveLength(3));
  });
});
