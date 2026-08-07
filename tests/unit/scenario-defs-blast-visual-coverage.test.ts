// BlastSimulator2026 — Regression coverage for issue #404
//
// Confirms the visual scenario for blast execution keeps exercising the three
// charge regimes the blast pipeline has to get right:
//   1. A low charge that collapses in place, producing no projections.
//   2. An overcharged, unstemmed blast that throws rock.
//   3. A blast large enough to stress the projectile path, where fragments are
//      grouped rather than simulated one by one
//      (docs/plans/rock-fragmentation-refactor.md §6/A5).
//
// This is a scenario-definition regression test: it locks in that the JSON
// steps exist with the right shape, so a future edit cannot silently drop
// this coverage. It does not replace the visual channel (screenshot
// inspection) or the logic channel (unit/integration tests already covering
// the underlying blast functions).

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';

const SCENARIO_NAME = 'blast-execution-visual';

function commandsOf(steps: ScenarioStepDef[]): string[] {
  return steps.map(s => s.command);
}

describe('blast-execution-visual — collapse / projection / large-blast coverage (#404)', () => {
  it('has more than one blast execution to isolate distinct physics regimes', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const blastSteps = commandsOf(scenario.steps).filter(c => c.trim() === 'blast');
    // Original baseline blast + collapse-only + projected + large-blast.
    expect(blastSteps.length).toBeGreaterThanOrEqual(4);
  });

  it('includes a low-charge blast guaranteed to collapse in place with zero projections', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const commands = commandsOf(scenario.steps);
    // Verified via command-mode run: rows:2 cols:2 spacing:4 depth:6 + amount:2
    // stemming:2 boomite yields "Projections: 0" in the blast report — every
    // fragment collapses, none crosses PROJECTION_VELOCITY_THRESHOLD.
    expect(commands).toContain('charge hole:* explosive:boomite amount:2 stemming:2');
  });

  it('includes a max-charge, min-stemming blast guaranteed to produce projected fragments', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const commands = commandsOf(scenario.steps);
    // boomite's valid range is [1-8]kg (src/core/world/ExplosiveCatalog.ts) — 8kg with
    // minimal stemming maximises surfaceProximityFactor and stemming efficiency together.
    // 0.5m, not 0, because the stemming stepper floors there (Charge.ts adjustStemming,
    // Math.max(0.5, ...)) — the command must match what interaction mode can actually click.
    const heavyOvercharges = commands.filter(c => c === 'charge hole:* explosive:boomite amount:8 stemming:0.5');
    // Used once for the dedicated projection demo, once again for the large blast.
    expect(heavyOvercharges.length).toBeGreaterThanOrEqual(2);
  });

  it('includes a large drill grid sized to stress the projectile path once heavily charged', () => {
    const scenario = loadScenarioDef(SCENARIO_NAME, SCENARIO_DIR);
    const commands = commandsOf(scenario.steps);
    const gridStep = commands.find(c => c.startsWith('drill_plan grid') && c.includes('rows:8') && c.includes('cols:8'));
    expect(gridStep).toBeDefined();

    const rowsMatch = gridStep!.match(/rows:(\d+)/);
    const colsMatch = gridStep!.match(/cols:(\d+)/);
    expect(rowsMatch).not.toBeNull();
    expect(colsMatch).not.toBeNull();
    const holeCount = Number(rowsMatch![1]) * Number(colsMatch![1]);

    // 64 holes under heavy overcharge produces far more projected fragments than
    // the game is willing to fly independently, exercising the grouping path.
    expect(holeCount).toBeGreaterThanOrEqual(64);
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
