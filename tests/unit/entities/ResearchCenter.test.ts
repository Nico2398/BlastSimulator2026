// BlastSimulator2026 — CH1.4 Red-phase tests: Research Center queue & tier unlocks
//
// Covers: ResearchTask, BuildingState.researchQueue, BuildingState.unlockedTiers,
//         queueResearchTask, tickResearch, isTierUnlocked
//
// WHY THESE TESTS FAIL (Red phase):
//   Building.ts does not yet export queueResearchTask, tickResearch,
//   isTierUnlocked, ResearchTask, or the new BuildingState fields
//   (researchQueue, unlockedTiers).  The missing named exports will be
//   `undefined` at runtime; every test that calls them throws
//   "TypeError: X is not a function".
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBuildingState,
  type BuildingState,
  type BuildingType,
  type BuildingTier,
  // ── New exports (CH1.4 — not yet implemented in Building.ts) ────────────────
  queueResearchTask,
  tickResearch,
  isTierUnlocked,
} from '../../../src/core/entities/Building.js';
import type { ResearchTask } from '../../../src/core/entities/Building.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshState(): BuildingState {
  return createBuildingState();
}

// ── Section 1: New fields on a freshly created BuildingState ─────────────────

describe('BuildingState — new fields after createBuildingState (CH1.4)', () => {
  it('researchQueue is initialised as an empty array', () => {
    const state = freshState();
    expect((state as any).researchQueue).toEqual([]);
  });

  it('unlockedTiers is initialised as an empty object', () => {
    const state = freshState();
    // Partial<Record<BuildingType, BuildingTier>> — must be an empty object, not undefined
    expect((state as any).unlockedTiers).toEqual({});
  });
});

// ── Section 2: isTierUnlocked ────────────────────────────────────────────────

describe('isTierUnlocked', () => {
  it('tier 1 is always unlocked regardless of unlockedTiers contents', () => {
    const state = freshState();
    // unlockedTiers is empty — tier 1 must still be considered available
    expect(isTierUnlocked(state, 'driving_center' as BuildingType, 1 as BuildingTier)).toBe(true);
    expect(isTierUnlocked(state, 'blasting_academy' as BuildingType, 1 as BuildingTier)).toBe(true);
    expect(isTierUnlocked(state, 'research_center' as BuildingType, 1 as BuildingTier)).toBe(true);
  });

  it('tier 2 is NOT unlocked for a building with no unlock record', () => {
    const state = freshState();
    expect(isTierUnlocked(state, 'driving_center' as BuildingType, 2 as BuildingTier)).toBe(false);
  });

  it('tier 3 is NOT unlocked for a building with no unlock record', () => {
    const state = freshState();
    expect(isTierUnlocked(state, 'blasting_academy' as BuildingType, 3 as BuildingTier)).toBe(false);
  });

  it('tier 2 is unlocked when unlockedTiers[type] is set to 2', () => {
    const state = freshState();
    (state as any).unlockedTiers['geology_lab'] = 2;
    expect(isTierUnlocked(state, 'geology_lab' as BuildingType, 2 as BuildingTier)).toBe(true);
  });

  it('tier 1 remains unlocked even after setting unlockedTiers[type] to 2', () => {
    const state = freshState();
    (state as any).unlockedTiers['geology_lab'] = 2;
    expect(isTierUnlocked(state, 'geology_lab' as BuildingType, 1 as BuildingTier)).toBe(true);
  });

  it('tier 3 is NOT unlocked when unlockedTiers[type] is only 2', () => {
    const state = freshState();
    (state as any).unlockedTiers['management_office'] = 2;
    expect(isTierUnlocked(state, 'management_office' as BuildingType, 3 as BuildingTier)).toBe(false);
  });

  it('tiers 1, 2, and 3 are all unlocked when unlockedTiers[type] is 3', () => {
    const state = freshState();
    (state as any).unlockedTiers['research_center'] = 3;
    expect(isTierUnlocked(state, 'research_center' as BuildingType, 1 as BuildingTier)).toBe(true);
    expect(isTierUnlocked(state, 'research_center' as BuildingType, 2 as BuildingTier)).toBe(true);
    expect(isTierUnlocked(state, 'research_center' as BuildingType, 3 as BuildingTier)).toBe(true);
  });

  it('unlock for one building type does not affect another type', () => {
    const state = freshState();
    (state as any).unlockedTiers['geology_lab'] = 3;
    // driving_center still has no unlock entry — tier 2 must be locked
    expect(isTierUnlocked(state, 'driving_center' as BuildingType, 2 as BuildingTier)).toBe(false);
  });
});

