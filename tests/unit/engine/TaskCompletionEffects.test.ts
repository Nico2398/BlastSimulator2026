// BlastSimulator2026 — Unit tests: applyTaskCompletion (#1086)
//
// Core-owned relocation of tickTaskCompletion.ts's resolveTaskCompletion.
// runTick's own black-box tests and the pre-existing integration/scenario
// suites already exercise this indirectly; these tests call it directly per
// core-purity.md's "adding an exported function here means adding its unit
// test in the mirrored tests/unit/ path" convention.

import { describe, it, expect } from 'vitest';
import { applyTaskCompletion } from '../../../src/core/engine/TaskCompletionEffects.js';
import { createGame, type BuiltRamp, type PendingAction, type PlannedRamp, type PlannedBuilding } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { VoxelGrid, chunkIndexOf, computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { generateTerrain } from '../../../src/core/world/TerrainGen.js';
import { BLAST_ZONE_RADIUS } from '../../../src/core/config/balance.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED, vehicleDriverId, getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import type { TaskProgressResult } from '../../../src/core/engine/TaskProgress.js';
import { getBuildingDef, getDefSize } from '../../../src/core/entities/Building.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { subscribeNavGridToUpdates, buildingFootprintOccupants } from '../../../src/core/nav/NavGridSync.js';
import { findBuildingApproachCell } from '../../../src/core/nav/BuildingApproach.js';
import { rampFootprint } from '../../../src/core/mining/RampWidening.js';
import type { RampDef } from '../../../src/core/mining/Ramp.js';
import type { PlaceBuildingActionPayload } from '../../../src/core/engine/PlaceBuildingAction.js';

const SEED = 42;

function baseProgress(overrides: Partial<TaskProgressResult>): TaskProgressResult {
  return { completed: true, leveledUp: false, skill: null, levelUps: [], ...overrides };
}

describe('applyTaskCompletion — level_ground (#1009)', () => {
  it('carves the ordered cells and reports voxelsCleared', () => {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(10, 10);
    grid.setVoxel(3, 3, 3, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);

    const progress = baseProgress({
      actionType: 'level_ground',
      actionPayload: {
        rect: { minX: 3, maxX: 3, minZ: 3, maxZ: 3 },
        // The single solid voxel at (3,3,3) puts the column's continuous
        // surface at 3.5 (setVoxelColumnSurfaceHeight/getSmoothTerrainSurfaceY,
        // VoxelGrid.ts) — targetY 2.5 carves exactly 1.0 of continuous height
        // off it, matching this test's pre-#1144 "clears 1 voxel" intent.
        targetY: 2.5,
        columns: [{ x: 3, z: 3 }],
        region: { minX: 3, maxX: 3, minZ: 3, maxZ: 3 },
        orderCost: 0,
        footprint: [[0, 0]],
      },
    });

    const report = applyTaskCompletion(state, grid, employee, progress, new EventEmitter());

    expect(report.completed).toBe(true);
    expect(report.groundLevelled).toEqual({ voxelsCleared: 1 });
  });
});

describe('applyTaskCompletion — dig_ramp_segment ordering (#945, updated for #1090)', () => {
  /**
   * A rock_digger driver mid-vehicle-chain, having just finished segment 0
   * of a 2-segment ramp, with segment 1 already queued open in the pool.
   * isRampSegmentClaimable (ActionSelection.ts) gates segment 1 on segment
   * 0's own tracker.done — so tracker.done being set here (before
   * completeVehicleGatedAction releases the claim) is what makes segment 1
   * claimable by ordinary dispatch the very next tick, whoever ranks
   * cheapest for it (#1090: no continuity promotion happens inside
   * applyTaskCompletion any more — completeVehicleGatedAction only releases
   * the reservation and clears the driver's active-task fields).
   */
  function makeFixture() {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(10, 10);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.rock_digger, 1);

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.occupantIds = [employee.id];

    const segment0Action: PendingAction = {
      id: 10,
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { rampId: 1, segmentIndex: 0, cells: [{ x: 1, y: 1, z: 1 }], region: null },
      targetEmployeeId: null,
      status: 'in_progress',
      holderId: employee.id,
      queuedAtTick: 0,
    };
    const segment1Action: PendingAction = {
      id: 11,
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { rampId: 1, segmentIndex: 1, cells: [{ x: 1, y: 0, z: 1 }], region: null },
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };
    state.pendingActions.push(segment0Action, segment1Action);

    reserveVehicle(state.vehicles, vehicle.id, segment0Action.id);
    employee.activeActionId = segment0Action.id;

    const ramp: PlannedRamp = {
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'north', length: 2, targetDepth: -2 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [
        { index: 0, actionId: segment0Action.id, cells: segment0Action.payload['cells'] as { x: number; y: number; z: number }[], region: null, done: false },
        { index: 1, actionId: segment1Action.id, cells: segment1Action.payload['cells'] as { x: number; y: number; z: number }[], region: null, done: false },
      ],
    };
    state.plannedRamps.push(ramp);

    return { state, grid, employee, vehicle, segment0Action, segment1Action, ramp };
  }

  it('marks the finished segment done, releases the claim, and leaves the next segment queued for ordinary dispatch to pick up', () => {
    const { state, grid, employee, vehicle, segment0Action, segment1Action, ramp } = makeFixture();

    const progress = baseProgress({
      actionType: 'dig_ramp_segment',
      actionPayload: segment0Action.payload,
      actionId: segment0Action.id,
    });

    const report = applyTaskCompletion(state, grid, employee, progress, new EventEmitter());

    expect(ramp.segments[0]!.done).toBe(true);
    expect(report.rampSegment).toEqual({
      rampId: 1, segmentIndex: 0, voxelsCleared: 1, voxelsFilled: 0, rampFullyDone: false,
    });

    // #1090: no continuity promotion — completeVehicleGatedAction only
    // releases the claim (vehicle reservation + driver's own active-task
    // fields) and completes segment 0's PendingAction. Segment 1 is now
    // claimable (isRampSegmentClaimable, ActionSelection.ts) but stays
    // 'queued' until the next tick's ordinary dispatch ranks a driver onto
    // it — this employee, still mounted in `vehicle`, is expected to win
    // that ranking by cost (planItinerary's zero-length first leg), but
    // applyTaskCompletion itself does not drive that.
    expect(employee.activeActionId).toBeNull();
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicleDriverId(vehicle)).toBe(employee.id); // still mounted — release is claim-only
    expect(state.pendingActions.find(a => a.id === segment1Action.id)!.status).toBe('queued');
    expect(state.pendingActions.find(a => a.id === segment1Action.id)!.holderId).toBeNull();
    expect(state.pendingActions.find(a => a.id === segment0Action.id)).toBeUndefined();
  });
});

