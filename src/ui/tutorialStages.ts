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

import {
  TOOLBAR_TARGET, SPEED_UP_TO_MAX_BUTTON, SPEED_BACK_TO_NORMAL_BUTTON,
} from './tutorialStepHelpers.js';
import type { TileRegion } from './tutorialPickerRegion.js';
import { TUTORIAL_STAGES_TRAINING } from './tutorialStagesTraining.js';

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
  /**
   * Alternate selector that also counts this stage as reached, checked only
   * once `target` itself is unreachable — for a stage whose control is
   * replaced by a status view once its own action starts (#903).
   */
  doneTarget?: string;
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
/**
 * Every guided placement is `exact`, so the step lands on the placement it is
 * teaching rather than on wherever the player's drag happened to finish (#489:
 * "the tutorial allow to create many different ramps... it should be told and
 * forced to place buildings or any element where expected"). Exact does not
 * mean fussy: the picker snaps any click inside the region's live margin onto
 * these corners, so the player aims at a drawn outline and cannot miss.
 */
const REGION = {
  // One tile, because a survey is a point pick. Sits inside the old 18→28
  // suggestion area, so nothing downstream of the survey moves.
  survey: { x1: 23, z1: 23, x2: 23, z2: 23, exact: true },
  // Sized to the grid it produces: the tool derives
  // cols = round((x2 - x1) / spacing) + 1. This region predates Drill.ts's
  // own DEFAULT_SPACING_M (3, not the 5 this region was originally sized
  // for) -- the mismatch went unnoticed because the spacing stepper is
  // unreachable this early in the rail (no path to it, confirmed live), so
  // nothing here ever adjusts spacing away from the tool's own default, and
  // charging used to be instant (pre-#553/#554) so the doubled 4×4=16-hole
  // grid a 20→30 span actually produces at spacing 3 never had time to cost
  // anything. Once charging became real, queued work, 16 holes was enough
  // for a lone early-tutorial employee (no living quarters built yet) to
  // collapse repeatedly and trigger a full worker revolt before finishing
  // (issue #586 CI, tutorial-interactive.json). 20→26 at spacing 3 is
  // round(6/3)+1=3 holes/side, 3×3=9 -- restoring the region to the
  // originally-intended 3×3 grid for the spacing this tool actually opens
  // at, not the 4×4 the stale 20→30/spacing-5 sizing silently grew it to.
  drill: { x1: 20, z1: 20, x2: 26, z2: 26, exact: true },
  // One tile: the warehouse is placed by its origin corner, and the footprint
  // ghost shows the rest. In the level's clear north-west quarter, but pulled
  // off the map's own corner: at (4,4) the camera ray through that tile's
  // pixel skims past the edge of the terrain mesh and hits nothing, so the
  // click resolved to no tile at all. (6,6) picks cleanly at every framing
  // distance, and leaves room for the footprint to sit on the map.
  warehouse: { x1: 6, z1: 6, x2: 6, z2: 6, exact: true },
  // The starter cut runs down the west side of where the drill pattern will
  // go, on ground that is still intact — the point of the step is that it is
  // dug *before* anything is blasted, so the first shot has a face to break
  // toward and a void for the rock to fall into. One line, not a corridor of
  // candidate lines: the console hint names this exact ramp.
  boxcut: { x1: 16, z1: 19, x2: 16, z2: 31, exact: true },
  // One tile, same origin-corner placement as the warehouse above. Sits in
  // the same clear north-west quarter as the warehouse (6,6) but well clear
  // of it and of the box-cut/drill footprints further east and south (#553:
  // drilling is now vehicle-gated — the driller needs somewhere to train for
  // and park a drill_rig before drill-plan can ever land a hole).
  drivingCenter: { x1: 10, z1: 8, x2: 10, z2: 8, exact: true },
  // One tile, same origin-corner convention. #689-followup: (13,4) sat far
  // enough from the drill grid (20-26,20-26) that the crew's own commute
  // there and back roughly broke even against the rest gained, leaving them
  // to oscillate near collapse instead of recovering — the mitigation these
  // steps exist to teach couldn't actually keep up. Moved to (18,14): north
  // of the box-cut ramp (x=16, z19-31 — 3 tiles of x clearance, well clear on
  // z) and the drill grid itself (footprint 3×3 lands at x:18-20, z:14-16,
  // bordering but not overlapping the grid's own x1:20/z1:20), cutting the
  // round trip enough for a genuine net recovery instead of a near-wash.
  livingQuarters: { x1: 18, z1: 14, x2: 18, z2: 14, exact: true },
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

  'build-living-quarters': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    {
      target: '#bs-build-panel [data-build-type="living_quarters"] .bs-build-buy-btn',
      hintKey: 'tutorial.stage.build_living_quarters',
    },
    ...pickerStages('tutorial.stage.build_site', REGION.livingQuarters),
  ],

  'set-early-policy': [
    { target: TOOLBAR_TARGET.ops, hintKey: 'tutorial.stage.open_ops' },
    // #689-followup: one stage, not two sequential ones — resolveStageIndex
    // (tutorialGuide.ts) picks the LAST reachable stage, and #bs-policy-apply
    // is unconditionally reachable the instant the panel opens (nothing
    // disables it before a shift mode is chosen). A separate later stage
    // targeting it is therefore never actually reached as its own stage: the
    // rail resolves straight past "click Continuous" to "apply" the moment
    // Operations opens, so a player (or this file's own interaction-mode
    // scenario) can click Apply immediately and silently keep the shift_8h
    // default instead of Continuous -- confirmed live (interaction mode
    // reported the Continuous button itself as inert/unreachable). Matches
    // the later 'set-policy' stage's own working shape below: Apply is the
    // stage's target (so the rail actually reaches it), with the controls
    // that legitimately need to be clickable alongside it -- shift-mode
    // included -- allowed via `also`, rather than gated behind a stage of
    // their own that can never become active.
    {
      // Continuous, not the shift_8h default: applying shift_8h this early
      // interrupts the queued drilling/digging work below before it can
      // finish (SHIFT_DURATIONS_TICKS.shift_8h is 8 ticks, shorter than a
      // single drill_hole action). Continuous still forces rest on
      // hunger/fatigue, just without the shift-length cap. Highlighted
      // target stays the Continuous button (not Apply) so the glow points at
      // the one choice this early step actually requires the player to make.
      target: '#bs-policy-shift button[data-shift-mode="continuous"]',
      hintKey: 'tutorial.stage.policy_continuous',
      also: ['#bs-policy-apply', '#bs-policy-hunger', '#bs-policy-fatigue'],
    },
  ],

  'build-driving-center': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    {
      target: '#bs-build-panel [data-build-type="driving_center"] .bs-build-buy-btn',
      hintKey: 'tutorial.stage.build_driving_center',
    },
    ...pickerStages('tutorial.stage.build_site', REGION.drivingCenter),
  ],

  // train-driller/buy-drill-rig-assign/train-digger/buy-rock-digger-assign:
  // split into tutorialStagesTraining.ts (#557 — see that file's own header).
  ...TUTORIAL_STAGES_TRAINING,

  'drill-plan': [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="grid-tool"]', hintKey: 'tutorial.stage.grid_tool' },
    ...pickerStages('tutorial.stage.drill_area', REGION.drill),
  ],

  charge: [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="charge-all"]', hintKey: 'tutorial.stage.charge_all' },
  ],

  // #926: `auto-sequence` lives inside the Sequence tab's own body, hidden
  // (display:none) whenever a different tab is showing -- which the panel's
  // own auto-advance (BlastWorkshop.ts's suggestStep) can legitimately do
  // while the crew is still mid-charge. Without a stage in between,
  // resolveStageIndex (tutorialGuide.ts, "last reachable stage wins") had
  // nowhere to fall back to but the already-satisfied "open the Blast panel"
  // hint, with every control on the panel blocked and the Sequence tab
  // itself un-clickable. The tab button (`data-step`, BlastWorkshop.ts) is
  // part of the strip, not any one step's body, so it stays reachable
  // regardless of which tab is active -- this stage lets the player put the
  // panel on Sequence themselves whenever the panel hasn't gotten there on
  // its own yet.
  sequence: [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-step="3"]', hintKey: 'tutorial.stage.open_sequence_tab' },
    { target: '#bs-blast-panel [data-action="auto-sequence"]', hintKey: 'tutorial.stage.auto_sequence' },
  ],

  // #557: open the Blast Workshop, then press the Fire step's own "Sound the
  // Horn" button (FireStep.ts's hornBtn, dataset.action="sound-horn"). Scoped
  // to #bs-blast-panel — the same button-role/panel-scoping convention every
  // other stage list above uses (charge/sequence/blast) — not the toolbar
  // target both stages used to share: resolveStageIndex (tutorialGuide.ts)
  // resolves the LAST reachable stage, and a toolbar button that is always
  // reachable once the panel is open made this stage indistinguishable from
  // the one before it, so the rail could never actually highlight the real
  // Sound the Horn control.
  'evacuate-zone': [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="sound-horn"]', hintKey: 'tutorial.stage.sound_horn' },
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

  // #921: dropped the third (assign-driver) stage — a vehicle's driver is
  // claimed automatically now, so the step completes on purchase alone.
  'vehicle-buy-assign': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.open_vehicles' },
    { target: '#bs-vehicle-panel [data-vtype="debris_hauler"]', hintKey: 'tutorial.stage.vehicle_buy' },
  ],

  'build-storage': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    {
      target: '#bs-build-panel [data-build-type="freight_warehouse"] .bs-build-buy-btn',
      hintKey: 'tutorial.stage.build_warehouse',
    },
    ...pickerStages('tutorial.stage.build_site', REGION.warehouse),
  ],

  // No button to press — hauling self-dispatches (#552). One stage, so the
  // glow just sits on the Fleet toolbar button the whole step, inviting the
  // player to open it and watch the fleet work rather than pointing at a
  // control that no longer exists.
  'haul-debris': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.vehicle_watch' },
  ],

  'contract-deliver': [
    { target: TOOLBAR_TARGET.contracts, hintKey: 'tutorial.stage.open_contracts' },
    {
      target: '#bs-contract-panel .bs-contract-deliver',
      hintKey: 'tutorial.stage.contract_deliver',
      also: ['#bs-contract-panel .bs-contract-amount'],
    },
  ],

  'box-cut': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    { target: '#bs-build-panel .bs-build-ramp-btn', hintKey: 'tutorial.stage.ramp_tool' },
    ...pickerStages('tutorial.stage.boxcut_area', REGION.boxcut),
  ],

  // #923: taught inside the box-cut wait — ×8 while the ramp-dig is still in
  // progress, ×1 once it's done. One stage each: a single button press, no
  // panel to open first.
  'speed-up-for-dig': [
    { target: SPEED_UP_TO_MAX_BUTTON, hintKey: 'tutorial.stage.speed_up_dig' },
  ],

  'speed-normal-after-dig': [
    { target: SPEED_BACK_TO_NORMAL_BUTTON, hintKey: 'tutorial.stage.speed_normal_after_dig' },
  ],

  'set-policy': [
    { target: TOOLBAR_TARGET.ops, hintKey: 'tutorial.stage.open_ops' },
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
