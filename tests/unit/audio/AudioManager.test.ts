// BlastSimulator2026 — AudioManager unit tests (11.1)
// Uses a minimal Web Audio API mock (no DOM needed).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Minimal Web Audio API mock ──

function makeGainNode() {
  return {
    gain: { value: 1.0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function makeBufferSource() {
  return {
    buffer: null as unknown,
    loop: false,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function makeAudioBuffer(duration: number, sampleRate: number) {
  const data = new Float32Array(Math.floor(duration * sampleRate));
  return {
    duration,
    sampleRate,
    getChannelData: () => data,
    numberOfChannels: 1,
    length: data.length,
  };
}

const mockCtx = {
  state: 'running',
  currentTime: 0,
  sampleRate: 44100,
  createGain: vi.fn(() => makeGainNode()),
  createBufferSource: vi.fn(() => makeBufferSource()),
  createBuffer: vi.fn((_channels: number, length: number, rate: number) => makeAudioBuffer(length / rate, rate)),
  destination: {},
  resume: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.stubGlobal('AudioContext', vi.fn(() => mockCtx));

// Import after mock setup
import { AudioManager } from '../../../src/audio/AudioManager.js';
import { AUDIO_DEFAULT_VOLUMES } from '../../../src/core/config/balance.js';

describe('AudioManager (11.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.state = 'running';
  });

  it('constructs and connects gain nodes', () => {
    const mgr = new AudioManager();
    expect(mockCtx.createGain).toHaveBeenCalled();
    mgr.dispose();
  });

  it('setVolume adjusts master gain', () => {
    const mgr = new AudioManager();
    mgr.setVolume('master', 0.5);
    expect(mgr.getVolume('master')).toBe(0.5);
    mgr.dispose();
  });

  it('setVolume clamps to 0-1', () => {
    const mgr = new AudioManager();
    mgr.setVolume('effects', -1);
    expect(mgr.getVolume('effects')).toBe(0);
    mgr.setVolume('effects', 999);
    expect(mgr.getVolume('effects')).toBe(1);
    mgr.dispose();
  });

  it('setMuted true silences master gain', () => {
    const mgr = new AudioManager();
    mgr.setMuted(true);
    expect(mgr.isMuted).toBe(true);
    mgr.dispose();
  });

  it('setMuted false restores volume', () => {
    const mgr = new AudioManager();
    mgr.setVolume('master', 0.8);
    mgr.setMuted(true);
    mgr.setMuted(false);
    expect(mgr.isMuted).toBe(false);
    mgr.dispose();
  });

  it('playBuffer returns a handle with stop()', () => {
    const mgr = new AudioManager();
    const buf = makeAudioBuffer(0.1, 44100) as unknown as AudioBuffer;
    const handle = mgr.playBuffer(buf, 'effects');
    expect(typeof handle.stop).toBe('function');
    handle.stop();
    mgr.dispose();
  });

  it('playLooping returns a handle with stop()', () => {
    const mgr = new AudioManager();
    const buf = makeAudioBuffer(1.0, 44100) as unknown as AudioBuffer;
    const handle = mgr.playLooping(buf, 'ambient');
    expect(typeof handle.stop).toBe('function');
    handle.stop();
    mgr.dispose();
  });

  it('playBuffer does nothing when muted', () => {
    const mgr = new AudioManager();
    mgr.setMuted(true);
    const buf = makeAudioBuffer(0.1, 44100) as unknown as AudioBuffer;
    const sourceBefore = mockCtx.createBufferSource.mock.calls.length;
    mgr.playBuffer(buf, 'effects');
    // No new source should be created
    expect(mockCtx.createBufferSource.mock.calls.length).toBe(sourceBefore);
    mgr.dispose();
  });
});

describe('AudioManager.applyVolumes (#1324)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCtx.state = 'running'; });

  it('default volumes equal AUDIO_DEFAULT_VOLUMES', () => {
    const mgr = new AudioManager();
    for (const ch of Object.keys(AUDIO_DEFAULT_VOLUMES) as Array<keyof typeof AUDIO_DEFAULT_VOLUMES>) {
      expect(mgr.getVolume(ch)).toBe(AUDIO_DEFAULT_VOLUMES[ch]);
    }
    mgr.dispose();
  });

  it('sets every provided channel', () => {
    const mgr = new AudioManager();
    mgr.applyVolumes({ master: 0.5, effects: 0.25, ambient: 0.1, ui: 0 });
    expect(mgr.getVolume('master')).toBe(0.5);
    expect(mgr.getVolume('effects')).toBe(0.25);
    expect(mgr.getVolume('ambient')).toBe(0.1);
    expect(mgr.getVolume('ui')).toBe(0);
    mgr.dispose();
  });

  it('absent channels keep their value', () => {
    const mgr = new AudioManager();
    mgr.applyVolumes({ master: 0.3 });
    expect(mgr.getVolume('master')).toBe(0.3);
    expect(mgr.getVolume('ambient')).toBe(AUDIO_DEFAULT_VOLUMES.ambient);
    mgr.dispose();
  });

  it('applies to the gain nodes, clamped', () => {
    const mgr = new AudioManager();
    mgr.applyVolumes({ ui: 7, effects: -2 });
    expect(mgr.getVolume('ui')).toBe(1);
    expect(mgr.getVolume('effects')).toBe(0);
    expect(mgr.getCategoryGain('ui').gain.value).toBe(1);
    mgr.dispose();
  });
});
