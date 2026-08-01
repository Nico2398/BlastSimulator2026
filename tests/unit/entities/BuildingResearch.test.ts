// BlastSimulator2026 — Red-phase tests: Research Center gameplay loop (#442)
//
// Covers: hasActiveResearchCenter, isConditionMet, getUnmetConditions,
//         queueResearchTask (3-arg, placement-gated + condition-gated),
//         tickResearch, isTierUnlocked, isResearchQueued.
//
// WHY THESE TESTS FAIL (Red phase):
//   BuildingResearch.ts's exported functions are stubs — hasActiveResearchCenter
//   always returns false, isConditionMet/getUnmetConditions never report a
//   condition as met, and queueResearchTask always returns { success: false }
//   with no code. Every test below that expects success or a specific `code`
//   value fails against the stub.
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBuildingState,
  placeBuilding,
  type BuildingState,
  type BuildingType,
} from '../../../src/core/entities/Building.js';
import {
  hasActiveResearchCenter,
  isConditionMet,
  getUnmetConditions,
  queueResearchTask,
  getQueueBlockCode,
  tickResearch,
  isTierUnlocked,
  isResearchQueued,
  type ResearchCondition,
  type ResearchTask,
} from '../../../src/core/entities/BuildingResearch.js';
import { RESEARCH_TASK_DEFS, getResearchTaskDef } from '../../../src/core/config/balance.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshState(): BuildingState {
  return createBuildingState();
}

/** Place an active tier-1 research_center at (x, z), asserting the setup call itself succeeds. */
function placeResearchCenter(state: BuildingState, x = 40, z = 40): void {
  const result = placeBuilding(state, 'research_center', x, z, 64, 64);
  if (!result.success) {
    throw new Error(`test setup: failed to place research_center: ${result.error}`);
  }
}

/** Push a raw building instance directly into state, bypassing placeBuilding's research gate. */
function pushRawBuilding(state: BuildingState, type: BuildingType, tier: 1 | 2 | 3, x: number, z: number, active = true): void {
  state.buildings.push({ id: state.nextId++, type, tier, x, z, hp: 100, active });
}

// ── Section 1: hasActiveResearchCenter ───────────────────────────────────────

describe('hasActiveResearchCenter', () => {
  it('is false on a freshly created (empty) BuildingState', () => {
    const state = freshState();
    expect(hasActiveResearchCenter(state)).toBe(false);
  });

  it('is false when only other building types are placed', () => {
    const state = freshState();
    placeBuilding(state, 'living_quarters', 0, 0, 64, 64);
    placeBuilding(state, 'vehicle_depot', 10, 10, 64, 64);
    expect(hasActiveResearchCenter(state)).toBe(false);
  });

  it('is true once an active research_center is placed', () => {
    const state = freshState();
    placeResearchCenter(state);
    expect(hasActiveResearchCenter(state)).toBe(true);
  });

  it('is false when the only research_center present is inactive', () => {
    const state = freshState();
    placeResearchCenter(state);
    state.buildings[0]!.active = false;
    expect(hasActiveResearchCenter(state)).toBe(false);
  });

  it('is true when at least one of several research_centers is active', () => {
    const state = freshState();
    placeResearchCenter(state, 0, 0);
    placeResearchCenter(state, 20, 20);
    state.buildings[0]!.active = false; // first one destroyed, second still active
    expect(hasActiveResearchCenter(state)).toBe(true);
  });
});

// ── Section 2: isConditionMet / getUnmetConditions ───────────────────────────

