// BlastSimulator2026 — Scenario-runner integration tests for issue #410
//
// Runs the affected building-*-visual scenario JSON files through the
// command-mode scenario runner (pure Node.js, no browser — see
// scripts/shared/command-runner.ts) and asserts on the resulting game state,
// rather than just checking the JSON files parse. These pin down the
// pass/fail combinations the visual-coherence fixes are supposed to produce:
//   - building-destruction-visual: the charge amount bug (amount:10, out of
//     boomite's [1,8]kg range) must no longer produce "Missing charge", and
//     the blast must destroy the warehouses in its footprint.
//   - building-tier-system-visual / building-research-visual /
//     building-research-progression-visual: once tier-gating is wired, a
//     direct Tier 2/3 build must be rejected before research completes, and
//     must succeed afterward.
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { createGameEngine, runSteps } from '../../scripts/shared/command-runner.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import type { StepResult } from '../../scripts/shared/scenario-types.js';

function runScenarioSteps(name: string) {
  const engine = createGameEngine();
  const scenario = loadScenarioDef(name, SCENARIO_DIR);
  const outDir = resolve(tmpdir(), `bs2026-scenario-410-${name}`);
  const results = runSteps(engine, scenario.steps, outDir);
  return { engine, results };
}

/** Find the first result whose command starts with the given prefix. */
function stepFor(results: StepResult[], commandPrefix: string): StepResult {
  const found = results.find(r => r.command.startsWith(commandPrefix));
  if (!found) throw new Error(`No step found for command prefix "${commandPrefix}"`);
  return found;
}

/** Find the Nth (0-indexed) result whose command starts with the given prefix. */
function stepForNth(results: StepResult[], commandPrefix: string, occurrence: number): StepResult {
  const matches = results.filter(r => r.command.startsWith(commandPrefix));
  const found = matches[occurrence];
  if (!found) throw new Error(`No occurrence #${occurrence} found for command prefix "${commandPrefix}"`);
  return found;
}

describe('building-destruction-visual — scenario-runner (#410)', () => {
  it('the blast step succeeds and does not report "Missing charge"', () => {
    const { results } = runScenarioSteps('building-destruction-visual');
    const chargeStep = stepFor(results, 'charge hole:*');
    expect(chargeStep.commandOutput).not.toMatch(/missing charge/i);
    expect(chargeStep.error).toBeUndefined();

    const blastStep = stepFor(results, 'blast');
    expect(blastStep.error, blastStep.commandOutput).toBeUndefined();
    expect(blastStep.commandOutput).not.toMatch(/missing charge/i);
  });

  it('the explosive and freight warehouses are destroyed by the blast', () => {
    // The drill grid (start:15,15 rows:3 cols:3 spacing:5) places holes at
    // (20,20) and (25,25) — exactly the warehouse origins — so the blast is
    // expected to clear their footprint voxels and remove them from
    // state.buildings (BlastBuildings.test.ts: "buildings are removed from
    // state when their footprint voxels are cleared"). If this still fails
    // after the charge-amount fix, the gap is deeper than the charge bug —
    // see the "Reserved for future blast/damage modeling" note on
    // BuildingDef.structuralResistance in src/core/entities/Building.ts.
    const { engine, results } = runScenarioSteps('building-destruction-visual');
    const blastStep = stepFor(results, 'blast');
    expect(blastStep.error).toBeUndefined();

    const remaining = engine.ctx.state!.buildings.buildings;
    const remainingTypes = remaining.map(b => b.type);
    expect(remainingTypes).not.toContain('explosive_warehouse');
    expect(remainingTypes).not.toContain('freight_warehouse');
  });
});

describe('building-tier-system-visual — scenario-runner (#410)', () => {
  it('the tier-2 upgrade succeeds after research completes', () => {
    const { results } = runScenarioSteps('building-tier-system-visual');
    const firstUpgrade = stepForNth(results, 'build upgrade', 0);
    expect(firstUpgrade.error).toBeUndefined();
    expect(firstUpgrade.commandOutput).toMatch(/T2/);
  });

  it('the tier-3 upgrade succeeds after its own research completes', () => {
    const { results } = runScenarioSteps('building-tier-system-visual');
    const secondUpgrade = stepForNth(results, 'build upgrade', 1);
    expect(secondUpgrade.error).toBeUndefined();
    expect(secondUpgrade.commandOutput).toMatch(/T3/);
  });
});

describe('building-research-visual — scenario-runner (#410)', () => {
  it('the first direct tier-2 attempt is rejected — demonstrates the gate', () => {
    const { results } = runScenarioSteps('building-research-visual');
    const firstAttempt = stepForNth(results, 'build research_center at:15,5 tier:2', 0);
    // "Built" is the fixed prefix of a successful placement (entities.ts buildCommand);
    // note the building TYPE itself is "research_center", so matching /research/i alone
    // would pass on a successful placement too — the "Built" prefix is what actually
    // discriminates accept from reject.
    expect(firstAttempt.commandOutput).not.toMatch(/^Built /);
  });

  it('the second tier-2 attempt succeeds once research has completed', () => {
    const { results } = runScenarioSteps('building-research-visual');
    const secondAttempt = stepForNth(results, 'build research_center at:15,5 tier:2', 1);
    expect(secondAttempt.error).toBeUndefined();
    expect(secondAttempt.commandOutput).toMatch(/^Built /);
    expect(secondAttempt.commandOutput).toMatch(/T2/);
  });

  it('the tier-3 build succeeds after tier-3 research completes', () => {
    const { results } = runScenarioSteps('building-research-visual');
    const tier3Build = stepFor(results, 'build research_center at:25,5 tier:3');
    expect(tier3Build.error).toBeUndefined();
    expect(tier3Build.commandOutput).toMatch(/^Built /);
    expect(tier3Build.commandOutput).toMatch(/T3/);
  });
});

describe('building-research-progression-visual — scenario-runner (#410)', () => {
  it('a direct tier-2 build is rejected before research, then succeeds after', () => {
    const { results } = runScenarioSteps('building-research-progression-visual');

    const rejected = stepForNth(results, 'build research_center at:15,5 tier:2', 0);
    expect(rejected.commandOutput).not.toMatch(/^Built /);

    const accepted = stepForNth(results, 'build research_center at:15,5 tier:2', 1);
    expect(accepted.error).toBeUndefined();
    expect(accepted.commandOutput).toMatch(/^Built /);
    expect(accepted.commandOutput).toMatch(/T2/);
  });

  it('research status reports progress and then clears once complete', () => {
    const { results } = runScenarioSteps('building-research-progression-visual');
    const statusSteps = results.filter(r => r.command.startsWith('research status'));
    expect(statusSteps.length).toBeGreaterThanOrEqual(3);

    // First status check happens right after queuing — task still pending.
    expect(statusSteps[0]!.commandOutput).toContain('research_center');

    // Last status check happens after the tick-pad — queue should be empty.
    const lastStatus = statusSteps[statusSteps.length - 1]!;
    expect(lastStatus.commandOutput.toLowerCase()).toMatch(/no.*research|empty|none/);
  });
});
