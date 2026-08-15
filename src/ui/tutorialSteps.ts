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

  // ── Step 3b: build-driving-center ──
  // #553: drill_hole became a queued, vehicle-gated action -- a driller
  // physically drives a drill_rig to each hole -- but hiring only grants the
  // driller their 'blasting' qualification (ROLE_STARTING_QUALIFICATION,
  // Employee.ts), never the driving.drill_rig licence a drill_rig needs. With
  // nothing in the tutorial ever granting that licence or buying a drill_rig,
  // the drill-plan step below could never land a single hole -- holeCount
  // stuck at 0 forever, the same deadlock class #552 fixed for hauling. These
  // three steps (build a school, train the licence, buy+crew the rig) close
  // that gap the same way vehicle-buy-assign already does for the hauler.
  createComparisonStep(
    'build-driving-center',
    'tutorial.step_drivingcenter.title',
    'tutorial.step_drivingcenter',
    (s) => countBuildingsOfType(s, 'driving_center'),
    ['build driving_center at:10,8'],
    TOOLBAR_TARGET.build,
  ),

  // ── Step 3c: train-driller ──
  // Not a comparison step: the driller (employee #2, hired just above) holds
  // no driving.drill_rig qualification to begin with, so "value increased"
  // has nothing to increase from -- completion is the licence's existence.
  {
    id: 'train-driller',
    titleKey: 'tutorial.step_traindriller.title',
    textKey: 'tutorial.step_traindriller',
    commands: ['employee train 2 skill:driving.drill_rig'],
    highlightTarget: TOOLBAR_TARGET.employees,
    tickBudget: 25,
    waitsOnWork: true,
    isComplete: (state: GameState) => getEmployees(state).some((e) => {
      const raw = e as unknown as Record<string, unknown>;
      if (raw.role !== 'driller') return false;
      const quals = raw.qualifications as Array<{ category: string }> | undefined;
      return (quals ?? []).some((q) => q.category === 'driving.drill_rig');
    }),
  },

  // ── Step 3d: buy-drill-rig-assign ──
  // Same naive count-increased + existence-check shape as vehicle-buy-assign
  // below, but that shape is only safe for a step buying the tutorial's
  // first-ever vehicle (see that step's own comment) -- which, now that this
  // step exists, is THIS one, not that one. Snapshotting which vehicle ids
  // already had a driver and requiring a driven vehicle outside that set
  // keeps this step from false-completing on some other already-driven
  // vehicle, the same guard vehicle-buy-assign now needs for the same reason.
  {
    id: 'buy-drill-rig-assign',
    titleKey: 'tutorial.step_buydrillrig.title',
    textKey: 'tutorial.step_buydrillrig',
    highlightTarget: TOOLBAR_TARGET.vehicles,
    // The driller trained one step earlier is employee #2.
    commands: ['vehicle buy drill_rig', 'vehicle driver 1 2'],
    tickBudget: 20,
    waitsOnWork: true,
    captureSnapshot: (state: GameState) => ({
      prevVehicleCount: getVehicles(state).length,
      prevDrivenVehicleIds: getVehicles(state).filter((v) => v.driverId !== null).map((v) => v.id),
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prevCount = snapshot.prevVehicleCount as number;
      const prevDriven = snapshot.prevDrivenVehicleIds as number[];
      return (
        getVehicles(state).length > prevCount &&
        getVehicles(state).some((v) => v.driverId !== null && !prevDriven.includes(v.id))
      );
    },
  },

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
  // #553: no longer the tutorial's first-ever vehicle purchase -- the
  // build-driving-center/train-driller/buy-drill-rig-assign trio above buys
  // and crews a drill_rig long before this step, and that driller keeps
  // driving it (or, if the blast destroyed the rig, simply keeps the
  // driving.drill_rig licence) the whole time in between. The naive
  // count-increased + "some vehicle has a driver" check #409 used for hire
  // steps would false-complete the instant this step opened, since the
  // drill_rig's own driver already satisfies "some vehicle has a driver".
  // Snapshotting which vehicle ids already had a driver and requiring a
  // driven vehicle outside that set (the same guard buy-drill-rig-assign
  // above needs, for the same reason) keeps this step honest again.
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
      prevDrivenVehicleIds: getVehicles(state).filter((v) => v.driverId !== null).map((v) => v.id),
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prevCount = snapshot.prevVehicleCount as number;
      const prevDriven = snapshot.prevDrivenVehicleIds as number[];
      return (
        getVehicles(state).length > prevCount &&
        getVehicles(state).some((v) => v.driverId !== null && !prevDriven.includes(v.id))
      );
    },
  },

  // ── Step 14: build-storage ──
  createComparisonStep('build-storage', 'tutorial.step15.title', 'tutorial.step15', (s) => countBuildingsOfType(s, 'freight_warehouse'), ['build freight_warehouse at:6,6'], TOOLBAR_TARGET.build),

  // ── Step 14b: haul-debris ──
  // Fires when stored mass increases — the same "value went up" pattern every
  // other comparison step uses. Hauling is self-dispatching (#552): a
  // qualified idle employee auto-claims a free debris_hauler and drives it to
  // the nearest fragment on its own, no player click required — so this step
  // carries no command hint (nothing to type or press) and just points at the
  // Fleet panel to watch it happen.
  createComparisonStep(
    'haul-debris',
    'tutorial.step_haul.title',
    'tutorial.step_haul',
    (s) => s.logistics?.storedMassKg ?? 0,
    undefined,
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
