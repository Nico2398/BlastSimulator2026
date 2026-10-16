// @vitest-environment jsdom
// BlastSimulator2026 — the vehicle inspector's driver/upgrade/scrap/repair pieces
// (moved out of fleetDetailSections.ts by #1767; shared with the Fleet card until then).
import { describe, it, expect, vi } from 'vitest';
import { vehicleDisplayName } from '../../../../../src/ui/fleetDetailSections.js';
import {
  upgradeState, licenceWarning, scrapConfirmConfig, driverState, repairState,
  makePendingDriverRow, makeNoDriverRow, makeDriverRow,
} from '../../../../../src/ui/panels/inspector/vehicleDetailParts.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';
import type { Vehicle } from '../../../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../../../src/core/entities/Employee.js';

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

describe('vehicleDetailParts — makeDriverRow', () => {
  it('shows the real driver name when driverId matches a roster employee', () => {
    const state = makeState([], [makeEmployee({ id: 6, name: 'Dorian Kask' })]);
    const row = makeDriverRow(makeVehicle({ occupantIds: [6] }), state);
    expect(row.textContent).toContain('Dorian Kask');
  });

  it('falls back to "#<driverId>" when no roster employee matches driverId', () => {
    const state = makeState([], [makeEmployee({ id: 6, name: 'Dorian Kask' })]);
    const row = makeDriverRow(makeVehicle({ occupantIds: [99] }), state);
    expect(row.textContent).toContain('#99');
    expect(row.textContent).not.toContain('Dorian Kask');
  });
});

import { computeVehicleUpgradeCost } from '../../../../../src/core/entities/VehicleUpgrade.js';
import { computeScrapResidualValue } from '../../../../../src/core/entities/Vehicle.js';
import type { PendingAction } from '../../../../../src/core/state/GameState.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';
import { t } from '../../../../../src/core/i18n/I18n.js';

function licensed(overrides: Partial<Employee> = {}, level: 1 | 2 | 3 = 1): Employee {
  return makeEmployee({ qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0, licenceLevel: level }], ...overrides });
}

describe('vehicleDetailParts — upgradeState', () => {
  it('is available and affordable with enough cash, carrying the price difference', () => {
    const cost = computeVehicleUpgradeCost('debris_hauler', 1)!;
    expect(upgradeState({ type: 'debris_hauler', tier: 1 }, cost)).toEqual({ available: true, affordable: true, cost });
  });

  it('is available but unaffordable one dollar short', () => {
    const cost = computeVehicleUpgradeCost('debris_hauler', 1)!;
    expect(upgradeState({ type: 'debris_hauler', tier: 1 }, cost - 1)).toEqual({ available: true, affordable: false, cost });
  });

  it('is unavailable at the maximum tier, with no cost', () => {
    expect(upgradeState({ type: 'debris_hauler', tier: 3 }, 9_999_999)).toEqual({ available: false, affordable: false, cost: null });
  });
});

describe('vehicleDetailParts — licenceWarning', () => {
  it('warns when nobody on the roster can drive the next tier', () => {
    const w = licenceWarning({ type: 'debris_hauler', tier: 1 }, [licensed({}, 1)]);
    expect(w).not.toBeNull();
    expect(w!.key).toBe('ui.fleet.upgrade_licence_warning');
  });

  it('is null once a living employee holds the next tier licence', () => {
    expect(licenceWarning({ type: 'debris_hauler', tier: 1 }, [licensed({}, 2)])).toBeNull();
  });

  it('ignores a dead licence holder', () => {
    expect(licenceWarning({ type: 'debris_hauler', tier: 1 }, [licensed({ alive: false }, 3)])).not.toBeNull();
  });

  it('is null at the maximum tier, where no upgrade exists', () => {
    expect(licenceWarning({ type: 'debris_hauler', tier: 3 }, [])).toBeNull();
  });
});

describe('vehicleDetailParts — scrapConfirmConfig', () => {
  it('names the vehicle and the residual value in the body', () => {
    const v = makeVehicle({ hp: 60 });
    const cfg = scrapConfirmConfig(v, () => {});
    const residual = computeScrapResidualValue(v.type, v.tier, v.hp);
    expect(cfg.title).toBe(t('ui.fleet.scrap_confirm_title'));
    expect(cfg.body).toBe(t('ui.fleet.scrap_confirm_body', { name: vehicleDisplayName(v.type, v.tier), amount: formatMoney(residual) }));
    expect(cfg.confirmLabel).toBe(t('ui.fleet.scrap'));
  });

  it('confirming runs the scrap console command for that vehicle', () => {
    const run = vi.fn();
    scrapConfirmConfig(makeVehicle({ id: 12 }), run).onConfirm();
    expect(run).toHaveBeenCalledWith('vehicle scrap 12');
  });

  it('does not run anything until confirmed', () => {
    const run = vi.fn();
    scrapConfirmConfig(makeVehicle(), run);
    expect(run).not.toHaveBeenCalled();
  });

  it('a wrecked vehicle shows a lower residual than a pristine one', () => {
    const pristine = scrapConfirmConfig(makeVehicle({ hp: 100 }), () => {}).body;
    const wrecked = scrapConfirmConfig(makeVehicle({ hp: 0 }), () => {}).body;
    expect(wrecked).not.toBe(pristine);
  });
});