describe('applyTaskCompletion — place_building footprint blocking (#1200)', () => {
  const SOLID_VOXEL = {
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };

  /**
   * A flat 10x10 slab, a management_office T1 order at (2,0) already sitting
   * in `state.plannedBuildings` (so a NavGrid built off
   * `buildingFootprintOccupants` — the #1200 skeleton's own widened helper —
   * already classifies its 2x2 footprint 'blocked', exactly as it will once
   * order-time blocking is wired up), and `subscribeNavGridToUpdates` wired
   * the same way `createRunner.ts`/`gameContext.ts` wire it for a real game,
   * so this unit test observes the same NavGrid mutation a console command
   * would trigger.
   */
  function makeFootprintFixture() {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(10, 10);
    for (let z = 0; z <= 4; z++) {
      for (let x = 0; x <= 4; x++) {
        grid.setVoxel(x, 0, z, SOLID_VOXEL);
      }
    }
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);

    const buildingOrderId = state.nextPlannedBuildingId++;
    const actionId = state.nextPendingActionId++;
    const order: PlannedBuilding = {
      id: buildingOrderId,
      buildingId: state.buildings.nextId++,
      type: 'management_office',
      tier: 1,
      x: 2,
      z: 0,
      actionId,
      cost: 1000,
    };
    state.plannedBuildings.push(order);

    state.navGrid = NavGrid.buildNavGrid(grid, buildingFootprintOccupants(state), state.drillHoles);

    const emitter = new EventEmitter();
    subscribeNavGridToUpdates(emitter, () => ({
      navGrid: state.navGrid!,
      grid,
      buildings: buildingFootprintOccupants(state),
      drillHoles: state.drillHoles,
    }));

    const def = getBuildingDef(order.type, order.tier);
    const payload: PlaceBuildingActionPayload = {
      buildingOrderId,
      cost: order.cost,
      footprint: def.footprint,
      durationTicks: 10,
    };

    return { state, grid, employee, order, def, payload, emitter };
  }

  it('the footprint is already blocked before construction even starts, off the plannedBuildings entry alone', () => {
    const { state, order } = makeFootprintFixture();
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(order.type, order.tier));
    for (let dz = 0; dz < sizeZ; dz++) {
      for (let dx = 0; dx < sizeX; dx++) {
        expect(state.navGrid!.cellAt(order.x + dx, order.z + dz)!.type).toBe('blocked');
      }
    }
  });

  it('completes construction at the order\'s own (x, z) even when the builder worked from the footprint\'s approach ring cell, not the raw order origin', () => {
    const { state, grid, employee, order, payload, emitter } = makeFootprintFixture();
    const def = getBuildingDef(order.type, order.tier);

    // The builder's walk target is the ring cell nearest their own spawn
    // point, per findBuildingApproachCell (BuildingApproach.ts) — never the
    // raw order origin, which the footprint's own blocking now makes
    // unreachable outright.
    const ringCell = findBuildingApproachCell(state.navGrid, order, def, employee.x, employee.z);
    expect(ringCell.x === order.x && ringCell.z === order.z).toBe(false);
    employee.x = ringCell.x;
    employee.z = ringCell.z;

    const action: PendingAction = {
      id: order.actionId,
      type: 'place_building',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: ringCell.x,
      targetZ: ringCell.z,
      targetY: 0,
      payload: payload as unknown as Record<string, unknown>,
      targetEmployeeId: null,
      status: 'in_progress',
      holderId: employee.id,
      queuedAtTick: 0,
    };
    state.pendingActions.push(action);

    const progress = baseProgress({
      actionType: 'place_building',
      actionPayload: payload as unknown as Record<string, unknown>,
      actionId: action.id,
    });

    const report = applyTaskCompletion(state, grid, employee, progress, emitter);

    expect(report.completed).toBe(true);
    expect(report.building).toBeDefined();
    expect(report.building!.outcome).toBe('built');
    // The finished building lands on the ORDER's own coordinates, not on
    // whichever ring cell the builder's own PendingAction target happened
    // to hold.
    expect(report.building!.x).toBe(order.x);
    expect(report.building!.z).toBe(order.z);

    // The builder was standing on the ring — outside the new footprint —
    // so the newly-blocked-footprint occupant sweep must leave them exactly
    // where they were, not relocate them a second time.
    expect(employee.x).toBe(ringCell.x);
    expect(employee.z).toBe(ringCell.z);
  });

  it('frees the footprint when a place_building completion fails and refunds the order', () => {
    const { state, grid, employee, order, payload, emitter } = makeFootprintFixture();
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(order.type, order.tier));

    // Confirm the footprint is genuinely blocked before the failing
    // completion runs — same "already blocked" baseline the success-path
    // test above pins.
    expect(state.navGrid!.cellAt(order.x, order.z)!.type).toBe('blocked');

    // A blast reshaping the ground mid-construction (the scenario
    // `applyTaskCompletion`'s own place_building comment already documents)
    // — one footprint cell towers over the rest, past
    // BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD, so placeBuilding's own
    // completion re-check refuses with "Uneven surface" and this lands in
    // the refund/cancel branch instead of the success branch.
    for (let y = 1; y <= 5; y++) grid.setVoxel(order.x + 1, y, order.z + 1, SOLID_VOXEL);

    const cashBefore = state.cash;
    const progress = baseProgress({
      actionType: 'place_building',
      actionPayload: payload as unknown as Record<string, unknown>,
      actionId: order.actionId,
    });

    const report = applyTaskCompletion(state, grid, employee, progress, emitter);

    expect(report.completed).toBe(true);
    expect(report.building).toBeDefined();
    expect(report.building!.outcome).toBe('failed');
    expect(state.cash).toBe(cashBefore + order.cost);
    expect(state.plannedBuildings).toHaveLength(0);

    // The order is gone and nothing else occupies this ground — the
    // footprint must no longer refuse routing.
    for (let dz = 0; dz < sizeZ; dz++) {
      for (let dx = 0; dx < sizeX; dx++) {
        const cell = state.navGrid!.cellAt(order.x + dx, order.z + dz);
        expect(cell).toBeTruthy();
        expect(cell!.type).not.toBe('blocked');
      }
    }
  });
});