// ── Section 3: queueResearchTask ─────────────────────────────────────────────

describe('queueResearchTask', () => {
  let state: BuildingState;

  beforeEach(() => {
    state = freshState();
  });

  it('adds exactly one ResearchTask to researchQueue and returns the cost', () => {
    const cost = queueResearchTask(state, 'driving_center' as BuildingType, 2, 50, 10000);
    expect(cost).toBe(10000);

    const queue: ResearchTask[] = (state as any).researchQueue;
    expect(queue).toHaveLength(1);
  });

  it('the queued task contains the correct targetType, targetTier, ticksRemaining, and cost', () => {
    queueResearchTask(state, 'driving_center' as BuildingType, 2, 50, 10000);

    const task: ResearchTask = (state as any).researchQueue[0];
    expect(task.targetType).toBe('driving_center');
    expect(task.targetTier).toBe(2);
    expect(task.ticksRemaining).toBe(50);
    expect(task.cost).toBe(10000);
  });

  it('can queue tier 3 research', () => {
    queueResearchTask(state, 'blasting_academy' as BuildingType, 3, 80, 25000);

    const task: ResearchTask = (state as any).researchQueue[0];
    expect(task.targetTier).toBe(3);
    expect(task.targetType).toBe('blasting_academy');
  });

  it('appends subsequent tasks in FIFO order', () => {
    queueResearchTask(state, 'driving_center' as BuildingType, 2, 40, 8000);
    queueResearchTask(state, 'blasting_academy' as BuildingType, 2, 60, 12000);
    queueResearchTask(state, 'geology_lab' as BuildingType, 3, 80, 20000);

    const queue: ResearchTask[] = (state as any).researchQueue;
    expect(queue).toHaveLength(3);
    expect(queue[0]!.targetType).toBe('driving_center');
    expect(queue[1]!.targetType).toBe('blasting_academy');
    expect(queue[2]!.targetType).toBe('geology_lab');
  });

  it('returns the cost unchanged regardless of queue depth', () => {
    queueResearchTask(state, 'driving_center' as BuildingType, 2, 40, 8000);
    const cost = queueResearchTask(state, 'management_office' as BuildingType, 2, 30, 5500);
    expect(cost).toBe(5500);
  });
});

// ── Section 4: tickResearch ───────────────────────────────────────────────────

