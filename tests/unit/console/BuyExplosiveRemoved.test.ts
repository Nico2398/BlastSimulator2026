// BlastSimulator2026 — `buy explosive:<id> kg:<n>` no longer exists: explosives are bought only at loading (#2153)

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import type { GameState } from '../../../src/core/state/GameState.js';

function start(withWarehouse: boolean) {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game mine_type:desert seed:1 size:32').success).toBe(true);
  const state = ctx.state!;
  state.cash = 100_000;
  state.finances.cash = 100_000;
  if (withWarehouse) expect(placeBuilding(state.buildings, 'explosive_warehouse', 10, 10, 32, 32).success).toBe(true);
  return { run, state };
}

const explosivesTx = (state: GameState) => state.finances.transactions.filter(t => t.category === 'explosives');

/** Anything a legacy stock write would have left on any building. */
function anyStoredExplosives(state: GameState): boolean {
  return state.buildings.buildings.some(b => Object.keys((b as unknown as { storedExplosives?: object }).storedExplosives ?? {}).length > 0);
}

describe('buy explosive:<id> kg:<n> is gone (#2153)', () => {
  it('is refused with a warehouse standing', () => {
    const { run } = start(true);
    expect(run('buy explosive:boomite kg:100').success).toBe(false);
  });

  it('is refused without a warehouse', () => {
    const { run } = start(false);
    expect(run('buy explosive:boomite kg:100').success).toBe(false);
  });

  it('spends no cash and books no explosives expense', () => {
    const { run, state } = start(true);
    run('buy explosive:boomite kg:100');
    expect(state.cash).toBe(100_000);
    expect(explosivesTx(state)).toHaveLength(0);
  });

  it('leaves nothing stored in any building', () => {
    const { run, state } = start(true);
    run('buy explosive:boomite kg:100');
    expect(anyStoredExplosives(state)).toBe(false);
  });

  it('does not buy tubing in its place', () => {
    const { run, state } = start(true);
    run('buy explosive:boomite kg:100');
    expect(state.tubingState.inventory).toBe(0);
  });

  it('is refused for an unknown explosive too', () => {
    const { run, state } = start(true);
    expect(run('buy explosive:nope kg:10').success).toBe(false);
    expect(state.cash).toBe(100_000);
  });

  it('the buy help line no longer advertises explosives', () => {
    const { runner } = createRunner();
    const help = runner.run('help').output.split('\n').find(l => l.trim().startsWith('buy '));
    expect(help, 'help line for buy').toBeDefined();
    expect(help).not.toMatch(/explosive/i);
  });
});

describe('buy amount:<n> still buys tubing (#2153)', () => {
  it('adds tubing inventory and charges the tubing price', () => {
    const { run, state } = start(true);
    const cash = state.cash;
    expect(run('buy amount:5').success).toBe(true);
    expect(state.tubingState.inventory).toBe(5);
    expect(state.cash).toBeLessThan(cash);
    expect(explosivesTx(state)).toHaveLength(0);
  });
});
