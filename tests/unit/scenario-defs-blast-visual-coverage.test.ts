// BlastSimulator2026 — Regression coverage for issue #404
//
// Confirms the visual scenario for blast execution exercises three
// previously-uncovered physics areas from the blast pipeline (see
// gameplay-blast-system SKILL.md, Step 4 — Projection Velocity & Physics
// Settle):
//   1. Tier A (`'projected'`) vs Tier B (`'collapse'`) simulation tiers,
//      rendered with visually distinct colors (see src/renderer/FragmentMesh.ts).
//   2. PHYSICS_FRAGMENT_CAP overflow — a blast producing more projected
//      fragments than the cap, forcing the analytic parabolic fallback path
//      (see src/physics/FragmentSimPhysics.ts).
//
// This is a scenario-definition regression test: it locks in that the JSON
// steps exist with the right shape, so a future edit cannot silently drop
// this coverage. It does not replace the visual channel (screenshot
// inspection) or the logic channel (unit/integration tests already covering
// the underlying physics functions).

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { PHYSICS_FRAGMENT_CAP } from '../../src/core/config/balance.js';

const SCENARIO_NAME = 'blast-execution-visual';

function commandsOf(steps: ScenarioStepDef[]): string[] {
  return steps.map(s => s.command);
}

describe('blast-execution-visual — Tier A/B physics + PHYSICS_FRAGMENT_CAP overflow coverage (#404)', () => {
  it('has more than one blast execution to isolate distinct physics regimes', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const blastSteps = commandsOf(scenario.steps).filter(c => c.trim() === 'blast');
    // Original baseline blast + Tier B collapse-only + Tier A projected + cap-overflow blast.
    expect(blastSteps.length).toBeGreaterThanOrEqual(4);
  });

  it('includes a low-charge blast guaranteed to collapse in place with zero projections (Tier B)', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const commands = commandsOf(scenario.steps);
    // Verified via command-mode run: rows:2 cols:2 spacing:4 depth:6 + amount:2
    // stemming:2 boomite yields "Projections: 0" in the blast report — pure
    // Tier B collapse, no fragment crosses PROJECTION_VELOCITY_THRESHOLD.
    expect(commands).toContain('charge hole:* explosive:boomite amount:2 stemming:2');
  });

  it('includes a max-charge, zero-stemming blast guaranteed to produce projected fragments (Tier A)', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const commands = commandsOf(scenario.steps);
    // boomite's valid range is [1-8]kg (src/core/world/ExplosiveCatalog.ts) — 8kg with
    // zero stemming maximises surfaceProximityFactor and stemming efficiency together.
    const heavyOvercharges = commands.filter(c => c === 'charge hole:* explosive:boomite amount:8 stemming:0');
    // Used once for the dedicated Tier A demo, once again for the cap-overflow blast.
    expect(heavyOvercharges.length).toBeGreaterThanOrEqual(2);
  });

  it('includes a large drill grid sized to exceed PHYSICS_FRAGMENT_CAP once heavily charged', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const commands = commandsOf(scenario.steps);
    const gridStep = commands.find(c => c.startsWith('drill_plan grid') && c.includes('rows:8') && c.includes('cols:8'));
    expect(gridStep).toBeDefined();

    const rowsMatch = gridStep!.match(/rows:(\d+)/);
    const colsMatch = gridStep!.match(/cols:(\d+)/);
    expect(rowsMatch).not.toBeNull();
    expect(colsMatch).not.toBeNull();
    const holeCount = Number(rowsMatch![1]) * Number(colsMatch![1]);

    // 64 holes under heavy overcharge is designed to push the projected-fragment
    // count well past PHYSICS_FRAGMENT_CAP, exercising the parabolic fallback path.
    expect(holeCount).toBeGreaterThan(PHYSICS_FRAGMENT_CAP / 4);
  });

  it('follows every new blast with a fragments + state inspection pair, matching existing convention', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const commands = commandsOf(scenario.steps);
    for (let i = 0; i < commands.length; i++) {
      if (commands[i] === 'blast') {
        expect(commands[i + 1]).toBe('fragments');
        expect(commands[i + 2]).toBe('state full');
      }
    }
  });

  it('every command-type interaction action mirrors its step command (command/interaction consistency)', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    for (const step of scenario.steps) {
      if (!step.interaction) continue;
      for (const action of step.interaction) {
        if (action.type === 'command') {
          expect(action.command).toBe(step.command);
        }
      }
    }
  });
});
