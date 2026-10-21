// Walkable exits from a sandbox site, through the real console runner (#1734).
//
// The flattened sandbox square used to sit on cliffs in rugged biomes: the
// crew could not walk off it. Ring probes (drill-hole orders) 6, 18 and 30 m
// past the grid edge, all ordered together so every chunk on the ring is
// claimed, must read reachable on most of the ring and on every side.
//
// #2044: a progression sandbox also places its starting buildings and vehicles
// in one area drivable at the slowest vehicle tier's slope limit, and that
// area reaches the first-blast target (the site centre's nearest navigable cell).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { claimForAction } from '../../src/console/commands/siteExpansion.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { getAllBiomes } from '../../src/core/world/BiomeCatalog.js';
import { DEFAULT_GRID_SIZE, NAV_CLEARANCE_VEHICLE_CELLS, VEHICLE_MAX_SLOPE_DEGREES } from '../../src/core/config/balance.js';
import { computeClimbComponents, findNearestNavigableCell } from '../../src/core/nav/NavGridReachability.js';
import { slopeRatioForDegrees } from '../../src/core/nav/ClimbLimit.js';

const SITE = DEFAULT_GRID_SIZE;
const OFFSETS = [6, 18, 30] as const;
const PROBE_SPACING = 8;
const SEEDS = [1, 7, 42, 103, 106] as const;
const MIN_REACHABLE_SHARE = 0.6;

type Side = 'N' | 'E' | 'S' | 'W';
interface Probe { x: number; z: number; side: Side }

/** Probes on the square ring `offset` metres outside the grid edge, one every 8 m along each side. */
function ringProbes(offset: number): Probe[] {
  const lo = -offset, hi = SITE + offset;
  const probes: Probe[] = [];
  for (let t = lo; t < hi; t += PROBE_SPACING) {
    probes.push({ x: t, z: lo, side: 'N' }, { x: hi, z: t, side: 'E' }, { x: t + PROBE_SPACING, z: hi, side: 'S' }, { x: lo, z: t + PROBE_SPACING, side: 'W' });
  }
  return probes;
}

function measureRing(biome: string, seed: number): { total: number; reachable: number; sidesReachable: Record<Side, number> } {
  const { runner, ctx } = createRunner();
  const started = runner.run(`sandbox start biome:${biome} seed:${seed} staffed:true`);
  expect(started.success, started.output).toBe(true);
  runner.run('time pause');

  const probes = OFFSETS.flatMap(ringProbes);
  const claim = claimForAction(ctx as GameContext, probes, 'ring probes');
  expect(claim.ok, `ring claim refused: ${claim.output}`).toBe(true);

  const state = ctx.state!;
  const probeKey = (x: number, z: number): string => `${x},${z}`;
  for (const p of probes) {
    const r = runner.run(`drill_plan add x:${p.x} z:${p.z} depth:4`);
    expect(r.success, `${probeKey(p.x, p.z)}: ${r.output}`).toBe(true);
  }

  const blocked = new Set<string>();
  for (const a of state.pendingActions) {
    if (a.type === 'drill_hole' && a.blockedReason === 'target_unreachable') blocked.add(probeKey(a.targetX, a.targetZ));
  }
  const sidesReachable: Record<Side, number> = { N: 0, E: 0, S: 0, W: 0 };
  let reachable = 0;
  for (const p of probes) {
    if (blocked.has(probeKey(p.x, p.z))) continue;
    reachable++;
    sidesReachable[p.side]++;
  }
  return { total: probes.length, reachable, sidesReachable };
}

describe('sandbox site exits (#1734)', () => {
  describe.each(getAllBiomes().map(b => b.id))('%s', (biome) => {
    it.each(SEEDS)('seed %i: most of the ring is reachable and every side has a way off the site', (seed) => {
      const { total, reachable, sidesReachable } = measureRing(biome, seed);
      expect(total).toBeGreaterThan(100);
      expect(reachable / total, `${reachable}/${total} reachable`).toBeGreaterThanOrEqual(MIN_REACHABLE_SHARE);
      for (const side of ['N', 'E', 'S', 'W'] as const) {
        expect(sidesReachable[side], `side ${side} has no reachable probe`).toBeGreaterThanOrEqual(1);
      }
    }, 120000);
  });
});

/** Radius, in cells, around a building's origin searched for ground its crew can drive to. */
const BUILDING_APPROACH_RADIUS = 3;

describe('sandbox starting site is one drivable area reaching the first blast (#2044)', () => {
  describe.each(getAllBiomes().map(b => b.id))('%s', (biome) => {
    it.each(SEEDS)('seed %i: every starting vehicle and building shares a climb component with the site centre at the slowest tier limit', (seed) => {
      const { runner, ctx } = createRunner();
      const started = runner.run(`sandbox start biome:${biome} seed:${seed} kit:digger`);
      expect(started.success, started.output).toBe(true);
      const state = ctx.state!;
      expect(state.grade, 'sandbox runs as a progression site').toBeDefined();
      const navGrid = state.navGrid!;
      const target = findNearestNavigableCell(navGrid, navGrid.originX + Math.floor(navGrid.width / 2), navGrid.originZ + Math.floor(navGrid.height / 2));
      const components = computeClimbComponents(navGrid, NAV_CLEARANCE_VEHICLE_CELLS, slopeRatioForDegrees(VEHICLE_MAX_SLOPE_DEGREES));

      expect(state.vehicles.vehicles.length, 'digger kit starts with a fleet').toBeGreaterThan(0);
      for (const v of state.vehicles.vehicles) {
        const x = Math.round(v.x), z = Math.round(v.z);
        expect(components.canReach(x, z, target.x, target.z), `${v.type} at ${x},${z} cannot drive to ${target.x},${target.z}`).toBe(true);
      }
      for (const b of state.buildings.buildings) {
        let reaches = false;
        for (let dz = -BUILDING_APPROACH_RADIUS; dz <= BUILDING_APPROACH_RADIUS && !reaches; dz++) {
          for (let dx = -BUILDING_APPROACH_RADIUS; dx <= BUILDING_APPROACH_RADIUS && !reaches; dx++) {
            const x = Math.round(b.x) + dx, z = Math.round(b.z) + dz;
            reaches = navGrid.containsCell(x, z) && components.canReach(x, z, target.x, target.z);
          }
        }
        expect(reaches, `${b.type} at ${b.x},${b.z} has no ground within ${BUILDING_APPROACH_RADIUS} cells that drives to ${target.x},${target.z}`).toBe(true);
      }
    }, 120000);
  });
});
