// VehicleWorkProgress — unit tests (#2226)
// The fraction of work a mounted employee does from a vehicle: the timed task's own fraction, else the haul
// load dwell of the itinerary leg being served (#2199), else nothing to show.

import { describe, it, expect } from 'vitest';
import { mountedWorkFraction } from '../../../../src/core/entities/VehicleWorkProgress.js';
import { hireEmployee, createEmployeeState } from '../../../../src/core/entities/Employee.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import { createVehicleState } from '../../../../src/core/entities/Vehicle.js';
import type { Itinerary, Leg } from '../../../../src/core/engine/Itinerary.js';
import { Random } from '../../../../src/core/math/Random.js';

function makeMounted(overrides: Partial<Employee> = {}): Employee {
  const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(42), 0, 0);
  return Object.assign(employee, { locomotion: { kind: 'mounted', vehicleId: 1 } }, overrides);
}

function leg(overrides: Partial<Leg> = {}): Leg {
  return {
    mode: 'drive', vehicleId: 1, destX: 5, destZ: 5, arrival: 'exact',
    onArrive: { kind: 'effect', effectId: 'haul_load' }, estTicks: 6,
    ...overrides,
  };
}

function itinerary(...legs: Leg[]): Itinerary {
  return { legs, goal: { kind: 'work', actionId: 1 }, workTicks: 0, estTotalTicks: 10 };
}

const vs = createVehicleState();

describe('mountedWorkFraction — timed task', () => {
  it('is 0 when the task has just started', () => {
    const e = makeMounted({ taskTicksRemaining: 20, activeTaskTotalTicks: 20, pendingActionType: 'drill_hole' });
    expect(mountedWorkFraction(e, vs)).toBeCloseTo(0, 6);
  });

  it('is the completed share partway through', () => {
    const e = makeMounted({ taskTicksRemaining: 5, activeTaskTotalTicks: 20, pendingActionType: 'drill_hole' });
    expect(mountedWorkFraction(e, vs)).toBeCloseTo(0.75, 6);
  });

  it('grows as ticksRemaining shrinks', () => {
    const early = makeMounted({ taskTicksRemaining: 15, activeTaskTotalTicks: 20, pendingActionType: 'charge_hole' });
    const late = makeMounted({ taskTicksRemaining: 3, activeTaskTotalTicks: 20, pendingActionType: 'charge_hole' });
    expect(mountedWorkFraction(late, vs)!).toBeGreaterThan(mountedWorkFraction(early, vs)!);
  });

  it('is 1 on the last tick', () => {
    const e = makeMounted({ taskTicksRemaining: 0, activeTaskTotalTicks: 20, pendingActionType: 'drill_hole' });
    expect(mountedWorkFraction(e, vs)).toBeCloseTo(1, 6);
  });

  it('takes the task fraction over a haul dwell', () => {
    const e = makeMounted({
      taskTicksRemaining: 10, activeTaskTotalTicks: 20, pendingActionType: 'drill_hole',
      itinerary: itinerary(leg({ dwellTicks: 4, dwellLeft: 1 })),
    });
    expect(mountedWorkFraction(e, vs)).toBeCloseTo(0.5, 6);
  });

  it('is null for a timer with no recorded total (old save), absent a dwell', () => {
    const e = makeMounted({ taskTicksRemaining: 5, pendingActionType: 'drill_hole' });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });

  it('is null for place_building (the site carries that bar), absent a dwell', () => {
    const e = makeMounted({ taskTicksRemaining: 5, activeTaskTotalTicks: 20, pendingActionType: 'place_building' });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });
});

describe('mountedWorkFraction — haul load dwell (#2199)', () => {
  it('is (dwellTicks - dwellLeft) / dwellTicks for the first leg', () => {
    const e = makeMounted({ itinerary: itinerary(leg({ dwellTicks: 4, dwellLeft: 1 })) });
    expect(mountedWorkFraction(e, vs)).toBeCloseTo(0.75, 6);
  });

  it('is 0 when the countdown has just started', () => {
    const e = makeMounted({ itinerary: itinerary(leg({ dwellTicks: 4, dwellLeft: 4 })) });
    expect(mountedWorkFraction(e, vs)).toBeCloseTo(0, 6);
  });

  it('is 1 when the countdown has run out', () => {
    const e = makeMounted({ itinerary: itinerary(leg({ dwellTicks: 4, dwellLeft: 0 })) });
    expect(mountedWorkFraction(e, vs)).toBeCloseTo(1, 6);
  });

  it('is null while the countdown has not started (no dwellLeft)', () => {
    const e = makeMounted({ itinerary: itinerary(leg({ dwellTicks: 4 })) });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });

  it('is null for a leg with no dwell', () => {
    const e = makeMounted({ itinerary: itinerary(leg()) });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });

  it('is null for a zero-tick dwell', () => {
    const e = makeMounted({ itinerary: itinerary(leg({ dwellTicks: 0, dwellLeft: 0 })) });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });

  it('reads only the first leg: a later leg mid-dwell shows nothing', () => {
    const e = makeMounted({ itinerary: itinerary(leg(), leg({ dwellTicks: 4, dwellLeft: 1 })) });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });

  it('uses the first leg even when a later leg also dwells', () => {
    const e = makeMounted({ itinerary: itinerary(leg({ dwellTicks: 10, dwellLeft: 5 }), leg({ dwellTicks: 4, dwellLeft: 1 })) });
    expect(mountedWorkFraction(e, vs)).toBeCloseTo(0.5, 6);
  });

  it('is null for an itinerary with no legs', () => {
    const e = makeMounted({ itinerary: itinerary() });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });
});

describe('mountedWorkFraction — nothing to show', () => {
  it('is null for an idle mounted employee', () => {
    expect(mountedWorkFraction(makeMounted(), vs)).toBeNull();
  });

  it('is null for a mounted employee only driving (itinerary, no dwell, no timer)', () => {
    const e = makeMounted({ itinerary: itinerary(leg({ onArrive: { kind: 'none' } })) });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });

  it('is null for a fragment action with no work timer', () => {
    const e = makeMounted({ pendingActionType: 'fragment_debris', itinerary: itinerary(leg({ onArrive: { kind: 'effect', effectId: 'boulder_split' } })) });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });

  it('is null once the work ends (timer cleared, itinerary gone)', () => {
    const e = makeMounted({ taskTicksRemaining: null, itinerary: null, pendingActionType: 'drill_hole' });
    expect(mountedWorkFraction(e, vs)).toBeNull();
  });
});
