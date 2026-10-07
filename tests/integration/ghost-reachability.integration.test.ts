// BlastSimulator2026 — Integration tests: ghost-preview reachability colour (#1306)
//
// A queued order's ghost is red (GhostPreview.unreachable) when none of the
// actors able to perform THAT action can reach it, or none exists — and the
// colour must track every change that can flip the verdict, in both
// directions: within one tick while the game runs, and immediately for what
// the player does while paused. Orders are still accepted, charged and never
// started when red (#1272).
//
// The site is a flat 32x32 plateau cut by a two-column trench (the "moat", x = 22..23)
// of real re-graded columns, announced through the same `terrain:updated` event
// every carve emits. Region A (x < 22, the spawn side) and region B (x > 23)
// only meet where the moat is bridged. Employees are kept resting where an
// order must stay unclaimed: a resting employee is still an actor (temporary
// unavailability keeps the ghost blue) but never claims, and a claimed ghost
// is never red — so the colour under test is the reachability verdict alone.
// (An injured employee would also not claim, but leaves a skill-free order
// with nobody eligible and fires the unqualified-task event, which pauses ticks.)

import { describe, it, expect } from 'vitest';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import type { GameState, ActionType, PendingAction } from '../../src/core/state/GameState.js';
import { dispatchPendingAction } from '../../src/core/engine/TaskDispatch.js';
import { killEmployee, type Employee } from '../../src/core/entities/Employee.js';
import { destroyVehicle, ROLE_LICENCE_REQUIRED } from '../../src/core/entities/Vehicle.js';
import { setVoxelColumnSurfaceHeight } from '../../src/core/world/VoxelGrid.js';
import { tickUntil } from './helpers.js';

const ROCK_COMPOSITION = { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] };
const SIZE = 32;
const SURFACE = 15;
const MOAT_X0 = 22;
const MOAT_X1 = 23;
const BRIDGE_Z = [14, 15];
// A trench this deep has walls steeper than any employee or vehicle can climb,
// so its floor is a pocket of its own and the two banks are cut apart.
const TRENCH_FLOOR = 3;

const A_TARGET = { x: 10, z: 10 };
const B_TARGET = { x: 28, z: 10 };
const B_SPOT = { x: 28, z: 20 };

// ── Fixture ────────────────────────────────────────────────────────────────

/** Re-grade column (x, z) to `height`: the surface everything else reads (NavGrid, reachability). */
function setColumn(engine: RunnerWithContext, x: number, z: number, height: number): void {
  const grid = engine.ctx.grid!;
  setVoxelColumnSurfaceHeight(grid, x, z, height, grid.palette.intern(ROCK_COMPOSITION));
}

/** Tell the NavGrid (and everyone else) the strip changed, as every real carve does. */
function announceStrip(engine: RunnerWithContext): void {
  engine.emitter.emit('terrain:updated', {
    region: { minX: 0, maxX: SIZE - 1, minY: 0, maxY: SURFACE + 1, minZ: 0, maxZ: SIZE - 1 },
  });
}

function setMoat(engine: RunnerWithContext, opts: { bridge: boolean; dug: boolean }): void {
  for (let x = MOAT_X0; x <= MOAT_X1; x++) {
    for (let z = 0; z < SIZE; z++) {
      const bridged = opts.bridge && BRIDGE_Z.includes(z);
      setColumn(engine, x, z, !opts.dug || bridged ? SURFACE : TRENCH_FLOOR);
    }
  }
  announceStrip(engine);
}

interface Site {
  engine: RunnerWithContext;
  state: () => GameState;
}

function makeSite(opts: { moat?: 'none' | 'cut' | 'bridged'; paused?: boolean } = {}): Site {
  const { moat = 'cut', paused = true } = opts;
  const engine = createRunner();
  expect(runCommand(engine, `new_game seed:42 size:${SIZE} cash:900000`).success).toBe(true);
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) setColumn(engine, x, z, SURFACE);
  announceStrip(engine);
  if (moat !== 'none') setMoat(engine, { bridge: moat === 'bridged', dug: true });
  if (paused) expect(runCommand(engine, 'time pause').success).toBe(true);
  return { engine, state: () => engine.ctx.state! };
}

