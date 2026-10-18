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

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  getResearchProgress,
  isTierUnlocked,
  isResearchQueued,
  getResearchCenterProfile,
  getActiveResearchTasks,
  type ResearchCondition,
  type ResearchTask,
} from '../../../src/core/entities/BuildingResearch.js';
import { RESEARCH_TASK_DEFS, RESEARCH_CENTER_SPEED_BY_TIER, RESEARCH_CENTER_SLOTS_BY_TIER, getResearchTaskDef } from '../../../src/core/config/balance.js';

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
  state.buildings.push({ id: state.nextId++, type, tier, x, z, hp: 100, active, occupantIds: [] });
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
    placeBuilding(state, 'geology_lab', 10, 10, 64, 64);
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
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'geology_lab', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);
  });

  it('is false when the building exists only at a lower tier', () => {
    const state = freshState();
    placeBuilding(state, 'geology_lab', 0, 0, 64, 64, 1);
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'geology_lab', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);
  });

  it('is true when a building of exactly the required tier is placed and active', () => {
    const state = freshState();
    pushRawBuilding(state, 'geology_lab', 2, 0, 0);
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'geology_lab', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(true);
  });

  it('is false when the matching-tier building is inactive', () => {
    const state = freshState();
    pushRawBuilding(state, 'geology_lab', 2, 0, 0, false);
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'geology_lab', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);
  });

  it('does not consider a building of a different type, even at the required tier', () => {
    const state = freshState();
    pushRawBuilding(state, 'living_quarters', 2, 0, 0); // different type, same tier
    const condition: ResearchCondition = { kind: 'building_tier', buildingType: 'geology_lab', tier: 2 };
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
    // ...but the condition asks about geology_lab — must still be unmet.
    const condition: ResearchCondition = { kind: 'research_completed', buildingType: 'geology_lab', tier: 2 };
    expect(isConditionMet(state, condition)).toBe(false);

    // Once geology_lab itself is researched, the SAME condition object becomes met —
    // proving the mechanism reads `condition.buildingType`, not some hard-coded type.
    state.unlockedTiers['geology_lab'] = 2;
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
      { kind: 'building_tier', buildingType: 'geology_lab', tier: 2 },
    ];
    expect(getUnmetConditions(state, conditions)).toEqual(conditions);
  });

  it('returns an empty array when every condition is met', () => {
    const state = freshState();
    state.unlockedTiers['driving_center'] = 2;
    pushRawBuilding(state, 'geology_lab', 2, 0, 0);
    const conditions: ResearchCondition[] = [
      { kind: 'research_completed', buildingType: 'driving_center', tier: 2 },
      { kind: 'building_tier', buildingType: 'geology_lab', tier: 2 },
    ];
    expect(getUnmetConditions(state, conditions)).toEqual([]);
  });

  it('returns only the subset that is unmet, in original order', () => {
    const state = freshState();
    state.unlockedTiers['driving_center'] = 2; // this one is met
    const unmetCondition: ResearchCondition = { kind: 'building_tier', buildingType: 'geology_lab', tier: 2 }; // this one is not
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
    placeBuilding(state, 'geology_lab', 10, 10, 64, 64);
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
    const result = queueResearchTask(state, 'geology_lab', 3);
    expect(result.success).toBe(false);
    expect(result.code).toBe('conditions_not_met');
    expect(state.researchQueue).toHaveLength(0);
  });

  it('rejects with conditions_not_met even when a tier-2 building of that type is already physically placed', () => {
    // Physically placed via raw insertion (bypassing the research gate) — proves that
    // PHYSICAL presence of a tier-2 building is not the same as the tier-2 research
    // being COMPLETED. Only unlockedTiers (set by tickResearch) satisfies the condition.
    pushRawBuilding(state, 'geology_lab', 2, 0, 0);
    expect(isTierUnlocked(state, 'geology_lab', 2)).toBe(false);

    const result = queueResearchTask(state, 'geology_lab', 3);
    expect(result.success).toBe(false);
    expect(result.code).toBe('conditions_not_met');
  });

  it("succeeds once the type's own tier-2 research has completed", () => {
    const t2 = queueResearchTask(state, 'geology_lab', 2);
    expect(t2.success, JSON.stringify(t2)).toBe(true);
    tickResearch(state); // tier-2 is 0-ticks — completes on the very next tick
    expect(isTierUnlocked(state, 'geology_lab', 2)).toBe(true);

    const result = queueResearchTask(state, 'geology_lab', 3);
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

    // geology_lab's own tier-2 research is still outstanding.
    const result = queueResearchTask(state, 'geology_lab', 3);
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
    // geology_lab tier-3's own condition (tier-2 research completed) is NOT met...
    expect(isTierUnlocked(state, 'geology_lab', 2)).toBe(false);
    // ...but fabricate an existing queued entry for the same {type, tier}.
    state.researchQueue.push({ targetType: 'geology_lab', targetTier: 3, ticksRemaining: 50, cost: 12000, conditions: [] });

    const result = queueResearchTask(state, 'geology_lab', 3);
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
    expect(isTierUnlocked(state, 'geology_lab', 2)).toBe(false);
    expect(getQueueBlockCode(state, 'geology_lab', 3)).toBe('conditions_not_met');
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

// ── Section 5: tickResearch — Research Center destroyed mid-research (#461) ──
//
// REVERSES the earlier (queue-time-only) decision: an in-flight task is now
// cancelled — not silently completed — the moment no active research_center
// remains. `hasActiveResearchCenter` is the live, per-tick source of truth;
// there is no latch remembering a past destruction (a re-placed center lets
// the task resume).

describe('tickResearch — Research Center destroyed mid-research (#461)', () => {
  it('cancels an in-flight tier-3 task and refunds its exact cost when the sole active research_center is destroyed', () => {
    const state = freshState();
    placeResearchCenter(state);

    // Complete tier-2 first so tier-3's condition is satisfiable.
    queueResearchTask(state, 'geology_lab', 2);
    tickResearch(state);

    const t3 = queueResearchTask(state, 'geology_lab', 3);
    expect(t3.success, JSON.stringify(t3)).toBe(true);
    const def = getResearchTaskDef('geology_lab', 3);
    expect(def.ticks).toBeGreaterThan(1);

    // Tick partway through — still in-flight.
    tickResearch(state);
    expect(state.researchQueue[0]!.ticksRemaining).toBe(def.ticks - 1);

    // Destroy the sole active research_center.
    const center = state.buildings.find((b) => b.type === 'research_center')!;
    center.active = false;
    expect(hasActiveResearchCenter(state)).toBe(false);

    const result = tickResearch(state);
    expect(result).toEqual({ targetType: 'geology_lab', targetTier: 3, refund: def.cost });
    expect(state.researchQueue).toHaveLength(0);
    expect(isTierUnlocked(state, 'geology_lab', 3)).toBe(false);
  });

  it('does NOT cancel when a second research_center remains active — ticksRemaining decrements normally', () => {
    const state = freshState();
    placeResearchCenter(state, 0, 0);
    placeResearchCenter(state, 20, 20);

    queueResearchTask(state, 'geology_lab', 2);
    tickResearch(state);
    queueResearchTask(state, 'geology_lab', 3);
    const before = state.researchQueue[0]!.ticksRemaining;

    // Destroy only one of the two active centers.
    state.buildings[0]!.active = false;
    expect(hasActiveResearchCenter(state)).toBe(true);

    const result = tickResearch(state);
    expect(result).toBeUndefined();
    expect(state.researchQueue[0]!.ticksRemaining).toBe(before - 1);
  });

  it('is a live per-tick check, not a latch: re-placing a center before the next tick lets the task survive', () => {
    const state = freshState();
    placeResearchCenter(state);

    queueResearchTask(state, 'geology_lab', 2);
    tickResearch(state);
    queueResearchTask(state, 'geology_lab', 3);
    const before = state.researchQueue[0]!.ticksRemaining;

    // Destroy the only active center...
    state.buildings[0]!.active = false;
    expect(hasActiveResearchCenter(state)).toBe(false);

    // ...then place a new one before the next tickResearch call.
    placeResearchCenter(state, 60, 60);
    expect(hasActiveResearchCenter(state)).toBe(true);

    const result = tickResearch(state);
    expect(result).toBeUndefined();
    expect(state.researchQueue[0]!.ticksRemaining).toBe(before - 1);
  });

  it('cancels a 0-tick tier-2 task before it can silently complete, when the center is destroyed first', () => {
    const state = freshState();
    placeResearchCenter(state);

    const q = queueResearchTask(state, 'driving_center', 2);
    expect(q.success, JSON.stringify(q)).toBe(true);
    const def = getResearchTaskDef('driving_center', 2);
    expect(def.ticks).toBe(0);

    // Destroy the center BEFORE the first tickResearch call.
    state.buildings[0]!.active = false;
    expect(hasActiveResearchCenter(state)).toBe(false);

    const result = tickResearch(state);
    expect(result).toEqual({ targetType: 'driving_center', targetTier: 2, refund: def.cost });
    expect(state.researchQueue).toHaveLength(0);
    expect(isTierUnlocked(state, 'driving_center', 2)).toBe(false);
  });

  it('cancels multiple queued tasks one at a time across successive ticks, never both in one call', () => {
    const state = freshState();
    placeResearchCenter(state);

    const q1 = queueResearchTask(state, 'driving_center', 2);
    const q2 = queueResearchTask(state, 'blasting_academy', 2);
    expect(q1.success, JSON.stringify(q1)).toBe(true);
    expect(q2.success, JSON.stringify(q2)).toBe(true);
    expect(state.researchQueue).toHaveLength(2);

    state.buildings[0]!.active = false;
    expect(hasActiveResearchCenter(state)).toBe(false);

    const r1 = tickResearch(state);
    expect(r1).toEqual({
      targetType: 'driving_center',
      targetTier: 2,
      refund: getResearchTaskDef('driving_center', 2).cost,
    });
    expect(state.researchQueue).toHaveLength(1);
    expect(state.researchQueue[0]!.targetType).toBe('blasting_academy');

    const r2 = tickResearch(state);
    expect(r2).toEqual({
      targetType: 'blasting_academy',
      targetTier: 2,
      refund: getResearchTaskDef('blasting_academy', 2).cost,
    });
    expect(state.researchQueue).toHaveLength(0);

    // No crash, no phantom refund, once the queue is empty.
    expect(() => tickResearch(state)).not.toThrow();
    expect(tickResearch(state)).toBeUndefined();
  });

  it('returns undefined on an empty queue regardless of whether an active research_center exists', () => {
    const withCenter = freshState();
    placeResearchCenter(withCenter);
    expect(tickResearch(withCenter)).toBeUndefined();

    const withoutCenter = freshState();
    expect(tickResearch(withoutCenter)).toBeUndefined();
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

// ── #1398: research events + progress ────────────────────────────────────────

function makeEmitterSpy() {
  return { emit: vi.fn() };
}

describe('tickResearch — events (#1398)', () => {
  let state: BuildingState;
  beforeEach(() => {
    state = freshState();
    placeResearchCenter(state);
  });

  it('emits research:completed once with type and tier when a task finishes', () => {
    const emitter = makeEmitterSpy();
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state, emitter);
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith('research:completed', { targetType: 'driving_center', targetTier: 2 });
  });

  it('emits research:completed only after unlockedTiers is set', () => {
    let unlockedAtEmit: number | undefined;
    const emitter = { emit: vi.fn(() => { unlockedAtEmit = state.unlockedTiers['driving_center']; }) };
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state, emitter);
    expect(unlockedAtEmit).toBe(2);
  });

  it('does not emit while a task is still in progress', () => {
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state);
    queueResearchTask(state, 'driving_center', 3);
    const emitter = makeEmitterSpy();
    tickResearch(state, emitter);
    expect(state.researchQueue).toHaveLength(1);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('emits completion for the final tick of a multi-tick task, exactly once', () => {
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state);
    queueResearchTask(state, 'driving_center', 3);
    const emitter = makeEmitterSpy();
    const ticks = state.researchQueue[0]!.ticksRemaining;
    for (let i = 0; i < ticks; i++) tickResearch(state, emitter);
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith('research:completed', { targetType: 'driving_center', targetTier: 3 });
  });

  it('emits research:cancelled with refund when the research center is gone, and returns the same refund', () => {
    queueResearchTask(state, 'driving_center', 2);
    tickResearch(state);
    queueResearchTask(state, 'driving_center', 3);
    state.buildings = state.buildings.filter((b) => b.type !== 'research_center');
    const emitter = makeEmitterSpy();
    const result = tickResearch(state, emitter);
    const refund = getResearchTaskDef('driving_center', 3).cost;
    expect(result).toEqual({ targetType: 'driving_center', targetTier: 3, refund });
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith('research:cancelled', { targetType: 'driving_center', targetTier: 3, refund });
  });

  it('does not emit completed when cancelling', () => {
    queueResearchTask(state, 'driving_center', 2);
    state.buildings = state.buildings.filter((b) => b.type !== 'research_center');
    const emitter = makeEmitterSpy();
    tickResearch(state, emitter);
    expect(emitter.emit).not.toHaveBeenCalledWith('research:completed', expect.anything());
  });

  it('emits nothing on an empty queue', () => {
    const emitter = makeEmitterSpy();
    tickResearch(state, emitter);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('queue of two: completions are emitted in queue order, one per task', () => {
    const emitter = makeEmitterSpy();
    queueResearchTask(state, 'driving_center', 2);
    queueResearchTask(state, 'blasting_academy', 2);
    tickResearch(state, emitter);
    tickResearch(state, emitter);
    expect(emitter.emit.mock.calls).toEqual([
      ['research:completed', { targetType: 'driving_center', targetTier: 2 }],
      ['research:completed', { targetType: 'blasting_academy', targetTier: 2 }],
    ]);
  });

  it('behaves identically without an emitter (no throw, same state)', () => {
    queueResearchTask(state, 'driving_center', 2);
    expect(() => tickResearch(state)).not.toThrow();
    expect(state.unlockedTiers['driving_center']).toBe(2);
    expect(state.researchQueue).toHaveLength(0);
  });
});

describe('getResearchProgress (#1398)', () => {
  const task = (ticksRemaining: number): ResearchTask => ({
    targetType: 'driving_center', targetTier: 3, ticksRemaining, cost: 12000, conditions: [],
  });

  it('reports total from the task def and elapsed = total - ticksRemaining', () => {
    const p = getResearchProgress(task(50));
    expect(p.total).toBe(getResearchTaskDef('driving_center', 3).ticks);
    expect(p.elapsed).toBe(0);
    expect(p.fraction).toBe(0);
  });

  it('midway: half elapsed gives fraction 0.5', () => {
    const total = getResearchTaskDef('driving_center', 3).ticks;
    const p = getResearchProgress(task(total / 2));
    expect(p.elapsed).toBe(total / 2);
    expect(p.fraction).toBeCloseTo(0.5, 5);
  });

  it('finished (ticksRemaining 0) gives fraction 1', () => {
    expect(getResearchProgress(task(0)).fraction).toBe(1);
  });

  it('zero-tick task (tier 2) gives fraction 1 and total 0', () => {
    const t2: ResearchTask = { targetType: 'driving_center', targetTier: 2, ticksRemaining: 0, cost: 5000, conditions: [] };
    const p = getResearchProgress(t2);
    expect(p.total).toBe(0);
    expect(p.fraction).toBe(1);
  });

  it('clamps fraction to 0..1 for out-of-range ticksRemaining', () => {
    expect(getResearchProgress(task(9999)).fraction).toBe(0);
    expect(getResearchProgress(task(-5)).fraction).toBe(1);
  });
});

// ── Research Center tier -> speed + parallel slots (#1936) ───────────────────

describe('research center speed and slots (#1936)', () => {
  const T3_TYPES: BuildingType[] = ['driving_center', 'blasting_academy', 'management_office', 'geology_lab'];
  const mk = (type: BuildingType, tier: 2 | 3, ticks: number): ResearchTask =>
    ({ targetType: type, targetTier: tier, ticksRemaining: ticks, cost: 1, conditions: [] });
  const centerOf = (tier: 1 | 2 | 3, active = true): BuildingState => {
    const st = freshState();
    pushRawBuilding(st, 'research_center', tier, 10, 10, active);
    return st;
  };

  it('balance tables hold the spec values', () => {
    expect(RESEARCH_CENTER_SPEED_BY_TIER).toEqual({ 1: 1, 2: 1.5, 3: 2 });
    expect(RESEARCH_CENTER_SLOTS_BY_TIER).toEqual({ 1: 1, 2: 2, 3: 3 });
  });

  describe('getResearchCenterProfile', () => {
    it.each([[1, 1, 1], [2, 1.5, 2], [3, 2, 3]] as const)('tier %i gives speed %f and %i slots', (tier, speed, slots) => {
      expect(getResearchCenterProfile(centerOf(tier))).toEqual({ speed, slots });
    });

    it('is undefined with no research center', () => {
      expect(getResearchCenterProfile(freshState())).toBeUndefined();
    });

    it('is undefined when the only center is closed by an event', () => {
      const st = centerOf(3);
      st.buildings[0]!.outOfService = true;
      expect(getResearchCenterProfile(st)).toBeUndefined();
    });

    it('is undefined when the only center is inactive', () => {
      expect(getResearchCenterProfile(centerOf(2, false))).toBeUndefined();
    });

    it('takes the best operating tier, no stacking', () => {
      const st = centerOf(1);
      pushRawBuilding(st, 'research_center', 2, 20, 20);
      expect(getResearchCenterProfile(st)).toEqual({ speed: 1.5, slots: 2 });
      pushRawBuilding(st, 'research_center', 2, 30, 30);
      expect(getResearchCenterProfile(st)).toEqual({ speed: 1.5, slots: 2 });
    });

    it('ignores a closed tier-3 center when a tier-1 center operates', () => {
      const st = centerOf(1);
      pushRawBuilding(st, 'research_center', 3, 20, 20);
      st.buildings[1]!.outOfService = true;
      expect(getResearchCenterProfile(st)).toEqual({ speed: 1, slots: 1 });
    });

    it('ignores non-research buildings', () => {
      const st = freshState();
      pushRawBuilding(st, 'geology_lab', 3, 5, 5);
      expect(getResearchCenterProfile(st)).toBeUndefined();
    });
  });

  describe('getActiveResearchTasks', () => {
    const queueOf = (st: BuildingState, n: number): ResearchTask[] => {
      for (let i = 0; i < n; i++) st.researchQueue.push(mk(T3_TYPES[i % 4]!, 3, 50));
      return st.researchQueue;
    };

    it.each([[1, 1], [2, 2], [3, 3]] as const)('tier %i center: first %i queued tasks are active', (tier, slots) => {
      const st = centerOf(tier);
      const q = queueOf(st, 5);
      const active = getActiveResearchTasks(st);
      expect(active).toHaveLength(slots);
      active.forEach((t, i) => expect(t).toBe(q[i]));
    });

    it('returns fewer than slots when the queue is shorter', () => {
      const st = centerOf(3);
      queueOf(st, 2);
      expect(getActiveResearchTasks(st)).toHaveLength(2);
    });

    it('is empty for an empty queue', () => {
      expect(getActiveResearchTasks(centerOf(3))).toEqual([]);
    });

    it('is empty with no operating center', () => {
      const st = freshState();
      queueOf(st, 2);
      expect(getActiveResearchTasks(st)).toEqual([]);
      const closed = centerOf(3);
      closed.buildings[0]!.outOfService = true;
      queueOf(closed, 2);
      expect(getActiveResearchTasks(closed)).toEqual([]);
    });
  });

  describe('tickResearch with speed and slots', () => {
    it('tier 1: only the head progresses, 1 tick per tick', () => {
      const st = centerOf(1);
      st.researchQueue.push(mk('driving_center', 3, 50), mk('geology_lab', 3, 50));
      tickResearch(st);
      expect(st.researchQueue[0]!.ticksRemaining).toBe(49);
      expect(st.researchQueue[1]!.ticksRemaining).toBe(50);
    });

    it('tier 2: two tasks progress by 1.5 each, the third waits', () => {
      const st = centerOf(2);
      st.researchQueue.push(mk('driving_center', 3, 50), mk('geology_lab', 3, 50), mk('management_office', 3, 50));
      tickResearch(st);
      expect(st.researchQueue.map((q) => q.ticksRemaining)).toEqual([48.5, 48.5, 50]);
    });

    it('tier 3: three tasks progress by 2 each, the fourth waits', () => {
      const st = centerOf(3);
      for (const ty of T3_TYPES) st.researchQueue.push(mk(ty, 3, 50));
      tickResearch(st);
      expect(st.researchQueue.map((q) => q.ticksRemaining)).toEqual([48, 48, 48, 50]);
    });

    it('tier 3: two 50-tick tasks both finish at tick 25 (not 100 sequential)', () => {
      const st = centerOf(3);
      st.researchQueue.push(mk('driving_center', 3, 50), mk('geology_lab', 3, 50));
      const emitter = { emit: vi.fn() };
      for (let i = 0; i < 24; i++) tickResearch(st, emitter);
      expect(st.researchQueue).toHaveLength(2);
      expect(emitter.emit).not.toHaveBeenCalled();
      tickResearch(st, emitter);
      expect(st.researchQueue).toHaveLength(0);
      expect(st.unlockedTiers['driving_center']).toBe(3);
      expect(st.unlockedTiers['geology_lab']).toBe(3);
      expect(emitter.emit).toHaveBeenCalledTimes(2);
      expect(emitter.emit).toHaveBeenCalledWith('research:completed', { targetType: 'driving_center', targetTier: 3 });
      expect(emitter.emit).toHaveBeenCalledWith('research:completed', { targetType: 'geology_lab', targetTier: 3 });
    });

    it('tier 2: a 50-tick task completes in 34 ticks, not 33', () => {
      const st = centerOf(2);
      st.researchQueue.push(mk('driving_center', 3, 50));
      for (let i = 0; i < 33; i++) tickResearch(st);
      expect(st.researchQueue).toHaveLength(1);
      tickResearch(st);
      expect(st.researchQueue).toHaveLength(0);
      expect(st.unlockedTiers['driving_center']).toBe(3);
    });

    it('a waiting task starts progressing once an active one completes, queue order of the rest kept', () => {
      const st = centerOf(2);
      st.researchQueue.push(mk('driving_center', 3, 1), mk('geology_lab', 3, 10), mk('management_office', 3, 10), mk('blasting_academy', 3, 10));
      tickResearch(st);
      expect(st.researchQueue.map((q) => q.targetType)).toEqual(['geology_lab', 'management_office', 'blasting_academy']);
      expect(st.researchQueue.map((q) => q.ticksRemaining)).toEqual([8.5, 10, 10]);
      tickResearch(st);
      expect(st.researchQueue.map((q) => q.ticksRemaining)).toEqual([7, 8.5, 10]);
    });

    it('completing a non-head active task keeps the head and order', () => {
      const st = centerOf(3);
      st.researchQueue.push(mk('driving_center', 3, 50), mk('geology_lab', 3, 2), mk('management_office', 3, 50));
      tickResearch(st);
      expect(st.researchQueue.map((q) => q.targetType)).toEqual(['driving_center', 'management_office']);
      expect(st.unlockedTiers['geology_lab']).toBe(3);
    });

    it('tier-2 (0-tick) tasks complete on the first tick, several at once', () => {
      const st = centerOf(3);
      st.researchQueue.push(mk('driving_center', 2, 0), mk('geology_lab', 2, 0), mk('management_office', 2, 0));
      const emitter = { emit: vi.fn() };
      tickResearch(st, emitter);
      expect(st.researchQueue).toHaveLength(0);
      expect(emitter.emit).toHaveBeenCalledTimes(3);
      expect(st.unlockedTiers['management_office']).toBe(2);
    });

    it('a 0-tick task behind a full tier-1 slot waits its turn', () => {
      const st = centerOf(1);
      st.researchQueue.push(mk('driving_center', 3, 5), mk('geology_lab', 2, 0));
      tickResearch(st);
      expect(st.researchQueue).toHaveLength(2);
    });

    it('no operating center: no progress for any queued task', () => {
      const st = centerOf(3);
      st.buildings[0]!.outOfService = true;
      st.researchQueue.push(mk('driving_center', 3, 50), mk('geology_lab', 3, 50));
      expect(tickResearch(st)).toBeUndefined();
      expect(st.researchQueue.map((q) => q.ticksRemaining)).toEqual([50, 50]);
    });

    it('closed tier-3 plus operating tier-1 progresses at tier-1 pace', () => {
      const st = centerOf(1);
      pushRawBuilding(st, 'research_center', 3, 20, 20);
      st.buildings[1]!.outOfService = true;
      st.researchQueue.push(mk('driving_center', 3, 50), mk('geology_lab', 3, 50));
      tickResearch(st);
      expect(st.researchQueue.map((q) => q.ticksRemaining)).toEqual([49, 50]);
    });

    it('destroyed center still cancels the head and refunds (unchanged)', () => {
      const st = freshState();
      st.researchQueue.push(mk('driving_center', 3, 50));
      st.researchQueue[0]!.cost = 12000;
      const emitter = { emit: vi.fn() };
      expect(tickResearch(st, emitter)).toEqual({ targetType: 'driving_center', targetTier: 3, refund: 12000 });
      expect(st.researchQueue).toHaveLength(0);
    });
  });
});
