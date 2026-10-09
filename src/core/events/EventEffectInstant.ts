// BlastSimulator2026 — Instant (non-timed) event effect handlers (#1414)

import type { Random } from '../math/Random.js';
import type { Employee, EmployeeRole } from '../entities/Employee.js';
import type { EventEffectSpec } from './EventEffectCatalog.js';
import type { EffectOutcome, EventWorld } from './TrafficJamEffects.js';
import { getLivingEmployees, hireEmployee, injureEmployee } from '../entities/Employee.js';
import { hireSpawnPoint } from '../entities/HireSpawn.js';
import { fireEmployeeFromWorld } from '../engine/TaskCancellation.js';
import { offerSpecialContract, outstandingPenalty } from '../economy/Contract.js';
import { chargeFine, deductExpense } from '../economy/Finance.js';
import { resolveContractOres, resolveContractPriceMultiplier } from '../campaign/Level.js';
import {
  EVENT_EFFECT_FATIGUE_RELIEF_LEVEL, EVENT_EFFECT_JOIN_DEFAULT_ROLE, EVENT_EFFECT_SPECIAL_CONTRACT_PRICE_BONUS,
} from '../config/balance.js';

const outcome = (over: Partial<EffectOutcome> = {}): EffectOutcome => ({
  effects: [], cashChange: 0, cashSettled: 0, scoreChanges: {}, resultKeySuffix: '', ...over,
});
const alt = (): EffectOutcome => outcome({ resultKeySuffix: '_alt' });

type SpecOf<T extends EventEffectSpec['type']> = Extract<EventEffectSpec, { type: T }>;

/** The employee an employee_leaves spec picks, or undefined when nobody matches. */
function pickLeaver(spec: SpecOf<'employee_leaves'>, staff: Employee[], rng: Random): Employee | undefined {
  const pool = spec.pick === 'role' ? staff.filter(e => e.role === spec.role) : staff;
  if (pool.length === 0) return undefined;
  if (spec.pick === 'junior') {
    // Most recently hired; ids only grow, so the highest id breaks a same-tick tie.
    return pool.reduce((a, b) => ((b.hiredAtTick ?? 0) > (a.hiredAtTick ?? 0) || ((b.hiredAtTick ?? 0) === (a.hiredAtTick ?? 0) && b.id > a.id) ? b : a));
  }
  return pool[rng.nextInt(0, pool.length - 1)];
}

/** Applies one instant spec (hire, leave, injury, bonus, contract change, ...). */
export function applyInstantEffect(
  spec: EventEffectSpec, world: EventWorld, tick: number, rng: Random,
): EffectOutcome {
  const { state } = world;
  const staff = getLivingEmployees(state.employees.employees);
  switch (spec.type) {
    case 'employee_leaves': {
      const leaver = pickLeaver(spec, staff, rng);
      // Unionised staff are protected from the fire command; events may still take them.
      if (!leaver || !fireEmployeeFromWorld(state, leaver.id, { force: true }).success) return alt();
      return outcome();
    }
    case 'employee_joins': {
      const role: EmployeeRole = spec.role ?? EVENT_EFFECT_JOIN_DEFAULT_ROLE;
      const { x, z } = hireSpawnPoint(state);
      hireEmployee(state.employees, role, rng, x, z, tick);
      return outcome();
    }
    case 'employee_injured': {
      const healthy = staff.filter(e => !e.injured);
      const victim = healthy[rng.nextInt(0, healthy.length - 1)];
      return victim && injureEmployee(state.employees, victim.id) ? outcome() : alt();
    }
    case 'fatigue_relief':
      for (const e of staff) e.fatigue = Math.max(e.fatigue, EVENT_EFFECT_FATIGUE_RELIEF_LEVEL);
      return outcome();
    case 'bonus_per_employee': {
      const total = spec.amount * staff.length;
      if (total <= 0) return outcome();
      deductExpense(state, total, 'salaries', 'Event bonus');
      return outcome({ cashSettled: -total });
    }
    case 'special_contract':
      offerSpecialContract(
        state.contracts, rng, resolveContractPriceMultiplier(state) * EVENT_EFFECT_SPECIAL_CONTRACT_PRICE_BONUS, resolveContractOres(state),
      );
      return outcome();
    case 'cancel_contract': {
      const open = state.contracts.active.filter(c => !c.completed && !c.expired);
      const target = open[rng.nextInt(0, open.length - 1)];
      if (!target) return alt();
      state.contracts.active.splice(state.contracts.active.indexOf(target), 1);
      target.expired = true;
      state.contracts.completedHistory.push(target);
      if (!spec.penalty) return outcome();
      const penalty = outstandingPenalty(target);
      target.penaltyCharged = penalty;
      chargeFine(state, penalty, 'Cancelled contract penalty', tick);
      return outcome({ cashSettled: -penalty });
    }
    default:
      return outcome();
  }
}
