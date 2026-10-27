// BlastSimulator2026 — Unit tests: the probe's crater access policy, the player's job (#2095)

import { describe, it, expect } from 'vitest';
import {
  RAMP_SHOT_KEEP_OUT_M, buildRampCommand, hasLiveRampWork, keepsVehicleNetwork, nearestHaulDepot, newCraterAccessMemory, patternKeepOut, rampKeepOutZones,
  rampedAlready, stuckRampFootprints, stalledRampFootprints, ACCESS_RAMP_STALL_TICKS, needsNetworkDigger, releaseOutreachedFloors, strandedCrew,
} from '../../../scripts/shared/probe-crater-access.js';
import { buildRamp, landRampOnGrid } from '../../../src/core/mining/Ramp.js';
import { rampFootprint, recordBuiltRamp } from '../../../src/core/mining/RampWidening.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { VoxelGrid, setVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { shotOverlapsProtectedRamp } from '../../../scripts/shared/probe-ladder-policy.js';
import type { PendingAction, PlannedRamp } from '../../../src/core/state/GameState.js';
import type { RampDef } from '../../../src/core/mining/Ramp.js';

function segment(id: number, over: Partial<PendingAction> = {}): PendingAction {
  return {
    id, type: 'dig_ramp_segment', requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger',
    targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
    ...over,
  } as PendingAction;
}

function planned(id: number, actionIds: number[], done: boolean[] = actionIds.map(() => false)): PlannedRamp {
  return {
    id, def: { originX: 0, originZ: 0, direction: 'south', length: 5, targetDepth: 2 },
    footprint: { minX: id, maxX: id, minZ: 0, maxZ: 4 },
    segments: actionIds.map((actionId, index) => ({ index, actionId, cells: [], region: null, done: done[index]! })),
  };
}

describe('buildRampCommand (#2095)', () => {
  it('orders a straight ramp as a two-waypoint path with its depth and width', () => {
    const def: RampDef = { originX: 10, originZ: 5, direction: 'south', length: 12, targetDepth: 4, width: 3 };
    expect(buildRampCommand(def)).toBe('build_ramp path:10,5;10,17 depth:4 width:3');
  });

  it('orders a turning ramp through every corner and keeps its chosen grade', () => {
    const def: RampDef = {
      originX: 10, originZ: 5, direction: 'south', length: 20, targetDepth: 6, width: 5, gradeDegrees: 18.1,
      legs: [{ direction: 'south', length: 12 }, { direction: 'east', length: 8 }],
    };
    expect(buildRampCommand(def)).toBe('build_ramp path:10,5;10,17;18,17 depth:6 width:5 grade:18.1');
  });
});

describe('hasLiveRampWork (#2095, #2091)', () => {
  const access = planned(1, [1]);
  it('is false with no ramp work and true while an access ramp segment can be dug', () => {
    expect(hasLiveRampWork({ plannedRamps: [], pendingActions: [] })).toBe(false);
    expect(hasLiveRampWork({ plannedRamps: [access], pendingActions: [segment(1)] })).toBe(true);
    expect(hasLiveRampWork({
      plannedRamps: [access], pendingActions: [segment(1, { status: 'in_progress', holderId: 7, blockedReason: 'target_unreachable' })],
    })).toBe(true);
  });

  it('a queued, unheld segment stamped blocked is stuck, not live work', () => {
    expect(hasLiveRampWork({ plannedRamps: [access], pendingActions: [segment(1, { blockedReason: 'target_unreachable' })] })).toBe(false);
  });

  it('a repair or a widening being dug is not a way in and holds no access ramp back', () => {
    const repair = { ...planned(2, [2]), repairOf: 5 };
    const widen = { ...planned(3, [3]), widenOf: 6 };
    expect(hasLiveRampWork({ plannedRamps: [repair, widen], pendingActions: [segment(2), segment(3)] })).toBe(false);
  });
});

describe('patternKeepOut (#2091)', () => {
  it('is nothing with no hole ordered or drilled', () => {
    expect(patternKeepOut({ drillHoles: [], plannedDrillHoles: [] })).toEqual([]);
  });

  it('covers every hole, ordered or drilled, grown by RAMP_SHOT_KEEP_OUT_M', () => {
    const hole = (x: number, z: number) => ({ id: `${x},${z}`, x, z, depth: 10, diameter: 0.089 });
    const m = RAMP_SHOT_KEEP_OUT_M;
    expect(patternKeepOut({ drillHoles: [hole(10, 20)], plannedDrillHoles: [hole(14, 24)] }))
      .toEqual([{ minX: 10 - m, maxX: 14 + m, minZ: 20 - m, maxZ: 24 + m }]);
  });
});

