// @vitest-environment jsdom
// BlastSimulator2026 — branch coverage for fleetDetailSections.ts's card-piece
// builders. FleetPanel.test.ts exercises these indirectly through the whole
// panel and only ever hits one leg of each of makeHpGauge's/makeLoadGauge's/
// makeDriverRow's ternaries — this file targets the legs it misses.
import { describe, it, expect } from 'vitest';
import { makeHpGauge, makeLoadGauge, makeStatusChip, makeDriverNameLine } from '../../../src/ui/fleetDetailSections.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 5, z: 5, hp: 100,
    cargo: [],
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
    const row = makeLoadGauge(makeVehicle({ type: 'debris_hauler', cargo: [] }))!;
    const fill = row.querySelector('.bsx-gauge-fill') as HTMLElement;
    const value = row.querySelector('.bsx-gauge-value') as HTMLElement;
    expect(fill.style.width).toBe('0%');
    expect(value.textContent).toBe('0 / 4000 kg');
  });

  it('reports the real percentage (fill width) and kg / capacity for a loaded payload', () => {
    // debris_hauler tier1 capacity is 4000kg (VEHICLE_BASE_STATS, #1370) — 2000kg is 50%.
    const row = makeLoadGauge(makeVehicle({
      type: 'debris_hauler', tier: 1, cargo: [{ fragmentId: 7, massKg: 2000 }],
    }))!;
    const fill = row.querySelector('.bsx-gauge-fill') as HTMLElement;
    const value = row.querySelector('.bsx-gauge-value') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(value.textContent).toBe('2000 / 4000 kg');
  });

  it('clamps the fill width at 100% when payload mass exceeds rated capacity (#1092)', () => {
    // debris_hauler tier1 capacity is 4000kg — 5000kg overshoots it, which a
    // real fleet can reach mid-haul (a fragment heavier than the estimate
    // used at load time). The percentage shown must never exceed 100.
    const row = makeLoadGauge(makeVehicle({
      type: 'debris_hauler', tier: 1, cargo: [{ fragmentId: 7, massKg: 5000 }],
    }))!;
    const fill = row.querySelector('.bsx-gauge-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('sums every cargo item into the load gauge (#1370)', () => {
    const row = makeLoadGauge(makeVehicle({
      type: 'debris_hauler', tier: 1,
      cargo: [{ fragmentId: 1, massKg: 500 }, { fragmentId: 2, massKg: 700 }, { fragmentId: 3, massKg: 800 }],
    }))!;
    const fill = row.querySelector('.bsx-gauge-fill') as HTMLElement;
    const value = row.querySelector('.bsx-gauge-value') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(value.textContent).toBe('2000 / 4000 kg');
  });

  it('clamps a multi-item load heavier than capacity at 100% (#1370)', () => {
    const row = makeLoadGauge(makeVehicle({
      type: 'debris_hauler', tier: 1,
      cargo: [{ fragmentId: 1, massKg: 3000 }, { fragmentId: 2, massKg: 3000 }],
    }))!;
    expect((row.querySelector('.bsx-gauge-fill') as HTMLElement).style.width).toBe('100%');
  });

  it('shows tier 2 capacity of 6400 kg (#1370)', () => {
    const row = makeLoadGauge(makeVehicle({
      type: 'debris_hauler', tier: 2, cargo: [{ fragmentId: 1, massKg: 3200 }],
    }))!;
    expect((row.querySelector('.bsx-gauge-fill') as HTMLElement).style.width).toBe('50%');
    expect((row.querySelector('.bsx-gauge-value') as HTMLElement).textContent).toBe('3200 / 6400 kg');
  });
});

// ── makeStatusChip (#1138: vehicleState threads through to the reservation
// lookup computeVehicleStatus's hauling branch needs) ──────────────────────

describe('fleetDetailSections — makeStatusChip', () => {
  it('reports idle with no occupant and no reservation', () => {
    const state = makeState([makeVehicle()], []);
    const chip = makeStatusChip(makeVehicle(), state.vehicles);
    expect(chip.textContent).toContain('Idle');
  });

  it('reports broken for hp <= 0, regardless of vehicleState/occupant', () => {
    const state = makeState([], []);
    const chip = makeStatusChip(makeVehicle({ hp: 0 }), state.vehicles);
    expect(chip.textContent).toContain('Broken');
  });

  it('reports hauling for a debris_hauler with an active reservation, via vehicleState', () => {
    const vehicle = makeVehicle({ id: 3, type: 'debris_hauler' });
    const state = makeState([vehicle], [makeEmployee({ id: 6 })]);
    vehicle.occupantIds = [6];
    state.vehicles.reservations.push({ vehicleId: vehicle.id, actionId: 1 });
    const occupant = state.employees.employees.find(e => e.id === 6);
    const chip = makeStatusChip(vehicle, state.vehicles, occupant);
    expect(chip.textContent).toContain('Hauling');
  });
});

// ── makeDriverNameLine (#1767): the Fleet row's one-line driver readout ──

describe('fleetDetailSections — makeDriverNameLine', () => {
  it('carries the bs-fleet-driver class hook', () => {
    const line = makeDriverNameLine(makeVehicle(), []);
    expect(line.classList.contains('bs-fleet-driver')).toBe(true);
  });

  it('shows the driver name from the seat', () => {
    const line = makeDriverNameLine(makeVehicle({ occupantIds: [6] }), [makeEmployee({ id: 6, name: 'Dorian Kask' })]);
    expect(line.textContent).toContain('Dorian Kask');
    expect(line.textContent).not.toContain('Unmanned');
  });

  it('shows the pending driver walking to the vehicle', () => {
    const line = makeDriverNameLine(
      makeVehicle({ id: 2 }),
      [makeEmployee({ id: 8, name: 'Pip Walker', pendingDriverVehicleId: 2 })],
    );
    expect(line.textContent).toContain('Pip Walker');
  });

  it('ignores a pending walker bound for another vehicle', () => {
    const line = makeDriverNameLine(
      makeVehicle({ id: 2 }),
      [makeEmployee({ id: 8, name: 'Pip Walker', pendingDriverVehicleId: 5 })],
    );
    expect(line.textContent).not.toContain('Pip Walker');
    expect(line.textContent).toContain('Unmanned');
  });

  it('reads Unmanned (muted) with no driver and no pending walker', () => {
    const line = makeDriverNameLine(makeVehicle(), [makeEmployee({ id: 6 })]);
    expect(line.textContent).toContain('Unmanned');
    expect(line.classList.contains('bs-fleet-driver')).toBe(true);
  });

  it('never warns or offers Train, even when nobody holds the licence', () => {
    const line = makeDriverNameLine(makeVehicle({ type: 'drill_rig' }), []);
    expect(line.textContent).toContain('Unmanned');
    expect(line.textContent).not.toContain('Nobody is licensed');
    expect(line.querySelector('button')).toBeNull();
  });

  it('is plain text: no button even with a driver', () => {
    const line = makeDriverNameLine(makeVehicle({ occupantIds: [6] }), [makeEmployee({ id: 6 })]);
    expect(line.querySelector('button')).toBeNull();
  });

  it('falls back to "#<id>" when the seated driver is not on the roster', () => {
    const line = makeDriverNameLine(makeVehicle({ occupantIds: [99] }), []);
    expect(line.textContent).toContain('#99');
  });
});
