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
import type { ScenarioStepDef, StepResult } from '../../scripts/shared/scenario-types.js';

/** `build <type> at:x,z [tier:N]` — the default-case order command, as opposed to build's list/destroy/upgrade/move/types subcommands (which stay synchronous even under #556). */
function isPlacementOrderCommand(command: string): boolean {
  const [top, sub] = command.trim().split(/\s+/);
  const knownSubcommands = new Set(['list', 'destroy', 'upgrade', 'move', 'types']);
  return top === 'build' && sub !== undefined && !knownSubcommands.has(sub);
}

/**
 * #556 changed `build <type> at:x,z` from placing a building instantly to
 * charging/validating and queuing a construction site that only becomes a
 * real building once an idle employee finishes the work. These pre-existing
 * scenario JSON files (`scripts/scenario-defs/`, shared broadly by
 * `npm run scenarios`/`scenarios:interaction` well outside this issue's own
 * file list — so patched here in-memory rather than edited on disk) assert a
 * completed building the instant the order command returns, and start with
 * no roster at all (an order with `requiredSkill: null` still needs at least
 * one alive/idle employee before dispatch will touch it — see
 * `EmployeeDispatch.ts`'s `eligible.length > 0` check).
 *
 * This clones the loaded steps and: (1) hires one cheap employee right after
 * `new_game` so a `place_building` action has someone to claim it — the
 * file's own `equals`/`changedBy` cash checks on every OTHER step stay valid
 * since `changedBy` is always relative to the state right before that step,
 * never the file's running total; (2) for every accepted placement-order
 * step that asserted a `buildingCount` the instant the order returned, moves
 * that assertion off the order step (which now only queues) onto a
 * synthetic `waitUntil` step spliced in right after it, driving ticks until
 * construction actually lands. A refused order (`commandOutcome: 'refused'`,
 * the guard/rejection steps) is left untouched — nothing was queued to wait
 * for.
 */
/**
 * Extra starting cash folded into a `new_game ... cash:N` step (in-memory
 * only, same as everything else here). These files sized their starting
 * cash for the old instant-build chain; construction waits now spend dozens
 * of extra ticks (walk time + `BUILDING_CONSTRUCTION_BASE_DURATION_TICKS`
 * per order) the original budget never had to cover, and every one of those
 * ticks drains employee upkeep. Sized generously against the worst case
 * observed (a T3 research_center order short by ~$14k under the padded
 * cash figure already in these files).
 */
const CASH_BUFFER = 60000;

/** Bumps a `new_game ... cash:N` step's cash by CASH_BUFFER, keeping its own `expect.equals.cash` (if any) in sync. No-op for a step with no `cash:` param. */
function bumpNewGameCash(step: ScenarioStepDef): ScenarioStepDef {
  const match = step.command.match(/cash:(\d+)/);
  if (!match) return step;
  const newCash = Number(match[1]) + CASH_BUFFER;
  const bump = (s: string) => s.replace(/cash:\d+/, `cash:${newCash}`);
  return {
    ...step,
    command: bump(step.command),
    interaction: step.interaction?.map(a => (a.type === 'command' ? { ...a, command: bump(a.command) } : a)),
    expect: step.expect?.equals && 'cash' in step.expect.equals
      ? { ...step.expect, equals: { ...step.expect.equals, cash: newCash } }
      : step.expect,
  };
}

function driveConstructionOrders(steps: ScenarioStepDef[]): ScenarioStepDef[] {
  const out: ScenarioStepDef[] = [];
  let hired = false;

  for (const step of steps) {
    if (!hired && step.command.trim().startsWith('new_game')) {
      out.push(bumpNewGameCash(step));
      out.push({
        command: 'employee hire role:driller',
        role: 'bootstrap',
        interaction: [{ type: 'command', command: 'employee hire role:driller' }],
      });
      hired = true;
      continue;
    }

    out.push(step);

    if (
      isPlacementOrderCommand(step.command)
      && step.commandOutcome === undefined
      && step.expect?.equals
      && 'buildingCount' in step.expect.equals
    ) {
      const targetCount = step.expect.equals['buildingCount'] as number;
      const { buildingCount: _dropped, ...restEquals } = step.expect.equals;
      out[out.length - 1] = {
        ...step,
        expect: {
          ...step.expect,
          ...(Object.keys(restEquals).length > 0 ? { equals: restEquals } : { equals: undefined }),
        },
      };
      out.push({
        command: `wait_until field:buildingCount equals:${targetCount}`,
        role: 'setup',
        interaction: [{
          type: 'waitUntil', field: 'buildingCount', equals: targetCount, maxTicks: 200, timeoutMs: 120000,
        }],
        expect: { equals: { buildingCount: targetCount } },
      });
    }
  }

  return out;
}

