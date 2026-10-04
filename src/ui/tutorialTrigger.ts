export const TUTORIAL_LEVEL_ID = 'tutorial_pit';

/** Auto-start after a level entry: only the tutorial map, only for first-timers. */
export function shouldAutoStartTutorial(
  levelId: string | null | undefined,
  completed: boolean,
): boolean {
  return levelId === TUTORIAL_LEVEL_ID && !completed;
}

/** Keep a running tutorial: only while the live level is the tutorial map. */
export function shouldKeepTutorialRunning(levelId: string | null | undefined): boolean {
  return levelId === TUTORIAL_LEVEL_ID;
}
