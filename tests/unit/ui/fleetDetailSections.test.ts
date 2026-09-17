// @vitest-environment jsdom
// BlastSimulator2026 — branch coverage for fleetDetailSections.ts's card-piece
// builders. FleetPanel.test.ts exercises these indirectly through the whole
// panel and only ever hits one leg of each of makeHpGauge's/makeLoadGauge's/
// makeDriverRow's ternaries — this file targets the legs it misses.
import { describe, it, expect } from 'vitest';
import { makeHpGauge, makeLoadGauge, makeDriverRow } from '../../../src/ui/fleetDetailSections.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 5, z: 5, hp: 100, task: 'idle',
    targetX: 5, targetZ: 5, driverId: null, state: 'idle', payload: null,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    reservedForActionId: null, pendingEvacuationDestination: null,
    occupantIds: [],
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Dorian Kask', role: 'driver', salary: 400, morale: 60,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, activeActionId: null,
    fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0,
    restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null,
    pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [],
    locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  };
}

function makeState(vehicles: Vehicle[] = [], employees: Employee[] = []): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.vehicles.vehicles = vehicles;
  state.vehicles.nextId = vehicles.length + 1;
  state.employees.employees = employees;
  return state;
}

describe('fleetDetailSections — makeHpGauge', () => {
  // debris_hauler tier1 maxHp is 100 (VEHICLE_BASE_STATS), so hp doubles as pct here.

  it('colors the gauge positive-green above 50%', () => {
    const gauge = makeHpGauge(makeVehicle({ hp: 90 }));
    const value = gauge.querySelector('.bsx-gauge-value') as HTMLElement;
    expect(value.textContent).toBe('90');
    expect(value.style.color).toBe('var(--bsx-positive)');
  });

  it('colors the gauge amber between 21% and 50%', () => {
    const gauge = makeHpGauge(makeVehicle({ hp: 50 }));
    const value = gauge.querySelector('.bsx-gauge-value') as HTMLElement;
    expect(value.textContent).toBe('50');
    expect(value.style.color).toBe('var(--bsx-amber)');
  });

  it('colors the gauge critical-red at or below 20%', () => {
    const gauge = makeHpGauge(makeVehicle({ hp: 10 }));
    const value = gauge.querySelector('.bsx-gauge-value') as HTMLElement;
    expect(value.textContent).toBe('10');
    expect(value.style.color).toBe('var(--bsx-critical)');
  });
});

describe('fleetDetailSections — makeLoadGauge', () => {
  it('returns null for a non-hauler role', () => {
    expect(makeLoadGauge(makeVehicle({ type: 'drill_rig' }))).toBeNull();
  });

  it('reports 0% (fill width) and 0kg / capacity with no payload', () => {
    const row = makeLoadGauge(makeVehicle({ type: 'debris_hauler', payload: null }))!;
    const fill = row.querySelector('.bsx-gauge-fill') as HTMLElement;
    const value = row.querySelector('.bsx-gauge-value') as HTMLElement;
    expect(fill.style.width).toBe('0%');
    expect(value.textContent).toBe('0 / 200 kg');
  });

  it('reports the real percentage (fill width) and kg / capacity for a loaded payload', () => {
    // debris_hauler tier1 capacity is 200kg (VEHICLE_BASE_STATS) — 100kg is 50%.
    const row = makeLoadGauge(makeVehicle({
      type: 'debris_hauler', tier: 1, payload: { fragmentId: 7, massKg: 100 },
    }))!;
    const fill = row.querySelector('.bsx-gauge-fill') as HTMLElement;
    const value = row.querySelector('.bsx-gauge-value') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(value.textContent).toBe('100 / 200 kg');
  });

  it('clamps the fill width at 100% when payload mass exceeds rated capacity (#1092)', () => {
    // debris_hauler tier1 capacity is 200kg — 500kg overshoots it, which a
    // real fleet can reach mid-haul (a fragment heavier than the estimate
    // used at load time). The percentage shown must never exceed 100.
    const row = makeLoadGauge(makeVehicle({
      type: 'debris_hauler', tier: 1, payload: { fragmentId: 7, massKg: 500 },
    }))!;
    const fill = row.querySelector('.bsx-gauge-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });
});

describe('fleetDetailSections — makeDriverRow', () => {
  it('shows the real driver name when driverId matches a roster employee', () => {
    const state = makeState([], [makeEmployee({ id: 6, name: 'Dorian Kask' })]);
    const row = makeDriverRow(makeVehicle({ driverId: 6 }), state);
    expect(row.textContent).toContain('Dorian Kask');
  });

  it('falls back to "#<driverId>" when no roster employee matches driverId', () => {
    const state = makeState([], [makeEmployee({ id: 6, name: 'Dorian Kask' })]);
    const row = makeDriverRow(makeVehicle({ driverId: 99 }), state);
    expect(row.textContent).toContain('#99');
    expect(row.textContent).not.toContain('Dorian Kask');
  });
});
