// BlastSimulator2026 — Scenario-runner integration tests for issue #431
//
// Runs blast-overcharge.json and blast-undercharge.json through the
// command-mode scenario runner (pure Node.js, no browser — see
// scripts/shared/command-runner.ts) and asserts on the resulting game state,
// rather than just checking the JSON files parse.
//
// Regression this test guards against (pre-fix, issue #431): the
// scenario JSONs used to charge boomite at amount:25 for blast-overcharge
// (out of boomite's [1,8]kg valid range, src/core/world/ExplosiveCatalog.ts)
// and amount:1 for blast-undercharge. ChargePlan's createCharge rejected the
// amount:25 charge outright — chargesByHole stayed empty and the later blast
// step failed validateBlastPlan with "Missing charge" for every hole, so the
// blast never fired. amount:1 was in-range but too weak for the 2x2 hole
// grid, so the blast fired but cleared nothing (Cleared voxels: 0 /
// Fragments: 0).
//
// Current (fixed) scenario files: blast-overcharge now charges amount:8
// (boomite's max valid amount — still an overcharge relative to the hole
// grid, producing flyrock/projections) and blast-undercharge charges
// amount:2 (boomite's min viable amount — clears voxels and produces
// fragments but no projections). Both are within [1,8]kg, so the charge
// step succeeds for both scenarios. That is why every assertion below
// expects success (`not.toMatch(/out of range/i)`, `chargeStep.error
// toBeUndefined()`) rather than the pre-fix rejection.
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
  const outDir = resolve(tmpdir(), `bs2026-scenario-431-${name}`);
  const results = runSteps(engine, scenario.steps, outDir);
  return { engine, results };
}

/** Find the first result whose command starts with the given prefix. */
function stepFor(results: StepResult[], commandPrefix: string): StepResult {
  const found = results.find(r => r.command.startsWith(commandPrefix));
  if (!found) throw new Error(`No step found for command prefix "${commandPrefix}"`);
  return found;
}

interface BlastReportNumbers {
  clearedVoxels: number;
  fragments: number;
  projections: number;
}

/** Parse the `=== BLAST REPORT ===` block printed by src/console/commands/mining.ts. */
function parseBlastReport(output: string): BlastReportNumbers {
  const clearedMatch = output.match(/Cleared voxels: (\d+)/);
  const fragmentsMatch = output.match(/Fragments: (\d+)/);
  const projectionsMatch = output.match(/Projections: (\d+)/);
  if (!clearedMatch || !fragmentsMatch || !projectionsMatch) {
    throw new Error(`Could not parse BLAST REPORT numbers from output:\n${output}`);
  }
  return {
    clearedVoxels: Number(clearedMatch[1]),
    fragments: Number(fragmentsMatch[1]),
    projections: Number(projectionsMatch[1]),
  };
}

describe('blast-overcharge — scenario-runner (#431)', () => {
  it('the charge step succeeds — amount is within boomite\'s valid range', () => {
    const { results } = runScenarioSteps('blast-overcharge');
    const chargeStep = stepFor(results, 'charge hole:*');
    expect(chargeStep.commandOutput).not.toMatch(/out of range/i);
    expect(chargeStep.error).toBeUndefined();
  });

  it('the blast step succeeds and does not report "Missing charge" or an invalid plan', () => {
    const { results } = runScenarioSteps('blast-overcharge');
    const blastStep = stepFor(results, 'blast');
    expect(blastStep.error, blastStep.commandOutput).toBeUndefined();
    expect(blastStep.commandOutput).not.toMatch(/missing charge|invalid plan/i);
  });

  it('produces cleared voxels, fragments, and projections (flyrock from overcharge)', () => {
    const { results } = runScenarioSteps('blast-overcharge');
    const blastStep = stepFor(results, 'blast');
    const report = parseBlastReport(blastStep.commandOutput);
    expect(report.clearedVoxels).toBeGreaterThan(0);
    expect(report.fragments).toBeGreaterThan(0);
    expect(report.projections).toBeGreaterThan(0);
  });
});

describe('blast-undercharge — scenario-runner (#431)', () => {
  it('the charge step succeeds — amount is within boomite\'s valid range', () => {
    const { results } = runScenarioSteps('blast-undercharge');
    const chargeStep = stepFor(results, 'charge hole:*');
    expect(chargeStep.commandOutput).not.toMatch(/out of range/i);
    expect(chargeStep.error).toBeUndefined();
  });

  it('the blast step succeeds and does not report "Missing charge" or an invalid plan', () => {
    const { results } = runScenarioSteps('blast-undercharge');
    const blastStep = stepFor(results, 'blast');
    expect(blastStep.error, blastStep.commandOutput).toBeUndefined();
    expect(blastStep.commandOutput).not.toMatch(/missing charge|invalid plan/i);
  });

  it('clears voxels and produces fragments, but zero projections (charge too weak for flyrock)', () => {
    const { results } = runScenarioSteps('blast-undercharge');
    const blastStep = stepFor(results, 'blast');
    const report = parseBlastReport(blastStep.commandOutput);
    expect(report.clearedVoxels).toBeGreaterThan(0);
    expect(report.fragments).toBeGreaterThan(0);
    expect(report.projections).toBe(0);
  });
});

describe('blast-overcharge vs blast-undercharge — relative magnitude (#431)', () => {
  it('overcharge produces strictly more fragments than undercharge', () => {
    const overResults = runScenarioSteps('blast-overcharge').results;
    const underResults = runScenarioSteps('blast-undercharge').results;

    const overReport = parseBlastReport(stepFor(overResults, 'blast').commandOutput);
    const underReport = parseBlastReport(stepFor(underResults, 'blast').commandOutput);

    expect(overReport.fragments).toBeGreaterThan(underReport.fragments);
  });
});
