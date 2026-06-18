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
} from './tutorialStepHelpers.js';

export interface TutorialStep {
  id: string;
  titleKey: string;
  textKey: string;
  commands?: string[];
  autoAdvanceMs?: number;
  captureSnapshot?: ((state: GameState) => Record<string, unknown>) | undefined;
  isComplete: (state: GameState, snapshot: Record<string, unknown>) => boolean;
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
      return state.timeScale >= prev;
    },
  },

  // ── Step 1: hire-surveyor ──
  createHireStep('hire-surveyor', 'tutorial.step2.title', 'tutorial.step2', 'surveyor', '#bs-employee-panel'),

  // ── Step 2: survey ──
  createComparisonStep('survey', 'tutorial.step3.title', 'tutorial.step3', (s) => (s.surveyResults ?? []).length, ['survey seismic'], '#bs-survey-panel'),

  // ── Step 3: hire-driller ──
  createHireStep('hire-driller', 'tutorial.step4.title', 'tutorial.step4', 'driller', '#bs-employee-panel'),

  // ── Step 4: drill-plan ──
  createComparisonStep('drill-plan', 'tutorial.step5.title', 'tutorial.step5', (s) => (s.drillHoles ?? []).length, ['drill plan'], '#bs-blast-panel'),

  // ── Step 5: charge ──
  createComparisonStep('charge', 'tutorial.step6.title', 'tutorial.step6', (s) => Object.keys(s.chargesByHole ?? {}).length, ['blast plan'], '#bs-blast-panel'),

  // ── Step 6: sequence ──
  createComparisonStep('sequence', 'tutorial.step7.title', 'tutorial.step7', (s) => Object.keys(s.sequenceDelays ?? {}).length, ['blast plan'], '#bs-blast-panel'),

  // ── Step 7: blast ──
  createComparisonStep('blast', 'tutorial.step8.title', 'tutorial.step8', (s) => Object.keys(s.collectedOre ?? {}).length, ['blast execute'], '#bs-blast-panel'),

  // ── Step 8: scores ──
  createAutoAdvanceStep('scores', 'tutorial.step9.title', 'tutorial.step9', (state: GameState) => ({
    scores: { ...(state.scores ?? {}) },
    collectedOre: { ...(state.collectedOre ?? {}) },
  }), '#bs-hud-scores'),

  // ── Step 9: event-fire-resolve ──
  {
    id: 'event-fire-resolve',
    titleKey: 'tutorial.step10.title',
    textKey: 'tutorial.step10',
    highlightTarget: '#bs-event-dialog',
    commands: ['tick 3'],
    isComplete: (state: GameState) => {
      return state.events?.pendingEvent != null;
    },
  },

  // ── Step 10: hire-manager ──
  createHireStepWithEventGuard('hire-manager', 'tutorial.step11.title', 'tutorial.step11', 'manager', '#bs-employee-panel'),

  // ── Step 11: contract-accept ──
  createComparisonStep('contract-accept', 'tutorial.step12.title', 'tutorial.step12', (s) => (s.contracts?.active ?? []).length, ['contracts'], '#bs-contract-panel'),

  // ── Step 12: hire-driver ──
  createHireStep('hire-driver', 'tutorial.step13.title', 'tutorial.step13', 'driver', '#bs-employee-panel'),

  // ── Step 13: vehicle-buy-assign ──
  {
    id: 'vehicle-buy-assign',
    titleKey: 'tutorial.step14.title',
    textKey: 'tutorial.step14',
    highlightTarget: '#bs-vehicle-panel',
    commands: ['buy debris_hauler'],
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
  createComparisonStep('build-storage', 'tutorial.step15.title', 'tutorial.step15', (s) => countBuildingsOfType(s, 'freight_warehouse'), ['build freight_warehouse'], '#bs-build-panel'),

  // ── Step 15: contract-deliver ──
  createComparisonStep('contract-deliver', 'tutorial.step16.title', 'tutorial.step16', (s) => (s.contracts?.completedHistory ?? []).length, ['logistics'], '#bs-contract-panel'),

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
    highlightTarget: '#bs-build-panel',
    commands: ['build ramp'],
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
  }), '#bs-employee-panel'),

  // ── Step 19: set-policy ──
  {
    id: 'set-policy',
    titleKey: 'tutorial.step20.title',
    textKey: 'tutorial.step20',
    commands: ['policy'],
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
