// BlastSimulator2026 — Regression coverage for issue #704
//
// blast-visual-full.json's step timeouts were set without accounting for
// interaction-mode --screenshots capture cost (1 base render + 4 `shots`
// angles per step, plus any per-step `frames`, each costing several seconds
// under software rasterization with no GPU). This file locks in that each
// step's timeout budget actually covers its capture cost.
//
// See scripts/scenario-defs/blast-visual-full.json and its top-level
// `shots` array (4 camera angles captured after every step).

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';

// Per-frame capture cost under software rasterization (no GPU). Not an
// exported named constant anywhere in source as of #704 — hardcoded here per
// .claude/CLAUDE.md's "Claude Code only" section / issue #475, the source of
// truth for the ~6s/frame figure.
const SOFTWARE_RASTER_FRAME_COST_MS = 6000;

describe('scenario timeout budget', () => {
  const scenario = loadScenarioDef('blast-visual-full', SCENARIO_DIR);
  const shotsCount = scenario.shots?.length ?? 0;

  it('blast-visual-full.json step 0 timeout covers base + shots capture cost under software rasterization', () => {
    const step = scenario.steps[0] as ScenarioStepDef;
    expect(typeof step).not.toBe('string');
    expect(step.command).toBe('new_game seed:42 cash:200000');

    // floor = (1 base capture + shots.length + step.frames) * per-frame cost
    const floorMs = (1 + shotsCount + (step.frames ?? 0)) * SOFTWARE_RASTER_FRAME_COST_MS;
    const declaredMs = (step.timeout ?? 60) * 1000;

    expect(declaredMs).toBeGreaterThanOrEqual(floorMs);
  });

  it('blast-visual-full.json step 36 (blast) timeout covers base + frames + shots capture cost', () => {
    const blastStep = scenario.steps.find(
      (s): s is ScenarioStepDef => typeof s !== 'string' && s.command === 'blast',
    );
    expect(blastStep, 'expected a step with command "blast" in blast-visual-full.json').toBeDefined();
    const step = blastStep as ScenarioStepDef;

    const floorMs = (1 + shotsCount + (step.frames ?? 0)) * SOFTWARE_RASTER_FRAME_COST_MS;
    const declaredMs = (step.timeout ?? 60) * 1000;

    expect(declaredMs).toBeGreaterThanOrEqual(floorMs);
  });
});
