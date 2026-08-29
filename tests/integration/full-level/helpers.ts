// BlastSimulator2026 — Shared helper functions for full-level integration tests

import { expect } from 'vitest';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { campaignStartCommand, campaignCompleteCommand } from '../../../src/console/commands/campaign.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';
import { drillPlanCommand, chargeCommand, sequenceCommand, blastCommand } from '../../../src/console/commands/mining.js';
import { employeeCommand } from '../../../src/console/commands/employees.js';
import { stateCommand } from '../../../src/console/commands/state.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { recordProfit } from '../../../src/core/campaign/Campaign.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';

/**
 * Create a fresh GameContext with a new game of the default mine preset.
 * Used as the base for all full-level test helpers.
 */
function createBaseContext(): GameContext {
  const ctx: GameContext = { state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/** Complete tutorial_pit (threshold 5000) to unlock dusty_hollow. */
function _unlockDustyHollow(campaign: any): void {
  recordProfit(campaign, 'tutorial_pit', 5000);
}

/** Complete dusty_hollow to unlock grumpstone_ridge. */
function _unlockGrumpstoneRidge(campaign: any): void {
  _unlockDustyHollow(campaign);
  recordProfit(campaign, 'dusty_hollow', 80000);
}

/** Complete grumpstone_ridge to unlock treranium_depths. */
function _unlockTreraniumDepths(campaign: any): void {
  _unlockGrumpstoneRidge(campaign);
  recordProfit(campaign, 'grumpstone_ridge', 250000);
}

/**
 * Create a GameContext with a fresh campaign started for the given level.
 * Automatically completes any prior levels needed to unlock the target.
 * Calls campaignStartCommand to initialise the level.
 * @param levelId The campaign level identifier (e.g. 'dusty_hollow').
 * @returns A fully initialised GameContext ready for test commands.
 */
export function makeCampaignCtx(levelId: string): GameContext {
  const ctx = createBaseContext();
  if (levelId === 'dusty_hollow') {
    _unlockDustyHollow(ctx.state!.campaign);
  } else if (levelId === 'grumpstone_ridge') {
    _unlockGrumpstoneRidge(ctx.state!.campaign);
  } else if (levelId === 'treranium_depths') {
    _unlockTreraniumDepths(ctx.state!.campaign);
  }
  // tutorial_pit is unlocked by default — no unlock needed
  campaignStartCommand(ctx, [], { level: levelId });
  return ctx;
}

/**
 * Create a GameContext with the given level started.
 * Alias for makeCampaignCtx — retained for API compatibility.
 * makeCampaignCtx now handles all prerequisite unlocking automatically.
 * @param levelId The campaign level identifier to start.
 * @returns A fully initialised GameContext with preceding levels completed.
 */
export function makeCampaignCtxWithUnlock(levelId: string): GameContext {
  return makeCampaignCtx(levelId);
}

/**
 * Shared loop body for tickWithEvents/driveDrillPlanToCompletion/
 * driveChargePlanToCompletion/driveConstructionToCompletion: ticks up to
 * `maxIterations` times (or until `continueCondition` returns false),
 * resolving pending events and clearing the pause flag each tick. When
 * `topUpNeeds` is set, tops up every employee's hunger/fatigue/breakNeed
 * before each tick — see driveDrillPlanToCompletion's doc comment for why.
 */
function runTickLoop(
  ctx: GameContext,
  maxIterations: number,
  opts: { topUpNeeds?: boolean; continueCondition?: () => boolean } = {}
): void {
  const { topUpNeeds = false, continueCondition } = opts;
  for (let i = 0; i < maxIterations && (continueCondition ? continueCondition() : true); i++) {
    if (topUpNeeds) {
      for (const emp of ctx.state!.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
    }
    tickCommand(ctx, ['1'], {});
    if (ctx.state!.events.pendingEvent) {
      eventCommand(ctx, ['choose', '0'], {});
    }
    if (ctx.state!.isPaused) {
      ctx.state!.isPaused = false;
    }
  }
}

/**
 * Advance the simulation by `n` ticks, running `tickCommand` each tick
 * and resolving any events that fire during the tick window.
 * @param ctx The game context.
 * @param n Number of ticks to advance.
 */
export function tickWithEvents(ctx: GameContext, n: number): void {
  runTickLoop(ctx, n);
}

/**
 * Ticks until every hole ordered by the most recent drill_plan grid/add has
 * landed in state.drillHoles (#553) — a 'blasting'-qualified employee and a
 * drill_rig vehicle must already exist for any hole to ever land. Resolves
 * pending events the same way tickWithEvents does, and tops up employee need
 * gauges each tick: a solo drill_rig/driller multi-hole drive can otherwise
 * run long enough for hunger/fatigue/breakNeed to cross a collapse threshold
 * mid-drive, an unrelated needs mechanic these tests aren't exercising.
 */
export function driveDrillPlanToCompletion(ctx: GameContext, maxTicks = 400): void {
  runTickLoop(ctx, maxTicks, {
    topUpNeeds: true,
    continueCondition: () => ctx.state!.plannedDrillHoles.length > 0,
  });
}

/**
 * Ticks until every charge ordered by the most recent `charge hole:*`/`charge
 * hole:<id>` has landed in state.chargesByHole (#554) — a 'blasting'-
 * qualified employee must already exist for any charge to ever land.
 * Resolves pending events and tops up employee need gauges each tick, same
 * reasoning as driveDrillPlanToCompletion above.
 */
export function driveChargePlanToCompletion(ctx: GameContext, maxTicks = 400): void {
  runTickLoop(ctx, maxTicks, {
    topUpNeeds: true,
    continueCondition: () => Object.keys(ctx.state!.plannedChargesByHole).length > 0,
  });
}

/**
 * Ticks until every construction site ordered so far has landed in
 * state.buildings.buildings (#556) — an idle employee must exist to claim
 * and finish a `place_building` order (`requiredSkill: null`, but still
 * gated on `eligible.length > 0`, EmployeeDispatch.ts). Resolves pending
 * events and tops up employee need gauges each tick, same reasoning as
 * driveDrillPlanToCompletion/driveChargePlanToCompletion above.
 */
export function driveConstructionToCompletion(ctx: GameContext, maxTicks = 300): void {
  runTickLoop(ctx, maxTicks, {
    topUpNeeds: true,
    continueCondition: () => ctx.state!.plannedBuildings.length > 0,
  });
}

/**
 * Perform a standard blast cycle: drill grid, charge all, auto-sequence, blast.
 * Uses a 2×2 grid with 4m spacing, 8m depth, boomite explosive.
 * @param ctx The game context (cast to MiningContext internally for command compatibility).
 * @param originX X-coordinate of the drill grid origin.
 * @param originZ Z-coordinate of the drill grid origin.
 * @returns The blast command output text.
 */
export function performBlast(ctx: GameContext, originX: number, originZ: number): string {
  drillPlanCommand(ctx as any, ['grid'], {
    origin: `${originX},${originZ}`,
    rows: '2',
    cols: '2',
    spacing: '4',
    depth: '8',
  });
  chargeCommand(ctx as any, [], {
    hole: '*',
    explosive: 'boomite',
    amount: '5kg',
    stemming: '2m',
  });
  sequenceCommand(ctx as any, ['auto'], {});
  const result = blastCommand(ctx as any, [], {});
  return result.output;
}

/**
 * Drive a fresh level context to completion and force-complete it: hires a
 * driller (role 'driller'), assigns blasting skill at `skillLevel` to
 * employee id '1', performs a standard blast via performBlast(ctx, 10, 10),
 * advances `ticks` ticks via tickWithEvents, then force-completes the level
 * via campaignCompleteCommand(ctx, [], {}). Shared "drive to level completion
 * and assert" sequence extracted from level1-win.integration.test.ts and
 * tutorial.integration.test.ts (#827) — every test-specific assertion stays
 * in the calling test.
 * @param ctx The game context.
 * @param skillLevel The blasting skill level to assign to the hired driller.
 * @param ticks Number of ticks to advance via tickWithEvents after blasting.
 * @returns The blast command output text and the campaign-complete command result.
 */
export function driveToLevelCompletion(
  ctx: GameContext,
  skillLevel: number,
  ticks: number
): { blastOutput: string; completeResult: CommandResult } {
  employeeCommand(ctx, ['hire'], { role: 'driller' });
  employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: String(skillLevel) });
  const blastOutput = performBlast(ctx, 10, 10);
  tickWithEvents(ctx, ticks);
  const completeResult = campaignCompleteCommand(ctx, [], {});
  return { blastOutput, completeResult };
}

/**
 * Drive a fresh level context to completion and assert the standard "level
 * ended, force-completed" outcome. See `driveToLevelCompletion` for the setup
 * sequence this drives. Shared assertion block extracted from
 * level1-win.integration.test.ts and tutorial.integration.test.ts (#827) — a
 * caller that also needs the blast output (tutorial's test asserts it
 * contains 'BLAST REPORT') can read it off the returned object.
 * @returns The blast command output text and the campaign-complete command
 * result, plus the state.levelEnded/levelEndReason and `state summary`
 * assertions this function makes along the way.
 */
export function assertLevelCompletion(
  ctx: GameContext,
  skillLevel: number,
  ticks: number
): { blastOutput: string; completeResult: CommandResult } {
  const { blastOutput, completeResult } = driveToLevelCompletion(ctx, skillLevel, ticks);
  expect(completeResult.success).toBe(true);
  expect(completeResult.output).toContain('force-completed');

  expect(ctx.state!.levelEnded).toBe(true);
  expect(ctx.state!.levelEndReason).toBe('completed');

  const summary = getStateSummary(ctx);
  expect(summary.levelEnded).toBe(true);
  expect(summary.levelEndReason).toBe('completed');

  return { blastOutput, completeResult };
}

/**
 * Assert that the `state summary` console command reflects level completion.
 * Does not drive the level to completion itself — callers must call
 * driveToLevelCompletion (or assertLevelCompletion, if they also need those
 * assertions) first. Shared assertion block extracted from
 * level1-win.integration.test.ts and tutorial.integration.test.ts (#827).
 * @param ctx The game context.
 */
export function assertStateSummaryCompletion(ctx: GameContext): void {
  const statsResult = stateCommand(ctx as any, ['summary'], {});
  expect(statsResult.success).toBe(true);
  const parsed = JSON.parse(statsResult.output) as Record<string, unknown>;
  expect(parsed.levelEnded).toBe(true);
  expect(parsed.levelEndReason).toBe('completed');
}

/**
 * Return a summary object of the current game state (profit, balance,
 * scores, employee count, etc.) for use in test assertions.
 * @param ctx The game context.
 * @returns A plain object with key state properties for assertion.
 */
export function getStateSummary(ctx: GameContext): Record<string, unknown> {
  return {
    tickCount: ctx.state!.tickCount,
    cash: ctx.state!.cash,
    scores: ctx.state!.scores,
    buildings: ctx.state!.buildings.buildings.length,
    employees: ctx.state!.employees.employees.length,
    levelEnded: ctx.state!.levelEnded,
    levelEndReason: ctx.state!.levelEndReason,
    campaignLevel: ctx.state!.campaign.activeLevelId,
  };
}
