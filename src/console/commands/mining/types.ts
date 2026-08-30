// BlastSimulator2026 — Shared types for mining console commands

import type { GameContext } from '../world.js';
import type { Random } from '../../../core/math/Random.js';
import type { createWeatherCycle } from '../../../core/weather/WeatherCycle.js';
import type { FragmentData } from '../../../core/mining/BlastExecution.js';

// ── Extended context for mining ──

export interface MiningContext extends GameContext {
  weatherCycle?: ReturnType<typeof createWeatherCycle>;
  rng?: Random;
  /** Positions of fragments from the last blast — used by renderer for localized re-mesh. */
  lastBlastFragments?: { x: number; y: number; z: number }[];
  /** Full fragment data from last blast — used by renderer to spawn fragment meshes. */
  lastBlastFragmentData?: FragmentData[];
  /** Drill holes from before the last blast — used by renderer for per-hole detonation timing. */
  lastBlastHoles?: import('../../../core/mining/DrillPlan.js').DrillHole[];
  /** Each fragment's journey from where it broke to where it settled — the renderer animates these. */
  lastBlastFlights?: import('../../../core/mining/BlastResolve.js').FragmentFlight[];
  /** True while the tutorial rail is active — gates blast refusal messaging on an occupied zone (#557). */
  tutorialActive?: boolean;
}
