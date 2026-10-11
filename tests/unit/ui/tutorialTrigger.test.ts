import { describe, it, expect } from 'vitest';
import {
  TUTORIAL_LEVEL_ID,
  shouldAutoStartTutorial,
  shouldKeepTutorialRunning,
  shouldRestartTutorialOnRetry,
} from '../../../src/ui/tutorialTrigger';
import { getAllLevels } from '../../../src/core/campaign/Level';

const ALL_IDS = getAllLevels().map((l) => l.id);
const OTHER_IDS = ALL_IDS.filter((id) => id !== 'tutorial_pit');
const NOT_A_LEVEL: ReadonlyArray<string | null | undefined> = [null, undefined, '', 'nonexistent_level', 'TUTORIAL_PIT', ' tutorial_pit'];

describe('tutorialTrigger (#1319)', () => {
  it('TUTORIAL_LEVEL_ID is tutorial_pit and a real campaign level', () => {
    expect(TUTORIAL_LEVEL_ID).toBe('tutorial_pit');
    expect(ALL_IDS).toContain(TUTORIAL_LEVEL_ID);
    expect(OTHER_IDS.length).toBeGreaterThan(0);
  });

  describe('shouldAutoStartTutorial', () => {
    it('is true for the tutorial level when not yet completed', () => {
      expect(shouldAutoStartTutorial('tutorial_pit', false)).toBe(true);
    });

    it('is false for the tutorial level once completed', () => {
      expect(shouldAutoStartTutorial('tutorial_pit', true)).toBe(false);
    });

    it.each(ALL_IDS)('is false for %s when completed', (id) => {
      expect(shouldAutoStartTutorial(id, true)).toBe(false);
    });

    it.each(OTHER_IDS)('is false for non-tutorial level %s even for a first-timer', (id) => {
      expect(shouldAutoStartTutorial(id, false)).toBe(false);
    });

    it('is true for exactly one (level, completed) combination across the campaign', () => {
      const hits = ALL_IDS.flatMap((id) => [false, true].map((c) => [id, c] as const))
        .filter(([id, c]) => shouldAutoStartTutorial(id, c));
      expect(hits).toEqual([['tutorial_pit', false]]);
    });

    it.each(NOT_A_LEVEL)('is false for non-level id %j', (id) => {
      expect(shouldAutoStartTutorial(id, false)).toBe(false);
      expect(shouldAutoStartTutorial(id, true)).toBe(false);
    });
  });

  describe('shouldKeepTutorialRunning', () => {
    it('is true for the tutorial level', () => {
      expect(shouldKeepTutorialRunning('tutorial_pit')).toBe(true);
    });

    it.each(OTHER_IDS)('is false for non-tutorial level %s', (id) => {
      expect(shouldKeepTutorialRunning(id)).toBe(false);
    });

    it('is true for exactly one campaign level', () => {
      expect(ALL_IDS.filter((id) => shouldKeepTutorialRunning(id))).toEqual(['tutorial_pit']);
    });

    it.each(NOT_A_LEVEL)('is false for non-level id %j', (id) => {
      expect(shouldKeepTutorialRunning(id)).toBe(false);
    });
  });
});

describe('shouldRestartTutorialOnRetry (#1631)', () => {
  it('is true for a tutorial_pit bankruptcy', () => {
    expect(shouldRestartTutorialOnRetry('tutorial_pit', 'bankruptcy')).toBe(true);
  });

  it.each(['arrest', 'worker_revolt'])('is true for a tutorial_pit %s defeat', (reason) => {
    expect(shouldRestartTutorialOnRetry('tutorial_pit', reason)).toBe(true);
  });

  it.each([['completed'], [null], [undefined]] as const)(
    'is false for tutorial_pit when levelEndReason is %s',
    (reason) => {
      expect(shouldRestartTutorialOnRetry('tutorial_pit', reason)).toBe(false);
    },
  );

  it('is false for another level even on defeat', () => {
    expect(shouldRestartTutorialOnRetry('dusty_hollow', 'bankruptcy')).toBe(false);
  });

  it('is false with no level id', () => {
    expect(shouldRestartTutorialOnRetry(null, 'bankruptcy')).toBe(false);
    expect(shouldRestartTutorialOnRetry(undefined, 'bankruptcy')).toBe(false);
  });
});