describe('stuckRampFootprints (#2095)', () => {
  it('lists a planned ramp only when every segment it has left is stuck', () => {
    const stuck = planned(1, [10, 11], [true, false]);
    const live = planned(2, [20, 21]);
    const pendingActions = [
      segment(11, { blockedReason: 'target_unreachable' }),
      segment(20, { blockedReason: 'target_unreachable' }), segment(21),
    ];
    expect(stuckRampFootprints({ plannedRamps: [stuck, live], pendingActions })).toEqual([stuck.footprint]);
  });

  it('lists nothing when no segment is stuck', () => {
    expect(stuckRampFootprints({ plannedRamps: [planned(1, [10])], pendingActions: [segment(10)] })).toEqual([]);
  });
});

describe('stalledRampFootprints (#2089)', () => {
  it('lists a planned ramp once it has finished no segment for ACCESS_RAMP_STALL_TICKS', () => {
    const memory = newCraterAccessMemory();
    const ramp = planned(1, [10, 11]);
    expect(stalledRampFootprints({ plannedRamps: [ramp], pendingActions: [], tickCount: 100 }, memory)).toEqual([]);
    expect(stalledRampFootprints({ plannedRamps: [ramp], pendingActions: [], tickCount: 100 + ACCESS_RAMP_STALL_TICKS - 1 }, memory)).toEqual([]);
    expect(stalledRampFootprints({ plannedRamps: [ramp], pendingActions: [], tickCount: 100 + ACCESS_RAMP_STALL_TICKS }, memory)).toEqual([ramp.footprint]);
  });

  it('a finished segment restarts the clock', () => {
    const memory = newCraterAccessMemory();
    stalledRampFootprints({ plannedRamps: [planned(1, [10, 11])], pendingActions: [], tickCount: 0 }, memory);
    const progressed = planned(1, [10, 11], [true, false]);
    expect(stalledRampFootprints({ plannedRamps: [progressed], pendingActions: [], tickCount: ACCESS_RAMP_STALL_TICKS }, memory)).toEqual([]);
    expect(stalledRampFootprints({ plannedRamps: [progressed], pendingActions: [], tickCount: 2 * ACCESS_RAMP_STALL_TICKS }, memory)).toEqual([progressed.footprint]);
  });

  it('a ramp nobody works while another is dug is waiting its turn: its clock restarts (#2091)', () => {
    const memory = newCraterAccessMemory();
    const waiting = planned(1, [10, 11]);
    const dug = planned(2, [20, 21]);
    const working = [segment(20, { status: 'in_progress', holderId: 7 })];
    stalledRampFootprints({ plannedRamps: [waiting, dug], pendingActions: [], tickCount: 0 }, memory);
    expect(stalledRampFootprints({ plannedRamps: [waiting, dug], pendingActions: working, tickCount: ACCESS_RAMP_STALL_TICKS }, memory))
      .toEqual([dug.footprint]);
    expect(stalledRampFootprints({ plannedRamps: [waiting, dug], pendingActions: [], tickCount: 2 * ACCESS_RAMP_STALL_TICKS - 1 }, memory))
      .toEqual([dug.footprint]);
  });

  it('forgets a ramp that is no longer planned', () => {
    const memory = newCraterAccessMemory();
    stalledRampFootprints({ plannedRamps: [planned(1, [10])], pendingActions: [], tickCount: 0 }, memory);
    stalledRampFootprints({ plannedRamps: [], pendingActions: [], tickCount: 1 }, memory);
    expect(memory.progress).toEqual({});
  });
});

describe('needsNetworkDigger (#2091)', () => {
  /** The network: everything west of x = 20. */
  const reach = (x: number): boolean => x < 20;
  function site(diggerX: number | null, segmentBlocked: boolean) {
    const state = createGame({ seed: 42 });
    if (diggerX !== null) purchaseVehicle(state.vehicles, 'rock_digger', diggerX, 5);
    state.pendingActions.push(segment(1, segmentBlocked ? { blockedReason: 'target_unreachable' } : {}));
    return state;
  }

  it('is true when a segment waits and the only digger is off the network', () => {
    expect(needsNetworkDigger(site(30, true), reach)).toBe(true);
  });

  it('is true when a segment waits and the site owns no digger', () => {
    expect(needsNetworkDigger(site(null, true), reach)).toBe(true);
  });

  it('is false while a digger stands on the network', () => {
    expect(needsNetworkDigger(site(10, true), reach)).toBe(false);
  });

  it('is false while no segment is stuck', () => {
    expect(needsNetworkDigger(site(30, false), reach)).toBe(false);
  });
});

