export const TUTORIAL_LEVEL_ID = 'tutorial_pit';

/** True for any terminal `levelEndReason` other than a genuine win: set and not 'completed'. */
export function isDefeatReason(reason: string | null | undefined): boolean {
  return !!reason && reason !== 'completed';
}

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

/** True when retrying a level that ended without completion should restart the tutorial. */
export function shouldRestartTutorialOnRetry(
  levelId: string | null | undefined,
  levelEndReason: string | null | undefined,
): boolean {
  return levelId === TUTORIAL_LEVEL_ID && isDefeatReason(levelEndReason);
}
