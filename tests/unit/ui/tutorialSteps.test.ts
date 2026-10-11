// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import { createSurveyOverlayToggleStep, isSurveyOverlayToggleOn } from '../../../src/ui/tutorialStepHelpers.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { victoryProgress, goalChipParams } from '../../../src/ui/tutorialStepsClosing.js';
import { TUTORIAL_STAGES, REGION } from '../../../src/ui/tutorialStages.js';
import { createFinanceState, addIncome, addExpense, getFinancialReport } from '../../../src/core/economy/Finance.js';
import { formatDollars } from '../../../src/core/economy/formatMoney.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { TUTORIAL_LEVEL_ID } from '../../../src/ui/tutorialTrigger.js';
import { t, setLocale, getLocale } from '../../../src/core/i18n/I18n.js';

describe('tutorialSteps', () => {
  // ── 1 ────────────────────────────────────────────────────────────────────
  it('has exactly 27 entries (#1339 removes train-driller/train-digger, moves hire-driver before box-cut and build-driving-center after blast, adds train-fragmenter, #1335 removes contract-accept, the player accepts the fillable ore offer in sell-ore, #1328 replaces set-policy/tick-advance/victory with free-play, #553 adds build-driving-center/train-driller/buy-drill-rig-assign, #555 adds train-digger/buy-rock-digger-assign, #681 adds build-living-quarters/set-early-policy, #557 adds evacuate-zone, #905 adds toggle-survey-overlay, #923 removed time-speed and added speed-up-for-dig/speed-normal-after-dig, #1344 removes the detonation-sequence step, #1015 removes those two speed-control steps — the speed bar is unconditionally player-controlled from the tutorial\'s very first step onward, so no step teaches it any more)', () => {
    expect(TUTORIAL_STEPS.length).toBe(27);
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
  it('no tutorial step auto-dismisses on a timer (#1334)', () => {
    for (const step of TUTORIAL_STEPS) {
      expect('autoAdvanceMs' in step, `step "${step.id}"`).toBe(false);
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
      // #904: hire-surveyor is first, since it completes on the hire alone
      // and does not need the clock running. #923 had moved a speed-control
      // lesson into the box-cut ramp-dig wait further down; #1015 removes
      // that lesson entirely — the speed bar is unconditionally
      // player-controlled from this very first step onward (see
      // BASE_PERMANENTLY_ALLOWED, tutorialRails.ts) — so hiring advances
      // straight into 'survey'.
      'hire-surveyor',
      'survey',
      // #905: teaches the Survey panel's existing overlay-toggle button
      // (#496) right after the first survey lands, while the panel is
      // already open from the 'survey' step above.
      'toggle-survey-overlay',
      'hire-driller',
      'build-living-quarters',
      'set-early-policy',
      // #1339: every role arrives able to do its own job, so the driver is
      // hired before the rig/digger and no licence course precedes box-cut.
      'hire-driver',
      'buy-drill-rig-assign',
      'buy-rock-digger-assign',
      'box-cut',
      // #1015: box-cut is immediately followed by drill-plan — the
      // speed-up-for-dig/speed-normal-after-dig pair #923 inserted here is
      // gone, since the speed bar is always player-controlled now and needs
      // no dedicated lesson.
      'drill-plan',
      'charge',
      // #557: the blast zone must be evacuated before firing. Inserted right
      // before 'blast' so the rail cannot skip past it.
      'evacuate-zone',
      'blast',
      // #1339: the first blast leaves oversized boulders; the driving center
      // teaches the one licence (rock fragmenter) nobody is hired holding.
      'build-driving-center',
      'train-fragmenter',
      'scores',
      'event-fire-resolve',
      'hire-manager',
      'vehicle-buy-assign',
      'build-storage',
      // #1335: contract-accept is gone; haul-debris follows build-storage
      // directly. The player accepts the one fillable ore offer in sell-ore.
      'haul-debris',
      'finances',
      'needs',
      // #959/#1328: sell-ore closes the guided part (after finances/needs);
      // 'free-play' lifts the rails and shows the goal chip.
      'sell-ore',
      'free-play',
      'congratulations',
    ];
    const actualIds = TUTORIAL_STEPS.map(s => s.id);
    expect(actualIds).toEqual(expectedIds);
  });

  // ── #1015: the speed bar needs no dedicated lesson any more ───────────────
  describe('the speed bar is unconditionally player-controlled from the tutorial\'s very first step onward (#1015)', () => {
    it('opens on hire-surveyor', () => {
      expect(TUTORIAL_STEPS[0]!.id).toBe('hire-surveyor');
    });

    it('no step is called "time-speed" any more — the standalone #923 step never came back', () => {
      expect(TUTORIAL_STEPS.find((s) => s.id === 'time-speed')).toBeUndefined();
    });

    it('no step is called "speed-up-for-dig" or "speed-normal-after-dig" any more', () => {
      expect(TUTORIAL_STEPS.find((s) => s.id === 'speed-up-for-dig')).toBeUndefined();
      expect(TUTORIAL_STEPS.find((s) => s.id === 'speed-normal-after-dig')).toBeUndefined();
    });

    it('box-cut is immediately followed by drill-plan', () => {
      const ids = TUTORIAL_STEPS.map((s) => s.id);
      const boxCutIdx = ids.indexOf('box-cut');
      expect(boxCutIdx).toBeGreaterThan(-1);
      expect(ids[boxCutIdx + 1]).toBe('drill-plan');
    });
  });

  // ── #1015: no tutorial step may complete on, or read, state.timeScale ────
  it('no tutorial step completes on, or reads, state.timeScale', () => {
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
      const step = TUTORIAL_STEPS[i]!;
      expect(
        step.isComplete.toString(),
        `step "${step.id}" (index ${i}) reads state.timeScale in isComplete`,
      ).not.toMatch(/timeScale/);
      if (step.captureSnapshot) {
        expect(
          step.captureSnapshot.toString(),
          `step "${step.id}" (index ${i}) reads state.timeScale in captureSnapshot`,
        ).not.toMatch(/timeScale/);
      }
    }
  });

  // ── 12 ───────────────────────────────────────────────────────────────────
  it('scores/finances/needs have no autoAdvanceMs and are not complete on a fresh DOM (#1334)', () => {
    // #553 inserts build-driving-center/train-driller/buy-drill-rig-assign
    // right after hire-driller, shifting every step from box-cut onward up
    // by 3 from their pre-#553 positions (scores 9->12, finances 18->21,
    // needs 19->22). Looked up by id instead of a hardcoded index so the
    // next insertion does not have to re-derive these by hand again.
    const scores = TUTORIAL_STEPS.find((s) => s.id === 'scores')!;
    const finances = TUTORIAL_STEPS.find((s) => s.id === 'finances')!;
    const needs = TUTORIAL_STEPS.find((s) => s.id === 'needs')!;
    document.body.innerHTML = '';
    for (const step of [scores, finances, needs]) {
      expect('autoAdvanceMs' in step, step.id).toBe(false);
      const state = { isPaused: false } as GameState;
      const snapshot = step.captureSnapshot ? step.captureSnapshot(state) : {};
      expect(step.isComplete(state, snapshot), step.id).toBe(false);
    }
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

    describe('outcome dialog still on screen (#1632)', () => {
      const resolvedState = {
        events: { pendingEvent: null, firedEventIds: ['tutorial_synergy_consultant'] },
      } as unknown as GameState;

      function mountDialog(display?: string): void {
        const el = document.createElement('div');
        el.id = 'bs-event-dialog';
        if (display !== undefined) el.style.display = display;
        document.body.appendChild(el);
      }

      afterEach(() => { document.body.innerHTML = ''; });

      it('is not complete while pendingEvent is set', () => {
        const state = {
          events: { pendingEvent: { eventId: 'tutorial_synergy_consultant', firedAtTick: 5 }, firedEventIds: ['tutorial_synergy_consultant'] },
        } as unknown as GameState;
        expect(step9.isComplete(state, {})).toBe(false);
      });

      it('is not complete when resolved but the dialog is still displayed', () => {
        mountDialog('flex');
        expect(step9.isComplete(resolvedState, {})).toBe(false);
      });

      it('is complete once the dialog is display:none', () => {
        mountDialog('none');
        expect(step9.isComplete(resolvedState, {})).toBe(true);
      });

      it('is complete when the dialog element is absent', () => {
        expect(step9.isComplete(resolvedState, {})).toBe(true);
      });

      it('is not complete before the event fired even with the dialog closed', () => {
        mountDialog('none');
        const state = { events: { pendingEvent: null, firedEventIds: [] } } as unknown as GameState;
        expect(step9.isComplete(state, {})).toBe(false);
      });
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

  // ── #1335 ────────────────────────────────────────────────────────────────
  it('has no contract-accept step (#1335): sell-ore accepts the fillable offer itself', () => {
    expect(TUTORIAL_STEPS.find((s) => s.id === 'contract-accept')).toBeUndefined();
    expect(TUTORIAL_STEPS.some((s) => s.titleKey === 'tutorial.step12.title')).toBe(false);
    expect(TUTORIAL_STEPS.some((s) => s.textKey === 'tutorial.step12')).toBe(false);
  });

  // ── 17 ───────────────────────────────────────────────────────────────────
  it('steps with meaningful UI target have a highlightTarget defined', () => {
    // Steps that should definitely have highlight targets
    const stepsWithTarget = new Set([
      'hire-surveyor', 'survey', 'toggle-survey-overlay', 'hire-driller',
      'build-driving-center', 'train-fragmenter', 'buy-drill-rig-assign',
      'buy-rock-digger-assign',
      'drill-plan', 'charge', 'evacuate-zone', 'blast',
      'scores', 'event-fire-resolve', 'hire-manager',
      'hire-driver', 'vehicle-buy-assign', 'build-storage', 'haul-debris', 'sell-ore',
      'finances', 'box-cut', 'needs',
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

  // ── #1596: the first blast is the scripted one ───────────────────────────
  describe('first blast is deterministic (#1596)', () => {
    const charge = { explosiveId: 'boomite', amountKg: 4, stemmingM: 2.5 };
    const holeList = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `H${i + 1}` }));
    const planned = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}` }));
    const chargedAll = (n: number) => Object.fromEntries(holeList(n).map((h) => [h.id, charge]));
    const st = (o: Record<string, unknown>) => o as unknown as GameState;

    describe('drill-plan', () => {
      const step = () => TUTORIAL_STEPS.find((s) => s.id === 'drill-plan')!;

      it('is not complete with 1 hole drilled and 8 still ordered', () => {
        expect(step().isComplete(st({ drillHoles: holeList(1), plannedDrillHoles: planned(8) }), {})).toBe(false);
      });

      it('is not complete with nothing drilled and nothing ordered', () => {
        expect(step().isComplete(st({ drillHoles: [], plannedDrillHoles: [] }), {})).toBe(false);
      });

      it('is complete with 9 drilled and 0 ordered', () => {
        expect(step().isComplete(st({ drillHoles: holeList(9), plannedDrillHoles: [] }), {})).toBe(true);
      });
    });

    describe('charge', () => {
      const step = () => TUTORIAL_STEPS.find((s) => s.id === 'charge')!;

      it('is not complete while holes are still ordered, even if every drilled hole is charged', () => {
        expect(step().isComplete(st({
          drillHoles: holeList(1), plannedDrillHoles: planned(8),
          chargesByHole: chargedAll(1), plannedChargesByHole: {},
        }), {})).toBe(false);
      });

      it('is not complete while a charge is still ordered but not loaded', () => {
        expect(step().isComplete(st({
          drillHoles: holeList(9), plannedDrillHoles: [],
          chargesByHole: chargedAll(9), plannedChargesByHole: { H9: charge },
        }), {})).toBe(false);
      });

      it('is not complete while a drilled hole is uncharged', () => {
        expect(step().isComplete(st({
          drillHoles: holeList(9), plannedDrillHoles: [],
          chargesByHole: chargedAll(8), plannedChargesByHole: {},
        }), {})).toBe(false);
      });

      it('is complete only when all 9 are drilled, none ordered, all charged, no charge ordered', () => {
        expect(step().isComplete(st({
          drillHoles: holeList(9), plannedDrillHoles: [],
          chargesByHole: chargedAll(9), plannedChargesByHole: {},
        }), {})).toBe(true);
      });
    });
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
    // the tutorial rail (#951: no 'blast' sub-stage targets anything inside
    // this modal, so `applyRails`'s per-modal restriction in
    // tutorialGuide.ts never narrows it -- it keeps the old blanket
    // allowance).
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

    it('exists, positioned directly after build-storage (index 21) and before finances', () => {
      const ids = TUTORIAL_STEPS.map(s => s.id);
      const buildIdx = ids.indexOf('build-storage');
      const haulIdx = ids.indexOf('haul-debris');
      const sellOreIdx = ids.indexOf('sell-ore');
      expect(haulIdx).toBeGreaterThan(-1);
      // #1335: contract-accept was removed; no step sits between them.
      expect(haulIdx).toBe(buildIdx + 1);
      expect(haulIdx).toBe(21);
      // #1328: finances/needs sit between haul-debris and sell-ore now, so
      // the first sale is the last guided step.
      expect(ids[haulIdx + 1]).toBe('finances');
      expect(ids.indexOf('finances')).toBe(22);
      expect(sellOreIdx).toBe(ids.indexOf('needs') + 1);
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

  // ── sell-ore (#959) ──────────────────────────────────────────────────────
  // Replaces the old contract-deliver step: the tutorial never actually
  // hauled and sold the blasted ore for money, so a player following it to
  // the letter finished with negative cash even on a technical "win". The
  // step is repeatable — a tier-1 freight_warehouse only holds 2000kg, so
  // more than one accept-and-deliver cycle is expected, not a bug.
  //
  // isComplete's real contract (design decision this test pins for the
  // implementer): complete once at least one ore_sale contract has been
  // fully delivered SINCE the step opened — read off
  // state.contracts.completedHistory, the same ledger deliverMaterials
  // (Contract.ts) already pushes a contract onto the instant it completes.
  // Snapshot-gated the same way createHireStep/haul-debris are: an ore_sale
  // contract completed BEFORE this step opened must not retroactively
  // satisfy it.
  describe('sell-ore step (#959)', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'sell-ore')!;

    it('exists', () => {
      expect(step).toBeDefined();
    });

    it('has a Contracts-toolbar highlightTarget', () => {
      expect(step.highlightTarget).toBe('#bs-toolbar [data-panel="contracts"]');
    });

    it('waits on work and is given a tick allowance — hauling and delivering are queued, real work', () => {
      expect(step.waitsOnWork).toBe(true);
      expect(step.tickBudget ?? 0).toBeGreaterThan(0);
    });

    it('has a captureSnapshot, so a contract completed before the step opened cannot retroactively satisfy it', () => {
      expect(step.captureSnapshot).toBeDefined();
    });

    it('does not complete when nothing has ever been delivered', () => {
      const state = { contracts: { completedHistory: [] } } as unknown as GameState;
      const snapshot = step.captureSnapshot ? step.captureSnapshot(state) : {};
      expect(step.isComplete(state, snapshot)).toBe(false);
    });

    it('completes once an ore_sale contract is completed after the step opened', () => {
      const before = { contracts: { completedHistory: [] } } as unknown as GameState;
      const snapshot = step.captureSnapshot ? step.captureSnapshot(before) : {};
      const after = {
        contracts: {
          completedHistory: [
            { id: 1, type: 'ore_sale', materialId: 'dirtite', completed: true },
          ],
        },
      } as unknown as GameState;
      expect(step.isComplete(after, snapshot)).toBe(true);
    });

    it('does not complete on a rubble_disposal or supply contract alone — the objective is selling ORE', () => {
      const before = { contracts: { completedHistory: [] } } as unknown as GameState;
      const snapshot = step.captureSnapshot ? step.captureSnapshot(before) : {};
      const after = {
        contracts: {
          completedHistory: [
            { id: 1, type: 'rubble_disposal', materialId: '', completed: true },
            { id: 2, type: 'supply', materialId: 'dirtite', completed: true },
          ],
        },
      } as unknown as GameState;
      expect(step.isComplete(after, snapshot)).toBe(false);
    });

    it('does not complete on an ore_sale contract that was already completed before the step opened', () => {
      const before = {
        contracts: {
          completedHistory: [
            { id: 1, type: 'ore_sale', materialId: 'dirtite', completed: true },
          ],
        },
      } as unknown as GameState;
      const snapshot = step.captureSnapshot ? step.captureSnapshot(before) : {};
      // Nothing NEW happened since the snapshot — still just the one
      // pre-existing completed ore_sale contract.
      expect(step.isComplete(before, snapshot)).toBe(false);
    });

    it('is repeatable — completing a second ore_sale contract after the first also satisfies it (not capped at exactly one)', () => {
      const before = { contracts: { completedHistory: [] } } as unknown as GameState;
      const snapshot = step.captureSnapshot ? step.captureSnapshot(before) : {};
      const afterTwo = {
        contracts: {
          completedHistory: [
            { id: 1, type: 'ore_sale', materialId: 'dirtite', completed: true },
            { id: 2, type: 'ore_sale', materialId: 'rustite', completed: true },
          ],
        },
      } as unknown as GameState;
      expect(step.isComplete(afterTwo, snapshot)).toBe(true);
    });

    it('does not throw against a minimal state with no contracts field at all', () => {
      const state = {} as unknown as GameState;
      expect(() => {
        const snapshot = step.captureSnapshot ? step.captureSnapshot(state) : {};
        step.isComplete(state, snapshot);
      }).not.toThrow();
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
    // #921: buy-drill-rig-assign/buy-rock-digger-assign/vehicle-buy-assign
    // drop out of this list — a vehicle's driver is claimed automatically now
    // (VehicleReservation/ArrivalGate), so these three steps complete
    // synchronously on the purchase itself and no longer need to wait on the
    // simulation to run a driver's walk-and-board.
    // #959: 'sell-ore' replaces 'contract-deliver' here — haul+sell cycles
    // are queued, real work the same way delivering to a contract always was.
    const SIMULATION_OWNED = ['survey', 'train-fragmenter', 'haul-debris', 'sell-ore', 'evacuate-zone'];

    for (const id of SIMULATION_OWNED) {
      it(`"${id}" waits on work and is given a tick allowance`, () => {
        const step = TUTORIAL_STEPS.find((s) => s.id === id);
        expect(step, `no tutorial step with id "${id}"`).toBeDefined();
        expect(step!.waitsOnWork).toBe(true);
        expect(step!.tickBudget ?? 0).toBeGreaterThan(0);
      });
    }
  });

  // ── #921: purchase-completing steps (driver assignment removed) ──────────
  // buy-drill-rig-assign, buy-rock-digger-assign and vehicle-buy-assign used
  // to wait on a driver's walk-and-board (assignDriver sends them walking;
  // ArrivalGate seats them only on arrival). Now that a vehicle's driver is
  // claimed automatically, there is nothing left for the player to click
  // after the purchase — each step must complete the instant a vehicle of the
  // role it teaches exists, the same "value increased" shape createComparisonStep
  // already gives every other purchase/build step in this file (e.g.
  // build-living-quarters, build-storage).
  describe('purchase-completing steps no longer wait on an assigned driver (#921)', () => {
    const PURCHASE_COMPLETING: Array<{ id: string; role: string }> = [
      { id: 'buy-drill-rig-assign', role: 'drill_rig' },
      { id: 'buy-rock-digger-assign', role: 'rock_digger' },
      { id: 'vehicle-buy-assign', role: 'debris_hauler' },
    ];

    for (const { id, role } of PURCHASE_COMPLETING) {
      describe(`step "${id}"`, () => {
        it('carries no manual "vehicle driver ..." command hint', () => {
          const step = TUTORIAL_STEPS.find((s) => s.id === id)!;
          expect(step, `no tutorial step with id "${id}"`).toBeDefined();
          const commands = step.commands ?? [];
          for (const cmd of commands) {
            expect(cmd, `step "${id}" still hints a manual driver-assign command: "${cmd}"`).not.toMatch(/vehicle driver/);
          }
        });

        it(`completes once a vehicle of role "${role}" exists, with no driver required`, () => {
          const step = TUTORIAL_STEPS.find((s) => s.id === id)!;
          const before = { vehicles: { vehicles: [] } } as unknown as GameState;
          const snap = step.captureSnapshot ? step.captureSnapshot(before) : {};
          const after = {
            vehicles: { vehicles: [{ id: 1, type: role, driverId: null }] },
          } as unknown as GameState;
          expect(step.isComplete(after, snap)).toBe(true);
        });

        it('does not complete before the vehicle is bought', () => {
          const step = TUTORIAL_STEPS.find((s) => s.id === id)!;
          const before = { vehicles: { vehicles: [] } } as unknown as GameState;
          const snap = step.captureSnapshot ? step.captureSnapshot(before) : {};
          expect(step.isComplete(before, snap)).toBe(false);
        });
      });
    }
  });

  // ── evacuate-zone (#557) ─────────────────────────────────────────────────
  // The tutorial enforces the same safety drill the blast console command
  // itself is meant to refuse without: nobody standing in the drill plan's
  // danger zone (computeDangerZone(drillHoles, BLAST_DANGER_MARGIN_M),
  // mirroring PreflightModal.ts/blastSteps/Fire.ts's own use of that pair)
  // when the player tries to move on to 'blast'.
  describe('evacuate-zone step (#557)', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'evacuate-zone')!;

    it('exists between charge and blast', () => {
      const ids = TUTORIAL_STEPS.map((s) => s.id);
      const idx = ids.indexOf('evacuate-zone');
      expect(idx).toBeGreaterThan(-1);
      expect(ids[idx - 1]).toBe('charge');
      expect(ids[idx + 1]).toBe('blast');
    });

    it('waits on work and is given a tick allowance — walking out takes ticks', () => {
      expect(step.waitsOnWork).toBe(true);
      expect(step.tickBudget ?? 0).toBeGreaterThan(0);
    });

    it('has a blast-toolbar highlightTarget', () => {
      expect(step.highlightTarget).toBe('#bs-toolbar [data-panel="blast"]');
    });

    // #1362/#1591: DETONATE arms the sequence (horn + auto-fire). The step is
    // done only once a blast actually fired (blastsPerformed rose), never on arming.
    const armed = { armedTick: 1, strandedEmployeeIds: [], strandedVehicleIds: [], lastEvacuationTick: 1 };
    const baseState = (over: Record<string, unknown> = {}): GameState => ({
      drillHoles: [{ id: 'h1', x: 20, z: 20, depth: 8, diameter: 0.1 }],
      employees: { employees: [{ id: 1, x: 20, z: 20, alive: true }] },
      vehicles: { vehicles: [{ id: 1, x: 20, z: 20 }] },
      pendingDetonation: null,
      levelStats: { blastsPerformed: 0 },
      ...over,
    }) as unknown as GameState;
    const snapshotOf = (state: GameState) => step.captureSnapshot ? step.captureSnapshot(state) : {};

    it('does not complete while nothing is armed, even with the zone occupied', () => {
      const state = baseState();
      expect(step.isComplete(state, snapshotOf(state))).toBe(false);
    });

    it('does not complete on a clear zone alone (the horn has not been sounded)', () => {
      const state = baseState({ employees: { employees: [] }, vehicles: { vehicles: [] } });
      expect(step.isComplete(state, snapshotOf(state))).toBe(false);
    });

    it('does not complete while a detonation is only armed and the zone is still occupied (#1591)', () => {
      const state = baseState();
      const snap = snapshotOf(state);
      (state as unknown as { pendingDetonation: unknown }).pendingDetonation = armed;
      expect(step.isComplete(state, snap)).toBe(false);
    });

    it('completes once the armed blast fires (blastsPerformed rises) (#1591)', () => {
      const state = baseState();
      const snap = snapshotOf(state);
      (state as unknown as { pendingDetonation: unknown }).pendingDetonation = armed;
      (state as unknown as { levelStats: { blastsPerformed: number } }).levelStats = { blastsPerformed: 1 };
      (state as unknown as { pendingDetonation: unknown }).pendingDetonation = null;
      expect(step.isComplete(state, snap)).toBe(true);
    });

    it('completes when a blast was performed since the snapshot (clear zone fired at once)', () => {
      const state = baseState({ employees: { employees: [] }, vehicles: { vehicles: [] } });
      const snap = snapshotOf(state);
      (state as unknown as { levelStats: { blastsPerformed: number } }).levelStats = { blastsPerformed: 1 };
      expect(step.isComplete(state, snap)).toBe(true);
    });

    it('does not complete when blastsPerformed was already high at snapshot time and did not rise', () => {
      const state = baseState({ levelStats: { blastsPerformed: 3 } });
      const snap = snapshotOf(state);
      expect(step.isComplete(state, snap)).toBe(false);
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

  // ── #949: retuned scripted blast plan ─────────────────────────────────────
  // The tutorial's own drill-plan/charge commands used to overload/under-stem
  // a too-tight 5m grid (spacing:5 depth:8, amount:5kg stemming:2m) into a
  // blast that rated CATASTROPHIC — a teaching moment that taught the
  // opposite of what a tutorial should. #949 retunes both, verified live
  // against the real engine (build_ramp box-cut first, then this exact plan)
  // to rate PERFECT with zero casualties/destruction. calculateRating's own
  // thresholds (BlastExecution.ts) are untouched — only the tutorial's plan
  // parameters move.
  describe('retuned scripted blast plan (#949)', () => {
    it('drill-plan orders a 4m-spacing grid at the REGION.drill origin, not the old overloaded 5m-spacing plan', () => {
      const step = TUTORIAL_STEPS.find((s) => s.id === 'drill-plan')!;
      expect(step.commands).toEqual([
        `drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:${REGION.drill.x1},${REGION.drill.z1}`,
      ]);
    });

    it('charge orders 4kg with 2.5m stemming, not the old 5kg/2m under-stemmed order', () => {
      const step = TUTORIAL_STEPS.find((s) => s.id === 'charge')!;
      expect(step.commands).toEqual([
        'charge hole:* explosive:boomite amount:4 stemming:2.5',
      ]);
    });

    it('has no sequence step (detonation sequencing was removed, #1344)', () => {
      expect(TUTORIAL_STEPS.find((s) => s.id === 'sequence')).toBeUndefined();
      expect(TUTORIAL_STEPS.some((s) => s.commands?.some((c) => c.startsWith('sequence')))).toBe(false);
    });
  });
});

// ── #1210: box-cut step completion is order/id based, not NavGrid-based ────
//
// The box-cut step used to complete once a NavCell classified 'ramp'
// appeared in state.navGrid — but navGrid classification depends on the
// carve actually reaching walkable ground, which the earlier UI/core
// disagreement on derived ramp length (#1210's root cause) could silently
// prevent even after a ramp order was accepted. Completion now tracks the
// order itself: captureSnapshot remembers `state.nextPlannedRampId` before
// the order, and isComplete watches for a ramp whose id is at/after that
// snapshot to disappear from `state.plannedRamps` — which happens exactly
// once its excavation finishes (TaskCompletionEffects.ts splices a
// PlannedRamp out once its last segment lands) or the order is cancelled.
// A ramp order that fails validation never increments nextPlannedRampId at
// all, so the "unchanged from the snapshot" branch alone keeps a failed
// order from ever reading complete.

describe('box-cut step (#1210) — completion tracks nextPlannedRampId/plannedRamps, not NavGrid', () => {
  const boxCutStep = TUTORIAL_STEPS.find((s) => s.id === 'box-cut')!;

  function stateWith(fields: Partial<GameState>): GameState {
    return fields as unknown as GameState;
  }

  it('the step exists and carries a captureSnapshot', () => {
    expect(boxCutStep).toBeDefined();
    expect(boxCutStep.captureSnapshot).toBeDefined();
  });

  it('captureSnapshot returns { prevNextRampId: state.nextPlannedRampId ?? 1 }', () => {
    expect(boxCutStep.captureSnapshot!(stateWith({ nextPlannedRampId: 5 }))).toEqual({ prevNextRampId: 5 });
    expect(boxCutStep.captureSnapshot!(stateWith({ nextPlannedRampId: 1 }))).toEqual({ prevNextRampId: 1 });
  });

  it('captureSnapshot defaults prevNextRampId to 1 when nextPlannedRampId is undefined', () => {
    expect(boxCutStep.captureSnapshot!(stateWith({}))).toEqual({ prevNextRampId: 1 });
  });

  it('isComplete is false when nextPlannedRampId is unchanged from the snapshot (no order accepted yet)', () => {
    const before = stateWith({ nextPlannedRampId: 1, plannedRamps: [] });
    const snap = boxCutStep.captureSnapshot!(before);
    const after = stateWith({ nextPlannedRampId: 1, plannedRamps: [] });
    expect(boxCutStep.isComplete(after, snap)).toBe(false);
  });

  it('isComplete stays false when nextPlannedRampId is unchanged even if plannedRamps is non-empty (an unrelated, earlier ramp still in flight)', () => {
    const before = stateWith({ nextPlannedRampId: 3, plannedRamps: [] });
    const snap = boxCutStep.captureSnapshot!(before);
    const after = stateWith({
      nextPlannedRampId: 3,
      plannedRamps: [{ id: 1 } as unknown as GameState['plannedRamps'][number]],
    });
    expect(boxCutStep.isComplete(after, snap)).toBe(false);
  });

  // Depths 1-6 all validate for the box-cut's fixed 12-tile line
  // (computeMinimumRampLength(1..6) <= 12 < computeMinimumRampLength(7)) —
  // this loop is "any successfully-ordered ramp id progression", independent
  // of which of those depths the player actually confirmed.
  for (const depth of [1, 2, 3, 4, 5, 6]) {
    it(`depth ${depth}: isComplete is false while the newly-ordered ramp (id >= prev) is still present in plannedRamps`, () => {
      const before = stateWith({ nextPlannedRampId: 1, plannedRamps: [] });
      const snap = boxCutStep.captureSnapshot!(before);
      const after = stateWith({
        nextPlannedRampId: 2,
        plannedRamps: [{ id: 1, def: { targetDepth: depth } } as unknown as GameState['plannedRamps'][number]],
      });
      expect(boxCutStep.isComplete(after, snap)).toBe(false);
    });

    it(`depth ${depth}: isComplete is true once the newly-ordered ramp (id >= prev) is no longer present in plannedRamps (excavation finished or the order was cancelled)`, () => {
      const before = stateWith({ nextPlannedRampId: 1, plannedRamps: [] });
      const snap = boxCutStep.captureSnapshot!(before);
      const after = stateWith({ nextPlannedRampId: 2, plannedRamps: [] });
      expect(boxCutStep.isComplete(after, snap)).toBe(true);
    });
  }

  it('a stale ramp with id below prev (an older, unrelated order) does not block completion', () => {
    const before = stateWith({ nextPlannedRampId: 3, plannedRamps: [] });
    const snap = boxCutStep.captureSnapshot!(before);
    const after = stateWith({
      nextPlannedRampId: 4,
      // id 2 < prev (3): an earlier ramp from before this step opened, still
      // mid-excavation — must not hold this step open.
      plannedRamps: [{ id: 2 } as unknown as GameState['plannedRamps'][number]],
    });
    expect(boxCutStep.isComplete(after, snap)).toBe(true);
  });

  it('does not depend on NavGrid/NavCell classification at all: a populated navGrid with a ramp-classified cell does not, by itself, complete the step', () => {
    const before = stateWith({ nextPlannedRampId: 1, plannedRamps: [] });
    const snap = boxCutStep.captureSnapshot!(before);
    // nextPlannedRampId unchanged -- no order was ever accepted -- yet the
    // (old, pre-#1210) NavGrid-based check would have read this as complete:
    // a navGrid populated with a single 'ramp'-classified cell.
    const after = stateWith({
      nextPlannedRampId: 1,
      plannedRamps: [],
      navGrid: { cells: [[{ type: 'ramp' }]] } as unknown as GameState['navGrid'],
    });
    expect(boxCutStep.isComplete(after, snap)).toBe(false);
  });

  it('isComplete\'s own source no longer references NavGrid/countNavCellsByType', () => {
    const src = boxCutStep.isComplete.toString();
    expect(src).not.toMatch(/navGrid/i);
    expect(src).not.toContain('countNavCellsByType');
  });
});


describe('free-play step card (#1329/#1328) — honest about progress before the level ends', () => {
  const step = TUTORIAL_STEPS.find((s) => s.id === 'free-play')!;
  const target = getLevel(TUTORIAL_LEVEL_ID)!.unlockThreshold;
  const originalLocale = getLocale();
  afterEach(() => setLocale(originalLocale));

  function financesWithProfit(profit: number) {
    const f = createFinanceState(100000);
    if (profit > 0) addIncome(f, profit, 'contract' as never, 'test', 1);
    else if (profit < 0) addExpense(f, -profit, 'wages' as never, 'test', 1);
    return f;
  }

  function stateWith(profit: number, levelEnded = false): GameState {
    return {
      finances: financesWithProfit(profit),
      levelEnded,
      levelEndReason: levelEnded ? 'completed' : null,
      tickCount: 10,
    } as unknown as GameState;
  }

  function render(state: GameState, locale: 'en' | 'fr') {
    setLocale(locale);
    const params = step.textParamsFor ? step.textParamsFor(state) : undefined;
    return { title: t(step.titleKey), body: t(step.textKey, params) };
  }

  describe('victoryProgress', () => {
    it('zero profit leaves the whole target remaining', () => {
      expect(victoryProgress(financesWithProfit(0), target)).toEqual({ profit: 0, target, remaining: target });
    });
    it('reads profit as the financial report net profit', () => {
      const f = financesWithProfit(1200);
      expect(victoryProgress(f, target).profit).toBe(getFinancialReport(f, 0).operatingProfit);
      expect(victoryProgress(f, target).remaining).toBe(target - 1200);
    });
    it('profit above target clamps remaining to 0', () => {
      const r = victoryProgress(financesWithProfit(target + 700), target);
      expect(r.remaining).toBe(0);
      expect(r.profit).toBe(target + 700);
    });
    it('negative profit adds to what remains', () => {
      const r = victoryProgress(financesWithProfit(-300), target);
      expect(r.profit).toBe(-300);
      expect(r.remaining).toBe(target + 300);
    });
    it('profit exactly at target leaves 0', () => {
      expect(victoryProgress(financesWithProfit(target), target).remaining).toBe(0);
    });
    it('uses the supplied target, not a literal', () => {
      expect(victoryProgress(financesWithProfit(100), 250)).toEqual({ profit: 100, target: 250, remaining: 150 });
    });
  });

  describe('card text before the level ends', () => {
    it('provides textParamsFor returning profit, target and remaining', () => {
      expect(step.textParamsFor).toBeDefined();
      const p = step.textParamsFor!(stateWith(1200));
      expect(Object.keys(p)).toEqual(expect.arrayContaining(['profit', 'target', 'remaining']));
    });

    it('en title and body do not claim completion', () => {
      const { title, body } = render(stateWith(1200), 'en');
      expect(title).not.toMatch(/complete|completed|finished/i);
      expect(body).not.toMatch(/complete|completed|finished/i);
    });

    it('fr title and body do not claim completion', () => {
      const { title, body } = render(stateWith(1200), 'fr');
      expect(title).not.toMatch(/termin|accompli|compl[eé]t/i);
      expect(body).not.toMatch(/termin|accompli|compl[eé]t/i);
    });

    it('leaves no unresolved placeholders in either locale', () => {
      for (const loc of ['en', 'fr'] as const) {
        const { title, body } = render(stateWith(1200), loc);
        expect(title).not.toMatch(/[{}]/);
        expect(body).not.toMatch(/[{}]/);
      }
    });

    it('en body names profit, target and remaining, formatted', () => {
      const { body } = render(stateWith(1200), 'en');
      expect(body).toContain('1,200');
      expect(body).toContain('5,000');
      expect(body).toContain('3,800');
    });

    it('fr body carries the same figures', () => {
      const { body } = render(stateWith(1200), 'fr');
      expect(body).toMatch(/1[,\s\u202f\u00a0.]?200/);
      expect(body).toMatch(/3[,\s\u202f\u00a0.]?800/);
    });

    it('shows a zero remaining without breaking when profit already exceeds target', () => {
      const p = step.textParamsFor!(stateWith(target + 1));
      expect(String(p.remaining)).toMatch(/^\$0$/);
    });
  });

  describe('completion is unchanged', () => {
    it('is incomplete while the level runs', () => {
      expect(step.isComplete(stateWith(target + 1), {})).toBe(false);
    });
    it('completes on a genuine win', () => {
      expect(step.isComplete(stateWith(target, true), {})).toBe(true);
    });
    it('does not complete on a defeat', () => {
      const s = { ...stateWith(0, true), levelEndReason: 'bankruptcy' } as unknown as GameState;
      expect(step.isComplete(s, {})).toBe(false);
    });
  });

  describe('free-play step (#1328) — rails lifted, goal chip shown', () => {
    it('is guided:false with the goal chip and no clock-holding fields', () => {
      expect(step.guided).toBe(false);
      expect(step.goalChip).toBe(true);
      expect(step.tickBudget).toBeUndefined();
      expect(step.waitsOnWork).toBeUndefined();
    });
    it('sits between sell-ore and congratulations', () => {
      const ids = TUTORIAL_STEPS.map((x) => x.id);
      const i = ids.indexOf('free-play');
      expect(ids[i - 1]).toBe('sell-ore');
      expect(ids[i + 1]).toBe('congratulations');
    });
    it('every other step stays guided', () => {
      for (const other of TUTORIAL_STEPS) {
        if (other.id === 'free-play' || other.id === 'congratulations') continue;
        expect(other.guided, other.id).toBeUndefined();
        expect(other.goalChip, other.id).toBeUndefined();
      }
    });
    it('removed ids are gone', () => {
      const ids = TUTORIAL_STEPS.map((x) => x.id);
      for (const gone of ['set-policy', 'tick-advance', 'victory']) expect(ids).not.toContain(gone);
    });
    it('no stage entry for free-play (nothing to click)', () => {
      expect(TUTORIAL_STAGES['free-play']).toBeUndefined();
    });
  });

  describe('goalChipParams (#1328)', () => {
    it('formats profit and target as money strings', () => {
      expect(goalChipParams(stateWith(1200))).toEqual({
        profit: formatDollars(1200),
        target: formatDollars(target),
      });
    });
    it('zero profit', () => {
      expect(goalChipParams(stateWith(0)).profit).toBe(formatDollars(0));
    });
    it('negative profit reads -$N', () => {
      const p = goalChipParams(stateWith(-300));
      expect(p.profit).toBe(formatDollars(-300));
      expect(p.profit).toContain('-');
      expect(p.profit).toContain('300');
    });
    it('profit above target is reported as-is', () => {
      expect(goalChipParams(stateWith(target + 700)).profit).toBe(formatDollars(target + 700));
    });
  });

  describe('goal chip i18n (#1328)', () => {
    it.each(['en', 'fr'] as const)('%s has goal chip keys and free-play card text', (loc) => {
      setLocale(loc);
      for (const key of ['tutorial.goal_chip', 'tutorial.goal_chip_tooltip', step.titleKey, step.textKey]) {
        expect(t(key, { profit: '$1', target: '$2', remaining: '$3' }), key).not.toBe(key);
      }
      const chip = t('tutorial.goal_chip', { profit: '$1,234', target: '$5,000' });
      expect(chip).toContain('$1,234');
      expect(chip).toContain('$5,000');
    });
    it('chip text differs between en and fr', () => {
      setLocale('en');
      const en = t('tutorial.goal_chip', { profit: '$1', target: '$2' });
      setLocale('fr');
      const fr = t('tutorial.goal_chip', { profit: '$1', target: '$2' });
      expect(en).not.toBe(fr);
    });
  });
});

describe('finances step: panel already open at capture (#1628)', () => {
  const state = { isPaused: false } as GameState;
  afterEach(() => { document.body.innerHTML = ''; });
  const openPanel = (): HTMLElement => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    el.id = 'bs-finances-panel';
    el.style.display = 'flex';
    el.dataset['openCount'] = '1';
    document.body.appendChild(el);
    return el;
  };

  it('polling alone never completes when the panel was open at capture', () => {
    openPanel();
    const step = TUTORIAL_STEPS.find((s) => s.id === 'finances')!;
    const snap = step.captureSnapshot!(state);
    for (let i = 0; i < 5; i++) expect(step.isComplete(state, snap)).toBe(false);
  });

  it('completes when the open panel is re-shown (open count bumps)', () => {
    const el = openPanel();
    const step = TUTORIAL_STEPS.find((s) => s.id === 'finances')!;
    const snap = step.captureSnapshot!(state);
    expect(step.isComplete(state, snap)).toBe(false);
    el.dataset['openCount'] = '2';
    expect(step.isComplete(state, snap)).toBe(true);
  });
});