describe('vehicleDetailParts — driverState', () => {
  it('is driver when an employee is aboard', () => {
    const e = licensed({ id: 6, name: 'Dorian Kask' });
    const state = makeState([], [e]);
    const s = driverState(makeVehicle({ occupantIds: [6] }), state);
    expect(s.kind).toBe('driver');
    if (s.kind === 'driver') expect(s.employee.id).toBe(6);
  });

  it('is pending when an employee is walking to board this vehicle', () => {
    const e = licensed({ id: 6, pendingDriverVehicleId: 1 });
    const state = makeState([], [e]);
    const s = driverState(makeVehicle({ id: 1 }), state);
    expect(s.kind).toBe('pending');
    if (s.kind === 'pending') expect(s.employee.id).toBe(6);
  });

  it('is unmanned when nobody drives but a licensed employee exists', () => {
    const state = makeState([], [licensed({ id: 6 })]);
    expect(driverState(makeVehicle(), state).kind).toBe('unmanned');
  });

  it('is no_licensed when nobody on the roster holds the licence', () => {
    const state = makeState([], [makeEmployee({ id: 6 })]);
    expect(driverState(makeVehicle(), state).kind).toBe('no_licensed');
  });

  it('a pending walker for another vehicle does not count', () => {
    const state = makeState([], [licensed({ id: 6, pendingDriverVehicleId: 2 })]);
    expect(driverState(makeVehicle({ id: 1 }), state).kind).toBe('unmanned');
  });
});

describe('vehicleDetailParts — driver rows with a link factory', () => {
  it('makeDriverRow renders the name as a clickable link when a link callback is given', () => {
    const state = makeState([], [makeEmployee({ id: 6, name: 'Dorian Kask' })]);
    const link = vi.fn();
    const row = makeDriverRow(makeVehicle({ occupantIds: [6] }), state, link);
    const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent === 'Dorian Kask');
    expect(btn).toBeDefined();
    btn!.click();
    expect(link).toHaveBeenCalledWith(6);
  });

  it('makeDriverRow stays plain text without a link callback', () => {
    const state = makeState([], [makeEmployee({ id: 6, name: 'Dorian Kask' })]);
    expect(makeDriverRow(makeVehicle({ occupantIds: [6] }), state).querySelector('button')).toBeNull();
  });

  it('makePendingDriverRow links the walking employee when a callback is given', () => {
    const link = vi.fn();
    const row = makePendingDriverRow(makeEmployee({ id: 8, name: 'Pip Walker' }), link);
    const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent === 'Pip Walker');
    expect(btn).toBeDefined();
    btn!.click();
    expect(link).toHaveBeenCalledWith(8);
  });

  it('makeNoDriverRow keeps its Train button routing to crew', () => {
    const onCrew = vi.fn();
    const state = makeState([], [makeEmployee({ id: 6 })]);
    const row = makeNoDriverRow(makeVehicle(), state, onCrew);
    const train = Array.from(row.querySelectorAll('button')).find(b => b.textContent === t('ui.fleet.train_someone'));
    train!.click();
    expect(onCrew).toHaveBeenCalledTimes(1);
  });
});

describe('vehicleDetailParts — repairState', () => {
  const order = (overrides: Partial<PendingAction> = {}): PendingAction => ({
    id: 3, type: 'repair_vehicle', requiredSkill: null, requiredVehicleRole: null,
    targetX: 0, targetZ: 0, targetY: 0, payload: { vehicleId: 1 }, targetEmployeeId: null,
    status: 'in_progress', holderId: 6, queuedAtTick: 0, ...overrides,
  });

  it('needs no repair at full HP and has no action', () => {
    expect(repairState(makeVehicle({ hp: 100 }), [])).toEqual({ action: null, needsRepair: false });
  });

  it('needs repair when damaged but not wrecked', () => {
    expect(repairState(makeVehicle({ hp: 40 }), []).needsRepair).toBe(true);
  });

  it('returns the repair order covering this vehicle', () => {
    const a = order();
    const s = repairState(makeVehicle({ hp: 40 }), [a]);
    expect(s.action).toBe(a);
  });

  it('ignores repair orders for other vehicles and other action types', () => {
    const other = order({ payload: { vehicleId: 2 } });
    const haul = order({ id: 4, type: 'haul_debris', payload: { vehicleId: 1 } });
    expect(repairState(makeVehicle({ hp: 40 }), [other, haul]).action).toBeNull();
  });

  it('a wrecked vehicle (hp 0) still needs repair when an order exists', () => {
    const s = repairState(makeVehicle({ hp: 0 }), [order({ status: 'queued' })]);
    expect(s.action).not.toBeNull();
  });
});
