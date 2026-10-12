// BlastSimulator2026 — Audio unlock on the first gesture that works
// Browsers keep an AudioContext suspended until a gesture they count as a user activation. Not every gesture
// counts (Escape, a touchstart or a pointerdown that becomes a scroll do not), so the listeners stay until the
// context is actually running, and every gesture in between tries again.

/** The part of AudioManager the unlock reads. */
export interface UnlockableAudio {
  resume(): Promise<void>;
  readonly context: { readonly state: string } | null;
}

/** The part of the music director the unlock starts. */
interface UnlockableMusic {
  unlock(): void;
}

/** Gestures a browser may accept as an activation: the press, the release, the click, a touch end, a key. */
export const UNLOCK_GESTURES: readonly string[] = ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown'];

/**
 * Resume `audio` and start waiting music on every gesture until the context is running. With no context at all
 * (a browser without Web Audio) the first gesture detaches. The resume is never awaited on the gesture's path:
 * detaching happens when it settles. Returns a disposer for tests and teardown.
 */
export function installAudioUnlock(doc: Document, audio: UnlockableAudio, music: UnlockableMusic | null): () => void {
  const detach = (): void => {
    for (const type of UNLOCK_GESTURES) doc.removeEventListener(type, unlock, true);
  };
  const detachOnceRunning = (): void => {
    const state = audio.context?.state;
    if (state === undefined || state === 'running') detach();
  };
  function unlock(): void {
    void audio.resume().then(detachOnceRunning, detachOnceRunning);
    music?.unlock();
  }
  for (const type of UNLOCK_GESTURES) doc.addEventListener(type, unlock, true);
  return detach;
}
