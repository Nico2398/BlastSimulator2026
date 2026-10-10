// BlastSimulator2026 — Tutorial stage table: vehicle purchase and fragmenter training
// Split out of tutorialStages.ts (#557). Click sequences for the
// buy-drill-rig-assign/buy-rock-digger-assign/train-fragmenter steps.

import { TOOLBAR_TARGET } from './tutorialStepHelpers.js';
import type { TutorialStage } from './tutorialStages.js';

export const TUTORIAL_STAGES_TRAINING: Record<string, TutorialStage[]> = {
  // #921: dropped the third (assign-driver) stage — a vehicle's driver is
  // claimed automatically now, so the step completes on purchase alone.
  'buy-drill-rig-assign': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.open_vehicles' },
    { target: '#bs-vehicle-panel button[data-vtype="drill_rig"][data-tier="1"]', hintKey: 'tutorial.stage.vehicle_buy_drill_rig' },
  ],

  // The hired Driver is found by role (data-employee-role), never by id: who
  // is employee #N depends on the order the player hired in.
  'train-fragmenter': [
    { target: TOOLBAR_TARGET.employees, hintKey: 'tutorial.stage.open_crew' },
    // CrewPanel is single-expansion -- .bs-train-btn only renders once the
    // driver's own row is expanded.
    {
      target: '#bs-employee-panel [data-employee-role="driver"] .bs-detail-toggle',
      hintKey: 'tutorial.stage.expand_driver',
    },
    {
      target: '#bs-employee-panel [data-employee-role="driver"] .bs-train-btn[data-skill="driving.rock_fragmenter"]',
      // Booking the course replaces the button with a status view (#903).
      doneTarget: '#bs-employee-panel [data-employee-role="driver"] .bs-training-active[data-skill="driving.rock_fragmenter"]',
      hintKey: 'tutorial.stage.train_fragmenter',
    },
  ],

  // #921: dropped the third (assign-driver) stage — see buy-drill-rig-assign
  // above for why.
  'buy-rock-digger-assign': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.open_vehicles' },
    { target: '#bs-vehicle-panel button[data-vtype="rock_digger"][data-tier="1"]', hintKey: 'tutorial.stage.vehicle_buy_rock_digger' },
  ],
};
