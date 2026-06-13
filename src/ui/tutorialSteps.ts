// BlastSimulator2026 — Tutorial step definitions
// Defines the TutorialStep interface and ordered step array.

import type { GameState } from '../core/state/GameState.js';

export interface TutorialStep {
  id: string;
  titleKey: string;
  textKey: string;
  commands?: string[];
  autoAdvanceMs?: number;
  captureSnapshot?: (state: GameState) => Record<string, unknown>;
  isComplete: (state: GameState, snapshot: Record<string, unknown>) => boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a "hire employee" tutorial step for a specific role. */
function createHireStep(
  id: string,
  titleKey: string,
  textKey: string,
  role: string,
): TutorialStep {
  return {
    id,
    titleKey,
    textKey,
    commands: ['hire employee'],
    captureSnapshot: (state) => ({ prevEmployeeCount: state.employees?.employees?.length ?? 0 }),
    isComplete: (state, snapshot) =>
      (state.employees?.employees?.length ?? 0) > (snapshot.prevEmployeeCount as number) &&
      (state.employees?.employees ?? []).some(e => e.role === role),
  };
}

/** Create an auto-advance informational step (scores, finances, needs). */
function createAutoAdvanceStep(
  id: string,
  titleKey: string,
  textKey: string,
  captureSnapshot: (state: GameState) => Record<string, unknown>,
): TutorialStep {
  return {
    id,
    titleKey,
    textKey,
    autoAdvanceMs: 2000,
    captureSnapshot,
    isComplete: () => true,
  };
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

export const TUTORIAL_STEPS: TutorialStep[] = [
  // Step 0: time-speed — Increase game speed
  {
    id: 'time-speed',
    titleKey: 'tutorial.step1.title',
    textKey: 'tutorial.step1',
    captureSnapshot: (state) => ({ prevTimeScale: state.timeScale }),
    isComplete: (state, snapshot) => state.timeScale > (snapshot.prevTimeScale as number),
  },
  // Step 1: hire-surveyor — Hire a surveyor employee
  createHireStep('hire-surveyor', 'tutorial.step2.title', 'tutorial.step2', 'surveyor'),
  // Step 2: survey — Perform a seismic survey
  {
    id: 'survey',
    titleKey: 'tutorial.step3.title',
    textKey: 'tutorial.step3',
    commands: ['survey seismic'],
    captureSnapshot: (state) => ({ prevSurveyCount: state.surveyResults?.length ?? 0 }),
    isComplete: (state, snapshot) =>
      (state.surveyResults?.length ?? 0) > (snapshot.prevSurveyCount as number),
  },
  // Step 3: hire-driller — Hire a driller employee
  createHireStep('hire-driller', 'tutorial.step4.title', 'tutorial.step4', 'driller'),
  // Step 4: drill-plan — Place drill holes
  {
    id: 'drill-plan',
    titleKey: 'tutorial.step5.title',
    textKey: 'tutorial.step5',
    commands: ['drill plan'],
    captureSnapshot: (state) => ({ prevDrillCount: state.drillHoles?.length ?? 0 }),
    isComplete: (state, snapshot) =>
      (state.drillHoles?.length ?? 0) > (snapshot.prevDrillCount as number),
  },
  // Step 5: charge — Set explosive charges
  {
    id: 'charge',
    titleKey: 'tutorial.step6.title',
    textKey: 'tutorial.step6',
    commands: ['blast plan'],
    captureSnapshot: (state) => ({ prevChargeCount: Object.keys(state.chargesByHole ?? {}).length }),
    isComplete: (state, snapshot) =>
      Object.keys(state.chargesByHole ?? {}).length > (snapshot.prevChargeCount as number),
  },
  // Step 6: sequence — Configure detonation delays
  {
    id: 'sequence',
    titleKey: 'tutorial.step7.title',
    textKey: 'tutorial.step7',
    commands: ['blast plan'],
    captureSnapshot: (state) => ({ prevSeqCount: Object.keys(state.sequenceDelays ?? {}).length }),
    isComplete: (state, snapshot) =>
      Object.keys(state.sequenceDelays ?? {}).length > (snapshot.prevSeqCount as number),
  },
  // Step 7: blast — Execute the blast
  {
    id: 'blast',
    titleKey: 'tutorial.step8.title',
    textKey: 'tutorial.step8',
    commands: ['blast execute'],
    captureSnapshot: (state) => ({ prevOreCount: Object.keys(state.collectedOre ?? {}).length }),
    isComplete: (state, snapshot) =>
      Object.keys(state.collectedOre ?? {}).length > (snapshot.prevOreCount as number),
  },
  // Step 8: scores — Overview of scores (auto-advance)
  createAutoAdvanceStep('scores', 'tutorial.step9.title', 'tutorial.step9', (state) => ({
    scores: state.scores,
    collectedOre: state.collectedOre,
  })),
  // Step 9: event-fire-resolve — Respond to random events
  {
    id: 'event-fire-resolve',
    titleKey: 'tutorial.step10.title',
    textKey: 'tutorial.step10',
    captureSnapshot: (state) => ({ prevFiredCount: state.events?.firedEventIds?.length ?? 0 }),
    isComplete: (state, snapshot) =>
      (state.events?.firedEventIds?.length ?? 0) > (snapshot.prevFiredCount as number),
  },
  // Step 10: hire-manager — Hire a manager
  createHireStep('hire-manager', 'tutorial.step11.title', 'tutorial.step11', 'manager'),
  // Step 11: contract-accept — Accept a contract
  {
    id: 'contract-accept',
    titleKey: 'tutorial.step12.title',
    textKey: 'tutorial.step12',
    commands: ['contracts'],
    captureSnapshot: (state) => ({ prevContractCount: state.contracts?.active?.length ?? 0 }),
    isComplete: (state, snapshot) =>
      (state.contracts?.active?.length ?? 0) > (snapshot.prevContractCount as number),
  },
  // Step 12: hire-driver — Hire a driver
  createHireStep('hire-driver', 'tutorial.step13.title', 'tutorial.step13', 'driver'),
  // Step 13: vehicle-buy-assign — Buy a vehicle and assign a driver
  {
    id: 'vehicle-buy-assign',
    titleKey: 'tutorial.step14.title',
    textKey: 'tutorial.step14',
    commands: ['buy debris_hauler'],
    captureSnapshot: (state) => ({ prevVehicleCount: state.vehicles?.vehicles?.length ?? 0 }),
    isComplete: (state, snapshot) =>
      (state.vehicles?.vehicles?.length ?? 0) > (snapshot.prevVehicleCount as number) &&
      (state.vehicles?.vehicles ?? []).some(v => v.driverId != null),
  },
  // Step 14: build-storage — Build a freight warehouse
  {
    id: 'build-storage',
    titleKey: 'tutorial.step15.title',
    textKey: 'tutorial.step15',
    commands: ['build freight_warehouse'],
    captureSnapshot: (state) => ({
      prevStorageCount: (state.buildings?.buildings ?? []).filter(b => b.type === 'freight_warehouse').length,
    }),
    isComplete: (state, snapshot) =>
      (state.buildings?.buildings ?? []).filter(b => b.type === 'freight_warehouse').length >
        (snapshot.prevStorageCount as number),
  },
  // Step 15: contract-deliver — Deliver ore to fulfill a contract
  {
    id: 'contract-deliver',
    titleKey: 'tutorial.step16.title',
    textKey: 'tutorial.step16',
    commands: ['logistics'],
    captureSnapshot: (state) => ({
      prevDeliveredCount: state.contracts?.completedHistory?.length ?? 0,
    }),
    isComplete: (state, snapshot) =>
      (state.contracts?.completedHistory?.length ?? 0) > (snapshot.prevDeliveredCount as number),
  },
  // Step 16: finances — Overview of finances (auto-advance)
  createAutoAdvanceStep('finances', 'tutorial.step17.title', 'tutorial.step17', (state) => ({
    cash: state.cash,
    contracts: state.contracts,
  })),
  // Step 17: build-ramp — Build a ramp for bench access
  {
    id: 'build-ramp',
    titleKey: 'tutorial.step18.title',
    textKey: 'tutorial.step18',
    commands: ['build ramp'],
    captureSnapshot: (state) => ({
      prevRampCount: (state.navGrid?.cells?.flat()?.filter(c => (c as { type: string }).type === 'ramp').length ?? 0),
    }),
    isComplete: (state, snapshot) =>
      (state.navGrid?.cells?.flat()?.filter(c => (c as { type: string }).type === 'ramp').length ?? 0) >
        (snapshot.prevRampCount as number),
  },
  // Step 18: needs — Employee needs overview (auto-advance)
  createAutoAdvanceStep('needs', 'tutorial.step19.title', 'tutorial.step19', (state) => ({
    employees: state.employees,
  })),
  // Step 19: set-policy — Customize site policy
  {
    id: 'set-policy',
    titleKey: 'tutorial.step20.title',
    textKey: 'tutorial.step20',
    commands: ['policy'],
    captureSnapshot: (state) => ({
      shiftMode: state.sitePolicy?.shiftMode ?? 'shift_8h',
      hungerThreshold: state.sitePolicy?.hungerRestThreshold ?? 80,
      fatigueThreshold: state.sitePolicy?.fatigueRestThreshold ?? 80,
    }),
    isComplete: (state, snapshot) => {
      const s = snapshot as { shiftMode?: string; hungerThreshold?: number; fatigueThreshold?: number };
      return state.sitePolicy?.shiftMode !== s.shiftMode ||
        state.sitePolicy?.hungerRestThreshold !== s.hungerThreshold ||
        state.sitePolicy?.fatigueRestThreshold !== s.fatigueThreshold;
    },
  },
  // Step 20: tick-advance — Let time pass
  {
    id: 'tick-advance',
    titleKey: 'tutorial.step21.title',
    textKey: 'tutorial.step21',
    captureSnapshot: (state) => ({ prevTick: state.tickCount ?? 0 }),
    isComplete: (state, snapshot) =>
      (state.tickCount ?? 0) > (snapshot.prevTick as number) + 5,
  },
  // Step 21: victory — Level complete
  {
    id: 'victory',
    titleKey: 'tutorial.step22.title',
    textKey: 'tutorial.step22',
    isComplete: (state) => state.levelEnded === true,
  },
  // Step 22: congratulations — Tutorial done
  {
    id: 'congratulations',
    titleKey: 'tutorial.step23.title',
    textKey: 'tutorial.step23',
    isComplete: () => true,
  },
];

export const TOTAL_TUTORIAL_STEPS = TUTORIAL_STEPS.length;
