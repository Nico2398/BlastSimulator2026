// BlastSimulator2026 — Scenario-runner integration tests for issue #410
//
// Runs the affected building-*-visual scenario JSON files through the
// command-mode scenario runner (pure Node.js, no browser — see
// scripts/shared/command-runner.ts) and asserts on the resulting game state,
// rather than just checking the JSON files parse. These pin down the
// pass/fail combinations the visual-coherence fixes are supposed to produce:
//   - building-destruction-visual: the charge (once amount:10, out of
//     boomite's old [1,8]kg range; now each hole filled up to the stemming)
//     must not produce "Missing charge", and the blast must destroy the
//     warehouses in its footprint.
//   - building-tier-system-visual: the tier upgrades are accepted once their
//     building-tier quests are completed (#2283) and land under the same id.
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { createGameEngine, runSteps } from '../../scripts/shared/command-runner.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef, StepResult } from '../../scripts/shared/scenario-types.js';

/** `build <type> at:x,z [tier:N]` — the default-case order command, as opposed to build's list/destroy/upgrade/move/types subcommands (destroy/upgrade queue Building Destroyer work since #1392). */
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
 * observed (a T3 building order short by ~$14k under the padded
 * cash figure already in these files).
 */
const CASH_BUFFER = 200000; // also keeps the mine out of bankruptcy, which freezes it (#1313)

/** Default `new_game` starting cash when a step names no `cash:` param. */
const DEFAULT_NEW_GAME_CASH = 50000;

/** Bumps a `new_game ... cash:N` step's cash by CASH_BUFFER (a step with no `cash:` param starts from the default), keeping its own `expect.equals.cash` (if any) in sync. */
function bumpNewGameCash(step: ScenarioStepDef): ScenarioStepDef {
  const match = step.command.match(/cash:(\d+)/);
  const newCash = (match ? Number(match[1]) : DEFAULT_NEW_GAME_CASH) + CASH_BUFFER;
  const bump = (s: string) => (/cash:\d+/.test(s) ? s.replace(/cash:\d+/, `cash:${newCash}`) : `${s} cash:${newCash}`);
  return {
    ...step,
    command: bump(step.command),
    ...(step.interaction
      ? { interaction: step.interaction.map(a => (a.type === 'command' ? { ...a, command: bump(a.command) } : a)) }
      : {}),
    ...(step.expect?.equals && 'cash' in step.expect.equals
      ? { expect: { ...step.expect, equals: { ...step.expect.equals, cash: newCash } } }
      : {}),
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
      const { equals: _oldEquals, ...restExpect } = step.expect;
      out[out.length - 1] = {
        ...step,
        expect: {
          ...restExpect,
          ...(Object.keys(restEquals).length > 0 ? { equals: restEquals } : {}),
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

/**
 * These building-*-visual scenario JSON files (`scripts/scenario-defs/`,
 * shared broadly by `npm run scenarios`/`scenarios:interaction` well outside
 * this issue's own file list — so patched here in-memory rather than edited
 * on disk, same rationale as `driveConstructionOrders` above) place buildings
 * at coordinates that were never checked for flatness before #1008 wired the
 * "Uneven surface" rule into the real placement path
 * (`checkFootprintPlacement`). Each of these now sits on genuinely sloped
 * ground on the 64x64 desert_badlands/seed:42 terrain every one of these
 * files generates (`new_game seed:42 ... staffed:true` — no `size`/`mine_type`
 * override, so desert_badlands/64 is the default).
 *
 * Positional, not literal-coordinate-keyed: each entry is consumed in the
 * order its `build <type> at:x,z` command appears in the step list, and
 * overwrites whatever coordinate is already there — so this still lands the
 * verified-flat target below even if the JSON file on disk has already been
 * hand-edited to some other coordinate (verified empirically against a
 * living_quarters upgraded T1->T2->T3 in place: its bench must fit the T3
 * 5x4 footprint even though it starts at T1's 3x3, and a T3 target whose walk
 * from spawn squeezes past another building's own footprint can strand the
 * assigned employee indefinitely instead of ever reaching the site — found
 * during this run's coordinate relocation but not filed as an issue: this
 * run's one-issue budget went to #1022; noted in the PR's follow-up comment
 * instead).
 */
const FOOTPRINT_RELOCATIONS: Record<string, Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>> = {
  'building-tier-system-visual': {
    // upgraded T1 -> T2 -> T3 in place — bench sized for the T3 5x4 footprint
    living_quarters: [[2, 8]],
    management_office: [[14, 5]],
  },
};

function relocateFootprints(name: string, steps: ScenarioStepDef[]): ScenarioStepDef[] {
  const targetsByType = FOOTPRINT_RELOCATIONS[name];
  if (!targetsByType) return steps;

  const consumed: Record<string, number> = {};
  const buildAtPattern = /^build (\S+) at:\d+,\d+/;

  return steps.map(step => {
    const match = step.command.match(buildAtPattern);
    if (!match) return step;
    const type = match[1]!;
    const targets = targetsByType[type];
    const index = consumed[type] ?? 0;
    if (!targets || index >= targets.length) return step;
    consumed[type] = index + 1;

    const to = targets[index]!;
    const toAt = `at:${to[0]},${to[1]}`;

    const command = step.command.replace(/at:\d+,\d+/, toAt);
    const interaction = step.interaction?.map(action => {
      if (action.type === 'command') {
        return { ...action, command: action.command.replace(/at:\d+,\d+/, toAt) };
      }
      if (action.type === 'pickTile') {
        return { ...action, x: to[0], z: to[1] };
      }
      return action;
    });

    return { ...step, command, ...(interaction ? { interaction } : {}) };
  });
}

function runScenarioSteps(name: string) {
  const engine = createGameEngine();
  const scenario = loadScenarioDef(name, SCENARIO_DIR);
  const outDir = resolve(tmpdir(), `bs2026-scenario-410-${name}`);
  const relocated = relocateFootprints(name, scenario.steps);
  const results = runSteps(engine, driveConstructionOrders(relocated), outDir);
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

  it('the management office and freight warehouse are destroyed by the blast', () => {
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
    expect(remainingTypes).not.toContain('management_office');
    expect(remainingTypes).not.toContain('freight_warehouse');
  });
});

describe('building-tier-system-visual — scenario-runner (#410)', () => {
  it('the tier-2 upgrade is accepted after its quest completes, and lands at tier 2 under the same id (#1392)', () => {
    const { results } = runScenarioSteps('building-tier-system-visual');
    const firstUpgrade = stepForNth(results, 'build upgrade', 0);
    expect(firstUpgrade.error).toBeUndefined();
    expect(firstUpgrade.commandOutput).toMatch(/ordered/i);
    const landed = stepForNth(results, 'wait_until field:maxBuildingTier equals:2', 0);
    expect(landed.error).toBeUndefined();
  });

  it('the tier-3 upgrade is accepted after its own quest completes, and ends at tier 3 under the same id (#1392)', () => {
    const { engine, results } = runScenarioSteps('building-tier-system-visual');
    const secondUpgrade = stepForNth(results, 'build upgrade', 1);
    expect(secondUpgrade.error).toBeUndefined();
    expect(secondUpgrade.commandOutput).toMatch(/ordered/i);
    const quarters = engine.ctx.state!.buildings.buildings.filter(b => b.type === 'living_quarters');
    expect(quarters).toHaveLength(1);
    expect(quarters[0]!.tier).toBe(3);
    expect(engine.ctx.state!.buildings.buildings.some(b => (b.type as string) === 'research_center')).toBe(false);
  });
});
