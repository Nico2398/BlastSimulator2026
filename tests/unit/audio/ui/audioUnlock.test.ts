// @vitest-environment jsdom
// BlastSimulator2026 — Audio unlock on the first gesture that works
// A gesture the browser does not count as an activation leaves the context suspended; the listeners must
// survive it. Real DOM events against a fake manager whose resume() only succeeds when told to.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installAudioUnlock, UNLOCK_GESTURES, type UnlockableAudio,
} from '../../../../src/audio/ui/audioUnlock.js';

let state: string;
let hasContext: boolean;
let resumeCalls: number;
let acceptGestures: boolean;
let musicUnlocks: number;
let dispose: () => void;

const audio: UnlockableAudio = {
  get context() { return hasContext ? { state } : null; },
  resume: () => {
    resumeCalls++;
    if (acceptGestures) state = 'running';
    return Promise.resolve();
  },
};
const music = { unlock: (): void => { musicUnlocks++; } };

const gesture = (type: string): void => {
  document.body.dispatchEvent(new Event(type, { bubbles: true }));
};
/** Let the resume() promise and its settle handler run: microtasks only, no timer. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  state = 'suspended';
  hasContext = true;
  resumeCalls = 0;
  acceptGestures = false;
  musicUnlocks = 0;
  dispose = installAudioUnlock(document, audio, music);
});

afterEach(() => dispose());

describe('installAudioUnlock', () => {
  it.each(['pointerdown', 'pointerup', 'click', 'touchend', 'keydown'])('listens for %s', async type => {
    expect(UNLOCK_GESTURES).toContain(type);
    gesture(type);
    await settle();
    expect(resumeCalls).toBe(1);
    expect(musicUnlocks).toBe(1);
  });

  it('stays attached after a gesture the browser did not accept, and retries on the next', async () => {
    gesture('keydown');
    await settle();
    gesture('pointerdown');
    await settle();
    expect(resumeCalls).toBe(2);
    expect(musicUnlocks).toBe(2);
  });

  it('detaches once the context is running', async () => {
    acceptGestures = true;
    gesture('pointerup');
    await settle();
    expect(state).toBe('running');
    for (const type of UNLOCK_GESTURES) gesture(type);
    await settle();
    expect(resumeCalls).toBe(1);
  });

  it('detaches on the first gesture when the browser has no context', async () => {
    hasContext = false;
    gesture('click');
    await settle();
    gesture('click');
    await settle();
    expect(resumeCalls).toBe(1);
  });

  it('keeps retrying when resume() rejects while the context is still suspended', async () => {
    let attempts = 0;
    const failing: UnlockableAudio = {
      context: { state: 'suspended' },
      resume: () => { attempts++; return Promise.reject(new Error('blocked')); },
    };
    dispose();
    dispose = installAudioUnlock(document, failing, null);
    gesture('keydown');
    await settle();
    gesture('keydown');
    await settle();
    expect(attempts).toBe(2);
  });

  it('does not wait for the resume on the gesture path', () => {
    gesture('click');
    expect(resumeCalls).toBe(1);
    expect(musicUnlocks).toBe(1);
  });

  it('works without a music director and its disposer detaches', async () => {
    dispose();
    dispose = installAudioUnlock(document, audio, null);
    gesture('click');
    await settle();
    dispose();
    gesture('click');
    await settle();
    expect(resumeCalls).toBe(1);
  });
});
