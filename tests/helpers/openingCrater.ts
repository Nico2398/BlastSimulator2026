// BlastSimulator2026 — shared fixture: the crater of the standard opening shot on the menu-default sandbox (#2144).
//
// `sandbox start` with the defaults the main menu offers (desert_badlands, Digger kit, seed 12345), then the
// opening 3x3 shot a new player fires, through console commands only. Its rubble lands on the crater floor and the
// classifier stamps those haul/fragment orders `debris_out_of_reach`, because no ramp reaches the new floor.

import { expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { MiningContext } from '../../src/console/commands/mining/types.js';
import { SANDBOX_DEFAULTS } from '../../src/core/campaign/Sandbox.js';
import { fundForDeliveryWait } from './playthrough.js';

/** Top-left hole of the opening 3x3 shot (spacing 4, depth 6, 6 kg of krackle, stemming 2). */
export const OPENING_SHOT_START = '36,30';

export interface OpeningGame {
  run: (cmd: string) => { success: boolean; output: string };
  state: GameState;
  ctx: MiningContext;
}

/** A fresh menu-default sandbox, events off, nothing fired yet. */
export function menuDefaultSandbox(): OpeningGame {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd) as { success: boolean; output: string };
  const { biome, kit, seed } = SANDBOX_DEFAULTS;
  expect(run(`sandbox start biome:${biome} kit:${kit} seed:${seed}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  state.contracts.autoSell = false;
  state.contracts.autoClearRubble = false;
  return { run, state, ctx };
}

/** Ticks one at a time, keeping crew rested and the purse full, until `until()` holds or `max` ticks pass. */
export function tickWhile(game: Pick<OpeningGame, 'run' | 'state'>, until: () => boolean, max: number): number {
  let n = 0;
  for (; n < max && !until(); n++) {
    fundForDeliveryWait(game.state);
    for (const e of game.state.employees.employees) e.fatigue = 100;
    game.run('tick 1');
  }
  return n;
}

/** Orders still waiting on a way into the crater. */
export function outOfReachCount(state: GameState): number {
  return state.pendingActions.filter(a => a.blockedReason === 'debris_out_of_reach').length;
}

/** The menu-default sandbox after the standard opening shot, its blast report out and the classifier run. */
export function openingCraterGame(): OpeningGame {
  const game = menuDefaultSandbox();
  const { run, state } = game;
  fundForDeliveryWait(state);
  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${OPENING_SHOT_START}`)).toMatchObject({ success: true });
  tickWhile(game, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2')).toMatchObject({ success: true });
  tickWhile(game, () => Object.keys(state.plannedChargesByHole).length === 0, 1500);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(game, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();
  run('tick 3');
  expect(outOfReachCount(state)).toBeGreaterThan(0);
  return game;
}
