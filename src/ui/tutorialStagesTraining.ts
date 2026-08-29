// BlastSimulator2026 — Tutorial stage table: drill-rig/rock-digger training
// Split out of tutorialStages.ts (#557's evacuate-zone stage addition made
// that file cover two unrelated concerns — the click sequences below are
// their own single responsibility, separate from the rest of the stage
// table). Click sequences for the
// train-driller/buy-drill-rig-assign/train-digger/buy-rock-digger-assign
// steps (#553/#555): licensing a driller and a digger, then buying and
// crewing the vehicle each licence unlocks.

import { TOOLBAR_TARGET } from './tutorialStepHelpers.js';
import type { TutorialStage } from './tutorialStages.js';

export const TUTORIAL_STAGES_TRAINING: Record<string, TutorialStage[]> = {
  'train-driller': [
    { target: TOOLBAR_TARGET.employees, hintKey: 'tutorial.stage.open_crew' },
    // CrewPanel is single-expansion (expandedId) -- .bs-train-btn only
    // renders once the driller's own row is expanded, so this stage cannot
    // skip straight to it. The driller hired by 'hire-driller' is always
    // employee #2 at this point in the campaign's own tutorial script.
    // The train-btn target below is scoped to that same employee id --
    // #555's train-digger stage found the unscoped selector matches
    // whichever employee's row happens to still be expanded, once a single
    // school (driving_center) offers more than one of the courses these
    // back-to-back stages are each pointing at.
    {
      target: '#bs-employee-panel [data-employee-id="2"] .bs-detail-toggle',
      hintKey: 'tutorial.stage.expand_driller',
    },
    {
      target: '#bs-employee-panel [data-employee-id="2"] .bs-train-btn[data-skill="driving.drill_rig"]',
      hintKey: 'tutorial.stage.train_drill_rig',
    },
  ],

  'buy-drill-rig-assign': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.open_vehicles' },
    { target: '#bs-vehicle-panel [data-vtype="drill_rig"]', hintKey: 'tutorial.stage.vehicle_buy_drill_rig' },
    // Scoped to a drill_rig ROW specifically — see 'vehicle-buy-assign''s own
    // (tutorialStages.ts) comment on the identical fix, #557 follow-up.
    { target: '#bs-vehicle-panel [data-vtype="drill_rig"] .bs-vehicle-assign-btn', hintKey: 'tutorial.stage.vehicle_assign' },
  ],

  'train-digger': [
    { target: TOOLBAR_TARGET.employees, hintKey: 'tutorial.stage.open_crew' },
    // CrewPanel is single-expansion (expandedId) -- .bs-train-btn only
    // renders once the digger's own row is expanded. The surveyor hired by
    // 'hire-surveyor' -- idle since the survey step completed -- is always
    // employee #1 at this point in the campaign's own tutorial script, the
    // same fixed-id assumption train-driller makes for the driller (#2).
    // The train-btn target is scoped to that id -- driving_center offers
    // both driving.drill_rig and driving.excavator, so an unscoped selector
    // matches the still-expanded driller's row from the previous stage
    // (train-driller) before the player ever expands the digger's own row,
    // making resolveStageIndex jump straight to this stage and skip it.
    {
      target: '#bs-employee-panel [data-employee-id="1"] .bs-detail-toggle',
      hintKey: 'tutorial.stage.expand_digger',
    },
    {
      target: '#bs-employee-panel [data-employee-id="1"] .bs-train-btn[data-skill="driving.excavator"]',
      hintKey: 'tutorial.stage.train_excavator',
    },
  ],

  'buy-rock-digger-assign': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.open_vehicles' },
    { target: '#bs-vehicle-panel [data-vtype="rock_digger"]', hintKey: 'tutorial.stage.vehicle_buy_rock_digger' },
    // Scoped to a rock_digger ROW specifically — see 'vehicle-buy-assign''s
    // own (tutorialStages.ts) comment on the identical fix, #557 follow-up.
    { target: '#bs-vehicle-panel [data-vtype="rock_digger"] .bs-vehicle-assign-btn', hintKey: 'tutorial.stage.vehicle_assign' },
  ],
};
