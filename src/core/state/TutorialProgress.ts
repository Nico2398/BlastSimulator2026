import type { GameState } from './GameState.js';

/** Persisted tutorial position so a save/load can resume mid-tutorial (#1333). */
export interface TutorialProgress {
  stepIndex: number;
  /** Opaque per-step snapshot used by the overlay to re-arm step conditions. */
  snapshot: Record<string, unknown>;
}

export function recordTutorialProgress(
  _state: GameState,
  _stepIndex: number,
  _snapshot: Record<string, unknown>,
): void {
  // TODO: implement
}

export function clearTutorialProgress(_state: GameState): void {
  // TODO: implement
}

/** Validated progress, or null when absent or stepIndex is outside [0, stepCount). */
export function readTutorialProgress(
  _state: Pick<GameState, 'tutorialProgress'>,
  _stepCount: number,
): TutorialProgress | null {
  return null; // TODO: implement
}

/** Coerces untrusted deserialized data; undefined when malformed. */
export function sanitizeTutorialProgress(_raw: unknown): TutorialProgress | undefined {
  return undefined; // TODO: implement
}
