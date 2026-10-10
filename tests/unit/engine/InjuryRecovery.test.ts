// BlastSimulator2026 — Tests for injury recovery (#1382).
// An injured employee recovers over INJURY_RECOVERY_TICKS of progress: 1/tick on foot,
// faster inside living quarters (rate by tier). Healed ones leave the building.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { injuryRecoveryRate, tickInjuryRecovery } from '../../../src/core/engine/InjuryRecovery.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import {
  hireEmployee,
  injureEmployee,
  killEmployee,
  getEffectiveness,
  type Employee,
} from '../../../src/core/entities/Employee.js';
import { placeBuilding, getBuildingPeopleCapacity } from '../../../src/core/entities/Building.js';
import {
  INJURY_RECOVERY_TICKS,
  INJURY_ON_FOOT_RECOVERY_RATE,
  INJURY_RECOVERY_RATE_BY_LQ_TIER,
} from '../../../src/core/config/balance.js';

const SEED = 42;

function setup(): { state: GameState; emp: Employee } {
  const state = createGame({ seed: SEED });
  const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 0, 0);
  return { state, emp: employee };
}

function injure(state: GameState, emp: Employee): void {
  injureEmployee(state.employees, emp.id);
}

/** Put the employee inside the building by hand (the same state Mount.enterBuilding leaves). */
function putInside(state: GameState, emp: Employee, buildingId: number): void {
  const b = state.buildings.buildings.find(x => x.id === buildingId)!;
  b.occupantIds.push(emp.id);
  emp.locomotion = { kind: 'inside', buildingId };
  emp.itinerary = null;
}

function placeLq(state: GameState, tier: 1 | 2 | 3 = 1) {
  const r = placeBuilding(state.buildings, 'living_quarters', 20, 20, 100, 100, 1);
  if (!('building' in r) || !r.building) throw new Error('placement failed');
  // Higher tiers are research-gated; set the tier directly (the unit under test reads it).
  r.building.tier = tier;
  return r.building;
}

describe('injuryRecoveryRate', () => {
  it('returns the on-foot rate when no living quarters', () => {
    expect(injuryRecoveryRate(null)).toBe(INJURY_ON_FOOT_RECOVERY_RATE);
    expect(injuryRecoveryRate(null)).toBe(1);
  });

  it.each([1, 2, 3] as const)('returns the configured rate for tier %i', tier => {
    expect(injuryRecoveryRate(tier)).toBe(INJURY_RECOVERY_RATE_BY_LQ_TIER[tier]);
  });

  it('is strictly increasing with tier and always above on-foot', () => {
    expect(injuryRecoveryRate(1)).toBeGreaterThan(injuryRecoveryRate(null));
    expect(injuryRecoveryRate(2)).toBeGreaterThan(injuryRecoveryRate(1));
    expect(injuryRecoveryRate(3)).toBeGreaterThan(injuryRecoveryRate(2));
  });
});

describe('tickInjuryRecovery — on foot, no living quarters', () => {
  it('heals after exactly INJURY_RECOVERY_TICKS calls', () => {
    const { state, emp } = setup();
    injure(state, emp);
    for (let i = 0; i < INJURY_RECOVERY_TICKS - 1; i++) tickInjuryRecovery(state);
    expect(emp.injured).toBe(true);
    expect(emp.injuryTicksRemaining).toBe(1);
    tickInjuryRecovery(state);
    expect(emp.injured).toBe(false);
    expect(emp.injuryTicksRemaining).toBeUndefined();
  });

  it('countdown drops by the on-foot rate each tick', () => {
    const { state, emp } = setup();
    injure(state, emp);
    tickInjuryRecovery(state);
    expect(emp.injuryTicksRemaining).toBe(INJURY_RECOVERY_TICKS - INJURY_ON_FOOT_RECOVERY_RATE);
  });

  it('effectiveness is 0 while injured and positive once healed', () => {
    const { state, emp } = setup();
    injure(state, emp);
    expect(getEffectiveness(emp)).toBe(0);
    for (let i = 0; i < INJURY_RECOVERY_TICKS; i++) tickInjuryRecovery(state);
    expect(getEffectiveness(emp)).toBeGreaterThan(0);
  });

  it('does not restore the morale lost to the injury', () => {
    const { state, emp } = setup();
    emp.morale = 80;
    injure(state, emp);
    for (let i = 0; i < INJURY_RECOVERY_TICKS; i++) tickInjuryRecovery(state);
    expect(emp.morale).toBe(60);
  });
});

