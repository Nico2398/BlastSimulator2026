// BlastSimulator2026 — Unit tests: the probe's explosive store sizing and top-up (#2091)

import { describe, it, expect } from 'vitest';
import { explosiveRoomKg, topUpWarehouse, type Run } from '../../../scripts/shared/player-actions.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { placeBuilding, getBuildingDef } from '../../../src/core/entities/Building.js';
import { storeExplosives } from '../../../src/core/entities/BuildingWarehouse.js';

const CAPACITY_KG = getBuildingDef('explosive_warehouse', 1).capacity;

/** A site with one tier-1 explosive warehouse holding `stock` (kg by explosive id). */
function site(stock: Record<string, number> = {}): GameState {
  const state = createGame({ seed: 42 });
  placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1);
  for (const [id, kg] of Object.entries(stock)) storeExplosives(state.buildings, id, kg);
  return state;
}

/** A runner that records each command and accepts it. */
function recorder(): { run: Run; cmds: string[] } {
  const cmds: string[] = [];
  return { cmds, run: (cmd: string) => { cmds.push(cmd); return { success: true, output: '' }; } };
}

describe('explosiveRoomKg (#2091)', () => {
  it('is the whole store when it is empty', () => {
    expect(explosiveRoomKg(site(), 'krackle')).toBe(CAPACITY_KG);
  });

  it('counts stock of the same explosive as room: it charges the next pattern', () => {
    expect(explosiveRoomKg(site({ krackle: CAPACITY_KG }), 'krackle')).toBe(CAPACITY_KG);
  });

  it('leaves out stock of another explosive', () => {
    expect(explosiveRoomKg(site({ boomite: 100 }), 'krackle')).toBe(CAPACITY_KG - 100);
  });
});

describe('topUpWarehouse (#2091)', () => {
  it('buys only the shortfall over the stock already held', () => {
    const { run, cmds } = recorder();
    expect(topUpWarehouse(run, site({ krackle: 150 }), 'krackle', 200).success).toBe(true);
    expect(cmds).toEqual(['buy explosive:krackle kg:50']);
  });

  it('buys nothing when the stock already covers the charge', () => {
    const { run, cmds } = recorder();
    expect(topUpWarehouse(run, site({ krackle: 200 }), 'krackle', 200).success).toBe(true);
    expect(cmds).toEqual([]);
  });

  it('passes on a refused buy', () => {
    const run: Run = () => ({ success: false, output: 'over capacity' });
    expect(topUpWarehouse(run, site({ boomite: CAPACITY_KG }), 'krackle', 10)).toEqual({ success: false, output: 'over capacity' });
  });
});
