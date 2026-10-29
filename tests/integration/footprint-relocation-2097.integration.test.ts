// A building ordered over a mounted driller must not strand the crew (#2097).
//
// Ordering a building patches its footprint into the nav grid as blocked and
// moves anyone standing on it to the nearest free cell. That sweep used to
// search from the world corner (0, 0): on a site whose corner sits in a pocket
// cut off from the working area, the driller was teleported across the map to
// the corner, and the hole they were driving to stayed 'target_unreachable'
// for the rest of the run.
//
// Drives the real console runner: sandbox site, one hole, a freight warehouse
// ordered over the rig as it arrives, then time passes.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { getBuildingDef, getDefSize } from '../../src/core/entities/Building.js';
import { makeFootprintRegion } from '../../src/core/engine/BuildingTaskHelpers.js';
import { tickResolvingEvents, tickUntil } from './helpers.js';

const HOLE = { x: 30, z: 36 } as const;
const ARRIVAL_RADIUS = 4;
const MAX_ARRIVAL_TICKS = 200;
const MAX_DRILL_TICKS = 600;
const MAX_TILES_FROM_FOOTPRINT = 3;

describe('building ordered over a mounted driller (#2097)', () => {
  // Seed 5 puts the rig on ground whose freed footprint cells carry the blocked patch's zero clearance (#2119).
  it.each([1, 5])('relocates the driller beside the footprint, not to the world corner, and the hole still gets drilled (seed %i)', seed => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run(`sandbox start biome:desert_badlands kit:digger seed:${seed}`).success).toBe(true);
    expect(run(`drill_plan add x:${HOLE.x} z:${HOLE.z} depth:4`).success).toBe(true);
    const state = ctx.state!;
    const driller = state.employees.employees.find(e => e.role === 'driller')!;

    // Let the rig drive out until it is close to the hole.
    for (let i = 0; i < MAX_ARRIVAL_TICKS && Math.hypot(driller.x - HOLE.x, driller.z - HOLE.z) > ARRIVAL_RADIUS; i++) {
      tickResolvingEvents(run);
    }
    expect(driller.locomotion?.kind).toBe('mounted');
    expect(Math.hypot(driller.x - HOLE.x, driller.z - HOLE.z)).toBeLessThanOrEqual(ARRIVAL_RADIUS);

    // Order the warehouse so the driller stands inside its footprint.
    const ox = Math.round(driller.x) - 1;
    const oz = Math.round(driller.z) - 1;
    const { sizeX, sizeZ } = getDefSize(getBuildingDef('freight_warehouse', 1));
    const footprint = makeFootprintRegion(ox, oz, sizeX, sizeZ);
    const dx = Math.round(driller.x);
    const dz = Math.round(driller.z);
    expect(dx >= footprint.minX && dx <= footprint.maxX && dz >= footprint.minZ && dz <= footprint.maxZ).toBe(true);
    expect(run(`build freight_warehouse at:${ox},${oz}`).success).toBe(true);

    // Right after the order: off the footprint, near it, nowhere near the corner.
    const gapX = Math.max(footprint.minX - driller.x, 0, driller.x - footprint.maxX);
    const gapZ = Math.max(footprint.minZ - driller.z, 0, driller.z - footprint.maxZ);
    expect(Math.max(gapX, gapZ)).toBeLessThanOrEqual(MAX_TILES_FROM_FOOTPRINT);
    expect(Math.hypot(driller.x, driller.z)).toBeGreaterThan(MAX_TILES_FROM_FOOTPRINT);

    // The crew can still reach the hole and drill it.
    tickUntil(run, () => state.drillHoles.length > 0, MAX_DRILL_TICKS);
    expect(state.drillHoles.some(h => Math.round(h.x) === HOLE.x && Math.round(h.z) === HOLE.z)).toBe(true);
  });
});