describe('tickInjuryRecovery — untouched employees', () => {
  it('ignores a healthy employee', () => {
    const { state, emp } = setup();
    tickInjuryRecovery(state);
    expect(emp.injured).toBe(false);
    expect(emp.injuryTicksRemaining).toBeUndefined();
  });

  it('ignores a dead employee', () => {
    const { state, emp } = setup();
    injure(state, emp);
    killEmployee(state.employees, emp.id);
    tickInjuryRecovery(state);
    expect(emp.alive).toBe(false);
    expect(emp.injuryTicksRemaining).toBeUndefined();
  });

  it('does not set a counter on an employee that is dead but still flagged injured', () => {
    const { state, emp } = setup();
    emp.alive = false;
    emp.injured = true;
    tickInjuryRecovery(state);
    expect(emp.injuryTicksRemaining).toBeUndefined();
  });
});

describe('tickInjuryRecovery — legacy injured employee without a counter', () => {
  it('backfills the counter then heals after INJURY_RECOVERY_TICKS calls', () => {
    const { state, emp } = setup();
    emp.injured = true;
    delete emp.injuryTicksRemaining;
    tickInjuryRecovery(state);
    expect(emp.injured).toBe(true);
    expect(emp.injuryTicksRemaining).toBeDefined();
    expect(emp.injuryTicksRemaining!).toBeGreaterThan(0);
    for (let i = 0; i < INJURY_RECOVERY_TICKS; i++) tickInjuryRecovery(state);
    expect(emp.injured).toBe(false);
  });
});

describe('tickInjuryRecovery — living quarters', () => {
  it('routes an injured employee to a living quarters with a free bed', () => {
    const { state, emp } = setup();
    const lq = placeLq(state);
    injure(state, emp);
    tickInjuryRecovery(state);
    expect(emp.itinerary).not.toBeNull();
    const last = emp.itinerary!.legs[emp.itinerary!.legs.length - 1]!;
    expect(JSON.stringify(last)).toContain('enter_building');
    expect(JSON.stringify(emp.itinerary)).toContain(`${lq.id}`);
  });

  it.each([1, 2, 3] as const)('inside a tier-%i living quarters the counter drops by the tier rate', tier => {
    const { state, emp } = setup();
    const lq = placeLq(state, tier);
    injure(state, emp);
    putInside(state, emp, lq.id);
    tickInjuryRecovery(state);
    expect(emp.injuryTicksRemaining).toBe(INJURY_RECOVERY_TICKS - INJURY_RECOVERY_RATE_BY_LQ_TIER[tier]);
  });

  it('heals sooner inside living quarters than on foot', () => {
    const { state, emp } = setup();
    const lq = placeLq(state, 3);
    injure(state, emp);
    putInside(state, emp, lq.id);
    const ticks = Math.ceil(INJURY_RECOVERY_TICKS / INJURY_RECOVERY_RATE_BY_LQ_TIER[3]);
    for (let i = 0; i < ticks; i++) tickInjuryRecovery(state);
    expect(emp.injured).toBe(false);
    expect(ticks).toBeLessThan(INJURY_RECOVERY_TICKS);
  });

  it('on heal the employee leaves the building and is on foot, no longer injured', () => {
    const { state, emp } = setup();
    const lq = placeLq(state, 3);
    injure(state, emp);
    putInside(state, emp, lq.id);
    const ticks = Math.ceil(INJURY_RECOVERY_TICKS / INJURY_RECOVERY_RATE_BY_LQ_TIER[3]);
    for (let i = 0; i < ticks; i++) tickInjuryRecovery(state);
    expect(emp.injured).toBe(false);
    expect(emp.locomotion).toEqual({ kind: 'on_foot' });
    expect(lq.occupantIds).not.toContain(emp.id);
    expect(emp.injured).toBe(false);
  });

  it('with the living quarters full, recovers in place at the on-foot rate', () => {
    const { state, emp } = setup();
    const lq = placeLq(state);
    const cap = getBuildingPeopleCapacity(lq.type, lq.tier);
    for (let i = 0; i < cap; i++) lq.occupantIds.push(10_000 + i);
    injure(state, emp);
    tickInjuryRecovery(state);
    expect(emp.itinerary).toBeNull();
    expect(emp.locomotion).toEqual({ kind: 'on_foot' });
    expect(emp.injuryTicksRemaining).toBe(INJURY_RECOVERY_TICKS - INJURY_ON_FOOT_RECOVERY_RATE);
  });
});

