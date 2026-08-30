// Site expansion through the console commands (#473 P2) — an off-site action
// either grows the site or says why it cannot, and never silently no-ops.

import { describe, it, expect, beforeEach } from 'vitest';
import { terrainConfigOf } from '../../src/console/commands/world.js';
import { drillPlanCommand, buildRampCommand, surveyCommand, type MiningContext } from '../../src/console/commands/mining.js';
import { buildCommand, employeeCommand } from '../../src/console/commands/entities.js';
import { PlayableArea } from '../../src/core/world/PlayableArea.js';
import type { ProtectedStructures } from '../../src/core/world/Structures.js';
import { SURVEY_COVERAGE_RADIUS } from '../../src/core/config/balance.js';
import { makeGameContext } from '../helpers/gameContext.js';

function makeCtx(): MiningContext {
  return makeGameContext({ mineType: 'desert', seed: 42, size: 32, cash: 500000 });
}

/** Hire a surveyor with geology skill so runSurvey()'s qualification guard passes. */
function hireSurveyor(ctx: MiningContext): void {
  const hire = employeeCommand(ctx, ['hire'], { role: 'surveyor' });
  if (!hire.success) throw new Error(`hire failed: ${hire.output}`);
  const empId = ctx.state!.employees.employees.slice(-1)[0]!.id;
  employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'geology', level: '3' });
}

