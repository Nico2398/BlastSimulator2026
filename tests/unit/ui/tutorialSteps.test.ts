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

  // ── set-policy ───────────────────────────────────────────────────────────
  describe('step 19 (set-policy)', () => {
    const step = TUTORIAL_STEPS.find(s => s.id === 'set-policy')!;

    const stateWith = (revision: number) =>
      ({ sitePolicy: { shiftMode: 'shift_8h', revision } } as unknown as GameState);

    it('completes when a policy is applied, even with every value unchanged', () => {
      // The reported bug: pressing Apply on the settings already in force is the
      // common case, since the form mirrors the current policy. Comparing values
      // concluded nothing had happened and the tutorial sat there forever while
      // the panel said "Site policy updated".
      const snap = step.captureSnapshot!(stateWith(0));
      expect(step.isComplete(stateWith(1), snap)).toBe(true);
    });

    it('does not complete before the player applies anything', () => {
      const snap = step.captureSnapshot!(stateWith(3));
      expect(step.isComplete(stateWith(3), snap)).toBe(false);
    });

    it('does not complete on a policy applied before the step opened', () => {
      const snap = step.captureSnapshot!(stateWith(5));
      expect(step.isComplete(stateWith(4), snap)).toBe(false);
    });

    it('survives a state with no site policy at all', () => {
      const empty = {} as unknown as GameState;
      expect(() => step.isComplete(empty, step.captureSnapshot!(empty))).not.toThrow();
    });
  });

  // ── 14 (event-fire-resolve) ──────────────────────────────────────────────
  describe('step 9 (event-fire-resolve, index 9)', () => {
    const step9 = TUTORIAL_STEPS[9];

    it('drives itself: autoCommands fast-forward and fire the scripted event', () => {
      expect(step9.autoCommands).toEqual(['tick 3', 'event fire tutorial_synergy_consultant']);
    });

    it('isComplete returns true once the scripted event fired and was resolved', () => {
      const state = {
        events: { pendingEvent: null, firedEventIds: ['tutorial_synergy_consultant'] },
      } as unknown as GameState;
      expect(step9.isComplete(state, {})).toBe(true);
    });

    it('isComplete returns false while the dialog is still open', () => {
      const state = {
        events: {
          pendingEvent: { eventId: 'tutorial_synergy_consultant', firedAtTick: 5 },
          firedEventIds: ['tutorial_synergy_consultant'],
        },
      } as unknown as GameState;
      expect(step9.isComplete(state, {})).toBe(false);
    });

    it('isComplete returns false before the scripted event has fired', () => {
      const state = {
        events: { pendingEvent: null, firedEventIds: [] },
      } as unknown as GameState;
      expect(step9.isComplete(state, {})).toBe(false);
    });

    it('resolving a different event does not complete the step', () => {
      const state = {
        events: { pendingEvent: null, firedEventIds: ['union_strike'] },
      } as unknown as GameState;
      expect(step9.isComplete(state, {})).toBe(false);
    });

    it('stays complete once resolved, so a fast answer cannot deadlock the tutorial', () => {
      // The old condition was only true while the dialog was open. This is the
      // regression guard: the completion signal must be monotonic.
      const state = {
        events: { pendingEvent: null, firedEventIds: ['tutorial_synergy_consultant'] },
      } as unknown as GameState;
      expect(step9.isComplete(state, {})).toBe(true);
      expect(step9.isComplete(state, {})).toBe(true);
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
      const snap = { prevIdsWithRole: [] };
      expect(step10.isComplete(state, snap)).toBe(false);
    });

    it('isComplete returns true when pendingEvent is null and manager hired', () => {
      const state = {
        events: { pendingEvent: null },
        employees: { employees: [{ role: 'manager' }] },
      } as unknown as GameState;
      const snap = { prevIdsWithRole: [] };
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

  // ── 16 ───────────────────────────────────────────────────────────────────
  it('every step has highlightTarget as either string or undefined', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.highlightTarget !== undefined) {
        expect(typeof step.highlightTarget).toBe('string');
        expect(step.highlightTarget.length).toBeGreaterThan(0);
      }
    }
  });

  // ── 17 ───────────────────────────────────────────────────────────────────
  it('steps with meaningful UI target have a highlightTarget defined', () => {
    // Steps that should definitely have highlight targets
    const stepsWithTarget = new Set([
      'time-speed', 'hire-surveyor', 'survey', 'hire-driller',
      'drill-plan', 'charge', 'sequence', 'blast',
      'scores', 'event-fire-resolve', 'hire-manager', 'contract-accept',
      'hire-driver', 'vehicle-buy-assign', 'build-storage', 'contract-deliver',
      'finances', 'build-ramp', 'needs', 'tick-advance',
    ]);
    for (const step of TUTORIAL_STEPS) {
      if (stepsWithTarget.has(step.id)) {
        expect(step.highlightTarget,
          `Step "${step.id}" should have a highlightTarget`
        ).toBeDefined();
      }
    }
  });

  // ── 18 ───────────────────────────────────────────────────────────────────
  it('highlightTarget starts with # for CSS selector syntax', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.highlightTarget) {
        expect(step.highlightTarget.startsWith('#'),
          `Step "${step.id}" highlightTarget "${step.highlightTarget}" should start with #`
        ).toBe(true);
      }
    }
  });

  // ── 16 ───────────────────────────────────────────────────────────────────
  it('step 0 (time-speed) only completes on a genuine speed increase', () => {
    const step0 = TUTORIAL_STEPS[0]!;
    const snap = step0.captureSnapshot!({ timeScale: 1 } as GameState);
    // Same speed as when the step opened — the player has not acted yet.
    expect(step0.isComplete({ timeScale: 1 } as GameState, snap)).toBe(false);
    expect(step0.isComplete({ timeScale: 2 } as GameState, snap)).toBe(true);
  });

  // ── 17 ───────────────────────────────────────────────────────────────────
  it('only the scripted event step carries autoCommands', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.id === 'event-fire-resolve') continue;
      expect(step.autoCommands).toBeUndefined();
    }
  });

  // ── 18 ───────────────────────────────────────────────────────────────────
  it('every highlightTarget points at a control that stays on screen', () => {
    // Panels are display:none until the player opens them, so a step may only
    // highlight the always-present HUD, score panel or toolbar buttons.
    const allowed = /^#bs-hud-top |^#bs-hud-scores$|^#bs-toolbar \[data-panel="[a-z]+"\]$/;
    for (const step of TUTORIAL_STEPS) {
      if (!step.highlightTarget) continue;
      expect(step.highlightTarget).toMatch(allowed);
    }
  });

  // ── 19 ───────────────────────────────────────────────────────────────────
  describe('step 7 (blast, index 7)', () => {
    const blastStep = TUTORIAL_STEPS[7]!;

    it('completes on a barren blast, not only when ore is found', () => {
      // A legitimate blast that turns up no ore still satisfied the objective:
      // "execute the blast sequence". Keying on ore alone dead-ends the card.
      const before = { levelStats: { blastsPerformed: 0 }, collectedOre: {} } as unknown as GameState;
      const snap = blastStep.captureSnapshot!(before);
      const after = { levelStats: { blastsPerformed: 1 }, collectedOre: {} } as unknown as GameState;
      expect(blastStep.isComplete(after, snap)).toBe(true);
    });

    it('still completes when ore is collected outside a campaign level', () => {
      const before = { collectedOre: {} } as unknown as GameState;
      const snap = blastStep.captureSnapshot!(before);
      const after = { collectedOre: { gravelite: 400 } } as unknown as GameState;
      expect(blastStep.isComplete(after, snap)).toBe(true);
    });

    it('does not complete before the player blasts', () => {
      const before = { levelStats: { blastsPerformed: 0 }, collectedOre: {} } as unknown as GameState;
      const snap = blastStep.captureSnapshot!(before);
      expect(blastStep.isComplete(before, snap)).toBe(false);
    });
  });
});
