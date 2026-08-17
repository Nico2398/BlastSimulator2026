// Sandbox mode — through the real console runner and game loop
//
// #504: `sandbox start` collapsed to biome/difficulty/seed. Grid extents are
// fixed (64x32x64) and starting cash comes from the named difficulty.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { parseSandboxArgs } from '../../src/console/commands/sandbox.js';
import { SANDBOX_DEFAULTS, SANDBOX_DIFFICULTIES } from '../../src/core/campaign/Sandbox.js';
import { DEFAULT_GRID_SIZE, SANDBOX_GRID_DEPTH, STARTING_SITE_STAFFED_COMPOSITION } from '../../src/core/config/balance.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import type { Employee } from '../../src/core/entities/Employee.js';
import type { Vehicle } from '../../src/core/entities/Vehicle.js';

/** Solid-voxel count — a cheap fingerprint of a generated map. */
function solidCount(grid: VoxelGrid): number {
  let n = 0;
  grid.forEachSolid(() => { n++; });
  return n;
}

describe('sandbox mode', () => {
  let runner: ConsoleRunner;
  let ctx: GameContext;

  beforeEach(() => {
    const made = createRunner();
    runner = made.runner;
    ctx = made.ctx;
  });

  it('starts a site from nothing — no new_game needed first', () => {
    const result = runner.run('sandbox start biome:alpine_granite difficulty:hard seed:777');
    expect(result.success).toBe(true);
    expect(ctx.state).toBeTruthy();
    expect(ctx.grid).toBeTruthy();
    expect(ctx.state!.world).toMatchObject({
      sizeX: DEFAULT_GRID_SIZE, sizeY: SANDBOX_GRID_DEPTH, sizeZ: DEFAULT_GRID_SIZE,
    });
  });

  it.each(['easy', 'normal', 'hard'] as const)(
    'difficulty:%s produces the documented starting cash',
    (difficulty) => {
      runner.run(`sandbox start biome:desert_badlands difficulty:${difficulty} seed:1`);
      expect(ctx.state!.cash).toBe(SANDBOX_DIFFICULTIES[difficulty].startingCash);
    },
  );

  it('rejects an unknown difficulty, naming the valid ids', () => {
    const result = runner.run('sandbox start difficulty:legendary');
    expect(result.success).toBe(false);
    expect(result.output).toContain('easy');
    expect(result.output).toContain('normal');
    expect(result.output).toContain('hard');
  });

  it('rejects difficulty:constructor rather than resolving it to Object.prototype.constructor (#504 prototype pollution)', () => {
    const result = runner.run('sandbox start biome:desert_badlands difficulty:constructor seed:1');
    expect(result.success).toBe(false);
    expect(result.output).toContain('easy');
    expect(result.output).toContain('normal');
    expect(result.output).toContain('hard');
  });

  it('rejects an unknown biome instead of silently substituting one', () => {
    const result = runner.run('sandbox start biome:atlantis');
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown biome');
  });

  it('seed:random produces a playable site', () => {
    const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:random');
    expect(result.success).toBe(true);
    expect(ctx.grid).toBeTruthy();
    expect(solidCount(ctx.grid!)).toBeGreaterThan(0);
  });

  it('rebuilds an identical map from the same seed and biome', () => {
    const args = 'sandbox start biome:green_foothills difficulty:normal seed:2024';
    runner.run(args);
    const first = solidCount(ctx.grid!);

    const second = createRunner();
    second.runner.run(args);
    expect(solidCount(second.ctx.grid!)).toBe(first);
    expect(second.ctx.grid!.sizeX).toBe(ctx.grid!.sizeX);
  });

  it('produces a different map for a different seed', () => {
    runner.run('sandbox start biome:green_foothills difficulty:normal seed:1');
    const a = solidCount(ctx.grid!);

    const other = createRunner();
    other.runner.run('sandbox start biome:green_foothills difficulty:normal seed:99999');
    expect(solidCount(other.ctx.grid!)).not.toBe(a);
  });

  it('starts a playable alpine_granite hard-difficulty site', () => {
    const result = runner.run('sandbox start biome:alpine_granite difficulty:hard seed:777');
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(SANDBOX_DIFFICULTIES.hard.startingCash);
    expect(ctx.state!.world).toMatchObject({
      sizeX: DEFAULT_GRID_SIZE, sizeY: SANDBOX_GRID_DEPTH, sizeZ: DEFAULT_GRID_SIZE,
    });
  });

  it('grid extent stays fixed at 64x32x64 regardless of a removed arg like size:', () => {
    const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:5 size:48');
    expect(result.success).toBe(true);
    expect(ctx.state!.world).toMatchObject({
      sizeX: DEFAULT_GRID_SIZE, sizeY: SANDBOX_GRID_DEPTH, sizeZ: DEFAULT_GRID_SIZE,
    });
  });

  it('is playable: a blast on a sandbox site removes rock', () => {
    // Staffed (#553): drill_plan grid now queues one drill_hole PendingAction
    // per hole instead of writing them straight into state.drillHoles — a
    // 'blasting'-qualified employee and a drill_rig vehicle are needed for
    // any hole to actually land, same composition drill-plan-queueing.test.ts
    // uses for `new_game ... staffed:true`.
    runner.run('sandbox start biome:desert_badlands difficulty:easy seed:42 staffed:true');
    const before = solidCount(ctx.grid!);

    runner.run('drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:20,20');
    for (let i = 0; i < 400 && ctx.state!.plannedDrillHoles.length > 0; i++) {
      // Tops up needs each tick — a solo multi-hole drive can otherwise run
      // long enough to trip an unrelated needs collapse mid-task (out of
      // scope for this test).
      for (const emp of ctx.state!.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      runner.run('tick 1');
    }
    runner.run('charge hole:* explosive:boomite amount:5 stemming:2');
    // #554: charging is real work too — drain the ordered charges the same
    // way the drill plan above was drained before blasting.
    for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      runner.run('tick 1');
    }
    runner.run('sequence auto');
    const blast = runner.run('blast');

    expect(blast.success).toBe(true);
    expect(solidCount(ctx.grid!)).toBeLessThan(before);
  });

  it('generates contracts so the economy is live from the first tick', () => {
    runner.run('sandbox start biome:desert_badlands difficulty:normal seed:5');
    expect(ctx.state!.contracts.available.length).toBeGreaterThan(0);
  });

  describe('staffed option', () => {
    /** Greedily matches each composition employee slot to a distinct hired employee. */
    function assertEmployeesMatchComposition(employees: Employee[]): void {
      expect(employees.length).toBe(STARTING_SITE_STAFFED_COMPOSITION.employees.length);
      const remaining = [...employees];
      for (const slot of STARTING_SITE_STAFFED_COMPOSITION.employees) {
        const idx = remaining.findIndex(e =>
          e.role === slot.role &&
          slot.qualifications.every(q =>
            e.qualifications.some(eq => eq.category === q.category && eq.proficiencyLevel === q.proficiencyLevel),
          ),
        );
        expect(idx, `no unmatched employee for slot ${JSON.stringify(slot)}`).toBeGreaterThanOrEqual(0);
        remaining.splice(idx, 1);
      }
    }

    /** Greedily matches each composition vehicle slot to a distinct purchased, idle, unmanned vehicle. */
    function assertVehiclesMatchComposition(vehicles: Vehicle[]): void {
      expect(vehicles.length).toBe(STARTING_SITE_STAFFED_COMPOSITION.vehicles.length);
      const remaining = [...vehicles];
      for (const slot of STARTING_SITE_STAFFED_COMPOSITION.vehicles) {
        const idx = remaining.findIndex(v =>
          v.type === slot.role && v.tier === slot.tier && v.driverId === null && v.state === 'idle',
        );
        expect(idx, `no unmatched vehicle for slot ${JSON.stringify(slot)}`).toBeGreaterThanOrEqual(0);
        remaining.splice(idx, 1);
      }
    }

    it('defaults to an empty roster and fleet when staffed is omitted', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42');
      expect(result.success).toBe(true);
      expect(ctx.state!.employees.employees.length).toBe(0);
      expect(ctx.state!.vehicles.vehicles.length).toBe(0);
    });

    it('staffed:false behaves identically to the default (empty roster and fleet)', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:false');
      expect(result.success).toBe(true);
      expect(ctx.state!.employees.employees.length).toBe(0);
      expect(ctx.state!.vehicles.vehicles.length).toBe(0);
    });

    it('staffed:true hires and equips the STARTING_SITE_STAFFED_COMPOSITION roster and fleet', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:true');
      expect(result.success).toBe(true);
      assertEmployeesMatchComposition(ctx.state!.employees.employees);
      assertVehiclesMatchComposition(ctx.state!.vehicles.vehicles);
    });

    it('staffed:true leaves starting cash unaffected — same as an unstaffed run with identical params', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:true');
      expect(result.success).toBe(true);
      expect(ctx.state!.cash).toBe(SANDBOX_DIFFICULTIES.normal.startingCash);
    });

    it('rejects staffed:banana, leaving any existing game state untouched', () => {
      runner.run('sandbox start biome:desert_badlands difficulty:normal seed:7');
      const before = ctx.state;

      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:banana');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Invalid staffed value');
      expect(ctx.state).toBe(before);
    });
  });
});

