// BlastSimulator2026 — Effects of the player's answer to an unqualified-task event (#1380)
//
// Each option does what its outcome text says to the actions the event was
// raised for: cancel them, finish them with a contractor, or book a course.

import type { ActionType, PendingAction } from '../state/GameState.js';
import type { SkillCategory } from '../entities/Employee.js';
import { createEmployeeState, hireEmployee, isEligibleForWork } from '../entities/Employee.js';
import { availableTrainingOffers, enrolInTraining, planTraining } from '../entities/EmployeeTraining.js';
import { cancelAction } from '../engine/TaskDispatch.js';
import { applyTaskCompletion } from '../engine/TaskCompletionEffects.js';
import { completePendingAction } from '../engine/TaskLifecycleCore.js';
import { emitFootprintRegionChanged } from '../engine/BuildingTaskHelpers.js';
import { addExpense, addIncome } from '../economy/Finance.js';
import { Random } from '../math/Random.js';
import { EventEmitter } from '../state/EventEmitter.js';
import { UNQUALIFIED_CONTRACTOR_FEE } from '../config/balance.js';
import type { EffectOutcome, EventWorld } from './TrafficJamEffects.js';

/** Resolves an unqualified_task event choice for the actions it concerns. */
type UnqualifiedEffectHandler = (
  actionIds: readonly number[],
  world: EventWorld,
  tick: number,
) => EffectOutcome;

const outcome = (over: Partial<EffectOutcome> = {}): EffectOutcome => ({
  effects: [],
  cashChange: 0,
  cashSettled: 0,
  scoreChanges: {},
  resultKeySuffix: '',
  ...over,
});

const alt = (): EffectOutcome => outcome({ resultKeySuffix: '_alt' });

function pendingActionsOf(world: EventWorld, ids: readonly number[]): PendingAction[] {
  const found: PendingAction[] = [];
  for (const id of ids) {
    const action = world.state.pendingActions.find(a => a.id === id);
    if (action) found.push(action);
  }
  return found;
}

const cancelTask: UnqualifiedEffectHandler = (ids, world) => {
  const { state, grid, emitter } = world;
  let cancelled = 0;
  let refunded = 0;
  for (const action of pendingActionsOf(world, ids)) {
    const result = cancelAction(state, action.id);
    if (!result.success) continue;
    const freed = result.freedFootprint;
    if (freed && grid && emitter) {
      emitFootprintRegionChanged(emitter, grid, freed.x, freed.z, freed.sizeX, freed.sizeZ);
    }
    cancelled++;
    refunded += result.refunded ?? 0;
  }
  return outcome({
    effects: cancelled > 0 ? [`Cancelled ${cancelled} task${cancelled === 1 ? '' : 's'}`] : [],
    cashSettled: refunded,
  });
};

/** Action types whose completion effects the contractor may apply (those applyTaskCompletion owns). */
const CONTRACTOR_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'general_work', 'survey', 'drill_hole', 'charge_hole', 'place_building', 'level_ground',
]);
/** Of those, the ones whose effect lands in the voxel grid and so cannot be done without one. */
const NEEDS_GRID: ReadonlySet<ActionType> = new Set<ActionType>(['survey', 'level_ground']);

const hireContractor: UnqualifiedEffectHandler = (ids, world, tick) => {
  const { state, grid } = world;
  const emitter = world.emitter ?? new EventEmitter();
  let completed = 0;
  for (const action of pendingActionsOf(world, ids)) {
    if (!CONTRACTOR_ACTIONS.has(action.type)) continue;
    if (NEEDS_GRID.has(action.type) && !grid) continue;
    // A one-off visitor: not on the roster, earns no XP, only does the work.
    const { employee: contractor } = hireEmployee(
      createEmployeeState(), 'manager', new Random(state.seed + tick + action.id), action.targetX, action.targetZ, tick,
    );
    contractor.id = -1;
    contractor.qualifications = action.requiredSkill === null
      ? []
      : [{ category: action.requiredSkill, proficiencyLevel: 1, xp: 0 }];
    applyTaskCompletion(state, grid, contractor, {
      completed: true,
      leveledUp: false,
      skill: null,
      levelUps: [],
      actionType: action.type,
      actionPayload: action.payload,
      actionId: action.id,
    }, emitter);
    completePendingAction(state, action.id);
    completed++;
  }
  if (completed === 0) {
    // Nothing the contractor could do: the fee the option already booked is returned.
    addIncome(state.finances, UNQUALIFIED_CONTRACTOR_FEE, 'refund', 'Contractor not needed', tick);
    return outcome({ cashChange: UNQUALIFIED_CONTRACTOR_FEE, resultKeySuffix: '_alt' });
  }
  return outcome({ effects: [`Contractor completed ${completed} task${completed === 1 ? '' : 's'}`] });
};

const trainEmployee: UnqualifiedEffectHandler = (ids, world, tick) => {
  const { state } = world;
  const skill: SkillCategory | null =
    pendingActionsOf(world, ids).find(a => a.requiredSkill !== null)?.requiredSkill ?? null;
  if (skill === null) return alt();
  const offer = availableTrainingOffers(state.buildings.buildings).find(o => o.skill === skill);
  if (!offer) return alt();

  const candidates = state.employees.employees
    .filter(e => isEligibleForWork(e) && !e.pendingTrainingState)
    .sort((a, b) => a.id - b.id);
  for (const emp of candidates) {
    const plan = planTraining(emp, skill, offer.building.tier);
    if (!plan || state.cash < plan.fee) continue;
    const result = enrolInTraining(state, emp.id, offer.building, skill, world.emitter);
    if (!result.success) continue;
    state.cash -= plan.fee;
    addExpense(state.finances, plan.fee, 'salaries', `Train ${emp.name}: ${skill}`, tick);
    return outcome({ effects: [`${emp.name} sent to train ${skill}`], cashSettled: -plan.fee });
  }
  return alt();
};

export const UNQUALIFIED_TASK_EFFECTS: Record<string, UnqualifiedEffectHandler> = {
  cancel_task: cancelTask,
  hire_contractor: hireContractor,
  train_employee: trainEmployee,
};