describe('applyTaskCompletion — finished ramps become BuiltRamps (#1298)', () => {
  const DEF: RampDef = { originX: 3, originZ: 1, direction: 'south', length: 4, targetDepth: 2 };

  /** `segmentCount` segments; segments before `completeIndex` are already done, `completeIndex` is finishing now. */
  function makeFixture(opts: { def?: RampDef; widenOf?: number; segmentCount: number; completeIndex: number; built?: BuiltRamp[] }) {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(12, 12);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.rock_digger, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.occupantIds = [employee.id];
    const def = opts.def ?? DEF;

    const segments: PlannedRamp['segments'] = [];
    let current!: PendingAction;
    for (let i = 0; i < opts.segmentCount; i++) {
      const cells = [{ x: 4, y: 1, z: 2 + i }];
      const action: PendingAction = {
        id: 10 + i, type: 'dig_ramp_segment', requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger',
        targetX: 0, targetZ: 0, targetY: 0,
        payload: { rampId: 1, segmentIndex: i, cells, region: null },
        targetEmployeeId: null,
        status: i === opts.completeIndex ? 'in_progress' : 'queued',
        holderId: i === opts.completeIndex ? employee.id : null,
        queuedAtTick: 0,
      };
      if (i === opts.completeIndex) current = action;
      if (i >= opts.completeIndex) state.pendingActions.push(action);
      segments.push({ index: i, actionId: action.id, cells, region: null, done: i < opts.completeIndex });
    }
    reserveVehicle(state.vehicles, vehicle.id, current.id);
    employee.activeActionId = current.id;

    const planned: PlannedRamp = {
      id: 1, def, footprint: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, segments,
      ...(opts.widenOf !== undefined ? { widenOf: opts.widenOf } : {}),
    };
    state.plannedRamps.push(planned);
    if (opts.built) { state.builtRamps.push(...opts.built); state.nextBuiltRampId = opts.built.length + 1; }
    return { state, grid, employee, current };
  }

  function complete(f: ReturnType<typeof makeFixture>) {
    return applyTaskCompletion(f.state, f.grid, f.employee,
      baseProgress({ actionType: 'dig_ramp_segment', actionPayload: f.current.payload, actionId: f.current.id }),
      new EventEmitter());
  }

  it('records one BuiltRamp with id, def, width and footprint when the last segment lands', () => {
    const def: RampDef = { ...DEF, width: 5 };
    const f = makeFixture({ def, segmentCount: 1, completeIndex: 0 });
    const report = complete(f);
    expect(report.rampSegment?.rampFullyDone).toBe(true);
    expect(f.state.plannedRamps).toEqual([]);
    expect(f.state.builtRamps).toHaveLength(1);
    const built = f.state.builtRamps[0]!;
    expect(built.id).toBe(1);
    expect(built.def).toEqual(def);
    expect(built.width).toBe(5);
    expect(built.footprint).toEqual(rampFootprint(def, 5));
    expect(f.state.nextBuiltRampId).toBe(2);
  });

  it('defaults the built width to 3 when the def carries none', () => {
    const f = makeFixture({ segmentCount: 1, completeIndex: 0 });
    complete(f);
    expect(f.state.builtRamps[0]!.width).toBe(3);
  });

  it('adds no BuiltRamp while segments remain', () => {
    const f = makeFixture({ segmentCount: 2, completeIndex: 0 });
    const report = complete(f);
    expect(report.rampSegment?.rampFullyDone).toBe(false);
    expect(f.state.builtRamps).toEqual([]);
    expect(f.state.plannedRamps).toHaveLength(1);
  });

  describe('a widen order', () => {
    const built = (): BuiltRamp => ({ id: 1, def: { ...DEF, width: 3 }, width: 3, footprint: rampFootprint(DEF, 3) });
    const widenDef: RampDef = { ...DEF, width: 5 };

    it('keeps the old width until its last segment completes', () => {
      const f = makeFixture({ def: widenDef, widenOf: 1, segmentCount: 2, completeIndex: 0, built: [built()] });
      complete(f);
      expect(f.state.builtRamps[0]!.width).toBe(3);
      expect(f.state.plannedRamps).toHaveLength(1);
    });

    it('updates the existing BuiltRamp width and footprint on the last segment, without adding another', () => {
      const f = makeFixture({ def: widenDef, widenOf: 1, segmentCount: 2, completeIndex: 1, built: [built()] });
      complete(f);
      expect(f.state.plannedRamps).toEqual([]);
      expect(f.state.builtRamps).toHaveLength(1);
      expect(f.state.builtRamps[0]!.id).toBe(1);
      expect(f.state.builtRamps[0]!.width).toBe(5);
      expect(f.state.builtRamps[0]!.footprint).toEqual(rampFootprint(DEF, 5));
      expect(f.state.nextBuiltRampId).toBe(2);
    });
  });
});

