// BlastSimulator2026 — Mix scenario registry
// The named scenarios the lab and `npm run sounds:check` render, built fresh and
// deterministically from the lab seed.

import { Random } from '../../core/math/Random.js';
import { LAB_RENDER_CONFIG } from '../../core/config/audio/lab.js';
import { buildBlastScenario } from './blastScenario.js';
import { buildBusyMineScenario } from './busyMineScenario.js';
import { isMixScenarioName, MIX_SCENARIO_NAMES, type MixScenario, type MixScenarioName } from './mixTypes.js';
import { buildUiTourScenario } from './uiTourScenario.js';

export function buildMixScenario(name: MixScenarioName): MixScenario {
  const random = new Random(LAB_RENDER_CONFIG.seed);
  switch (name) {
    case 'ui-tour': return buildUiTourScenario();
    case 'blast': return buildBlastScenario(random);
    case 'busy-mine': return buildBusyMineScenario(random);
  }
}

/** The scenario names in a comma separated list (a query parameter); unknown names are skipped, and an empty or missing list means all. */
export function parseScenarioList(text: string | null): MixScenarioName[] {
  const named = (text ?? '').split(',').map(part => part.trim()).filter(isMixScenarioName);
  return named.length > 0 ? [...new Set(named)] : [...MIX_SCENARIO_NAMES];
}
