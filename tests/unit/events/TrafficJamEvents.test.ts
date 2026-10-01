// BlastSimulator2026 — Resolving a traffic_jam event: reroute / widen / ignore (#1208)

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveEvent } from '../../../src/core/events/EventResolver.js';
import { clearEvents } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';
import type { TrafficJam } from '../../../src/core/events/TrafficJams.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGame, type BuiltRamp, type GameState } from '../../../src/core/state/GameState.js';
import { buildRamp, type RampDef } from '../../../src/core/mining/Ramp.js';
import { rampFootprint, validateWidenRamp } from '../../../src/core/mining/RampWidening.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { AgentOccupancy } from '../../../src/core/nav/AgentOccupancy.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  TRAFFIC_JAM_REROUTE_SILENCE_TICKS, TRAFFIC_JAM_WIDEN_SILENCE_TICKS,
  TRAFFIC_JAM_IGNORE_SILENCE_TICKS, TRAFFIC_JAM_IGNORE_WELLBEING_PENALTY,
  type RampWidth,
} from '../../../src/core/config/balance.js';

const TICK = 500;
const DEF: RampDef = { originX: 10, originZ: 5, direction: 'south', length: 12, targetDepth: 6 };

function makeElevatedGrid(sizeX: number, sizeZ: number, surfaceY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeZ);
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++)
      for (let y = 0; y <= surfaceY; y++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  return grid;
}

interface Setup { state: GameState; grid: VoxelGrid; ramp: BuiltRamp; jam: TrafficJam; }

/** A state owning built ramp 1 of `width`, three stuck agents on it, and a pending traffic_jam. */
function setup(width: RampWidth = 3, cash = 1_000_000, rampId: number | null = 1): Setup {
  const state = createGame({ seed: 42 });
  state.cash = cash;
  const grid = makeElevatedGrid(30, 40, 22);
  const def: RampDef = { ...DEF, width };
  expect(buildRamp(grid, def, 1e9).success).toBe(true);
  const ramp: BuiltRamp = { id: 1, def, width, footprint: rampFootprint(def, width) };
  state.builtRamps.push(ramp);
  state.nextBuiltRampId = 2;

  const rng = new Random(1);
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { employee } = hireEmployee(state.employees, 'driller', rng, 10.5, 10.5 + i);
    employee.vehicleWaitingTicks = 20;
    employee.isMoveStuck = true;
    employee.itinerary = {
      legs: [{ mode: 'foot', vehicleId: null, destX: 12, destZ: 12, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 }],
      goal: { kind: 'reposition', x: 12, z: 12 }, workTicks: 0, estTotalTicks: 5,
    };
    ids.push(employee.id);
  }
  // A bystander holds the jam agents' shared destination, so a reroute has something to spread around.
  const { employee: holder } = hireEmployee(state.employees, 'driller', rng, 12, 12);
  state.navGrid = NavGrid.buildNavGrid(grid, [], []);
  state.agentOccupancy = new AgentOccupancy();
  state.agentOccupancy.tryMove({ kind: 'employee', id: holder.id }, 12, 12);
  const jam: TrafficJam = {
    key: rampId === null ? 'passage:10,11' : `ramp:${rampId}`, kind: rampId === null ? 'passage' : 'ramp_head',
    rampId, x: 10.5, z: 11.5, agentIds: ids.sort((a, b) => a - b), vehicleCount: 0,
  };
  state.events.pendingEvent = { eventId: 'traffic_jam', firedAtTick: TICK, jam };
  return { state, grid, ramp, jam };
}

function resolve(s: Setup, option: number, withWorld = true, grid: VoxelGrid | null = s.grid) {
  return resolveEvent(
    s.state.events, s.state.finances, s.state.scores, option, TICK, new Random(7),
    withWorld ? { state: s.state, grid } : undefined,
  );
}

beforeEach(() => {
  clearEvents();
  setupEvents();
});

describe('traffic_jam — reroute_vehicles (option 0)', () => {
  it('clears waiting ticks and stuck flags of every jam agent', () => {
    const s = setup();
    resolve(s, 0);
    for (const id of s.jam.agentIds) {
      const e = s.state.employees.employees.find(x => x.id === id)!;
      expect(e.vehicleWaitingTicks).toBe(0);
      expect(e.isMoveStuck).toBe(false);
    }
  });

  it('re-spreads each jam agent\'s held destination, recording the original', () => {
    const s = setup();
    resolve(s, 0);
    for (const id of s.jam.agentIds) {
      const leg = s.state.employees.employees.find(x => x.id === id)!.itinerary!.legs[0]!;
      expect([leg.destX, leg.destZ]).not.toEqual([12, 12]);
      expect([leg.originalDestX, leg.originalDestZ]).toEqual([12, 12]);
    }
  });

  it('silences the chokepoint for the reroute duration', () => {
    const s = setup();
    resolve(s, 0);
    expect(s.state.events.jamSilencedUntil[s.jam.key]).toBe(TICK + TRAFFIC_JAM_REROUTE_SILENCE_TICKS);
  });

  it('does not touch cash and clears the pending event', () => {
    const s = setup();
    const cash = s.state.cash;
    const result = resolve(s, 0);
    expect(s.state.cash).toBe(cash);
    expect(result).not.toBeNull();
    expect(result!.cashChange).toBe(0);
    expect(s.state.events.pendingEvent).toBeNull();
  });

  it('leaves agents outside the jam alone', () => {
    const s = setup();
    const { employee: bystander } = hireEmployee(s.state.employees, 'driller', new Random(3), 30.5, 30.5);
    bystander.vehicleWaitingTicks = 20;
    bystander.isMoveStuck = true;
    resolve(s, 0);
    expect(bystander.vehicleWaitingTicks).toBe(20);
    expect(bystander.isMoveStuck).toBe(true);
  });
});