function runScenarioSteps(name: string) {
  const engine = createGameEngine();
  const scenario = loadScenarioDef(name, SCENARIO_DIR);
  const outDir = resolve(tmpdir(), `bs2026-scenario-410-${name}`);
  const results = runSteps(engine, driveConstructionOrders(scenario.steps), outDir);
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

/** Index (in `results`) of the Nth (0-indexed) result whose command starts with the given prefix. */
function stepIndexForNth(results: StepResult[], commandPrefix: string, occurrence: number): number {
  let seen = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i]!.command.startsWith(commandPrefix)) {
      if (seen === occurrence) return i;
      seen++;
    }
  }
  throw new Error(`No occurrence #${occurrence} found for command prefix "${commandPrefix}"`);
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
    // #556: "ordered" is the fixed prefix of a successful order confirmation
    // (buildOrder.ts's orderBuildingCommand) — a rejection never contains it.
    // Note the building TYPE itself is "research_center", so matching
    // /research/i alone would pass on a successful order too.
    expect(firstAttempt.commandOutput).not.toMatch(/ordered/);
  });

  it('the second tier-2 attempt succeeds once research has completed', () => {
    // #556: confirming the order only queues a construction site — it does
    // not create the building. `driveConstructionOrders` spliced a
    // `waitUntil` step in right after the order, driving ticks until an
    // idle employee actually finishes it; assert against the post-wait
    // state, not the order step's own "ordered" confirmation text.
    const { engine, results } = runScenarioSteps('building-research-visual');
    const orderIdx = stepIndexForNth(results, 'build research_center at:15,5 tier:2', 1);
    const orderStep = results[orderIdx]!;
    expect(orderStep.error).toBeUndefined();
    expect(orderStep.commandOutput).toMatch(/ordered/);
    expect(orderStep.commandOutput).toMatch(/T2/);

    const waitStep = results[orderIdx + 1]!;
    expect(waitStep.error).toBeUndefined();

    const built = engine.ctx.state!.buildings.buildings.find(b => b.type === 'research_center' && b.tier === 2);
    expect(built).toBeDefined();
    expect(built!.x).toBe(15);
    expect(built!.z).toBe(5);
  });

  it('the tier-3 build succeeds after tier-3 research completes', () => {
    const { engine, results } = runScenarioSteps('building-research-visual');
    const orderIdx = stepIndexForNth(results, 'build research_center at:25,5 tier:3', 0);
    const orderStep = results[orderIdx]!;
    expect(orderStep.error).toBeUndefined();
    expect(orderStep.commandOutput).toMatch(/ordered/);
    expect(orderStep.commandOutput).toMatch(/T3/);

    const waitStep = results[orderIdx + 1]!;
    expect(waitStep.error).toBeUndefined();

    const built = engine.ctx.state!.buildings.buildings.find(b => b.type === 'research_center' && b.tier === 3);
    expect(built).toBeDefined();
    expect(built!.x).toBe(25);
    expect(built!.z).toBe(5);
  });
});

describe('building-research-progression-visual — scenario-runner (#410)', () => {
  it('a direct tier-2 build is rejected before research, then succeeds after', () => {
    const { engine, results } = runScenarioSteps('building-research-progression-visual');

    const rejected = stepForNth(results, 'build research_center at:15,5 tier:2', 0);
    expect(rejected.commandOutput).not.toMatch(/ordered/);

    const orderIdx = stepIndexForNth(results, 'build research_center at:15,5 tier:2', 1);
    const acceptedStep = results[orderIdx]!;
    expect(acceptedStep.error).toBeUndefined();
    expect(acceptedStep.commandOutput).toMatch(/ordered/);
    expect(acceptedStep.commandOutput).toMatch(/T2/);

    const waitStep = results[orderIdx + 1]!;
    expect(waitStep.error).toBeUndefined();

    const built = engine.ctx.state!.buildings.buildings.find(b => b.type === 'research_center' && b.tier === 2);
    expect(built).toBeDefined();
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
