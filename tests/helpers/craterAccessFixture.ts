// BlastSimulator2026 — shared fixture: a stranded crater on a progression site (#2082).
//
// Reproduces the pit-deepening stall without firing blasts: a `sandbox start` site (a progression
// site, `state.grade` set) is levelled flat, then a square pit is cut straight down. No ramp exists,
// so the floor is far past the climb limit. Rubble dropped on the floor makes the dispatcher queue
// haul_debris / fragment_debris orders, which classification stamps `debris_out_of_reach`.

import { expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { MiningContext } from '../../src/console/commands/mining/types.js';
import { addBlastFragments } from '../../src/core/economy/Logistics.js';
import { computeVoxelColumnSurfaceY } from '../../src/core/world/VoxelGrid.js';
import { GENERATED_TERRAIN_GRID_SIZE_Y } from './gameContext.js';
import { makeRubbleFragment, tickUntilFresh } from './blastFixtures.js';

const FLAT_ROCK = { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 };

export interface Pit { x0: number; z0: number; size: number; drop: number }

export interface CraterSite {
  run: (cmd: string) => unknown;
  state: GameState;
  ctx: MiningContext;
  /** Surface height the site was levelled to. */
  top: number;
  pits: Pit[];
}

/** Levels the whole site to the surface found at (30, 30), so no natural slope links anything to anything. */
function flatten(ctx: MiningContext): number {
  const grid = ctx.grid!;
  const { minX, minZ, sizeX, sizeZ } = ctx.state!.world!;
  const top = computeVoxelColumnSurfaceY(grid, 30, 30)!;
  for (let z = minZ; z < minZ + sizeZ; z++) {
    for (let x = minX; x < minX + sizeX; x++) {
      for (let y = 0; y < GENERATED_TERRAIN_GRID_SIZE_Y; y++) {
        if (y <= top) grid.setVoxel(x, y, z, FLAT_ROCK);
        else grid.clearVoxel(x, y, z);
      }
    }
  }
  return top;
}

/** Cuts a straight-walled pit; the NavGrid learns of it through terrain:updated, as after a real blast. */
export function cutPit(site: Pick<CraterSite, 'ctx' | 'top' | 'pits'>, pit: Pit): void {
  const grid = site.ctx.grid!;
  const floor = site.top - pit.drop;
  for (let z = pit.z0; z < pit.z0 + pit.size; z++) {
    for (let x = pit.x0; x < pit.x0 + pit.size; x++) {
      for (let y = floor + 1; y <= site.top; y++) grid.clearVoxel(x, y, z);
    }
  }
  site.ctx.emitter.emit('terrain:updated', {
    region: { minX: pit.x0, maxX: pit.x0 + pit.size - 1, minZ: pit.z0, maxZ: pit.z0 + pit.size - 1, minY: 0, maxY: GENERATED_TERRAIN_GRID_SIZE_Y - 1 },
  });
  site.pits.push(pit);
}

/** Drops `count` on-ground rubble fragments onto a pit's floor. Ids start at `firstId`. */
export function dropRubble(site: CraterSite, pit: Pit, count: number, firstId = 9000): void {
  const y = site.top - pit.drop + 1;
  const frags = [];
  for (let i = 0; i < count; i++) {
    const f = makeRubbleFragment(firstId + i, 1000, { x: pit.x0 + 2, y, z: pit.z0 + 2 });
    f.position = { x: pit.x0 + 2 + (i % 4), y, z: pit.z0 + 2 + Math.floor(i / 4) };
    frags.push(f);
  }
  addBlastFragments(site.state.logistics, frags, site.state.navGrid);
}

/** A flat, staffed progression site (`sandbox start staffed:true`) with the given pits already cut. */
export function makeCraterSite(pits: Pit[], opts: { cash?: number } = {}): CraterSite {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:true')).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  state.cash = opts.cash ?? 5_000_000;
  const site: CraterSite = { run, state, ctx, top: flatten(ctx), pits: [] };
  for (const pit of pits) cutPit(site, pit);
  tickUntilFresh(run, state, () => false, 1);
  return site;
}
