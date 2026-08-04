// BlastSimulator2026 — Tutorial step definitions
// Defines the TutorialStep interface and ordered step array.

import type { GameState } from '../core/state/GameState.js';
import {
  createComparisonStep,
  createHireStep,
  createHireStepWithEventGuard,
  createAutoAdvanceStep,
  countNavCellsByType,
  getEmployees,
  getVehicles,
  countBuildingsOfType,
  countVehiclesWithDriver,
  TOOLBAR_TARGET,
} from './tutorialStepHelpers.js';

/** The one scripted event the tutorial fires, so the player meets the dialog. */
const TUTORIAL_EVENT_ID = 'tutorial_synergy_consultant';

export interface TutorialStep {
  id: string;
  titleKey: string;
  textKey: string;
  /**
   * Console commands equivalent to the step's objective, shown to the player as
   * a hint. These are never executed by the tutorial — completing the step is
   * the player's job.
   */
  commands?: string[];
  /**
   * Commands the tutorial runs itself when the step opens. Reserved for scripted
   * demonstrations (the event pop-up), not for doing the player's work.
   */
  autoCommands?: string[];
  autoAdvanceMs?: number;
  /**
   * Ticks this step may consume before the clock is held. Steps that wait on
   * queued work — a survey being run, ore being hauled — need more than steps
   * that are a single click. Omit for the default.
   */
  tickBudget?: number;
  /**
   * True when the step's completion depends on the simulation running — a
   * surveyor walking out, ore being hauled in. Those steps get a grace period
   * past their allowance so holding the clock cannot deadlock them. Steps that
   * merely wait on a click leave this off, so the world stops while the player
   * decides.
   */
  waitsOnWork?: boolean;
  captureSnapshot?: ((state: GameState) => Record<string, unknown>) | undefined;
  isComplete: (state: GameState, snapshot: Record<string, unknown>) => boolean;
  /**
   * CSS selector for the control the player must use. It has to point at
   * something that is on screen while the step is active — highlighting a
   * closed panel glows nothing.
   */
  highlightTarget?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // ── Step 0: time-speed ──
  {
    id: 'time-speed',
    titleKey: 'tutorial.step1.title',
    textKey: 'tutorial.step1',
    highlightTarget: '#bs-hud-top .bs-speed-btn',
    captureSnapshot: (state: GameState) => ({
      prevTimeScale: state.timeScale,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevTimeScale as number;
      return state.timeScale > prev;
    },
  },

  // ── Step 1: hire-surveyor ──
  createHireStep('hire-surveyor', 'tutorial.step2.title', 'tutorial.step2', 'surveyor'),

  // ── Step 2: survey ──
  createComparisonStep('survey', 'tutorial.step3.title', 'tutorial.step3', (s) => (s.surveyResults ?? []).length, ['survey seismic x:23 z:23'], TOOLBAR_TARGET.survey, { tickBudget: 20, waitsOnWork: true }),

  // ── Step 3: hire-driller ──
  createHireStep('hire-driller', 'tutorial.step4.title', 'tutorial.step4', 'driller'),

  // ── Step 4: box-cut ──
  // Real pits start the way this step does: an access ramp and a starter cut
  // are dug *before* the first shot, because blasted rock swells and has to
  // have somewhere to go. Firing into flat ground leaves the fragments sitting
  // in a stable layout — nothing visibly collapses, and the player learns
  // nothing about free faces. The cut is dug just west of where the drill
  // pattern goes, so the first blast breaks toward it.
  {
    id: 'box-cut',
    titleKey: 'tutorial.step_boxcut.title',
    textKey: 'tutorial.step_boxcut',
    highlightTarget: TOOLBAR_TARGET.build,
    commands: ['build_ramp start:16,19 end:16,31 depth:8'],
    waitsOnWork: true,
    captureSnapshot: (state: GameState) => ({
      prevRampCount: state.navGrid
        ? countNavCellsByType(state.navGrid.cells, 'ramp')
        : 0,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevRampCount as number;
      const current = state.navGrid
        ? countNavCellsByType(state.navGrid.cells, 'ramp')
        : 0;
      return current > prev;
    },
  },

  // ── Step 5: drill-plan ──
  createComparisonStep('drill-plan', 'tutorial.step5.title', 'tutorial.step5', (s) => (s.drillHoles ?? []).length, ['drill_plan grid rows:3 cols:3 spacing:5 depth:8 start:20,20'], TOOLBAR_TARGET.blast),

  // ── Step 5: charge ──
  createComparisonStep('charge', 'tutorial.step6.title', 'tutorial.step6', (s) => Object.keys(s.chargesByHole ?? {}).length, ['charge hole:* explosive:boomite amount:5 stemming:2'], TOOLBAR_TARGET.blast),

  // ── Step 6: sequence ──
  createComparisonStep('sequence', 'tutorial.step7.title', 'tutorial.step7', (s) => Object.keys(s.sequenceDelays ?? {}).length, ['sequence auto delay_step:25'], TOOLBAR_TARGET.blast),

  // ── Step 7: blast ──
  // Counts blasts fired as well as ore types collected. Keying only on ore
  // dead-ends the tutorial when a legitimate blast comes up barren — the player
  // did exactly what was asked and the card would never move on.
  createComparisonStep('blast', 'tutorial.step8.title', 'tutorial.step8', (s) => (s.levelStats?.blastsPerformed ?? 0) + Object.keys(s.collectedOre ?? {}).length, ['blast'], TOOLBAR_TARGET.blast),

  // ── Step 8: scores ──
  createAutoAdvanceStep('scores', 'tutorial.step9.title', 'tutorial.step9', (state: GameState) => ({
    scores: { ...(state.scores ?? {}) },
    collectedOre: { ...(state.collectedOre ?? {}) },
  }), '#bs-hud-scores'),

  // ── Step 9: event-fire-resolve ──
  // The only step the tutorial drives itself: it fast-forwards a few ticks and
  // fires the scripted consultant event so the player sees the dialog once.
  {
    id: 'event-fire-resolve',
    titleKey: 'tutorial.step10.title',
    textKey: 'tutorial.step10',
    highlightTarget: '#bs-hud-top .bs-event-badge',
    autoCommands: ['tick 3', 'event fire tutorial_synergy_consultant'],
    // The step asks the player to answer the dialog, so it completes on
    // fired-then-resolved. Completing on "an event is pending" was only true
    // while the dialog was open: a player who answered between two polls left
    // the tutorial stuck on this card with nothing left to click, because the
    // event fires at most once per level and cannot be brought back.
    isComplete: (state: GameState) => {
      const events = state.events;
      if (!events) return false;
      return (events.firedEventIds ?? []).includes(TUTORIAL_EVENT_ID)
        && events.pendingEvent == null;
    },
  },

  // ── Step 10: hire-manager ──
  createHireStepWithEventGuard('hire-manager', 'tutorial.step11.title', 'tutorial.step11', 'manager'),

  // ── Step 11: contract-accept ──
  // Offers are regenerated on a timer and the oldest is dropped, so the list
  // rearranges itself under a player who is reading it. Hold the clock almost
  // immediately: nothing about choosing an offer needs time to pass.
  createComparisonStep('contract-accept', 'tutorial.step12.title', 'tutorial.step12', (s) => (s.contracts?.active ?? []).length, ['contract accept 1'], TOOLBAR_TARGET.contracts, { tickBudget: 1 }),

  // ── Step 12: hire-driver ──
  createHireStep('hire-driver', 'tutorial.step13.title', 'tutorial.step13', 'driver'),

  // ── Step 13: vehicle-buy-assign ──
  // Uses the naive count-increased + existence-check pattern that #409 fixed
  // for hire steps. Safe here only because the tutorial buys its first-ever
  // vehicle at this step: there is no pre-existing vehicle for the "assigned"
  // half of the check to false-positive on, unlike hire steps where a role
  // could already be staffed before the step opened. Re-evaluate if a future
  // tutorial revision buys a vehicle earlier or reorders this step.
  {
    id: 'vehicle-buy-assign',
    titleKey: 'tutorial.step14.title',
    textKey: 'tutorial.step14',
    highlightTarget: TOOLBAR_TARGET.vehicles,
    // The driver hired one step earlier is employee #4.
    commands: ['vehicle buy debris_hauler', 'vehicle driver 1 4'],
    // Assigning a driver does not seat them: it sends them walking to the
    // vehicle, and ArrivalGate makes them the driver on arrival. That walk
    // needs the clock, so this step must wait on the simulation — without it
    // the allowance ran out while the player was still shopping, the clock
    // held for good, and the driver never took a step. The player saw an
    // Assign button that did nothing and the tutorial never advanced.
    tickBudget: 20,
    waitsOnWork: true,
    captureSnapshot: (state: GameState) => ({
      prevVehicleCount: getVehicles(state).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevVehicleCount as number;
      return (
        getVehicles(state).length > prev &&
        countVehiclesWithDriver(state) > 0
      );
    },
  },

  // ── Step 14: build-storage ──
  createComparisonStep('build-storage', 'tutorial.step15.title', 'tutorial.step15', (s) => countBuildingsOfType(s, 'freight_warehouse'), ['build freight_warehouse at:12,8'], TOOLBAR_TARGET.build),

  // ── Step 14b: haul-debris ──
  // Fires when stored mass increases — the same "value went up" pattern every
  // other comparison step uses. Points at the Vehicles toolbar; the console
  // hint names the reachability-aware fragment id a player would look up via
  // the Haul button rather than guessing one.
  createComparisonStep(
    'haul-debris',
    'tutorial.step_haul.title',
    'tutorial.step_haul',
    (s) => s.logistics?.storedMassKg ?? 0,
    ['vehicle haul <vehicleId> fragment:<fragmentId>'],
    TOOLBAR_TARGET.vehicles,
    { tickBudget: 20, waitsOnWork: true },
  ),

  // ── Step 15: contract-deliver ──
  createComparisonStep('contract-deliver', 'tutorial.step16.title', 'tutorial.step16', (s) => (s.contracts?.completedHistory ?? []).length, ['contract deliver 1 amount:5000'], TOOLBAR_TARGET.contracts, { tickBudget: 20, waitsOnWork: true }),

  // ── Step 16: finances ──
  createAutoAdvanceStep('finances', 'tutorial.step17.title', 'tutorial.step17', (state: GameState) => ({
    cash: state.cash,
    contracts: { ...(state.contracts ?? {}) },
  }), '#bs-hud-top .bs-balance'),

  // ── Step 18: needs ──
  createAutoAdvanceStep('needs', 'tutorial.step19.title', 'tutorial.step19', (state: GameState) => ({
    employees: getEmployees(state).map(e => ({
      id: (e as unknown as Record<string, unknown>).id as number ?? 0,
      hunger: (e as unknown as Record<string, unknown>).hunger as number ?? 0,
      fatigue: (e as unknown as Record<string, unknown>).fatigue as number ?? 0,
      breakNeed: (e as unknown as Record<string, unknown>).breakNeed as number ?? 0,
    })),
  }), TOOLBAR_TARGET.employees),

  // ── Step 19: set-policy ──
  {
    id: 'set-policy',
    titleKey: 'tutorial.step20.title',
    textKey: 'tutorial.step20',
    commands: ['set_policy mode:shift_8h'],
    highlightTarget: TOOLBAR_TARGET.settings,
    // Completes when a policy is applied, not when one of its values happens to
    // differ. Comparing values left a player who pressed Apply on the settings
    // already showing — the common case, since the form mirrors the policy in
    // force — watching a "Site policy updated" message while the tutorial sat
    // on the step forever.
    captureSnapshot: (state: GameState) => ({
      policyRevision: state.sitePolicy?.revision ?? 0,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const before = (snapshot.policyRevision as number | undefined) ?? 0;
      return (state.sitePolicy?.revision ?? 0) > before;
    },
  },

  // ── Step 20: tick-advance ──
  {
    id: 'tick-advance',
    titleKey: 'tutorial.step21.title',
    textKey: 'tutorial.step21',
    // The whole point of this step is that the clock runs.
    tickBudget: 30,
    waitsOnWork: true,
    highlightTarget: '#bs-hud-top .bs-speed-btn',
    captureSnapshot: (state: GameState) => ({
      prevTick: state.tickCount ?? 0,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevTick as number;
      return (state.tickCount ?? 0) > prev + 5;
    },
  },

  // ── Step 21: victory ──
  {
    id: 'victory',
    titleKey: 'tutorial.step22.title',
    textKey: 'tutorial.step22',
    // Waits on the level's profit target, which only accrues while time runs.
    tickBudget: 60,
    waitsOnWork: true,
    highlightTarget: '#bs-hud-scores',
    isComplete: (state: GameState) => state.levelEnded === true,
  },

  // ── Step 22: congratulations ──
  {
    id: 'congratulations',
    titleKey: 'tutorial.complete_title',
    textKey: 'tutorial.complete_text',
    isComplete: () => true,
  },
];

export const TOTAL_TUTORIAL_STEPS = TUTORIAL_STEPS.length;
