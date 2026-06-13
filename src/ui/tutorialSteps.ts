// BlastSimulator2026 — Tutorial step definitions
// Defines the TutorialStep interface and ordered step array.

import type { GameState } from '../core/state/GameState.js';
import type { ShiftMode } from '../core/entities/SitePolicy.js';
import {
  createHireStep,
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
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // ── Step 0: time-speed ──
  {
    id: 'time-speed',
    titleKey: 'tutorial.step1.title',
    textKey: 'tutorial.step1',
    captureSnapshot: (state: GameState) => ({
      prevTimeScale: state.timeScale,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevTimeScale as number;
      return state.timeScale >= prev;
    },
  },

  // ── Step 1: hire-surveyor ──
  createHireStep('hire-surveyor', 'tutorial.step2.title', 'tutorial.step2', 'surveyor'),

  // ── Step 2: survey ──
  {
    id: 'survey',
    titleKey: 'tutorial.step3.title',
    textKey: 'tutorial.step3',
    commands: ['survey seismic'],
    captureSnapshot: (state: GameState) => ({
      prevSurveyCount: (state.surveyResults ?? []).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevSurveyCount as number;
      return (state.surveyResults ?? []).length > prev;
    },
  },

  // ── Step 3: hire-driller ──
  createHireStep('hire-driller', 'tutorial.step4.title', 'tutorial.step4', 'driller'),

  // ── Step 4: drill-plan ──
  {
    id: 'drill-plan',
    titleKey: 'tutorial.step5.title',
    textKey: 'tutorial.step5',
    commands: ['drill plan'],
    captureSnapshot: (state: GameState) => ({
      prevDrillCount: (state.drillHoles ?? []).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevDrillCount as number;
      return (state.drillHoles ?? []).length > prev;
    },
  },

  // ── Step 5: charge ──
  {
    id: 'charge',
    titleKey: 'tutorial.step6.title',
    textKey: 'tutorial.step6',
    commands: ['blast plan'],
    captureSnapshot: (state: GameState) => ({
      prevChargeCount: Object.keys(state.chargesByHole ?? {}).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevChargeCount as number;
      return Object.keys(state.chargesByHole ?? {}).length > prev;
    },
  },

  // ── Step 6: sequence ──
  {
    id: 'sequence',
    titleKey: 'tutorial.step7.title',
    textKey: 'tutorial.step7',
    commands: ['blast plan'],
    captureSnapshot: (state: GameState) => ({
      prevSeqCount: Object.keys(state.sequenceDelays ?? {}).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevSeqCount as number;
      return Object.keys(state.sequenceDelays ?? {}).length > prev;
    },
  },

  // ── Step 7: blast ──
  {
    id: 'blast',
    titleKey: 'tutorial.step8.title',
    textKey: 'tutorial.step8',
    commands: ['blast execute'],
    captureSnapshot: (state: GameState) => ({
      prevOreCount: Object.keys(state.collectedOre ?? {}).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevOreCount as number;
      return Object.keys(state.collectedOre ?? {}).length > prev;
    },
  },

  // ── Step 8: scores ──
  createAutoAdvanceStep('scores', 'tutorial.step9.title', 'tutorial.step9', (state: GameState) => ({
    scores: { ...(state.scores ?? {}) },
    collectedOre: { ...(state.collectedOre ?? {}) },
  })),

  // ── Step 9: event-fire-resolve ──
  {
    id: 'event-fire-resolve',
    titleKey: 'tutorial.step10.title',
    textKey: 'tutorial.step10',
    captureSnapshot: (state: GameState) => ({
      prevFiredCount: (state.events?.firedEventIds ?? []).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevFiredCount as number;
      return (state.events?.firedEventIds ?? []).length > prev;
    },
  },

  // ── Step 10: hire-manager ──
  createHireStep('hire-manager', 'tutorial.step11.title', 'tutorial.step11', 'manager'),

  // ── Step 11: contract-accept ──
  {
    id: 'contract-accept',
    titleKey: 'tutorial.step12.title',
    textKey: 'tutorial.step12',
    commands: ['contracts'],
    captureSnapshot: (state: GameState) => ({
      prevActiveCount: (state.contracts?.active ?? []).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevActiveCount as number;
      return (state.contracts?.active ?? []).length > prev;
    },
  },

  // ── Step 12: hire-driver ──
  createHireStep('hire-driver', 'tutorial.step13.title', 'tutorial.step13', 'driver'),

  // ── Step 13: vehicle-buy-assign ──
  {
    id: 'vehicle-buy-assign',
    titleKey: 'tutorial.step14.title',
    textKey: 'tutorial.step14',
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
  {
    id: 'build-storage',
    titleKey: 'tutorial.step15.title',
    textKey: 'tutorial.step15',
    commands: ['build freight_warehouse'],
    captureSnapshot: (state: GameState) => ({
      prevStorageCount: countBuildingsOfType(state, 'freight_warehouse'),
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevStorageCount as number;
      return countBuildingsOfType(state, 'freight_warehouse') > prev;
    },
  },

  // ── Step 15: contract-deliver ──
  {
    id: 'contract-deliver',
    titleKey: 'tutorial.step16.title',
    textKey: 'tutorial.step16',
    commands: ['logistics'],
    captureSnapshot: (state: GameState) => ({
      prevCompletedCount: (state.contracts?.completedHistory ?? []).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevCompletedCount as number;
      return (state.contracts?.completedHistory ?? []).length > prev;
    },
  },

  // ── Step 16: finances ──
  createAutoAdvanceStep('finances', 'tutorial.step17.title', 'tutorial.step17', (state: GameState) => ({
    cash: state.cash,
    contracts: { ...(state.contracts ?? {}) },
  })),

  // ── Step 17: build-ramp ──
  {
    id: 'build-ramp',
    titleKey: 'tutorial.step18.title',
    textKey: 'tutorial.step18',
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
  })),

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
    isComplete: (state: GameState) => state.levelEnded === true,
  },

  // ── Step 22: congratulations ──
  {
    id: 'congratulations',
    titleKey: 'tutorial.step23.title',
    textKey: 'tutorial.step23',
    isComplete: () => true,
  },
];

export const TOTAL_TUTORIAL_STEPS = TUTORIAL_STEPS.length;
