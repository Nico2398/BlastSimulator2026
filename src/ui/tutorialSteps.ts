// BlastSimulator2026 — Tutorial step definitions
// Defines the TutorialStep interface and ordered step array.

import type { GameState } from '../core/state/GameState.js';
import type { ShiftMode } from '../core/entities/SitePolicy.js';
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
  createComparisonStep('survey', 'tutorial.step3.title', 'tutorial.step3', (s) => (s.surveyResults ?? []).length, ['survey seismic x:12 z:12'], TOOLBAR_TARGET.survey),

  // ── Step 3: hire-driller ──
  createHireStep('hire-driller', 'tutorial.step4.title', 'tutorial.step4', 'driller'),

  // ── Step 4: drill-plan ──
  createComparisonStep('drill-plan', 'tutorial.step5.title', 'tutorial.step5', (s) => (s.drillHoles ?? []).length, ['drill_plan grid rows:3 cols:3 spacing:5 depth:8 start:8,8'], TOOLBAR_TARGET.blast),

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
  createComparisonStep('contract-accept', 'tutorial.step12.title', 'tutorial.step12', (s) => (s.contracts?.active ?? []).length, ['contract accept 1'], TOOLBAR_TARGET.contracts),

  // ── Step 12: hire-driver ──
  createHireStep('hire-driver', 'tutorial.step13.title', 'tutorial.step13', 'driver'),

  // ── Step 13: vehicle-buy-assign ──
  {
    id: 'vehicle-buy-assign',
    titleKey: 'tutorial.step14.title',
    textKey: 'tutorial.step14',
    highlightTarget: TOOLBAR_TARGET.vehicles,
    commands: ['vehicle buy debris_hauler', 'vehicle driver 1 1'],
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

  // ── Step 15: contract-deliver ──
  createComparisonStep('contract-deliver', 'tutorial.step16.title', 'tutorial.step16', (s) => (s.contracts?.completedHistory ?? []).length, ['contract deliver 1 amount:5000'], TOOLBAR_TARGET.contracts),

  // ── Step 16: finances ──
  createAutoAdvanceStep('finances', 'tutorial.step17.title', 'tutorial.step17', (state: GameState) => ({
    cash: state.cash,
    contracts: { ...(state.contracts ?? {}) },
  }), '#bs-hud-top .bs-balance'),

  // ── Step 17: build-ramp ──
  {
    id: 'build-ramp',
    titleKey: 'tutorial.step18.title',
    textKey: 'tutorial.step18',
    highlightTarget: TOOLBAR_TARGET.build,
    commands: ['build_ramp start:10,15 end:10,25'],
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
    captureSnapshot: (state: GameState) => ({
      shiftMode: state.sitePolicy?.shiftMode,
      hungerRestThreshold: state.sitePolicy?.hungerRestThreshold,
      fatigueRestThreshold: state.sitePolicy?.fatigueRestThreshold,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const snapShift = snapshot.shiftMode as ShiftMode | undefined;
      const snapHunger = snapshot.hungerRestThreshold as number | undefined;
      const snapFatigue = snapshot.fatigueRestThreshold as number | undefined;
      const sp = state.sitePolicy;
      if (!sp) return false;
      return (
        sp.shiftMode !== snapShift ||
        sp.hungerRestThreshold !== snapHunger ||
        sp.fatigueRestThreshold !== snapFatigue
      );
    },
  },

  // ── Step 20: tick-advance ──
  {
    id: 'tick-advance',
    titleKey: 'tutorial.step21.title',
    textKey: 'tutorial.step21',
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