describe('parseSandboxArgs', () => {
  it('leaves unmentioned keys alone so defaults survive', () => {
    expect(parseSandboxArgs({ biome: 'alpine_granite' })).toEqual({ biome: 'alpine_granite' });
  });

  it('returns an empty partial for an empty named-args object', () => {
    expect(parseSandboxArgs({})).toEqual({});
  });

  it('reads seed:random as a fresh seed in range', () => {
    const parsed = parseSandboxArgs({ seed: 'random' });
    expect(parsed.seed).toBeGreaterThanOrEqual(0);
    expect(parsed.seed).toBeLessThanOrEqual(999999);
  });

  it('ignores a non-numeric seed value rather than yielding NaN', () => {
    expect(parseSandboxArgs({ seed: 'huge' })).toEqual({});
  });

  it('parses the full biome/difficulty/seed set the UI would emit', () => {
    const parsed = parseSandboxArgs({ biome: 'volcanic_flats', difficulty: 'hard', seed: '4242' });
    expect(parsed).toEqual({ biome: 'volcanic_flats', difficulty: 'hard', seed: 4242 });
    expect(Object.keys(SANDBOX_DEFAULTS)).toEqual(expect.arrayContaining(Object.keys(parsed)));
  });

  it('no longer recognizes removed keys like size/depth/cash/mixed_rock', () => {
    const parsed = parseSandboxArgs({ size: '48', depth: '24', cash: '250000', mixed_rock: 'true' });
    expect(parsed).toEqual({});
  });
});