describe('rampedAlready (#2095)', () => {
  const floor = { x: 20, z: 20, floorY: 5.5, orderCount: 12 };

  it('is false on a fresh memory', () => {
    expect(rampedAlready(newCraterAccessMemory(), floor)).toBe(false);
  });

  it('a floor beside a ramped one at the same depth is the same floor; a deeper one is new', () => {
    const memory = newCraterAccessMemory();
    memory.served.push({ floor, rampId: 3, footprint: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } });
    expect(rampedAlready(memory, { ...floor, x: 24, z: 17 })).toBe(true);
    expect(rampedAlready(memory, { ...floor, floorY: 3 })).toBe(false);
    expect(rampedAlready(memory, { ...floor, x: 60 })).toBe(false);
  });
});

describe('releaseOutreachedFloors (#2091)', () => {
  const ROCK = { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
  /** Surface at 15 for z < 25, a floor `drop` lower from there on. */
  function siteGrid(drop: number): VoxelGrid {
    const grid = new VoxelGrid(40, 50);
    for (let z = 0; z < 50; z++) for (let x = 0; x < 40; x++) for (let y = 0; y <= (z < 25 ? 15 : 15 - drop); y++) grid.setVoxel(x, y, z, ROCK);
    return grid;
  }
  const DEF: RampDef = { originX: 10, originZ: 0, direction: 'south', length: 25, targetDepth: 6, width: 3, cutSlopeRatio: Math.tan(20 * Math.PI / 180) * 0.98 };
  const floor = { x: 10, z: 30, floorY: 9, orderCount: 40 };

  /** A 6 m ramp down to the floor, built; the served entry for its floor. */
  function servedSite() {
    const grid = siteGrid(6);
    const state = createGame({ seed: 42 });
    const landed = landRampOnGrid(grid, DEF);
    expect(buildRamp(grid, landed, Infinity).success).toBe(true);
    const footprint = rampFootprint(landed, 3);
    recordBuiltRamp(state, { id: 7, def: landed, footprint, segments: [] });
    const memory = newCraterAccessMemory();
    memory.served.push({ floor, rampId: 7, footprint });
    return { grid, state, memory };
  }

  it('keeps a floor served while its built ramp still reaches it', () => {
    const { grid, state, memory } = servedSite();
    releaseOutreachedFloors(state, grid, memory);
    expect(memory.served).toHaveLength(1);
  });

  it('keeps a floor served while its ramp is still being dug', () => {
    const { state, memory } = servedSite();
    state.builtRamps.length = 0;
    state.plannedRamps.push(planned(7, [1]));
    releaseOutreachedFloors(state, siteGrid(14), memory);
    expect(memory.served).toHaveLength(1);
  });

  it('forgets the floor once a deeper shot put it out of the built ramp\'s reach', () => {
    const { state, memory } = servedSite();
    releaseOutreachedFloors(state, siteGrid(14), memory); // 14 m over 25 m is past the 20 degree limit
    expect(memory.served).toHaveLength(0);
  });

  it('forgets the floor when its ramp is neither planned nor built', () => {
    const { grid, state, memory } = servedSite();
    state.builtRamps.length = 0;
    releaseOutreachedFloors(state, grid, memory);
    expect(memory.served).toHaveLength(0);
  });
});

describe('nearestHaulDepot (#2045)', () => {
  type Buildings = Parameters<typeof nearestHaulDepot>[0]['buildings'];
  const site = (list: Array<{ type: string; x: number; z: number }>) => ({ buildings: { buildings: list } as unknown as Buildings });

  it('is the freight warehouse or spoil heap nearest the floor', () => {
    const state = site([{ type: 'freight_warehouse', x: 9, z: 10 }, { type: 'spoil_heap', x: 50, z: 50 }]);
    expect(nearestHaulDepot(state, { x: 45, z: 40 })).toEqual({ x: 50, z: 50 });
    expect(nearestHaulDepot(state, { x: 15, z: 15 })).toEqual({ x: 9, z: 10 });
  });

  it('ignores buildings nothing is hauled to', () => {
    const state = site([{ type: 'living_quarters', x: 40, z: 40 }, { type: 'freight_warehouse', x: 0, z: 0 }]);
    expect(nearestHaulDepot(state, { x: 41, z: 41 })).toEqual({ x: 0, z: 0 });
  });

  it('is null on a site with no depot', () => {
    expect(nearestHaulDepot(site([{ type: 'living_quarters', x: 4, z: 4 }]), { x: 0, z: 0 })).toBeNull();
  });
});

describe('rampKeepOutZones (#2045)', () => {
  it('grows each built ramp\'s footprint by the keep-out margin on every side', () => {
    const ramp = { footprint: { minX: 10, maxX: 12, minZ: 5, maxZ: 24 } } as Parameters<typeof rampKeepOutZones>[0]['builtRamps'][number];
    const [zone] = rampKeepOutZones({ builtRamps: [ramp] });
    const m = RAMP_SHOT_KEEP_OUT_M;
    expect(zone).toEqual({ x: 10 - m, z: 5 - m, span: 3 + 2 * m, spanZ: 20 + 2 * m });
  });

  it('a shot beside the corridor overlaps the zone; one past the margin does not', () => {
    const ramp = { footprint: { minX: 10, maxX: 12, minZ: 5, maxZ: 24 } } as Parameters<typeof rampKeepOutZones>[0]['builtRamps'][number];
    const zones = rampKeepOutZones({ builtRamps: [ramp] });
    expect(shotOverlapsProtectedRamp({ x: 13, z: 10, span: 4 }, zones)).toBe(true);
    expect(shotOverlapsProtectedRamp({ x: 13 + RAMP_SHOT_KEEP_OUT_M, z: 10, span: 4 }, zones)).toBe(false);
  });

  it('is empty with no built ramp', () => {
    expect(rampKeepOutZones({ builtRamps: [] })).toEqual([]);
  });
});

describe('strandedCrew (#2091)', () => {
  /** A plateau (x < 10, height 10) above a lowland (height 2) behind an 8 m cliff; the rally point on the plateau. */
  function cliffSite() {
    const grid = new VoxelGrid(30, 20);
    const comp = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let z = 0; z < 20; z++) for (let x = 0; x < 30; x++) setVoxelColumnSurfaceHeight(grid, x, z, x < 10 ? 10 : 2, comp);
    const state = createGame({ seed: 42 });
    state.grade = createGradeState();
    state.navGrid = NavGrid.buildNavGrid(grid, [], []);
    state.rallyPoint = { x: 4, z: 4 };
    return state;
  }

  it('lists crew on foot and vehicles below the cliff, not those on the plateau', () => {
    const state = cliffSite();
    const rng = new Random(42);
    const { employee: below } = hireEmployee(state.employees, 'driver', rng, 20, 10);
    hireEmployee(state.employees, 'driver', rng, 5, 10);
    purchaseVehicle(state.vehicles, 'rock_digger', 22, 12);
    purchaseVehicle(state.vehicles, 'rock_digger', 3, 12);
    expect(strandedCrew(state)).toEqual([{ x: below.x, z: below.z }, { x: 22, z: 12 }]);
  });

  it('is empty with no rally point', () => {
    const state = cliffSite();
    delete state.rallyPoint;
    hireEmployee(state.employees, 'driver', new Random(42), 20, 10);
    expect(strandedCrew(state)).toEqual([]);
  });
});