describe('isConditionMet — building_tier', () => {
  it('is false when no building of the required type exists', () => {
    const state = freshState();
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'vehicle_depot', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);
  });

  it('is false when the building exists only at a lower tier', () => {
    const state = freshState();
    placeBuilding(state, 'vehicle_depot', 0, 0, 64, 64, 1);
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'vehicle_depot', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);
  });

  it('is true when a building of exactly the required tier is placed and active', () => {
    const state = freshState();
    pushRawBuilding(state, 'vehicle_depot', 2, 0, 0);
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'vehicle_depot', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(true);
  });

  it('is false when the matching-tier building is inactive', () => {
    const state = freshState();
    pushRawBuilding(state, 'vehicle_depot', 2, 0, 0, false);
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'vehicle_depot', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);
  });

  it('does not consider a building of a different type, even at the required tier', () => {
    const state = freshState();
    pushRawBuilding(state, 'living_quarters', 2, 0, 0); // different type, same tier
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'vehicle_depot', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);
  });
});

describe('isConditionMet — research_completed', () => {
  it('is false on a fresh state (nothing researched)', () => {
    const state = freshState();
    const condition: ResearchCondition = { kind: 'research_completed', buildingType: 'driving_center', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);
  });

  it('is true once the referenced type/tier has been researched (unlockedTiers set)', () => {
    const state = freshState();
    state.unlockedTiers['driving_center'] = 2;
    const condition: ResearchCondition = { kind: 'research_completed', buildingType: 'driving_center', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(true);
  });

  it('is false for tier 3 when only tier 2 has been researched', () => {
    const state = freshState();
    state.unlockedTiers['driving_center'] = 2;
    const condition: ResearchCondition = { kind: 'research_completed', buildingType: 'driving_center', tier: 3 };
    expect(isConditionMet(state, condition)).toBe(false);
  });

  it('cross-type: a condition referencing one building type is unaffected by a DIFFERENT type being researched', () => {
    const state = freshState();
    // living_quarters tier 2 is fully researched...
    state.unlockedTiers['living_quarters'] = 2;
    // ...but the condition asks about vehicle_depot — must still be unmet.
    const condition: ResearchCondition = { kind: 'research_completed', buildingType: 'vehicle_depot', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);

    // Once vehicle_depot itself is researched, the SAME condition object becomes met —
    // proving the mechanism reads `condition.buildingType`, not some hard-coded type.
    state.unlockedTiers['vehicle_depot'] = 2;
    expect(isConditionMet(state, condition)).toBe(true);
  });
});

describe('getUnmetConditions', () => {
  it('returns an empty array when given an empty conditions list', () => {
    const state = freshState();
    expect(getUnmetConditions(state, [])).toEqual([]);
  });

  it('returns the full list when none of the conditions are met', () => {
    const state = freshState();
    const conditions: ResearchCondition[] = [
      { kind: 'research_completed', buildingType: 'driving_center', tier: 2 },
      { kind: 'building_tier', buildingType: 'vehicle_depot', tier: 2 },
    ];
    expect(getUnmetConditions(state, conditions)).toEqual(conditions);
  });

  it('returns an empty array when every condition is met', () => {
    const state = freshState();
    state.unlockedTiers['driving_center'] = 2;
    pushRawBuilding(state, 'vehicle_depot', 2, 0, 0);
    const conditions: ResearchCondition[] = [
      { kind: 'research_completed', buildingType: 'driving_center', tier: 2 },
      { kind: 'building_tier', buildingType: 'vehicle_depot', tier: 2 },
    ];
    expect(getUnmetConditions(state, conditions)).toEqual([]);
  });

  it('returns only the subset that is unmet, in original order', () => {
    const state = freshState();
    state.unlockedTiers['driving_center'] = 2; // this one is met
    const unmetCondition: ResearchCondition = { kind: 'building_tier', buildingType: 'vehicle_depot', tier: 2 }; // this one is not
    const conditions: ResearchCondition[] = [
      { kind: 'research_completed', buildingType: 'driving_center', tier: 2 },
      unmetCondition,
    ];
    expect(getUnmetConditions(state, conditions)).toEqual([unmetCondition]);
  });
});

// ── Section 3: queueResearchTask ─────────────────────────────────────────────

describe('queueResearchTask — placement prerequisite', () => {
  let state: BuildingState;
  beforeEach(() => { state = freshState(); });

  it('rejects with no_research_center when no research_center is placed anywhere', () => {
    const result = queueResearchTask(state, 'driving_center', 2);
    expect(result.success).toBe(false);
    expect(result.code).toBe('no_research_center');
    expect(state.researchQueue).toHaveLength(0);
  });

  it('rejects with no_research_center even when other buildings ARE placed', () => {
    placeBuilding(state, 'living_quarters', 0, 0, 64, 64);
    placeBuilding(state, 'vehicle_depot', 10, 10, 64, 64);
    const result = queueResearchTask(state, 'driving_center', 2);
    expect(result.success).toBe(false);
    expect(result.code).toBe('no_research_center');
  });

  it('rejects with no_research_center when the only research_center present is inactive', () => {
    placeResearchCenter(state);
    state.buildings[0]!.active = false;
    const result = queueResearchTask(state, 'driving_center', 2);
    expect(result.success).toBe(false);
    expect(result.code).toBe('no_research_center');
  });
});

describe('queueResearchTask — tier 2 (first upgrade): cost-only', () => {
  let state: BuildingState;
  beforeEach(() => {
    state = freshState();
    placeResearchCenter(state);
  });

  it('succeeds on cost alone, for any building type, even though conditions are []', () => {
    for (const type of Object.keys(RESEARCH_TASK_DEFS) as BuildingType[]) {
      const s = freshState();
      placeResearchCenter(s);
      const result = queueResearchTask(s, type, 2);
      expect(result.success, `${type}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('pushes a task with ticksRemaining 0 and an empty conditions array', () => {
    queueResearchTask(state, 'driving_center', 2);
    const task: ResearchTask = state.researchQueue[0]!;
    expect(task.targetType).toBe('driving_center');
    expect(task.targetTier).toBe(2);
    expect(task.ticksRemaining).toBe(0);
    expect(task.conditions).toEqual([]);
    expect(task.cost).toBe(getResearchTaskDef('driving_center', 2).cost);
  });

  it('reports the cost from RESEARCH_TASK_DEFS on success', () => {
    const result = queueResearchTask(state, 'geology_lab', 2);
    expect(result.cost).toBe(getResearchTaskDef('geology_lab', 2).cost);
  });
});

describe('queueResearchTask — tier 3: cost + duration + conditions', () => {
  let state: BuildingState;
  beforeEach(() => {
    state = freshState();
    placeResearchCenter(state);
  });

  it("rejects with conditions_not_met when the type's own tier-2 research has not completed", () => {
    const result = queueResearchTask(state, 'vehicle_depot', 3);
    expect(result.success).toBe(false);
    expect(result.code).toBe('conditions_not_met');
    expect(state.researchQueue).toHaveLength(0);
  });

  it('rejects with conditions_not_met even when a tier-2 building of that type is already physically placed', () => {
    // Physically placed via raw insertion (bypassing the research gate) — proves that
    // PHYSICAL presence of a tier-2 building is not the same as the tier-2 research
    // being COMPLETED. Only unlockedTiers (set by tickResearch) satisfies the condition.
    pushRawBuilding(state, 'vehicle_depot', 2, 0, 0);
    expect(isTierUnlocked(state, 'vehicle_depot', 2)).toBe(false);

    const result = queueResearchTask(state, 'vehicle_depot', 3);
    expect(result.success).toBe(false);
    expect(result.code).toBe('conditions_not_met');
  });

  it("succeeds once the type's own tier-2 research has completed", () => {
    const t2 = queueResearchTask(state, 'vehicle_depot', 2);
    expect(t2.success, JSON.stringify(t2)).toBe(true);
    tickResearch(state); // tier-2 is 0-ticks — completes on the very next tick
    expect(isTierUnlocked(state, 'vehicle_depot', 2)).toBe(true);

    const result = queueResearchTask(state, 'vehicle_depot', 3);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('pushes a task whose ticksRemaining and conditions match RESEARCH_TASK_DEFS exactly', () => {
    queueResearchTask(state, 'explosive_warehouse', 2);
    tickResearch(state);

    queueResearchTask(state, 'explosive_warehouse', 3);
    const task = state.researchQueue[0]!;
    const def = getResearchTaskDef('explosive_warehouse', 3);
    expect(task.ticksRemaining).toBe(def.ticks);
    expect(task.conditions).toEqual(def.conditions);
    expect(task.cost).toBe(def.cost);
  });

  it("does not satisfy the condition via a DIFFERENT type's completed tier-2 research", () => {
    // Complete tier-2 research for a different building type entirely.
    queueResearchTask(state, 'living_quarters', 2);
    tickResearch(state);
    expect(isTierUnlocked(state, 'living_quarters', 2)).toBe(true);

    // vehicle_depot's own tier-2 research is still outstanding.
    const result = queueResearchTask(state, 'vehicle_depot', 3);
    expect(result.success).toBe(false);
    expect(result.code).toBe('conditions_not_met');
  });
});

describe('queueResearchTask — already_unlocked / already_queued', () => {
  let state: BuildingState;
  beforeEach(() => {
    state = freshState();
    placeResearchCenter(state);
  });

  it('rejects with already_unlocked when the tier has already been researched', () => {
    state.unlockedTiers['driving_center'] = 2;
    const result = queueResearchTask(state, 'driving_center', 2);
    expect(result.success).toBe(false);
    expect(result.code).toBe('already_unlocked');
  });

  it('rejects with already_queued when the same {type, tier} is already pending', () => {
    queueResearchTask(state, 'driving_center', 2);
    const result = queueResearchTask(state, 'driving_center', 2);
    expect(result.success).toBe(false);
    expect(result.code).toBe('already_queued');
    expect(state.researchQueue).toHaveLength(1);
  });

  it('allows queuing a different tier of the same type while one is pending', () => {
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state); // completes tier-2 (0 ticks)
    const result = queueResearchTask(state, 'driving_center', 3);
    expect(result.success, JSON.stringify(result)).toBe(true);
  });
});

// ── Section 4: precedence between rejection codes ────────────────────────────
//
// Only the checks queueResearchTask can decide from BuildingState alone are
// covered here (no_research_center, already_unlocked, already_queued,
// conditions_not_met). insufficient_funds depends on GameState.cash, which
// this function does not receive — that precedence is covered at the console
// layer in tests/integration/research.integration.test.ts.

describe('queueResearchTask — rejection precedence', () => {
  it('no_research_center wins over already_unlocked', () => {
    const state = freshState();
    // Tier already researched, but no research_center placed at all.
    state.unlockedTiers['driving_center'] = 2;
    const result = queueResearchTask(state, 'driving_center', 2);
    expect(result.code).toBe('no_research_center');
  });

  it('no_research_center wins over already_queued', () => {
    const state = freshState();
    // Manually fabricate an "already queued" state without a research_center present.
    state.researchQueue.push({ targetType: 'driving_center', targetTier: 2, ticksRemaining: 0, cost: 5000, conditions: [] });
    const result = queueResearchTask(state, 'driving_center', 2);
    expect(result.code).toBe('no_research_center');
  });

  it('already_unlocked wins over already_queued', () => {
    const state = freshState();
    placeResearchCenter(state);
    state.unlockedTiers['driving_center'] = 2;
    // Fabricate a leftover queued entry for the same {type, tier} even though it's unlocked.
    state.researchQueue.push({ targetType: 'driving_center', targetTier: 2, ticksRemaining: 0, cost: 5000, conditions: [] });

    const result = queueResearchTask(state, 'driving_center', 2);
    expect(result.code).toBe('already_unlocked');
  });

  it('already_queued wins over conditions_not_met', () => {
    const state = freshState();
    placeResearchCenter(state);
    // vehicle_depot tier-3's own condition (tier-2 research completed) is NOT met...
    expect(isTierUnlocked(state, 'vehicle_depot', 2)).toBe(false);
    // ...but fabricate an existing queued entry for the same {type, tier}.
    state.researchQueue.push({ targetType: 'vehicle_depot', targetTier: 3, ticksRemaining: 50, cost: 12000, conditions: [] });

    const result = queueResearchTask(state, 'vehicle_depot', 3);
    expect(result.code).toBe('already_queued');
  });
});

// ── Section 4b: getQueueBlockCode — shared read-only precedence chain (#442 refactor) ──
// queueResearchTask (above) and the console `research queue` command both delegate
// their read-only precondition checks to this single helper — see BuildingResearch.ts.

describe('getQueueBlockCode', () => {
  it('returns undefined when every read-only precondition passes (happy path)', () => {
    const state = freshState();
    placeResearchCenter(state);
    expect(getQueueBlockCode(state, 'driving_center', 2)).toBeUndefined();
  });

  it('returns "no_research_center" when no active research_center is placed (boundary)', () => {
    const state = freshState();
    expect(getQueueBlockCode(state, 'driving_center', 2)).toBe('no_research_center');
  });

  it('returns "already_unlocked" when the target tier is already unlocked (rejection)', () => {
    const state = freshState();
    placeResearchCenter(state);
    state.unlockedTiers['driving_center'] = 2;
    expect(getQueueBlockCode(state, 'driving_center', 2)).toBe('already_unlocked');
  });

  it('returns "already_queued" when the target {type, tier} already sits in the queue', () => {
    const state = freshState();
    placeResearchCenter(state);
    state.researchQueue.push({ targetType: 'driving_center', targetTier: 2, ticksRemaining: 0, cost: 5000, conditions: [] });
    expect(getQueueBlockCode(state, 'driving_center', 2)).toBe('already_queued');
  });

  it('returns "conditions_not_met" when the task\'s own prerequisites are unmet', () => {
    const state = freshState();
    placeResearchCenter(state);
    expect(isTierUnlocked(state, 'vehicle_depot', 2)).toBe(false);
    expect(getQueueBlockCode(state, 'vehicle_depot', 3)).toBe('conditions_not_met');
  });

  it('matches the precedence order queueResearchTask itself enforces', () => {
    const state = freshState();
    // Fabricate a state where multiple block reasons apply at once; the two
    // functions must agree on which one wins.
    state.unlockedTiers['driving_center'] = 2;
    const blockCode = getQueueBlockCode(state, 'driving_center', 2);
    const queueResult = queueResearchTask(state, 'driving_center', 2);
    expect(queueResult.code).toBe(blockCode);
  });
});

// ── Section 5: demolished research_center does not interrupt an in-flight task ──

describe('queueResearchTask / tickResearch — research center check is queue-time only', () => {
  it('a task queued while a research_center exists keeps progressing after the center is removed', () => {
    const state = freshState();
    placeResearchCenter(state);

    // Complete tier-2 first so tier-3's condition is satisfiable.
    queueResearchTask(state, 'vehicle_depot', 2);
    tickResearch(state);

    const t3 = queueResearchTask(state, 'vehicle_depot', 3);
    expect(t3.success, JSON.stringify(t3)).toBe(true);
    const ticksNeeded = getResearchTaskDef('vehicle_depot', 3).ticks;
    expect(ticksNeeded).toBeGreaterThan(0);

    // Demolish the research_center entirely — no active center remains.
    state.buildings.splice(0, state.buildings.length);
    expect(hasActiveResearchCenter(state)).toBe(false);

    // The in-flight task must still progress and complete on schedule.
    for (let i = 0; i < ticksNeeded; i++) tickResearch(state);
    expect(isTierUnlocked(state, 'vehicle_depot', 3)).toBe(true);
    expect(state.researchQueue).toHaveLength(0);
  });
});

// ── Section 6: tickResearch (pre-existing behavior, retained) ────────────────

describe('tickResearch', () => {
  let state: BuildingState;
  beforeEach(() => {
    state = freshState();
    placeResearchCenter(state);
  });

  it('does nothing when the queue is empty', () => {
    expect(() => tickResearch(state)).not.toThrow();
    expect(state.researchQueue).toHaveLength(0);
  });

  it('decrements ticksRemaining of the first (tier-3) task by 1 per tick', () => {
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state); // completes tier-2 instantly
    queueResearchTask(state, 'driving_center', 3);

    const before = state.researchQueue[0]!.ticksRemaining;
    tickResearch(state);
    expect(state.researchQueue[0]!.ticksRemaining).toBe(before - 1);
  });

  it('only decrements the head task, leaving subsequent tasks unchanged', () => {
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state);
    queueResearchTask(state, 'driving_center', 3);
    queueResearchTask(state, 'blasting_academy', 2);

    const headBefore = state.researchQueue[0]!.ticksRemaining;
    const tailBefore = state.researchQueue[1]!.ticksRemaining;
    tickResearch(state);

    expect(state.researchQueue[0]!.ticksRemaining).toBe(headBefore - 1);
    expect(state.researchQueue[1]!.ticksRemaining).toBe(tailBefore);
  });

  it('removes the completed task from the queue when ticksRemaining reaches 0', () => {
    queueResearchTask(state, 'driving_center', 2); // 0 ticks — completes immediately
    tickResearch(state);
    expect(state.researchQueue).toHaveLength(0);
  });

  it('sets unlockedTiers[targetType] to targetTier when the task completes', () => {
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state);
    expect(state.unlockedTiers['driving_center']).toBe(2);
  });

  it('advances to the next queued task after the first completes', () => {
    queueResearchTask(state, 'driving_center', 2);
    queueResearchTask(state, 'blasting_academy', 2);
    tickResearch(state); // first (0-tick) task completes and is removed

    expect(state.researchQueue).toHaveLength(1);
    expect(state.researchQueue[0]!.targetType).toBe('blasting_academy');
  });
});

// ── Section 7: isTierUnlocked (pre-existing behavior, retained) ─────────────

describe('isTierUnlocked', () => {
  it('tier 1 is always unlocked regardless of unlockedTiers contents', () => {
    const state = freshState();
    expect(isTierUnlocked(state, 'driving_center', 1)).toBe(true);
  });

  it('tier 2 is NOT unlocked for a building with no unlock record', () => {
    const state = freshState();
    expect(isTierUnlocked(state, 'driving_center', 2)).toBe(false);
  });

  it('tier 2 is unlocked when unlockedTiers[type] is set to 2', () => {
    const state = freshState();
    state.unlockedTiers['geology_lab'] = 2;
    expect(isTierUnlocked(state, 'geology_lab', 2)).toBe(true);
  });

  it('unlock for one building type does not affect another type', () => {
    const state = freshState();
    state.unlockedTiers['geology_lab'] = 3;
    expect(isTierUnlocked(state, 'driving_center', 2)).toBe(false);
  });
});

// ── Section 8: isResearchQueued (pre-existing behavior, retained) ───────────

describe('isResearchQueued', () => {
  let state: BuildingState;
  beforeEach(() => {
    state = freshState();
    placeResearchCenter(state);
  });

  it('is false for a type+tier that has no queued task', () => {
    expect(isResearchQueued(state, 'driving_center', 2)).toBe(false);
  });

  it('is true once a matching {type, tier} task is queued', () => {
    queueResearchTask(state, 'driving_center', 2);
    expect(isResearchQueued(state, 'driving_center', 2)).toBe(true);
  });

  it('is false for the same type but a different tier', () => {
    queueResearchTask(state, 'driving_center', 2);
    expect(isResearchQueued(state, 'driving_center', 3)).toBe(false);
  });

  it('is false again once the matching task is removed from the queue (e.g. completed)', () => {
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state); // completes and shifts the task off the queue
    expect(isResearchQueued(state, 'driving_center', 2)).toBe(false);
  });
});
