// BlastSimulator2026 — Tutorial stages
//
// A step says *when* it is done. A stage says *what to click next*. Most steps
// take several clicks — open a panel, press a button in it, confirm a picker —
// and highlighting only the first one leaves the player guessing at the rest,
// which is how a guided tutorial gets lost.
//
// Stages are resolved by reachability, not by counting clicks: the active stage
// is the last one whose control is on screen and enabled. A panel that is not
// open yet has no reachable control, so the stage before it stays lit; opening
// it makes the next stage reachable at once. Closing the panel falls back.

import { TOOLBAR_TARGET } from './tutorialStepHelpers.js';

export interface TutorialStage {
  /** Selector for the one control the player should use now. */
  target: string;
  /** i18n key for the instruction shown while this stage is active. */
  hintKey: string;
  /**
   * Extra selectors the player may also use during this stage. Needed where an
   * action takes more than one control — typing an amount before pressing
   * Deliver, or picking a tile on a canvas before Confirm enables.
   */
  also?: string[];
}

const PICKER_CANVAS = '.bs-tile-select-canvas';
const PICKER_CONFIRM = '#bs-tile-select-confirm';

/** Pick a tile, then confirm — the shared tail of every placement step. */
function pickerStages(pickHintKey: string): TutorialStage[] {
  return [
    { target: PICKER_CANVAS, hintKey: pickHintKey },
    { target: PICKER_CONFIRM, hintKey: 'tutorial.stage.picker_confirm', also: [PICKER_CANVAS] },
  ];
}

/** Open the Crew panel, then hire one role. */
function hireStages(role: string, hintKey: string): TutorialStage[] {
  return [
    { target: TOOLBAR_TARGET.employees, hintKey: 'tutorial.stage.open_crew' },
    { target: `#bs-employee-panel [data-role="${role}"]`, hintKey },
  ];
}

/**
 * Click sequence per step id. A step with no entry falls back to its own
 * `highlightTarget`, so a step that is genuinely one click needs nothing here.
 */
export const TUTORIAL_STAGES: Record<string, TutorialStage[]> = {
  'time-speed': [
    { target: '#bs-hud-top .bs-speed-btn', hintKey: 'tutorial.stage.speed' },
  ],

  'hire-surveyor': hireStages('surveyor', 'tutorial.stage.hire_surveyor'),

  survey: [
    { target: TOOLBAR_TARGET.survey, hintKey: 'tutorial.stage.open_survey' },
    // Seismic, because that is what the step text and the console hint both
    // name. Pointing the glow at a different method than the card describes is
    // exactly the kind of mismatch that loses a player.
    { target: '#bs-survey-panel [data-method="seismic"]', hintKey: 'tutorial.stage.survey_method' },
    { target: '#bs-survey-run', hintKey: 'tutorial.stage.survey_run' },
    ...pickerStages('tutorial.stage.survey_target'),
  ],

  'hire-driller': hireStages('driller', 'tutorial.stage.hire_driller'),

  'drill-plan': [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="grid-tool"]', hintKey: 'tutorial.stage.grid_tool' },
    ...pickerStages('tutorial.stage.drill_area'),
  ],

  charge: [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="charge-all"]', hintKey: 'tutorial.stage.charge_all' },
  ],

  sequence: [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="auto-sequence"]', hintKey: 'tutorial.stage.auto_sequence' },
  ],

  blast: [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="execute"]', hintKey: 'tutorial.stage.execute' },
    {
      target: '.bs-confirm-overlay:not(#bs-event-dialog) .bs-btn-danger',
      hintKey: 'tutorial.stage.blast_confirm',
    },
  ],

  'event-fire-resolve': [
    { target: '#bs-event-dialog .bs-event-choice', hintKey: 'tutorial.stage.event_choose' },
    { target: '#bs-event-dialog .bs-event-dismiss', hintKey: 'tutorial.stage.event_dismiss' },
  ],

  'hire-manager': hireStages('manager', 'tutorial.stage.hire_manager'),

  'contract-accept': [
    { target: TOOLBAR_TARGET.contracts, hintKey: 'tutorial.stage.open_contracts' },
    { target: '#bs-contract-panel .bs-contract-accept', hintKey: 'tutorial.stage.contract_accept' },
  ],

  'hire-driver': hireStages('driver', 'tutorial.stage.hire_driver'),

  'vehicle-buy-assign': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.open_vehicles' },
    { target: '#bs-vehicle-panel [data-vtype="debris_hauler"]', hintKey: 'tutorial.stage.vehicle_buy' },
    { target: '#bs-vehicle-panel .bs-vehicle-assign-btn', hintKey: 'tutorial.stage.vehicle_assign' },
  ],

  'build-storage': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    {
      target: '#bs-build-panel [data-build-type="freight_warehouse"] .bs-build-buy-btn',
      hintKey: 'tutorial.stage.build_warehouse',
    },
    ...pickerStages('tutorial.stage.build_site'),
  ],

  'contract-deliver': [
    { target: TOOLBAR_TARGET.contracts, hintKey: 'tutorial.stage.open_contracts' },
    {
      target: '#bs-contract-panel .bs-contract-deliver',
      hintKey: 'tutorial.stage.contract_deliver',
      also: ['#bs-contract-panel .bs-contract-amount'],
    },
  ],

  'build-ramp': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    { target: '#bs-build-panel .bs-build-ramp-btn', hintKey: 'tutorial.stage.ramp_tool' },
    ...pickerStages('tutorial.stage.ramp_area'),
  ],

  'set-policy': [
    { target: TOOLBAR_TARGET.settings, hintKey: 'tutorial.stage.open_settings' },
    {
      target: '#bs-policy-apply',
      hintKey: 'tutorial.stage.policy_apply',
      also: ['#bs-policy-shift', '#bs-policy-hunger', '#bs-policy-fatigue'],
    },
  ],

  'tick-advance': [
    { target: '#bs-hud-top .bs-speed-btn', hintKey: 'tutorial.stage.let_time_run' },
  ],
};

/**
 * Stages for a step. Falls back to a single stage built from the step's own
 * highlight target, so every step has at least one control to point at.
 */
export function stagesFor(stepId: string, highlightTarget?: string): TutorialStage[] {
  const stages = TUTORIAL_STAGES[stepId];
  if (stages && stages.length > 0) return stages;
  if (highlightTarget) {
    return [{ target: highlightTarget, hintKey: 'tutorial.stage.generic' }];
  }
  return [];
}