describe('keepsVehicleNetwork (#2045)', () => {
  /**
   * A plateau (x < 10, height 10) and a lowland (x > 22, height 6), joined only by a gentle slope across z 10..14; a
   * cliff everywhere else. The rally point is on the plateau.
   */
  function slopeSite() {
    const grid = new VoxelGrid(40, 40);
    const comp = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let z = 0; z < 40; z++) {
      for (let x = 0; x < 40; x++) {
        const onSlope = z >= 10 && z <= 14;
        const h = x < 10 ? 10 : x > 22 ? 6 : onSlope ? 10 - (4 * (x - 10)) / 12 : x < 16 ? 10 : 6;
        setVoxelColumnSurfaceHeight(grid, x, z, h, comp);
      }
    }
    const state = createGame({ seed: 42 });
    state.grade = createGradeState();
    state.navGrid = NavGrid.buildNavGrid(grid, [], []);
    state.rallyPoint = { x: 4, z: 4 };
    return { state, grid };
  }

  it('accepts a trench dug in the lowland, away from the one slope', () => {
    const { state, grid } = slopeSite();
    const lowland: RampDef = { originX: 30, originZ: 2, direction: 'south', length: 20, targetDepth: 3, width: 3 };
    expect(keepsVehicleNetwork(state, grid, lowland)).toBe(true);
  });

  it('refuses a trench dug across the one slope: it walls the rally off from the lowland', () => {
    const { state, grid } = slopeSite();
    const across: RampDef = { originX: 16, originZ: 4, direction: 'south', length: 24, targetDepth: 4, width: 3 };
    expect(keepsVehicleNetwork(state, grid, across)).toBe(false);
  });
});