describe('tickResearch', () => {
  let state: BuildingState;

  beforeEach(() => {
    state = freshState();
  });

  it('does nothing when the queue is empty', () => {
    // Must not throw; queue remains empty
    expect(() => tickResearch(state)).not.toThrow();
    expect((state as any).researchQueue).toHaveLength(0);
  });

  it('decrements ticksRemaining of the first task by 1 per tick', () => {
    queueResearchTask(state, 'driving_center' as BuildingType, 2, 10, 8000);
    tickResearch(state);

    const task: ResearchTask = (state as any).researchQueue[0];
    expect(task.ticksRemaining).toBe(9);
  });

  it('only decrements the first task (head of queue), leaving subsequent tasks unchanged', () => {
    queueResearchTask(state, 'driving_center' as BuildingType, 2, 10, 8000);
    queueResearchTask(state, 'blasting_academy' as BuildingType, 2, 20, 12000);
    tickResearch(state);

    const queue: ResearchTask[] = (state as any).researchQueue;
    expect(queue[0]!.ticksRemaining).toBe(9);  // decremented
    expect(queue[1]!.ticksRemaining).toBe(20); // unchanged
  });

  it('removes the completed task from the queue when ticksRemaining reaches 0', () => {
    queueResearchTask(state, 'driving_center' as BuildingType, 2, 1, 8000);
    tickResearch(state); // 1 → 0 → complete, removed

    const queue: ResearchTask[] = (state as any).researchQueue;
    expect(queue).toHaveLength(0);
  });

  it('sets unlockedTiers[targetType] to targetTier when the task completes', () => {
    queueResearchTask(state, 'driving_center' as BuildingType, 2, 1, 8000);
    tickResearch(state);

    expect((state as any).unlockedTiers['driving_center']).toBe(2);
  });

  it('unlocks tier 3 when a tier-3 research task completes', () => {
    queueResearchTask(state, 'geology_lab' as BuildingType, 3, 1, 20000);
    tickResearch(state);

    expect((state as any).unlockedTiers['geology_lab']).toBe(3);
  });

  it('advances to the next queued task after the first completes', () => {
    queueResearchTask(state, 'driving_center' as BuildingType, 2, 1, 8000);
    queueResearchTask(state, 'blasting_academy' as BuildingType, 2, 5, 12000);

    tickResearch(state); // first task completes and is removed

    const queue: ResearchTask[] = (state as any).researchQueue;
    // Second task is now the head of the queue, ticksRemaining unchanged
    expect(queue).toHaveLength(1);
    expect(queue[0]!.targetType).toBe('blasting_academy');
    expect(queue[0]!.ticksRemaining).toBe(5);
  });

  it('does not unlock a tier for tasks still in progress (ticksRemaining > 0)', () => {
    queueResearchTask(state, 'management_office' as BuildingType, 2, 5, 5000);
    tickResearch(state); // 5 → 4, NOT complete

    expect((state as any).unlockedTiers['management_office']).toBeUndefined();
  });
});

// ── Section 5: isTierUnlocked reflects research completion (integration) ─────

describe('isTierUnlocked reflects tickResearch outcome', () => {
  it('tier 2 becomes unlocked after research completes via tickResearch', () => {
    const state = freshState();
    queueResearchTask(state, 'vehicle_depot' as BuildingType, 2, 1, 9000);

    expect(isTierUnlocked(state, 'vehicle_depot' as BuildingType, 2 as BuildingTier)).toBe(false);
    tickResearch(state);
    expect(isTierUnlocked(state, 'vehicle_depot' as BuildingType, 2 as BuildingTier)).toBe(true);
  });

  it('tier 1 is still unlocked for the same building after tier-2 research completes', () => {
    const state = freshState();
    queueResearchTask(state, 'vehicle_depot' as BuildingType, 2, 1, 9000);
    tickResearch(state);

    expect(isTierUnlocked(state, 'vehicle_depot' as BuildingType, 1 as BuildingTier)).toBe(true);
  });

  it('tier 3 requires its own research even after tier 2 is unlocked', () => {
    const state = freshState();
    queueResearchTask(state, 'vehicle_depot' as BuildingType, 2, 1, 9000);
    tickResearch(state); // tier 2 unlocked

    // Tier 3 has NOT been researched yet
    expect(isTierUnlocked(state, 'vehicle_depot' as BuildingType, 3 as BuildingTier)).toBe(false);
  });

  it('tier 3 becomes unlocked after tier-3 research completes', () => {
    const state = freshState();
    // Queue tier-3 research (regardless of whether tier 2 was researched first)
    queueResearchTask(state, 'explosive_warehouse' as BuildingType, 3, 1, 22000);
    tickResearch(state);

    expect(isTierUnlocked(state, 'explosive_warehouse' as BuildingType, 3 as BuildingTier)).toBe(true);
  });
});
