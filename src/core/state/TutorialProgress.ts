import type { GameState } from './GameState.js';

/** Persisted tutorial position so a save/load can resume mid-tutorial (#1333). */
export interface TutorialProgress {
  stepIndex: number;
  /** Opaque per-step snapshot used by the overlay to re-arm step conditions. */
  snapshot: Record<string, unknown>;
}

export function recordTutorialProgress(
  state: GameState,
  stepIndex: number,
  snapshot: Record<string, unknown>,
): void {
  state.tutorialProgress = { stepIndex, snapshot: { ...snapshot } };
}

export function clearTutorialProgress(state: GameState): void {
  state.tutorialProgress = null;
}

/** Validated progress, or null when absent or stepIndex is outside [0, stepCount). */
export function readTutorialProgress(
  state: Pick<GameState, 'tutorialProgress'>,
  stepCount: number,
): TutorialProgress | null {
  const progress = sanitizeTutorialProgress(state.tutorialProgress);
  if (!progress || progress.stepIndex >= stepCount) return null;
  return progress;
}

/** Coerces untrusted deserialized data; undefined when malformed. */
export function sanitizeTutorialProgress(raw: unknown): TutorialProgress | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { stepIndex, snapshot } = raw as Record<string, unknown>;
  if (typeof stepIndex !== 'number' || !Number.isInteger(stepIndex) || stepIndex < 0) return undefined;
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return undefined;
  return { stepIndex, snapshot: snapshot as Record<string, unknown> };
}