describe('tickInjuryRecovery — interrupting held work', () => {
  it('drops the active action of an injured employee with no rest in progress', () => {
    const { state, emp } = setup();
    injure(state, emp);
    emp.activeActionId = 999;
    emp.restTicksRemaining = null;
    tickInjuryRecovery(state);
    expect(emp.activeActionId).toBeNull();
  });

  it('keeps the active action while resting', () => {
    const { state, emp } = setup();
    injure(state, emp);
    emp.activeActionId = 999;
    emp.restTicksRemaining = 5;
    tickInjuryRecovery(state);
    expect(emp.activeActionId).toBe(999);
  });
});

describe('tickInjuryRecovery — bed seeking guards', () => {
  it('does not replan when the employee already has an itinerary', () => {
    const { state, emp } = setup();
    placeLq(state);
    injure(state, emp);
    tickInjuryRecovery(state);
    const itinerary = emp.itinerary;
    expect(itinerary).not.toBeNull();
    tickInjuryRecovery(state);
    expect(emp.itinerary).toBe(itinerary);
  });

  it('does not seek a second bed when already inside living quarters', () => {
    const { state, emp } = setup();
    const lq = placeLq(state);
    injure(state, emp);
    putInside(state, emp, lq.id);
    tickInjuryRecovery(state);
    expect(emp.itinerary).toBeNull();
    expect(emp.locomotion).toEqual({ kind: 'inside', buildingId: lq.id });
  });

  it('recovers in place at rate 1 while mounted', () => {
    const { state, emp } = setup();
    placeLq(state);
    injure(state, emp);
    emp.locomotion = { kind: 'mounted', vehicleId: 12345 };
    tickInjuryRecovery(state);
    expect(emp.itinerary).toBeNull();
    expect(emp.injuryTicksRemaining).toBe(INJURY_RECOVERY_TICKS - 1);
  });

  it('recovers at rate 1 without crashing when no living quarters exists', () => {
    const { state, emp } = setup();
    injure(state, emp);
    expect(() => tickInjuryRecovery(state)).not.toThrow();
    expect(emp.itinerary).toBeNull();
    expect(emp.injuryTicksRemaining).toBe(INJURY_RECOVERY_TICKS - 1);
  });
});

describe('runTick pipeline — injury recovery', () => {
  it('injured employee never shows fatigue 0 / morale 0 and heals at the expected tick', () => {
    const { state, emp } = setup();
    emp.morale = 100;
    injure(state, emp);
    const emitter = new EventEmitter();
    let healedAt = -1;
    for (let i = 1; i <= 250; i++) {
      runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
      if (emp.alive) {
        expect(emp.fatigue).toBeGreaterThan(0);
        expect(emp.morale).toBeGreaterThan(0);
      }
      if (!emp.injured && healedAt < 0) healedAt = i;
    }
    expect(healedAt).toBe(INJURY_RECOVERY_TICKS);
  });

  it('injured employee fatigue and morale stay held while injured', () => {
    const { state, emp } = setup();
    emp.morale = 90;
    injure(state, emp);
    const fatigue = emp.fatigue;
    const morale = emp.morale;
    const emitter = new EventEmitter();
    for (let i = 0; i < 10; i++) {
      runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
    }
    expect(emp.injured).toBe(true);
    expect(emp.fatigue).toBe(fatigue);
    expect(emp.morale).toBe(morale);
  });
});

describe('tickInjuryRecovery emits employee:left_building on healing (#1588)', () => {
  it('announces the healed employee leaving their living quarters', () => {
    const { state, emp } = setup();
    const lq = placeLq(state);
    injure(state, emp);
    putInside(state, emp, lq.id);
    emp.injuryTicksRemaining = 1;
    const emitter = new EventEmitter();
    const left: unknown[] = [];
    emitter.on('employee:left_building', e => left.push(e));

    tickInjuryRecovery(state, emitter);

    expect(emp.injured).toBe(false);
    expect(left).toEqual([{ employeeId: emp.id, buildingId: lq.id }]);
  });
});
