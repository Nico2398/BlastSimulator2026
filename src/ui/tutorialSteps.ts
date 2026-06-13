// BlastSimulator2026 — Tutorial step definitions
// Defines the TutorialStep interface and ordered step array.

import type { GameState } from '../core/state/GameState.js';

export interface TutorialStep {
  id: string;
  titleKey: string;
  textKey: string;
  commands?: string[];
  isComplete: (state: GameState) => boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    titleKey: 'tutorial.step1.title',
    textKey: 'tutorial.step1',
    isComplete: () => true,
  },
  {
    id: 'survey',
    titleKey: 'tutorial.step2.title',
    textKey: 'tutorial.step2',
    commands: ['survey seismic'],
    isComplete: (s) => (s.surveyResults?.length ?? 0) > 0,
  },
  {
    id: 'drill',
    titleKey: 'tutorial.step3.title',
    textKey: 'tutorial.step3',
    commands: ['drill plan'],
    isComplete: (s) => (s.drillHoles?.length ?? 0) > 0,
  },
  {
    id: 'charge',
    titleKey: 'tutorial.step4.title',
    textKey: 'tutorial.step4',
    commands: ['blast plan'],
    isComplete: (s) => Object.keys(s.chargesByHole ?? {}).length > 0,
  },
  {
    id: 'blast',
    titleKey: 'tutorial.step5.title',
    textKey: 'tutorial.step5',
    commands: ['blast execute'],
    isComplete: (s) => Object.keys(s.collectedOre ?? {}).length > 0,
  },
  {
    id: 'contracts',
    titleKey: 'tutorial.step6.title',
    textKey: 'tutorial.step6',
    commands: ['contracts'],
    isComplete: (s) => (s.contracts?.active?.length ?? 0) > 0,
  },
  {
    id: 'sell-ore',
    titleKey: 'tutorial.step7.title',
    textKey: 'tutorial.step7',
    isComplete: (s) => (s.cash ?? 0) > 0,
  },
  {
    id: 'build-living-quarters',
    titleKey: 'tutorial.step8.title',
    textKey: 'tutorial.step8',
    commands: ['build living_quarters'],
    isComplete: (s) => (s.buildings?.buildings ?? []).some(b => b.type === 'living_quarters'),
  },
  {
    id: 'build-more',
    titleKey: 'tutorial.step9.title',
    textKey: 'tutorial.step9',
    commands: ['build'],
    isComplete: (s) => (s.buildings?.buildings ?? []).length >= 2,
  },
  {
    id: 'hire-employees',
    titleKey: 'tutorial.step10.title',
    textKey: 'tutorial.step10',
    commands: ['hire employee'],
    isComplete: (s) => (s.employees?.employees ?? []).length > 0,
  },
  {
    id: 'purchase-hauler',
    titleKey: 'tutorial.step11.title',
    textKey: 'tutorial.step11',
    commands: ['buy debris_hauler'],
    isComplete: (s) => (s.vehicles?.vehicles ?? []).some(v => v.type === 'debris_hauler'),
  },
  {
    id: 'purchase-drill-rig',
    titleKey: 'tutorial.step12.title',
    textKey: 'tutorial.step12',
    commands: ['buy drill_rig'],
    isComplete: (s) => (s.vehicles?.vehicles ?? []).some(v => v.type === 'drill_rig'),
  },
  {
    id: 'research',
    titleKey: 'tutorial.step13.title',
    textKey: 'tutorial.step13',
    commands: ['research'],
    isComplete: (s) => (s.buildings?.researchQueue?.length ?? 0) > 0,
  },
  {
    id: 'upgrade',
    titleKey: 'tutorial.step14.title',
    textKey: 'tutorial.step14',
    isComplete: (s) => Object.keys(s.buildings?.unlockedTiers ?? {}).length > 0,
  },
  {
    id: 'safety-zone',
    titleKey: 'tutorial.step15.title',
    textKey: 'tutorial.step15',
    commands: ['zone set'],
    isComplete: (s) => s.zone?.activeZone != null,
  },
  {
    id: 'multiple-contracts',
    titleKey: 'tutorial.step16.title',
    textKey: 'tutorial.step16',
    isComplete: (s) => (s.contracts?.active?.length ?? 0) >= 2,
  },
  {
    id: 'profit',
    titleKey: 'tutorial.step17.title',
    textKey: 'tutorial.step17',
    isComplete: (s) => (s.cash ?? 0) >= 50000,
  },
  {
    id: 'wellbeing',
    titleKey: 'tutorial.step18.title',
    textKey: 'tutorial.step18',
    isComplete: (s) => (s.scores?.wellBeing ?? 0) > 50,
  },
  {
    id: 'second-blast',
    titleKey: 'tutorial.step19.title',
    textKey: 'tutorial.step19',
    isComplete: (s) => (s.tickCount ?? 0) > 100,
  },
  {
    id: 'fleet',
    titleKey: 'tutorial.step20.title',
    textKey: 'tutorial.step20',
    isComplete: (s) => (s.vehicles?.vehicles ?? []).length >= 3,
  },
  {
    id: 'workforce',
    titleKey: 'tutorial.step21.title',
    textKey: 'tutorial.step21',
    isComplete: (s) => (s.employees?.employees ?? []).length >= 5,
  },
  {
    id: 'level-complete',
    titleKey: 'tutorial.step22.title',
    textKey: 'tutorial.step22',
    isComplete: (s) => s.levelEnded === true,
  },
  {
    id: 'congratulations',
    titleKey: 'tutorial.step23.title',
    textKey: 'tutorial.done',
    isComplete: () => true,
  },
];

export const TOTAL_TUTORIAL_STEPS = TUTORIAL_STEPS.length;