describe('site expansion — drill plans', () => {
  let ctx: MiningContext;
  beforeEach(() => { ctx = makeCtx(); });

  it('claims the chunk under a hole added past the east edge', () => {
    const result = drillPlanCommand(ctx, ['add'], { x: '34', z: '10' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.containsColumn(34, 10)).toBe(true);
    expect(ctx.grid!.maxX).toBe(48);
  });

  it('claims westward, giving the site a negative origin', () => {
    const result = drillPlanCommand(ctx, ['add'], { x: '-4', z: '10' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.minX).toBe(-16);
    expect(ctx.state!.world!.minX).toBe(-16);
    expect(ctx.state!.world!.sizeX).toBe(48);
  });

  it('rebuilds the navgrid over the site\'s new bounding box', () => {
    drillPlanCommand(ctx, ['add'], { x: '-4', z: '10' });
    const nav = ctx.state!.navGrid!;
    expect(nav.originX).toBe(-16);
    expect(nav.width).toBe(48);
    expect(nav.cellAt(-4, 10)).toBeDefined();
    expect(nav.cellAt(-4, 10)!.type).not.toBe('void');
  });

  it('leaves the generation datum alone, so later chunks match the level', () => {
    drillPlanCommand(ctx, ['add'], { x: '34', z: '10' });
    expect(ctx.state!.world!.baseSizeX).toBe(32);
    expect(ctx.state!.world!.baseSizeZ).toBe(32);
  });

  it('refuses a grid plan that reaches ground touching no part of the site', () => {
    const result = drillPlanCommand(ctx, ['grid'], { origin: '400,400', rows: '2', cols: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Cannot drill');
    expect(ctx.state!.drillHoles).toHaveLength(0);
  });

  it('leaves the plan untouched when the claim is refused', () => {
    drillPlanCommand(ctx, ['grid'], { origin: '4,4', rows: '2', cols: '2' });
    const before = ctx.state!.drillHoles.length;
    drillPlanCommand(ctx, ['grid'], { origin: '400,400', rows: '2', cols: '2' });
    expect(ctx.state!.drillHoles).toHaveLength(before);
  });
});

describe('site expansion — buildings and ramps', () => {
  let ctx: MiningContext;
  beforeEach(() => { ctx = makeCtx(); });

  it('claims the ground a building straddling the edge needs', () => {
    // A 2x2 footprint at x=31 reaches x=32, one metre past the 32 m site.
    const result = buildCommand(ctx, ['management_office'], { at: '31,10' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.containsColumn(32, 10)).toBe(true);
  });

  it('places a building on freshly claimed ground', () => {
    const result = buildCommand(ctx, ['management_office'], { at: '34,10' });
    expect(result.success).toBe(true);
    // Confirming placement only queues a construction site (#556) — nothing
    // is built yet, but the ground is claimed immediately.
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
    expect(ctx.grid!.maxX).toBe(48);
  });

  it('claims the ground a ramp runs onto before cutting it', () => {
    const result = buildRampCommand(ctx, [], { origin: '30,10', direction: 'east', length: '8' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.containsColumn(38, 10)).toBe(true);
  });
});

describe('site expansion — the site keeps its shape after growing', () => {
  it('grows only in the direction play asked for', () => {
    const ctx = makeCtx();
    drillPlanCommand(ctx, ['add'], { x: '34', z: '10' });

    // One chunk east, nothing north or west.
    expect(ctx.grid!.minX).toBe(0);
    expect(ctx.grid!.minZ).toBe(0);
    expect(ctx.grid!.maxX).toBe(48);
    expect(ctx.grid!.maxZ).toBe(32);
    expect(ctx.grid!.chunkCount).toBe(5);
  });

  it('marks columns inside the bounding box but outside the claimed set as void', () => {
    const ctx = makeCtx();
    // Claim (2, 0) only — (2, 1) stays unclaimed inside the squared-off box.
    drillPlanCommand(ctx, ['add'], { x: '34', z: '4' });

    expect(ctx.grid!.containsColumn(34, 20)).toBe(false);
    expect(ctx.state!.navGrid!.cellAt(34, 20)!.type).toBe('void');
  });
});

// ── #558: aiming/claim-footprint fixes — survey discs, bridging, all-or-nothing ──

/** A protected-structure set with one village pad centred on chunk (cx, cz), small enough not to reach any neighbouring chunk. */
function structuresProtectingChunk(cx: number, cz: number): ProtectedStructures {
  const rect = PlayableArea.chunkRect(cx, cz);
  return {
    rivers: [], landmarks: [],
    villages: [{
      x: (rect.minX + rect.maxX) / 2,
      z: (rect.minZ + rect.maxZ) / 2,
      radius: 5,
      houses: [],
    }],
  };
}

describe('site expansion — survey claims its whole coverage disc, not just the center', () => {
  it('claims ground across the seismic disc, including near its edge, in several directions', () => {
    const ctx = makeCtx();
    surveyCommand(ctx, ['seismic'], { x: '16', z: '16' });

    const radius = SURVEY_COVERAGE_RADIUS.seismic;
    const points: Array<[number, number]> = [
      [16 + radius - 1, 16],
      [16 - radius + 1, 16],
      [16, 16 + radius - 1],
      [16, 16 - radius + 1],
      [16 + Math.round(radius * 0.7), 16 + Math.round(radius * 0.7)],
    ];
    for (const [x, z] of points) {
      expect(ctx.grid!.containsColumn(x, z)).toBe(true);
    }
  });
});

describe('site expansion — bridging a target that is not edge-adjacent', () => {
  it('bridges the intermediate chunks a far drill target needs, and the navgrid is walkable across the whole bridge', () => {
    const ctx = makeCtx();
    // Site is chunks (0,0)/(1,0) in this row (32-wide). Chunk (2,0) [32-47]
    // touches the site directly; chunk (3,0) [48-63] and chunk (4,0) [64-79]
    // do not — (70, 10) needs both bridged to become reachable at all.
    const result = drillPlanCommand(ctx, ['add'], { x: '70', z: '10' });

    expect(result.success).toBe(true);
    expect(ctx.grid!.containsColumn(70, 10)).toBe(true);

    const nav = ctx.state!.navGrid!;
    for (const x of [34, 50, 70]) {
      expect(nav.cellAt(x, 10)).toBeDefined();
      expect(nav.cellAt(x, 10)!.type).not.toBe('void');
    }
  });

  it('bridges a distant survey, building, and ramp target the same way', () => {
    const surveyCtx = makeCtx();
    hireSurveyor(surveyCtx);
    const survey = surveyCommand(surveyCtx, ['seismic'], { x: '70', z: '10' });
    expect(survey.success).toBe(true);
    expect(surveyCtx.grid!.containsColumn(70, 10)).toBe(true);

    const buildCtx = makeCtx();
    const building = buildCommand(buildCtx, ['management_office'], { at: '70,10' });
    expect(building.success).toBe(true);
    expect(buildCtx.grid!.containsColumn(70, 10)).toBe(true);

    const rampCtx = makeCtx();
    const ramp = buildRampCommand(rampCtx, [], { origin: '70,10', direction: 'east', length: '4' });
    expect(ramp.success).toBe(true);
    expect(rampCtx.grid!.containsColumn(70, 10)).toBe(true);
  });
});

describe('site expansion — a footprint straddling protected ground is refused whole', () => {
  it('refuses a drill grid that starts on claimable ground and reaches protected ground, without partially claiming it', () => {
    const ctx = makeCtx();
    // Chunk (2,0) [32-47] is off-site but otherwise perfectly claimable.
    // Chunk (3,0) [48-63], further along the same grid, is protected. The
    // grid's earlier holes (in chunk 2) come before the protected one in
    // iteration order — the old per-cell claim loop would already have
    // mutated chunk (2,0) into the site by the time it hit the refusal.
    ctx.playableArea!.adoptStructures(structuresProtectingChunk(3, 0));
    const before = ctx.grid!.chunkCount;

    const result = drillPlanCommand(ctx, ['grid'], { origin: '34,10', rows: '2', cols: '6', spacing: '3', depth: '6' });

    expect(result.success).toBe(false);
    expect(ctx.state!.drillHoles).toHaveLength(0);
    expect(ctx.grid!.chunkCount).toBe(before);
    expect(ctx.grid!.hasChunk(2, 0)).toBe(false);
  });
});

describe('site expansion — expansion_disabled refuses every action type', () => {
  it('refuses drill, ramp, building, and survey targets alike when the site cannot expand', () => {
    const ctx = makeCtx();
    const config = terrainConfigOf(ctx.state!)!;
    ctx.playableArea = new PlayableArea(ctx.grid!, config, { expansionEnabled: false });
    const before = ctx.grid!.chunkCount;

    const drill = drillPlanCommand(ctx, ['add'], { x: '34', z: '10' });
    expect(drill.success).toBe(false);

    const ramp = buildRampCommand(ctx, [], { origin: '30,10', direction: 'east', length: '8' });
    expect(ramp.success).toBe(false);

    const building = buildCommand(ctx, ['management_office'], { at: '34,4' });
    expect(building.success).toBe(false);

    const survey = surveyCommand(ctx, ['seismic'], { x: '34', z: '10' });
    expect(survey.success).toBe(false);

    expect(ctx.grid!.chunkCount).toBe(before);
  });
});
