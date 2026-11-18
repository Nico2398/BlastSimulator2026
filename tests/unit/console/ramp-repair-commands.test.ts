// BlastSimulator2026 — Console: repair_ramp id:N re-cuts a built ramp a blast damaged.
//
// Contract: the command checks it has a game and an id, then hands the ramp to orderRampRepair and reports its
// verdict in the player's words — the cells to work and the cost on success, the core's refusal otherwise.
import { describe, it, expect } from 'vitest';
import { repairRampCommand, type MiningContext } from '../../../src/console/commands/mining.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { VoxelGrid, computeVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { buildRamp, landRampOnGrid, type RampDef } from '../../../src/core/mining/Ramp.js';
import { rampFootprint, recordBuiltRamp } from '../../../src/core/mining/RampWidening.js';
import { makeEmptyGameContext } from '../../helpers/gameContext.js';

const ROCK = { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
const TOP = 15;
const START_CASH = 1_000_000;
/** A ramp from (10, 0) south 25 tiles onto a floor 6 m below the surface, which starts at z = 25. */
const DEF: RampDef = { originX: 10, originZ: 0, direction: 'south', length: 25, targetDepth: 6, width: 3, cutSlopeRatio: Math.tan(20 * Math.PI / 180) * 0.98 };

/** A game whose only ramp, #1, is built and recorded down to a dug floor. */
function builtSite(): MiningContext {
  setLocale('en');
  const grid = new VoxelGrid(40, 50);
  for (let z = 0; z < 50; z++) {
    for (let x = 0; x < 40; x++) {
      const top = z < 25 ? TOP : TOP - 6;
      for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, ROCK);
    }
  }
  const state = createGame({ seed: 42 });
  state.cash = START_CASH;
  const landed = landRampOnGrid(grid, DEF);
  expect(buildRamp(grid, landed, Infinity).success).toBe(true);
  recordBuiltRamp(state, { id: 1, def: landed, footprint: rampFootprint(landed, 3), segments: [] });
  const ctx = makeEmptyGameContext() as MiningContext;
  ctx.state = state;
  ctx.grid = grid;
  return ctx;
}

/** A blast deepens the ramp's three foot rows by `metres`. */
function blowFoot(grid: VoxelGrid, metres: number): void {
  for (const z of [22, 23, 24]) {
    for (const x of [9, 10, 11]) {
      const top = Math.floor(computeVoxelColumnSurfaceHeight(grid, x, z));
      for (let y = top; y > top - metres; y--) grid.clearVoxel(x, y, z);
    }
  }
}

describe('repair_ramp', () => {
  it('orders a damaged ramp repaired: charges the work and queues it as a repair of that ramp', () => {
    const ctx = builtSite();
    blowFoot(ctx.grid!, 2);
    const result = repairRampCommand(ctx, [], { id: '1' });
    expect(result.success).toBe(true);
    const state = ctx.state!;
    const cost = START_CASH - state.cash;
    expect(cost).toBeGreaterThan(0);
    const planned = state.plannedRamps.find(p => p.repairOf === 1);
    expect(planned).toBeDefined();
    expect(result.output).toMatch(/^Ramp #1 ordered repaired: \d+ cells to cut or fill for \$/);
  });

  it('refuses an intact ramp with the core reason, and charges nothing', () => {
    const ctx = builtSite();
    expect(repairRampCommand(ctx, [], { id: '1' })).toEqual({ success: false, output: t('mining.repair_ramp.intact', { id: 1 }) });
    expect(ctx.state!.cash).toBe(START_CASH);
    expect(ctx.state!.plannedRamps).toHaveLength(0);
  });

  it('refuses a ramp that does not exist', () => {
    const ctx = builtSite();
    expect(repairRampCommand(ctx, [], { id: '9' })).toEqual({ success: false, output: t('mining.widen_ramp.not_found', { id: 9 }) });
  });

  it('refuses a missing or non-numeric id with the usage line', () => {
    const usage = t('mining.repair_ramp.usage');
    expect(repairRampCommand(builtSite(), [], {})).toEqual({ success: false, output: usage });
    expect(repairRampCommand(builtSite(), [], { id: 'north' })).toEqual({ success: false, output: usage });
  });

  it('refuses to run without a game', () => {
    const ctx = makeEmptyGameContext() as MiningContext;
    const result = repairRampCommand(ctx, [], { id: '1' });
    expect(result.success).toBe(false);
    expect(result.output.length).toBeGreaterThan(0);
  });
});
