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
import type { TileRegion } from './tutorialPickerRegion.js';

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
  /**
   * Tiles the player must stay inside when this step opens a picker.
   *
   * Highlighting the canvas says "drag here" and nothing more: the grid tool
   * would happily lay a blast pattern in a corner of the map the step knows
   * nothing about. The picker draws this area and refuses to confirm outside it.
   */
  region?: TileRegion;
}

// P3 retired the 2D picker: dragging/clicking now happens directly on the
// game canvas, which is always on screen whether or not the tool is armed —
// unlike the old picker canvas, whose mere existence in the DOM meant a
// picker was actually open. Gated on the body class PlacementController's
// armed-state handler toggles, so "reachable" still means "ready for a tile
// click," not just "the canvas element exists." Not a functional lock
// either way — the canvas is neither a button, select, nor input, so the
// tutorial rail's CSS block never touched it — purely resolveStageIndex's
// signal for when to advance past "open the panel" / "press Run".
const PICKER_CANVAS = 'body.bs-placement-armed #game-canvas';
const PICKER_CONFIRM = '#bs-tile-select-confirm';

/** Pick a tile, then confirm — the shared tail of every placement step. */
function pickerStages(pickHintKey: string, region: TileRegion): TutorialStage[] {
  return [
    { target: PICKER_CANVAS, hintKey: pickHintKey, region },
    { target: PICKER_CONFIRM, hintKey: 'tutorial.stage.picker_confirm', also: [PICKER_CANVAS], region },
  ];
}

/**
 * Where each guided placement belongs, in tiles on the 32×32 tutorial map
 * (#458 T6.1/D13). Central enough to be obviously "the pit", wide enough not
 * to feel like threading a needle — and, critically, clear of the grid's
 * exact centre (16,16): vehicles always spawn there (VehicleCommand's
 * baseX/baseZ = sizeX/2), and a drill/blast footprint straddling that point
 * carves a lower "bench" right under the vehicle, on the far side of a level
 * change from wherever the driver starts. With no ramp built yet at that
 * point in the tutorial, NavGrid.findPath's multi-level routing can never
 * connect them — the driver walks partway, then sits stuck forever (found
 * via a full-suite regression this same resize introduced, traced to
 * findMultiLevelPath returning found:false with zero candidate ramps).
 * On the old 24×24 grid this region (8→18) missed the old centre (12,12) by
 * enough margin to never trip this; growing the grid without re-centring the
 * region is what closed that gap. Shifted well off-centre here instead of
 * re-deriving a new "just barely clears it" offset.
 */
const REGION = {
  survey: { x1: 18, z1: 18, x2: 28, z2: 28 },
  // Exact, and sized to the grid it produces: the tool derives
  // cols = round((x2 - x1) / spacing) + 1, so at the default spacing of 5 a
  // 20→30 span is exactly three holes at 20, 25 and 30. An outline the
  // resulting holes spilled out of would be telling the player the wrong thing.
  drill: { x1: 20, z1: 20, x2: 30, z2: 30, exact: true },
  warehouse: { x1: 2, z1: 2, x2: 9, z2: 9 },
  // Beside the pit, not inside it. The blast leaves sloped crater walls that
  // already register as ramp cells, so carving within them removes more than it
  // adds and the step's "a ramp appeared" check never fires. A haul ramp
  // belongs on intact ground anyway.
  ramp: { x1: 2, z1: 2, x2: 5, z2: 20 },
} as const satisfies Record<string, TileRegion>;

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
    { target: '#bs-hud-top .bs-speed-btn button[data-speed]', hintKey: 'tutorial.stage.speed' },
  ],

  'hire-surveyor': hireStages('surveyor', 'tutorial.stage.hire_surveyor'),

  survey: [
    { target: TOOLBAR_TARGET.survey, hintKey: 'tutorial.stage.open_survey' },
    // Seismic, because that is what the step text and the console hint both
    // name. Pointing the glow at a different method than the card describes is
    // exactly the kind of mismatch that loses a player.
    { target: '#bs-survey-panel [data-method="seismic"]', hintKey: 'tutorial.stage.survey_method' },
    { target: '#bs-survey-run', hintKey: 'tutorial.stage.survey_run' },
    ...pickerStages('tutorial.stage.survey_target', REGION.survey),
  ],

  'hire-driller': hireStages('driller', 'tutorial.stage.hire_driller'),

  'drill-plan': [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="grid-tool"]', hintKey: 'tutorial.stage.grid_tool' },
    ...pickerStages('tutorial.stage.drill_area', REGION.drill),
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
    ...pickerStages('tutorial.stage.build_site', REGION.warehouse),
  ],

  'haul-debris': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.open_vehicles' },
    { target: '#bs-vehicle-panel .bs-vehicle-haul-btn', hintKey: 'tutorial.stage.vehicle_haul' },
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
    ...pickerStages('tutorial.stage.ramp_area', REGION.ramp),
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
    { target: '#bs-hud-top .bs-speed-btn button[data-speed]', hintKey: 'tutorial.stage.let_time_run' },
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
