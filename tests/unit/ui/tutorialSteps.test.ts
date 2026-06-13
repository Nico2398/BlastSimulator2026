// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import type { GameState } from '../../../src/core/state/GameState.js';

describe('tutorialSteps', () => {
  // ── 1 ────────────────────────────────────────────────────────────────────
  it('has exactly 23 entries', () => {
    expect(TUTORIAL_STEPS.length).toBe(TOTAL_TUTORIAL_STEPS);
  });

  // ── 2 ────────────────────────────────────────────────────────────────────
  it('every step has a defined id', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.id).toBeTruthy();
    }
  });

  // ── 3 ────────────────────────────────────────────────────────────────────
  it('every step has a defined titleKey', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.titleKey).toBeTruthy();
    }
  });

  // ── 4 ────────────────────────────────────────────────────────────────────
  it('every step has a defined textKey', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.textKey).toBeTruthy();
    }
  });

  // ── 5 ────────────────────────────────────────────────────────────────────
  it('every step has an isComplete function', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(typeof step.isComplete).toBe('function');
    }
  });

  // ── 6 ────────────────────────────────────────────────────────────────────
  it('all step IDs are unique', () => {
    const ids = TUTORIAL_STEPS.map(s => s.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  // ── 7 ────────────────────────────────────────────────────────────────────
  it('every step isComplete can be called with a minimal GameState and snapshot without throwing', () => {
    const minimalState = { isPaused: false } as GameState;
    const emptySnapshot: Record<string, unknown> = {};
    for (const step of TUTORIAL_STEPS) {
      expect(() => step.isComplete(minimalState, emptySnapshot)).not.toThrow();
    }
  });

  // ── 8 ────────────────────────────────────────────────────────────────────
  it('autoAdvanceMs is either undefined or a positive number for all steps', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.autoAdvanceMs != null) {
        expect(typeof step.autoAdvanceMs).toBe('number');
        expect(step.autoAdvanceMs).toBeGreaterThan(0);
      }
    }
  });

  // ── 9 ────────────────────────────────────────────────────────────────────
  it('captureSnapshot is either undefined or a function for all steps', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.captureSnapshot != null) {
        expect(typeof step.captureSnapshot).toBe('function');
      }
    }
  });

  // ── 10 ───────────────────────────────────────────────────────────────────
  it('captureSnapshot returns a Record when called with a GameState', () => {
    const minimalState = { isPaused: false } as GameState;
    for (const step of TUTORIAL_STEPS) {
      if (step.captureSnapshot) {
        const result = step.captureSnapshot(minimalState);
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      }
    }
  });

  // ── 11 ───────────────────────────────────────────────────────────────────
  it('step IDs follow the issue-specified sequence', () => {
    const expectedIds: string[] = [
      'time-speed',
      'hire-surveyor',
      'survey',
      'hire-driller',
      'drill-plan',
      'charge',
      'sequence',
      'blast',
      'scores',
      'event-fire-resolve',
      'hire-manager',
      'contract-accept',
      'hire-driver',
      'vehicle-buy-assign',
      'build-storage',
      'contract-deliver',
      'finances',
      'build-ramp',
      'needs',
      'set-policy',
      'tick-advance',
      'victory',
      'congratulations',
    ];
    const actualIds = TUTORIAL_STEPS.map(s => s.id);
    expect(actualIds).toEqual(expectedIds);
  });

  // ── 12 ───────────────────────────────────────────────────────────────────
  it('steps 9, 17, 19 (1-indexed) have autoAdvanceMs set to 2000', () => {
    // 0-indexed: 8 = scores, 16 = finances, 18 = needs
    expect(TUTORIAL_STEPS[8].autoAdvanceMs).toBe(2000);
    expect(TUTORIAL_STEPS[16].autoAdvanceMs).toBe(2000);
    expect(TUTORIAL_STEPS[18].autoAdvanceMs).toBe(2000);
  });

  // ── 14 (event-fire-resolve) ──────────────────────────────────────────────
  describe('step 9 (event-fire-resolve, index 9)', () => {
    const step9 = TUTORIAL_STEPS[9];

    it('has commands ["tick 3"]', () => {
      expect(step9.commands).toEqual(['tick 3']);
    });

    it('isComplete returns true when pendingEvent is not null', () => {
      const state = {
        events: { pendingEvent: { eventId: 'test_evt', firedAtTick: 5 } },
      } as unknown as GameState;
      expect(step9.isComplete(state, {})).toBe(true);
    });

    it('isComplete returns false when pendingEvent is null', () => {
      const state = { events: { pendingEvent: null } } as unknown as GameState;
      expect(step9.isComplete(state, {})).toBe(false);
    });
  });

  // ── 15 (hire-manager) ────────────────────────────────────────────────────
  describe('step 10 (hire-manager, index 10)', () => {
    const step10 = TUTORIAL_STEPS[10];

    it('isComplete returns false when pendingEvent is not null even if manager hired', () => {
      const state = {
        events: { pendingEvent: { eventId: 'test_evt', firedAtTick: 5 } },
        employees: { employees: [{ role: 'manager' }] },
      } as unknown as GameState;
      const snap = { prevEmployeeCount: 0 };
      expect(step10.isComplete(state, snap)).toBe(false);
    });

    it('isComplete returns true when pendingEvent is null and manager hired', () => {
      const state = {
        events: { pendingEvent: null },
        employees: { employees: [{ role: 'manager' }] },
      } as unknown as GameState;
      const snap = { prevEmployeeCount: 0 };
      expect(step10.isComplete(state, snap)).toBe(true);
    });
  });

  // ── 13 ───────────────────────────────────────────────────────────────────
  it('steps 9, 17, 19 (1-indexed) have captureSnapshot that returns step-specific data', () => {
    // Step 9 (scores) — captures scores + collectedOre
    const step9 = TUTORIAL_STEPS[8];
    expect(step9.captureSnapshot).toBeDefined();
    const snap9 = step9.captureSnapshot!({
      scores: { wellBeing: 75, safety: 80, ecology: 60, nuisance: 30 },
      collectedOre: { iron: 500 },
      cash: 25000,
    } as GameState);
    expect(snap9.scores).toBeDefined();
    expect(snap9.collectedOre).toBeDefined();

    // Step 17 (finances) — captures cash + contracts
    const step17 = TUTORIAL_STEPS[16];
    expect(step17.captureSnapshot).toBeDefined();
    const snap17 = step17.captureSnapshot!({
      cash: 100000,
      contracts: { active: [{ id: 'c1' }] },
    } as GameState);
    expect(snap17.cash).toBe(100000);

    // Step 19 (needs) — captures employee needs
    const step19 = TUTORIAL_STEPS[18];
    expect(step19.captureSnapshot).toBeDefined();
    const snap19 = step19.captureSnapshot!({
      employees: { employees: [{ needs: { hunger: 50, fatigue: 30, breakPressure: 20 } }] },
    } as unknown as GameState);
    expect(snap19).toBeDefined();
  });

  // ── 15 ───────────────────────────────────────────────────────────────────
  it('step 22 uses tutorial.complete_title and tutorial.complete_text', () => {
    const step22 = TUTORIAL_STEPS[22];
    // After implementation: keys changed from tutorial.step23.title/tutorial.step23
    // to tutorial.complete_title / tutorial.complete_text
    expect(step22.titleKey).toBe('tutorial.complete_title');
    expect(step22.textKey).toBe('tutorial.complete_text');
  });
});
