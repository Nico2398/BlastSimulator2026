// BlastSimulator2026 — Shared game runs for the crowding tests
// A scripted game costs real CPU (the simulation), so a file plays each (scenario, speed) once and every
// test in it reads the same recording. Test files run in separate workers, so nothing leaks between them.

import type { CrowdSim, GameSpeed } from '../../../helpers/audioCrowding.js';
import { playScenario } from '../../../helpers/audioCrowdingScenario.js';

const cache = new Map<string, CrowdSim>();

/**
 * The scenario played at `speed`, recorded once: start to finish, or until the step that crosses `maxRealS` real
 * seconds when only the opening of a long game matters.
 */
export function scenarioRun(name: string, speed: GameSpeed, maxRealS?: number): CrowdSim {
  const key = `${name}@${speed}/${maxRealS ?? 'all'}`;
  let sim = cache.get(key);
  if (!sim) {
    sim = playScenario(name, { speed, ...(maxRealS === undefined ? {} : { maxRealS }) });
    cache.set(key, sim);
  }
  return sim;
}