/** Hire through the console and park the employee at (x, z). `parked` (default) has them resting so they never claim work. */
function hire(site: Site, role: string, at: { x: number; z: number }, opts: { parked?: boolean } = {}): Employee {
  const { parked = true } = opts;
  expect(runCommand(site.engine, `employee hire role:${role}`).success).toBe(true);
  const emp = site.state().employees.employees.at(-1)!;
  emp.unionized = false;
  emp.x = at.x;
  emp.z = at.z;
  if (parked) emp.restTicksRemaining = 1_000_000;
  return emp;
}

function queue(
  site: Site,
  type: ActionType,
  at: { x: number; z: number },
  extra: Partial<PendingAction> = {},
): number {
  const state = site.state();
  const id = state.nextPendingActionId++;
  const result = dispatchPendingAction(state, {
    id, type, requiredSkill: null, requiredVehicleRole: null,
    targetX: at.x, targetZ: at.z, targetY: 0, payload: {}, targetEmployeeId: null, ...extra,
  }, { skipQualificationCheck: true });
  expect(result.success).toBe(true);
  return id;
}

const queueDig = (site: Site, at: { x: number; z: number }) =>
  queue(site, 'level_ground', at, { requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger' });

const ghost = (site: Site, id: number) => site.state().ghostPreviews.find(g => g.id === id)!;
const isRed = (site: Site, id: number) => ghost(site, id).unreachable === true;
/**
 * Advance one tick at a time. A roster with nobody left fires the
 * unqualified-task event, which halts the tick loop until answered; it is
 * incidental to the colour contract under test, so it is dropped here rather
 * than answered (every answer changes the roster or cancels the order).
 */
const tick = (site: Site, n = 1) => {
  for (let i = 0; i < n; i++) {
    site.state().events.pendingEvent = null;
    const r = runCommand(site.engine, 'tick 1');
    expect(r.output).toMatch(/Advanced|EVENT|NEED:/);
  }
};

// ── Preconditions of the fixture itself ────────────────────────────────────

describe('fixture: the moat really splits the site', () => {
  it('a walker in region A cannot reach region B across a cut moat, and can across a bridged one', () => {
    const cut = makeSite({ moat: 'cut' });
    hire(cut, 'driver', { x: 5, z: 5 });
    const across = queue(cut, 'survey', B_TARGET);
    expect(isRed(cut, across)).toBe(true);

    const bridged = makeSite({ moat: 'bridged' });
    hire(bridged, 'driver', { x: 5, z: 5 });
    const through = queue(bridged, 'survey', B_TARGET);
    expect(isRed(bridged, through)).toBe(false);
  });
});

// ── Actors ─────────────────────────────────────────────────────────────────

describe('actors change while paused: the colour follows with no tick', () => {
  it('hiring an employee turns an on-foot order blue (red -> blue)', () => {
    const site = makeSite();
    const id = queue(site, 'survey', A_TARGET);
    expect(isRed(site, id)).toBe(true); // nobody on the roster
    const before = site.state().tickCount;

    hire(site, 'driver', { x: 5, z: 5 });
    // hire() parks the employee by hand; the console hire itself must already
    // have refreshed — re-check through a console no-op the player could make.
    runCommand(site.engine, 'employee list');
    expect(site.state().tickCount).toBe(before);
    expect(ghost(site, id).unreachable).toBe(false);
  });

  it('a console hire alone (no manual parking) turns a region-A order blue immediately', () => {
    const site = makeSite();
    const id = queue(site, 'survey', A_TARGET);
    expect(runCommand(site.engine, 'employee hire role:driver').success).toBe(true);
    const emp = site.state().employees.employees.at(-1)!;
    expect(emp.x).toBeLessThan(MOAT_X0); // spawns on the main side
    expect(ghost(site, id).unreachable).toBe(false);
  });

  it('firing the only employee turns the order red (blue -> red)', () => {
    const site = makeSite();
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', A_TARGET);
    expect(isRed(site, id)).toBe(false);
    expect(runCommand(site.engine, `employee fire ${emp.id}`).success).toBe(true);
    expect(isRed(site, id)).toBe(true);
  });

  it('assigning the required skill turns a skill-gated order blue; it stays queued and was never refused', () => {
    const site = makeSite();
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', A_TARGET, { requiredSkill: 'geology' });
    expect(isRed(site, id)).toBe(true);
    expect(runCommand(site.engine, `employee assign_skill ${emp.id} skill:geology level:1`).success).toBe(true);
    expect(ghost(site, id).unreachable).toBe(false);
    expect(site.state().pendingActions.find(a => a.id === id)!.status).toBe('queued');
  });

  it('assigning the licence for the role turns a vehicle-gated order blue once a vehicle exists', () => {
    const site = makeSite();
    expect(runCommand(site.engine, 'vehicle buy rock_digger').success).toBe(true);
    const emp = hire(site, 'surveyor', { x: 5, z: 5 }); // a hired driver would already hold the licence
    const id = queueDig(site, A_TARGET);
    expect(isRed(site, id)).toBe(true); // no licence yet
    expect(runCommand(site.engine, `employee assign_skill ${emp.id} skill:${ROLE_LICENCE_REQUIRED.rock_digger} level:1`).success).toBe(true);
    expect(ghost(site, id).unreachable).toBe(false);
  });

  it('buying a vehicle of the role turns a vehicle-gated order blue; scrapping it turns it red again', () => {
    const site = makeSite();
    hire(site, 'driver', { x: 5, z: 5 });
    const emp = site.state().employees.employees.at(-1)!;
    runCommand(site.engine, `employee assign_skill ${emp.id} skill:${ROLE_LICENCE_REQUIRED.rock_digger} level:1`);
    const id = queueDig(site, A_TARGET);
    expect(isRed(site, id)).toBe(true); // no vehicle

    expect(runCommand(site.engine, 'vehicle buy rock_digger').success).toBe(true);
    const vehicle = site.state().vehicles.vehicles.at(-1)!;
    expect(vehicle.x).toBeLessThan(MOAT_X0);
    expect(ghost(site, id).unreachable).toBe(false);

    expect(runCommand(site.engine, `vehicle scrap ${vehicle.id}`).success).toBe(true);
    expect(isRed(site, id)).toBe(true);
  });
});

describe('actors change while the game runs: the colour follows within one tick', () => {
  it('the only employee dying turns the order red (blue -> red)', () => {
    const site = makeSite({ paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', A_TARGET);
    tick(site);
    expect(isRed(site, id)).toBe(false);
    killEmployee(site.state().employees, emp.id);
    tick(site);
    expect(isRed(site, id)).toBe(true);
  });

  it('firing the only employee turns the order red within a tick, hiring one turns it blue within a tick', () => {
    const site = makeSite({ paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', A_TARGET);
    runCommand(site.engine, `employee fire ${emp.id}`);
    tick(site);
    expect(isRed(site, id)).toBe(true);
    hire(site, 'driver', { x: 6, z: 6 });
    tick(site);
    expect(isRed(site, id)).toBe(false);
  });

  it('losing the required skill turns a skill-gated order red; regaining it turns it blue', () => {
    const site = makeSite({ paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    runCommand(site.engine, `employee assign_skill ${emp.id} skill:geology level:1`);
    const id = queue(site, 'survey', A_TARGET, { requiredSkill: 'geology' });
    tick(site);
    expect(isRed(site, id)).toBe(false);

    const kept = emp.qualifications.filter(q => q.category !== 'geology');
    emp.qualifications = kept;
    tick(site);
    expect(isRed(site, id)).toBe(true);

    runCommand(site.engine, `employee assign_skill ${emp.id} skill:geology level:1`);
    tick(site);
    expect(isRed(site, id)).toBe(false);
  });

  it('a destroyed vehicle turns a vehicle-gated order red; a bought one turns it blue', () => {
    const site = makeSite({ paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    runCommand(site.engine, `employee assign_skill ${emp.id} skill:${ROLE_LICENCE_REQUIRED.rock_digger} level:1`);
    runCommand(site.engine, 'vehicle buy rock_digger');
    const vehicle = site.state().vehicles.vehicles.at(-1)!;
    const id = queueDig(site, A_TARGET);
    tick(site);
    expect(isRed(site, id)).toBe(false);

    destroyVehicle(site.state().vehicles, vehicle.id);
    tick(site);
    expect(isRed(site, id)).toBe(true);

    runCommand(site.engine, 'vehicle buy rock_digger');
    tick(site);
    expect(isRed(site, id)).toBe(false);
  });
});

// ── Positions ──────────────────────────────────────────────────────────────

describe('positions of the only capable actor', () => {
  it('stranded across the moat from the target: red; walking back to its side: blue', () => {
    const site = makeSite({ paused: false });
    const emp = hire(site, 'driver', B_SPOT);
    const id = queue(site, 'survey', A_TARGET);
    tick(site);
    expect(isRed(site, id)).toBe(true);

    emp.x = 5;
    emp.z = 5;
    tick(site);
    expect(isRed(site, id)).toBe(false);
  });

  it('an employee leaving the target\'s side turns the order red; returning turns it blue', () => {
    const site = makeSite({ paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', A_TARGET);
    tick(site);
    expect(isRed(site, id)).toBe(false);
    emp.x = B_SPOT.x;
    emp.z = B_SPOT.z;
    tick(site);
    expect(isRed(site, id)).toBe(true);
    emp.x = 5;
    emp.z = 5;
    tick(site);
    expect(isRed(site, id)).toBe(false);
  });

  it('a vehicle stranded across the moat from the employee\'s side makes a vehicle-gated order red; once it can drive to the target again it is blue', () => {
    const site = makeSite({ paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    runCommand(site.engine, `employee assign_skill ${emp.id} skill:${ROLE_LICENCE_REQUIRED.rock_digger} level:1`);
    runCommand(site.engine, 'vehicle buy rock_digger');
    const vehicle = site.state().vehicles.vehicles.at(-1)!;
    vehicle.x = B_SPOT.x;
    vehicle.z = B_SPOT.z;
    const id = queueDig(site, A_TARGET);
    tick(site);
    expect(isRed(site, id)).toBe(true);
    vehicle.x = 8;
    vehicle.z = 8;
    tick(site);
    expect(isRed(site, id)).toBe(false);
  });
});

// ── Navmesh ────────────────────────────────────────────────────────────────

describe('navmesh changes', () => {
  it('terrain reshaped by a carve cuts the target off (blue -> red) and a fill that bridges it reconnects (red -> blue), within one tick', () => {
    const site = makeSite({ moat: 'none', paused: false });
    hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', B_TARGET);
    tick(site);
    expect(isRed(site, id)).toBe(false);

    setMoat(site.engine, { bridge: false, dug: true });
    tick(site);
    expect(isRed(site, id)).toBe(true);

    setMoat(site.engine, { bridge: false, dug: false });
    tick(site);
    expect(isRed(site, id)).toBe(false);
  });

  it('a one-lane bridge over the moat connects the area for walkers (the way a ramp does)', () => {
    const site = makeSite({ moat: 'cut', paused: false });
    hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', B_TARGET);
    tick(site);
    expect(isRed(site, id)).toBe(true);
    setMoat(site.engine, { bridge: true, dug: true });
    tick(site);
    expect(isRed(site, id)).toBe(false);
  });

  it('a narrow bridge connects walkers but not vehicles: the same cell is blue for a survey and red for a digger order', () => {
    const site = makeSite({ moat: 'bridged', paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    runCommand(site.engine, `employee assign_skill ${emp.id} skill:${ROLE_LICENCE_REQUIRED.rock_digger} level:1`);
    runCommand(site.engine, 'vehicle buy rock_digger');
    const walkOrder = queue(site, 'survey', B_TARGET);
    const digOrder = queueDig(site, B_TARGET);
    tick(site);
    expect(isRed(site, walkOrder)).toBe(false);
    // Two ordered buildings, one against each side of the 2-cell bridge (a
    // planned footprint is an obstacle at once), leave every bridge cell within
    // 1 cell of one: room for a person (clearance 1), not for a vehicle (2).
    for (const z of [BRIDGE_Z[0]! - 2, BRIDGE_Z[1]! + 1]) {
      expect(runCommand(site.engine, `build management_office at:${MOAT_X0},${z}`).success).toBe(true);
    }
    tick(site);
    expect(isRed(site, walkOrder)).toBe(false);
    expect(isRed(site, digOrder)).toBe(true);
  });

  it('ordering a building whose footprint seals the bridge cuts the target off at once, while paused (blue -> red)', () => {
    const site = makeSite({ moat: 'bridged', paused: true });
    hire(site, 'driver', { x: 5, z: 5 });
    const survey = queue(site, 'survey', B_TARGET);
    expect(isRed(site, survey)).toBe(false);

    const cashBefore = site.state().cash;
    const order = runCommand(site.engine, `build management_office at:${MOAT_X0},${BRIDGE_Z[0]}`);
    expect(order.success).toBe(true);
    expect(site.state().cash).toBeLessThan(cashBefore); // charged at order time
    expect(isRed(site, survey)).toBe(true);
  });

  it('demolishing the building that sealed the bridge reconnects the target once the Building Destroyer is done (red -> blue)', () => {
    const site = makeSite({ moat: 'bridged', paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 }, { parked: false });
    expect(runCommand(site.engine, `build management_office at:${MOAT_X0},${BRIDGE_Z[0]}`).success).toBe(true);
    tickUntil(cmd => runCommand(site.engine, cmd), () => site.state().buildings.buildings.length === 1, 1500);
    expect(site.state().buildings.buildings).toHaveLength(1);
    emp.restTicksRemaining = 1_000_000; // idle from here on: no further claims

    const survey = queue(site, 'survey', B_TARGET);
    tick(site);
    expect(isRed(site, survey)).toBe(true);

    // Demolition is Building Destroyer work now (#1392): fleet and crew it on
    // the near side, order it, and the bridge stays sealed until it is done.
    expect(runCommand(site.engine, 'vehicle buy building_destroyer').success).toBe(true);
    hire(site, 'driver', { x: 5, z: 5 }, { parked: false });
    const building = site.state().buildings.buildings[0]!;
    expect(runCommand(site.engine, `build destroy ${building.id}`).success).toBe(true);
    expect(site.state().buildings.buildings).toHaveLength(1);
    expect(isRed(site, survey)).toBe(true);

    tickUntil(cmd => runCommand(site.engine, cmd), () => site.state().buildings.buildings.length === 0, 1500);
    expect(site.state().buildings.buildings).toHaveLength(0);
    tick(site);
    expect(isRed(site, survey)).toBe(false);
  });

  it('expanding the site brings an order outside the old grid into reach while paused (red -> blue)', () => {
    const site = makeSite({ moat: 'none', paused: true });
    hire(site, 'driver', { x: 5, z: 5 });
    const outside = { x: 40, z: 10 };
    expect(site.state().navGrid!.cellAt(outside.x, outside.z)).toBeUndefined();
    const id = queue(site, 'survey', outside);
    expect(isRed(site, id)).toBe(true);

    expect(runCommand(site.engine, `drill_plan add x:34 z:10`).success).toBe(true);
    expect(site.state().navGrid!.cellAt(outside.x, outside.z)).toBeDefined();
    // The claimed land is natural terrain, a cliff below the plateau, so it is
    // still cut off. Level it (a carve every real one announces) and the next
    // command, which is all a paused game gets, brings the order into reach.
    expect(isRed(site, id)).toBe(true);
    for (let x = SIZE; x < SIZE + 16; x++) for (let z = 0; z < SIZE; z++) setColumn(site.engine, x, z, SURFACE);
    site.engine.emitter.emit('terrain:updated', {
      region: { minX: SIZE - 1, maxX: SIZE + 15, minY: 0, maxY: SURFACE + 1, minZ: 0, maxZ: SIZE - 1 },
    });
    expect(runCommand(site.engine, 'time pause').success).toBe(true);
    expect(ghost(site, id).unreachable).toBe(false);
  });

  it('a drill hole added on the only crossing does not leave a stale colour behind (judged again, either verdict, within a tick)', () => {
    const site = makeSite({ moat: 'bridged', paused: false });
    hire(site, 'driller', { x: 5, z: 5 });
    const id = queue(site, 'survey', B_TARGET);
    tick(site);
    expect(isRed(site, id)).toBe(false);
    expect(runCommand(site.engine, `drill_plan add x:${MOAT_X0} z:${BRIDGE_Z[0]}`).success).toBe(true);
    tick(site);
    const nav = site.state().navGrid!;
    // A planned hole leaves its cell passable, so the bridge still crosses: pin
    // the verdict (blue) and check it against the navmesh rather than echoing it.
    const crossing = [MOAT_X0, MOAT_X1].every(x => BRIDGE_Z.some(z => {
      const cell = nav.cellAt(x, z);
      return cell !== undefined && cell.type !== 'blocked' && cell.type !== 'void';
    }));
    expect(crossing).toBe(true);
    expect(isRed(site, id)).toBe(false);
  });
});

// ── Orders ─────────────────────────────────────────────────────────────────

describe('a new order is coloured correctly the moment it appears', () => {
  it('while paused, with no tick: an unreachable order is born red and a reachable one blue', () => {
    const site = makeSite({ paused: true });
    hire(site, 'driver', { x: 5, z: 5 });
    const tickBefore = site.state().tickCount;
    const red = queue(site, 'survey', B_TARGET);
    const blue = queue(site, 'survey', A_TARGET);
    expect(site.state().tickCount).toBe(tickBefore);
    expect(ghost(site, red).unreachable).toBe(true);
    expect(ghost(site, blue).unreachable).toBe(false);
  });

  it('an ordered building (console command, paused) carries its type and tier and is coloured by reachability', () => {
    const site = makeSite({ paused: true });
    hire(site, 'driver', { x: 5, z: 5 });
    expect(runCommand(site.engine, 'build management_office at:6,6').success).toBe(true);
    const action = site.state().pendingActions.find(a => a.type === 'place_building')!;
    const g = ghost(site, action.id);
    expect(g.building).toMatchObject({ type: 'management_office', tier: 1, x: 6, z: 6 });
    expect(g.unreachable).toBe(false);
  });

  it('an ordered building nobody can reach is accepted, charged and red, and is never started', () => {
    const site = makeSite({ paused: false }); // nobody hired at all
    const cash = site.state().cash;
    const order = runCommand(site.engine, 'build management_office at:6,6');
    expect(order.success).toBe(true);
    expect(site.state().cash).toBeLessThan(cash);
    const action = site.state().pendingActions.find(a => a.type === 'place_building')!;
    expect(ghost(site, action.id).unreachable).toBe(true);
    tick(site, 25);
    expect(site.state().pendingActions.find(a => a.id === action.id)!.status).toBe('queued');
    expect(site.state().buildings.buildings).toHaveLength(0);
  });

  it('a red order carries target_unreachable when actors exist but none reaches, with no freight_warehouse anywhere', () => {
    const site = makeSite({ paused: false });
    hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', B_TARGET);
    tick(site);
    expect(site.state().buildings.buildings.some(b => b.type === 'freight_warehouse')).toBe(false);
    expect(site.state().pendingActions.find(a => a.id === id)!.blockedReason).toBe('target_unreachable');
    setMoat(site.engine, { bridge: false, dug: false });
    tick(site);
    expect(site.state().pendingActions.find(a => a.id === id)!.blockedReason ?? null).not.toBe('target_unreachable');
  });
});

describe('claimed ghosts are never red', () => {
  it('a ghost claimed by an employee on the way stays blue even if the way is cut', () => {
    const site = makeSite({ moat: 'none', paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 }, { parked: false });
    const id = queue(site, 'survey', B_TARGET);
    tick(site);
    expect(ghost(site, id).claimed).toBe(true);
    expect(emp.activeActionId).toBe(id);
    setMoat(site.engine, { bridge: false, dug: true });
    tick(site);
    expect(ghost(site, id).claimed).toBe(true);
    expect(isRed(site, id)).toBe(false);
  });
});

// ── Save / load ────────────────────────────────────────────────────────────

describe('save and load', () => {
  it('colours are correct right after loading, before the first tick', () => {
    const site = makeSite({ paused: true });
    hire(site, 'driver', { x: 5, z: 5 });
    const red = queue(site, 'survey', B_TARGET);
    const blue = queue(site, 'survey', A_TARGET);
    // Strip the flags so the saved file cannot be what makes them right.
    for (const g of site.state().ghostPreviews) delete g.unreachable;
    expect(runCommand(site.engine, 'save slot:ghost-reach').success).toBe(true);

    expect(runCommand(site.engine, 'load slot:ghost-reach').success).toBe(true);
    const loaded = site.state();
    const tickAtLoad = loaded.tickCount;
    const find = (id: number) => loaded.ghostPreviews.find(g => g.id === id)!;
    expect(find(red).unreachable).toBe(true);
    expect(find(blue).unreachable).toBe(false);
    expect(loaded.tickCount).toBe(tickAtLoad);
  });

  it('a loaded save with no capable actor reads red until one is hired, immediately and while paused', () => {
    const site = makeSite({ paused: true });
    const id = queue(site, 'survey', A_TARGET);
    expect(runCommand(site.engine, 'save slot:ghost-reach-2').success).toBe(true);
    expect(runCommand(site.engine, 'load slot:ghost-reach-2').success).toBe(true);
    expect(site.state().ghostPreviews.find(g => g.id === id)!.unreachable).toBe(true);
    expect(runCommand(site.engine, 'employee hire role:driver').success).toBe(true);
    expect(site.state().ghostPreviews.find(g => g.id === id)!.unreachable).toBe(false);
  });
});

// ── Renderer hand-off ──────────────────────────────────────────────────────

describe('ghostPreviewsRevision', () => {
  it('stays put while nothing flips and bumps when a colour flips, in both directions', () => {
    const site = makeSite({ paused: false });
    const emp = hire(site, 'driver', { x: 5, z: 5 });
    const id = queue(site, 'survey', A_TARGET);
    tick(site);
    const rev = site.state().ghostPreviewsRevision;
    tick(site, 5);
    expect(site.state().ghostPreviewsRevision).toBe(rev);

    killEmployee(site.state().employees, emp.id);
    tick(site);
    expect(isRed(site, id)).toBe(true);
    const redRev = site.state().ghostPreviewsRevision;
    expect(redRev).toBeGreaterThan(rev);

    tick(site, 5);
    expect(site.state().ghostPreviewsRevision).toBe(redRev);

    hire(site, 'driver', { x: 6, z: 6 });
    tick(site);
    expect(isRed(site, id)).toBe(false);
    expect(site.state().ghostPreviewsRevision).toBeGreaterThan(redRev);
  });
});
