import type { Page } from 'puppeteer';
import { gameState } from './interaction-driver.js';

/**
 * Game state when a step that may become moot (`ScenarioStepDef.interactionOnly`
 * or `skipWhenLevelEnded`) has nothing left to play because the level already
 * ended on its own — the mine is frozen and the goal is reached, so waiting on
 * its clock or clicking its panels stalls. Null for any other step or a level
 * still running. Shared by the single-scenario and batch runners so both skip
 * identically (the batch is what CI runs).
 */
export async function stateIfInteractionOnlyStepMoot(
  page: Page,
  step: { interactionOnly?: boolean; skipWhenLevelEnded?: boolean },
): Promise<Record<string, unknown> | null> {
  if (!step.interactionOnly && !step.skipWhenLevelEnded) return null;
  const current = await gameState(page);
  return current['levelEnded'] === true ? current : null;
}