describe('traffic_jam — widen_ramp (option 1)', () => {
  it('queues a widen order for the jam ramp and charges its cost exactly once', () => {
    const s = setup(3);
    const cost = (validateWidenRamp(s.ramp, 5, s.state.cash) as { data: { cost: number } }).data.cost;
    const cash = s.state.cash;
    const result = resolve(s, 1);
    expect(s.state.plannedRamps.some(p => p.widenOf === 1)).toBe(true);
    expect(s.state.cash).toBe(cash - cost);
    expect(result!.cashChange).toBe(0);
    expect(s.state.events.lastOutcome!.effects).toContainEqual({ kind: 'cash', key: 'cash', delta: -cost });
    expect(result!.resultKey.endsWith('_alt')).toBe(false);
  });

  it('silences the chokepoint for the widen duration', () => {
    const s = setup(3);
    resolve(s, 1);
    expect(s.state.events.jamSilencedUntil[s.jam.key]).toBe(TICK + TRAFFIC_JAM_WIDEN_SILENCE_TICKS);
  });

  it('clears the pending event', () => {
    const s = setup(3);
    resolve(s, 1);
    expect(s.state.events.pendingEvent).toBeNull();
  });

  it('a passage jam (no ramp) cannot widen: no charge, no order, _alt result', () => {
    const s = setup(3, 1_000_000, null);
    const cash = s.state.cash;
    const result = resolve(s, 1);
    expect(s.state.cash).toBe(cash);
    expect(s.state.plannedRamps).toHaveLength(0);
    expect(result!.resultKey.endsWith('_alt')).toBe(true);
  });

  it('an already-widest ramp cannot widen: no charge, no order, _alt result', () => {
    const s = setup(7);
    const cash = s.state.cash;
    const result = resolve(s, 1);
    expect(s.state.cash).toBe(cash);
    expect(s.state.plannedRamps).toHaveLength(0);
    expect(result!.resultKey.endsWith('_alt')).toBe(true);
  });

  it('without a grid it fails cleanly: no charge, no order, _alt result', () => {
    const s = setup(3);
    const cash = s.state.cash;
    const result = resolve(s, 1, true, null);
    expect(s.state.cash).toBe(cash);
    expect(s.state.plannedRamps).toHaveLength(0);
    expect(result!.resultKey.endsWith('_alt')).toBe(true);
  });

  it('with insufficient cash it fails cleanly: no charge, no order, _alt result', () => {
    const s = setup(3, 1);
    const result = resolve(s, 1);
    expect(s.state.cash).toBe(1);
    expect(s.state.plannedRamps).toHaveLength(0);
    expect(result!.resultKey.endsWith('_alt')).toBe(true);
  });

  it('a failed widen still clears the pending event', () => {
    const s = setup(7);
    resolve(s, 1);
    expect(s.state.events.pendingEvent).toBeNull();
  });
});

describe('traffic_jam — ignore_jam (option 2)', () => {
  it('drops wellBeing by the ignore penalty', () => {
    const s = setup();
    const before = s.state.scores.wellBeing;
    resolve(s, 2);
    expect(s.state.scores.wellBeing).toBe(before - TRAFFIC_JAM_IGNORE_WELLBEING_PENALTY);
    expect(s.state.events.lastOutcome!.effects).toContainEqual(
      { kind: 'score', key: 'wellBeing', delta: -TRAFFIC_JAM_IGNORE_WELLBEING_PENALTY },
    );
  });

  it('silences the chokepoint for the ignore duration', () => {
    const s = setup();
    resolve(s, 2);
    expect(s.state.events.jamSilencedUntil[s.jam.key]).toBe(TICK + TRAFFIC_JAM_IGNORE_SILENCE_TICKS);
  });

  it('does not touch cash or the agents', () => {
    const s = setup();
    const cash = s.state.cash;
    resolve(s, 2);
    expect(s.state.cash).toBe(cash);
    const e = s.state.employees.employees.find(x => x.id === s.jam.agentIds[0])!;
    expect(e.vehicleWaitingTicks).toBe(20);
  });
});

describe('traffic_jam — resolveEvent edges', () => {
  it('resolves without a world argument (no jam effects applied, event cleared)', () => {
    const s = setup();
    const result = resolve(s, 0, false);
    expect(result).not.toBeNull();
    expect(s.state.events.pendingEvent).toBeNull();
  });

  it('returns null for an out-of-range option', () => {
    const s = setup();
    expect(resolve(s, 3)).toBeNull();
    expect(resolve(s, -1)).toBeNull();
    expect(s.state.events.pendingEvent).not.toBeNull();
  });

  it('the widen option carries no fixed cashDelta of its own', () => {
    const s = setup(3);
    const cash = s.state.cash;
    const cost = (validateWidenRamp(s.ramp, 5, cash) as { data: { cost: number } }).data.cost;
    resolve(s, 1);
    expect(cash - s.state.cash).toBe(cost);
    expect(cash - s.state.cash).not.toBe(15000 + cost);
  });
});
