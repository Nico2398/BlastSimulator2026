export const TUTORIAL_LEVEL_ID = 'tutorial_pit';

/** Auto-start after a level entry: only the tutorial map, only for first-timers. */
export function shouldAutoStartTutorial(
  _levelId: string | null | undefined,
  _completed: boolean,
): boolean {
  throw new Error('not implemented');
}

/** Keep a running tutorial: only while the live level is the tutorial map. */
export function shouldKeepTutorialRunning(_levelId: string | null | undefined): boolean {
  throw new Error('not implemented');
}
