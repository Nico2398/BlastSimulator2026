// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import { createSurveyOverlayToggleStep, isSurveyOverlayToggleOn } from '../../../src/ui/tutorialStepHelpers.js';
import type { GameState } from '../../../src/core/state/GameState.js';

describe('tutorialSteps', () => {
  // ── 1 ────────────────────────────────────────────────────────────────────
  it('has exactly 33 entries (#553 adds build-driving-center/train-driller/buy-drill-rig-assign, #555 adds train-digger/buy-rock-digger-assign, #681 adds build-living-quarters/set-early-policy, #557 adds evacuate-zone, #905 adds toggle-survey-overlay)', () => {
    expect(TUTORIAL_STEPS.length).toBe(33);
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
      // #904: time-speed moved from index 0 to right before the first step
      // the player has to wait on (survey, waitsOnWork:true) — hire-surveyor
      // is now first, since it completes on the hire alone and does not
      // need the clock running.
      'hire-surveyor',
      'time-speed',
      'survey',
      // #905: teaches the Survey panel's existing overlay-toggle button
      // (#496) right after the first survey lands, while the panel is
      // already open from the 'survey' step above.
      'toggle-survey-overlay',
      'hire-driller',
      'build-living-quarters',
      'set-early-policy',
      'build-driving-center',
      'train-driller',
      'buy-drill-rig-assign',
      'train-digger',
      'buy-rock-digger-assign',
      'box-cut',
      'drill-plan',
      'charge',
      'sequence',
      // #557: the blast zone must be evacuated before firing. Inserted right
      // before 'blast' so the rail cannot skip past it.
      'evacuate-zone',
      'blast',
      'scores',
      'event-fire-resolve',
      'hire-manager',
      'hire-driver',
      'vehicle-buy-assign',
      'build-storage',
      // #556/#817: contract-accept sits AFTER build-storage. A contract's
      // deadline starts at acceptance and ordering the warehouse is real
      // queued work now, so accepting first spent that deadline watching a
      // construction site — and contract-deliver only advances on a genuinely
      // completed delivery, which left the tutorial card stuck with no way
      // forward.
      'contract-accept',
      'haul-debris',
      'contract-deliver',
      'finances',
      'needs',
      'set-policy',
      'tick-advance',
      'victory',
      'congratulations',
    ];
    const actualIds = TUTORIAL_STEPS.map(s => s.id);
    expect(actualIds).toEqual(expectedIds);
  });

  // ── #904: time-speed suggested at the first wait, not as the opening step ─
  describe('time-speed lesson sits at the first wait, not at the tutorial opening (#904)', () => {
    it('opens on hire-surveyor, not time-speed', () => {
      expect(TUTORIAL_STEPS[0]!.id).toBe('hire-surveyor');
    });

    it('time-speed is the second step', () => {
      expect(TUTORIAL_STEPS[1]!.id).toBe('time-speed');
    });

    it('no step earlier than immediately before the first waitsOnWork step is time-speed', () => {
      // General invariant, not hardcoded to an index: whatever the first
      // genuinely-waited-on step is, time-speed may sit immediately before
      // it (the approved position) but nothing earlier than that.
      const firstWaitIdx = TUTORIAL_STEPS.findIndex((s) => s.waitsOnWork === true);
      expect(firstWaitIdx).toBeGreaterThan(-1);
      for (let i = 0; i < firstWaitIdx - 1; i++) {
        expect(TUTORIAL_STEPS[i]!.id, `step at index ${i} is time-speed, more than one step before the first wait (index ${firstWaitIdx})`).not.toBe('time-speed');
      }
    });

    it("time-speed's index sits at, or immediately before, the first waitsOnWork step's index", () => {
      const firstWaitIdx = TUTORIAL_STEPS.findIndex((s) => s.waitsOnWork === true);
      const timeSpeedIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'time-speed');
      expect(firstWaitIdx).toBeGreaterThan(-1);
      expect(timeSpeedIdx).toBeGreaterThan(-1);
      expect(timeSpeedIdx).toBeLessThanOrEqual(firstWaitIdx);
      expect(firstWaitIdx - timeSpeedIdx).toBeLessThanOrEqual(1);
    });
  });

  // ── 12 ───────────────────────────────────────────────────────────────────
  it('scores/finances/needs have autoAdvanceMs set to 2000', () => {
    // #553 inserts build-driving-center/train-driller/buy-drill-rig-assign
    // right after hire-driller, shifting every step from box-cut onward up
    // by 3 from their pre-#553 positions (scores 9->12, finances 18->21,
    // needs 19->22). Looked up by id instead of a hardcoded index so the
    // next insertion does not have to re-derive these by hand again.
    const scores = TUTORIAL_STEPS.find((s) => s.id === 'scores')!;
    const finances = TUTORIAL_STEPS.find((s) => s.id === 'finances')!;
    const needs = TUTORIAL_STEPS.find((s) => s.id === 'needs')!;
    expect(scores.autoAdvanceMs).toBe(2000);
    expect(finances.autoAdvanceMs).toBe(2000);
    expect(needs.autoAdvanceMs).toBe(2000);
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
    const step9 = TUTORIAL_STEPS.find((s) => s.id === 'event-fire-resolve')!;

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
    const step10 = TUTORIAL_STEPS.find((s) => s.id === 'hire-manager')!;

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
  it('scores/finances/needs have captureSnapshot that returns step-specific data', () => {
    // scores — captures scores + collectedOre
    const step9 = TUTORIAL_STEPS.find((s) => s.id === 'scores')!;
    expect(step9.captureSnapshot).toBeDefined();
    const snap9 = step9.captureSnapshot!({
      scores: { wellBeing: 75, safety: 80, ecology: 60, nuisance: 30 },
      collectedOre: { iron: 500 },
      cash: 25000,
    } as unknown as GameState);
    expect(snap9.scores).toBeDefined();
    expect(snap9.collectedOre).toBeDefined();

    // finances — captures cash + contracts
    const step18 = TUTORIAL_STEPS.find((s) => s.id === 'finances')!;
    expect(step18.captureSnapshot).toBeDefined();
    const snap18 = step18.captureSnapshot!({
      cash: 100000,
      contracts: { active: [{ id: 'c1' }] },
    } as unknown as GameState);
    expect(snap18.cash).toBe(100000);

    // needs — captures employee needs
    const step20 = TUTORIAL_STEPS.find((s) => s.id === 'needs')!;
    expect(step20.captureSnapshot).toBeDefined();
    const snap20 = step20.captureSnapshot!({
      employees: { employees: [{ needs: { hunger: 50, fatigue: 30, breakPressure: 20 } }] },
    } as unknown as GameState);
    expect(snap20).toBeDefined();
  });

  // ── 15 ───────────────────────────────────────────────────────────────────
  it('congratulations (last step) uses tutorial.complete_title and tutorial.complete_text', () => {
    const step23 = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]!;
    expect(step23.id).toBe('congratulations');
    expect(step23.titleKey).toBe('tutorial.complete_title');
    expect(step23.textKey).toBe('tutorial.complete_text');
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
      'time-speed', 'hire-surveyor', 'survey', 'toggle-survey-overlay', 'hire-driller',
      'build-driving-center', 'train-driller', 'buy-drill-rig-assign',
      'train-digger', 'buy-rock-digger-assign',
      'drill-plan', 'charge', 'sequence', 'evacuate-zone', 'blast',
      'scores', 'event-fire-resolve', 'hire-manager',
      'hire-driver', 'vehicle-buy-assign', 'build-storage', 'contract-accept', 'haul-debris', 'contract-deliver',
      'finances', 'box-cut', 'needs', 'tick-advance',
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
  it('time-speed only completes on a genuine speed increase', () => {
    // Looked up by id, not index (#904 reorder moves time-speed off index 0).
    const timeSpeedStep = TUTORIAL_STEPS.find((s) => s.id === 'time-speed')!;
    const snap = timeSpeedStep.captureSnapshot!({ timeScale: 1 } as GameState);
    // Same speed as when the step opened — the player has not acted yet.
    expect(timeSpeedStep.isComplete({ timeScale: 1 } as GameState, snap)).toBe(false);
    expect(timeSpeedStep.isComplete({ timeScale: 2 } as GameState, snap)).toBe(true);
  });

  // ── 16b (#926) ───────────────────────────────────────────────────────────
  it('charge does not complete on a partially charged plan', () => {
    const chargeStep = TUTORIAL_STEPS.find((s) => s.id === 'charge')!;
    const holes = [{ id: 'H1' }, { id: 'H2' }, { id: 'H3' }];
    const charge = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };

    // No holes charged yet.
    expect(chargeStep.isComplete({
      drillHoles: holes, chargesByHole: {},
    } as unknown as GameState, {})).toBe(false);

    // Only the first of three holes charged — the bug this step used to have:
    // a plain "value increased" comparison completes here already.
    expect(chargeStep.isComplete({
      drillHoles: holes, chargesByHole: { H1: charge },
    } as unknown as GameState, {})).toBe(false);

    // Every hole charged.
    expect(chargeStep.isComplete({
      drillHoles: holes, chargesByHole: { H1: charge, H2: charge, H3: charge },
    } as unknown as GameState, {})).toBe(true);
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
    // highlight the always-present HUD, score panel or toolbar buttons — with
    // one exception: #905's toggle-survey-overlay sits immediately after
    // 'survey', so the Survey panel is guaranteed already open from that
    // preceding step, making its own overlay-toggle button a legitimate
    // highlight target too.
    const allowed = /^#bs-hud-top |^#bs-hud-scores$|^#bs-toolbar \[data-panel="[a-z]+"\]$|^#bs-survey-panel \[data-role="overlay-toggle"\]$/;
    for (const step of TUTORIAL_STEPS) {
      if (!step.highlightTarget) continue;
      expect(step.highlightTarget).toMatch(allowed);
    }
  });

  // ── 19 ───────────────────────────────────────────────────────────────────
  describe('step 7 (blast, index 7)', () => {
    const blastStep = TUTORIAL_STEPS.find((s) => s.id === 'blast')!;

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

    // #707: the count going up is not enough on its own — BlastReportModal
    // (src/ui/panels/BlastReportModal.ts) stamps `data-outstanding` on its
    // own overlay (`data-blast-report-modal`) for the whole arm/open-delay/
    // dismiss lifecycle of a report (#545). The 'blast' step must stay open
    // for that whole window so its own CLOSE button never goes inert under
    // the tutorial rail (`visibleModalControls`, tutorialGuide.ts).
    describe('gated on the Blast Report modal (#707)', () => {
      afterEach(() => {
        document.querySelectorAll('[data-blast-report-modal]').forEach((el) => el.remove());
      });

      function stampModal(outstanding: boolean): void {
        const overlay = document.createElement('div');
        overlay.dataset['blastReportModal'] = '';
        overlay.dataset['outstanding'] = String(outstanding);
        document.body.appendChild(overlay);
      }

      it('does not complete while the report is armed but not yet open (#545 delay window)', () => {
        stampModal(true);
        const before = { levelStats: { blastsPerformed: 0 }, collectedOre: {} } as unknown as GameState;
        const snap = blastStep.captureSnapshot!(before);
        const after = { levelStats: { blastsPerformed: 1 }, collectedOre: {} } as unknown as GameState;
        expect(blastStep.isComplete(after, snap)).toBe(false);
      });

      it('does not complete while the report is open on screen', () => {
        stampModal(true);
        const before = { levelStats: { blastsPerformed: 0 }, collectedOre: {} } as unknown as GameState;
        const snap = blastStep.captureSnapshot!(before);
        const after = { levelStats: { blastsPerformed: 1 }, collectedOre: {} } as unknown as GameState;
        expect(blastStep.isComplete(after, snap)).toBe(false);
      });

      it('completes once the count increased and the report is no longer outstanding', () => {
        stampModal(false);
        const before = { levelStats: { blastsPerformed: 0 }, collectedOre: {} } as unknown as GameState;
        const snap = blastStep.captureSnapshot!(before);
        const after = { levelStats: { blastsPerformed: 1 }, collectedOre: {} } as unknown as GameState;
        expect(blastStep.isComplete(after, snap)).toBe(true);
      });

      it('completes when no modal marker exists at all (non-browser / test harness state)', () => {
        // No stampModal() call: mirrors console-mode / headless-state harnesses
        // that never construct BlastReportModal at all.
        const before = { levelStats: { blastsPerformed: 0 }, collectedOre: {} } as unknown as GameState;
        const snap = blastStep.captureSnapshot!(before);
        const after = { levelStats: { blastsPerformed: 1 }, collectedOre: {} } as unknown as GameState;
        expect(blastStep.isComplete(after, snap)).toBe(true);
      });
    });
  });

  // ── 20 (haul-debris, #466) ────────────────────────────────────────────────
  describe('step haul-debris', () => {
    const step = TUTORIAL_STEPS.find(s => s.id === 'haul-debris');

    it('exists, positioned after build-storage/contract-accept and before contract-deliver', () => {
      const ids = TUTORIAL_STEPS.map(s => s.id);
      const buildIdx = ids.indexOf('build-storage');
      const acceptIdx = ids.indexOf('contract-accept');
      const haulIdx = ids.indexOf('haul-debris');
      const deliverIdx = ids.indexOf('contract-deliver');
      expect(haulIdx).toBeGreaterThan(-1);
      // #556/#817: contract-accept sits between build-storage and this step
      // now — a contract's deadline starts at acceptance, and ordering the
      // warehouse is real queued work, so accepting before it spent that
      // deadline watching a construction site.
      expect(acceptIdx).toBe(buildIdx + 1);
      expect(haulIdx).toBe(acceptIdx + 1);
      expect(deliverIdx).toBe(haulIdx + 1);
    });

    it('completes when storedMassKg increases past the value captured when the step opened', () => {
      expect(step).toBeDefined();
      const before = { logistics: { storedMassKg: 0 } } as unknown as GameState;
      const snap = step!.captureSnapshot!(before);
      const after = { logistics: { storedMassKg: 1200 } } as unknown as GameState;
      expect(step!.isComplete(after, snap)).toBe(true);
    });

    it('does not complete while storedMassKg has not increased', () => {
      const before = { logistics: { storedMassKg: 500 } } as unknown as GameState;
      const snap = step!.captureSnapshot!(before);
      const same = { logistics: { storedMassKg: 500 } } as unknown as GameState;
      expect(step!.isComplete(same, snap)).toBe(false);
    });

    it('does not complete when storedMassKg decreases relative to the snapshot', () => {
      const before = { logistics: { storedMassKg: 800 } } as unknown as GameState;
      const snap = step!.captureSnapshot!(before);
      const after = { logistics: { storedMassKg: 200 } } as unknown as GameState;
      expect(step!.isComplete(after, snap)).toBe(false);
    });

    it('has a Vehicles-toolbar highlightTarget', () => {
      expect(step!.highlightTarget).toBe('#bs-toolbar [data-panel="vehicles"]');
    });

    // #552: hauling self-dispatches — the Fleet panel's Haul button is
    // retired, and there is no player action left to hint a console command
    // for. A step that still told the player to type `vehicle haul` would be
    // pointing at a control that no longer exists.
    it('carries no manual "vehicle haul" command hint — hauling is fully automatic (#552)', () => {
      const commands = step!.commands ?? [];
      for (const cmd of commands) {
        expect(cmd, `step still hints a manual haul command: "${cmd}"`).not.toMatch(/vehicle haul/);
      }
    });

    it('does not reference a specific fragment id — auto-dispatch picks the target, not the player (#552)', () => {
      const commands = step!.commands ?? [];
      for (const cmd of commands) {
        expect(cmd, `step still names a player-chosen fragment id: "${cmd}"`).not.toMatch(/fragment:/);
      }
    });
  });

  // ── Steps whose completion the simulation owns ───────────────────────────
  describe('steps that finish only once the simulation runs', () => {
    // decideClock holds the clock for good once a step's tick allowance is
    // spent, unless the step declares it waits on work. A step whose goal
    // needs the world to keep turning and does NOT declare that will strand
    // the player: the card never completes and there is nothing left to click.
    // vehicle-buy-assign did exactly that — assigning a driver sends them
    // walking to the vehicle, and ArrivalGate only seats them on arrival.
    const SIMULATION_OWNED = ['survey', 'train-driller', 'buy-drill-rig-assign', 'train-digger', 'buy-rock-digger-assign', 'vehicle-buy-assign', 'haul-debris', 'contract-deliver', 'evacuate-zone'];

    for (const id of SIMULATION_OWNED) {
      it(`"${id}" waits on work and is given a tick allowance`, () => {
        const step = TUTORIAL_STEPS.find((s) => s.id === id);
        expect(step, `no tutorial step with id "${id}"`).toBeDefined();
        expect(step!.waitsOnWork).toBe(true);
        expect(step!.tickBudget ?? 0).toBeGreaterThan(0);
      });
    }

    it('vehicle-buy-assign names a driver who actually holds a driving licence', () => {
      // The hint command is what a stuck player copies into the console. It
      // pointed at employee 1 — the surveyor hired in step 2, who has geology
      // and no licence at all, so the command it suggested could only fail.
      const step = TUTORIAL_STEPS.find((s) => s.id === 'vehicle-buy-assign')!;
      expect(step.commands).toContain('vehicle driver 1 4');
    });
  });

  // ── evacuate-zone (#557) ─────────────────────────────────────────────────
  // The tutorial enforces the same safety drill the blast console command
  // itself is meant to refuse without: nobody standing in the drill plan's
  // danger zone (computeDangerZone(drillHoles, BLAST_DANGER_MARGIN_M),
  // mirroring PreflightModal.ts/blastSteps/Fire.ts's own use of that pair)
  // when the player tries to move on to 'blast'.
  describe('evacuate-zone step (#557)', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'evacuate-zone')!;

    it('exists between sequence and blast', () => {
      const ids = TUTORIAL_STEPS.map((s) => s.id);
      const idx = ids.indexOf('evacuate-zone');
      expect(idx).toBeGreaterThan(-1);
      expect(ids[idx - 1]).toBe('sequence');
      expect(ids[idx + 1]).toBe('blast');
    });

    it('waits on work and is given a tick allowance — walking out takes ticks', () => {
      expect(step.waitsOnWork).toBe(true);
      expect(step.tickBudget ?? 0).toBeGreaterThan(0);
    });

    it('has a blast-toolbar highlightTarget', () => {
      expect(step.highlightTarget).toBe('#bs-toolbar [data-panel="blast"]');
    });

    it('does not complete while an employee still stands inside the drill plan danger zone', () => {
      const state = {
        drillHoles: [{ id: 'h1', x: 20, z: 20, depth: 8, diameter: 0.1 }],
        employees: { employees: [{ id: 1, x: 20, z: 20, alive: true }] },
        vehicles: { vehicles: [] },
      } as unknown as GameState;
      expect(step.isComplete(state, {})).toBe(false);
    });

    it('does not complete while a vehicle still stands inside the drill plan danger zone', () => {
      const state = {
        drillHoles: [{ id: 'h1', x: 20, z: 20, depth: 8, diameter: 0.1 }],
        employees: { employees: [] },
        vehicles: { vehicles: [{ id: 1, x: 20, z: 20 }] },
      } as unknown as GameState;
      expect(step.isComplete(state, {})).toBe(false);
    });

    it('completes once every employee and vehicle has cleared the danger zone', () => {
      const state = {
        drillHoles: [{ id: 'h1', x: 20, z: 20, depth: 8, diameter: 0.1 }],
        employees: { employees: [{ id: 1, x: 100, z: 100, alive: true }] },
        vehicles: { vehicles: [{ id: 1, x: 100, z: 100 }] },
      } as unknown as GameState;
      expect(step.isComplete(state, {})).toBe(true);
    });

    it('does not falsely complete on a dead employee left inside the zone — only living crew must clear it', () => {
      // isZoneClear (Zone.ts) already skips !emp.alive; this pins the same
      // contract at the tutorial step boundary so a regression here is caught
      // even if the step stops delegating to isZoneClear directly.
      const state = {
        drillHoles: [{ id: 'h1', x: 20, z: 20, depth: 8, diameter: 0.1 }],
        employees: { employees: [{ id: 1, x: 20, z: 20, alive: false }] },
        vehicles: { vehicles: [] },
      } as unknown as GameState;
      expect(step.isComplete(state, {})).toBe(true);
    });
  });

  // ── toggle-survey-overlay (#905) ─────────────────────────────────────────
  // Teaches that the survey confidence overlay (#496) can be toggled off/on
  // via the Survey panel's existing button — no new control, just a lesson
  // on the one that already exists. Completes on ONE click in EITHER
  // direction: the tutorial does not force the player back to a specific
  // overlay state.
  describe('toggle-survey-overlay (#905)', () => {
    const SELECTOR = '#bs-survey-panel [data-role="overlay-toggle"]';

    afterEach(() => {
      document.body.innerHTML = '';
    });

    function mountToggleButton(pressed: boolean): HTMLElement {
      document.body.innerHTML =
        `<div id="bs-survey-panel"><button data-role="overlay-toggle" aria-pressed="${pressed}"></button></div>`;
      return document.querySelector(SELECTOR)!;
    }

    const dummyState = {} as unknown as GameState;

    describe('isSurveyOverlayToggleOn', () => {
      it('reads true when the toggle button is aria-pressed="true"', () => {
        mountToggleButton(true);
        expect(isSurveyOverlayToggleOn()).toBe(true);
      });

      it('reads false when the toggle button is aria-pressed="false"', () => {
        mountToggleButton(false);
        expect(isSurveyOverlayToggleOn()).toBe(false);
      });

      it('defaults to true when the toggle button is not rendered in the DOM, matching SurveyPanel\'s own default overlayVisible = true', () => {
        expect(document.querySelector(SELECTOR)).toBeNull();
        expect(() => isSurveyOverlayToggleOn()).not.toThrow();
        expect(isSurveyOverlayToggleOn()).toBe(true);
      });
    });

    describe('createSurveyOverlayToggleStep', () => {
      it('highlightTarget targets the Survey panel\'s own overlay-toggle button', () => {
        const step = createSurveyOverlayToggleStep();
        expect(step.highlightTarget).toBe(SELECTOR);
      });

      it('id is "toggle-survey-overlay"', () => {
        const step = createSurveyOverlayToggleStep();
        expect(step.id).toBe('toggle-survey-overlay');
      });

      it('isComplete is false when the toggle state is unchanged since captureSnapshot', () => {
        mountToggleButton(true);
        const step = createSurveyOverlayToggleStep();
        const snap = step.captureSnapshot!(dummyState);
        expect(step.isComplete(dummyState, snap)).toBe(false);
      });

      it('isComplete is true once the toggle switches off (aria-pressed flips true -> false)', () => {
        const btn = mountToggleButton(true);
        const step = createSurveyOverlayToggleStep();
        const snap = step.captureSnapshot!(dummyState);
        btn.setAttribute('aria-pressed', 'false');
        expect(step.isComplete(dummyState, snap)).toBe(true);
      });

      it('isComplete is true once the toggle switches back on (aria-pressed flips false -> true)', () => {
        const btn = mountToggleButton(false);
        const step = createSurveyOverlayToggleStep();
        const snap = step.captureSnapshot!(dummyState);
        btn.setAttribute('aria-pressed', 'true');
        expect(step.isComplete(dummyState, snap)).toBe(true);
      });

      it('captureSnapshot and isComplete never throw when the toggle button is not rendered in the DOM', () => {
        const step = createSurveyOverlayToggleStep();
        let snap: Record<string, unknown> = {};
        expect(() => { snap = step.captureSnapshot!(dummyState); }).not.toThrow();
        expect(() => step.isComplete(dummyState, snap)).not.toThrow();
        // Both reads default to true (button absent), so nothing "changed".
        expect(step.isComplete(dummyState, snap)).toBe(false);
      });
    });
  });
});