describe('applyTaskCompletion — charge_hole generates the rock it will blast (#1603)', () => {
  it('loads the charge and makes the hole\'s blast zone resident, down past the hole bottom', () => {
    const state = createGame({ seed: SEED });
    const grid = generateTerrain({ sizeX: 48, datum: 40, sizeZ: 48, seed: 11, climateBias: [0, 0] });
    const { employee } = hireEmployee(state.employees, 'blaster', new Random(SEED), 0, 0);
    const surface = computeVoxelColumnSurfaceY(grid, 20, 20)!;
    state.drillHoles.push({ id: 'H1', x: 20, z: 20, depth: 12, diameter: 0.15 });
    state.plannedChargesByHole['H1'] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 } as typeof state.plannedChargesByHole[string];
    const zoneBottomCy = chunkIndexOf(surface + 1 - 12 - BLAST_ZONE_RADIUS);
    expect(grid.allocatedCyRange(chunkIndexOf(20), chunkIndexOf(20))?.min ?? Infinity).toBeGreaterThan(zoneBottomCy);

    const report = applyTaskCompletion(state, grid, employee, baseProgress({
      actionType: 'charge_hole',
      actionPayload: { holeId: 'H1' },
    }), new EventEmitter());

    expect(report.chargeLoaded?.holeId).toBe('H1');
    expect(grid.allocatedCyRange(chunkIndexOf(20), chunkIndexOf(20))!.min).toBeLessThanOrEqual(zoneBottomCy);
  });
});
