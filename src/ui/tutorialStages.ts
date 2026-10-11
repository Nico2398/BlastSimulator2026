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
  TOOLBAR_TARGET, SURVEY_OVERLAY_TOGGLE_TARGET,
  hasActiveOreSale, hasPendingActionOfType, hasPlannedBuildingOfType, isHaulDispatched, isSellOreWaiting,
} from './tutorialStepHelpers.js';
import type { TileRegion } from './tutorialPickerRegion.js';
import { TUTORIAL_STAGES_TRAINING } from './tutorialStagesTraining.js';
import type { GameState } from '../core/state/GameState.js';
import type { BuildingType, BuildingTier } from '../core/entities/Building.js';
import { getBuildingDef, getDefSize } from '../core/entities/Building.js';
import { TUTORIAL_HIRING_SCRIPT, TUTORIAL_SITE_HAZARD_CLEARANCE_TILES } from '../core/config/balance.js';
import { NavGrid } from '../core/nav/NavGrid.js';
import { findPath } from '../core/nav/Pathfinding.js';

import { PLACEMENT_CANCEL_SELECTOR } from './scene/placementSelectors.js';

/** Cancel button of the placement strip (picker). */
export const PICKER_CANCEL = PLACEMENT_CANCEL_SELECTOR;

/**
 * Policy fatigue range the tutorial allows the player to set (#1595).
 * Upper bound stays below NEED_REST_NO_BUILDING_CAP (70, core/config/balance.ts): a threshold
 * >= that cap re-triggers rest immediately after a no-building rest tops out (#1338).
 */
export const TUTORIAL_POLICY_FATIGUE_MIN = 50;
export const TUTORIAL_POLICY_FATIGUE_MAX = 69;

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
   * Conditional extra selectors: each `selector` is allowed during this stage
   * only while `when(root)` holds (#1595).
   */
  alsoWhen?: ReadonlyArray<{ selector: string; when: (root: ParentNode) => boolean }>;
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
  /**
   * True once this stage's own action has been issued and the simulation now
   * owns the result — the sibling of `doneTarget` for a control that stays
   * reachable after being clicked (a buy/confirm/run button) instead of
   * disappearing. Checked independently of which stage `resolveStageIndex`
   * resolved to (see `resolveWaitStatus`, tutorialGuide.ts) so a control that
   * becomes unreachable for an unrelated reason (e.g. insufficient cash for a
   * second order) doesn't mask the wait.
   */
  spentWhen?: (state: GameState) => boolean;
  /**
   * Whether the player's order for this step has been issued (#1626). `null`
   * marks a step with no player order. Overrides `spentWhen` as the
   * "order issued" signal; `undefined` falls back to `spentWhen`.
   */
  orderIssuedWhen?: ((state: GameState) => boolean) | null;
  /** i18n key for the waiting line shown once `spentWhen` fires. Required whenever `spentWhen` is set. */
  waitingKey?: string;
  /** Whether this stage can be reached at all; an unreachable stage is skipped (#1632). */
  reachableWhen?: () => boolean;
  /** Interpolation params for `hintKey` (#1632). */
  hintParams?: Record<string, string | number>;
}

const CONTINUOUS_BUTTON = '#bs-policy-shift button[data-shift-mode="continuous"]';

/** True when the continuous shift mode button is pressed (#1632). */
export function isContinuousSelected(root: ParentNode): boolean {
  return root.querySelector(CONTINUOUS_BUTTON)?.getAttribute('aria-pressed') === 'true';
}

/** True when the policy fatigue input holds a value inside the tutorial range (#1632). */
export function isPolicyFatigueInRange(root: ParentNode): boolean {
  const input = root.querySelector('#bs-policy-fatigue') as HTMLInputElement | null;
  if (!input || input.value.trim() === '') return false;
  const fatigue = Number(input.value);
  return fatigue >= TUTORIAL_POLICY_FATIGUE_MIN && fatigue <= TUTORIAL_POLICY_FATIGUE_MAX;
}

/** Continuous selected and fatigue threshold inside the tutorial's range. */
function isPolicyApplicable(root: ParentNode): boolean {
  return isContinuousSelected(root) && isPolicyFatigueInRange(root);
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
export const PICKER_CANVAS = 'body.bs-placement-armed #game-canvas';
const PICKER_CONFIRM = '#bs-tile-select-confirm';
// Only an ore offer the pit can fill in full: rubble, supply and unfillable
// offers' Accept stays visible but outside the rails allow set (#1335).
const FILLABLE_ORE_ACCEPT =
  '#bs-contract-panel [data-contract-type="ore_sale"][data-contract-fillable="true"] .bs-contract-accept';

/**
 * Pick a tile, then confirm — the shared tail of every placement step.
 *
 * Both stages allow `PICKER_CANCEL` (#1593): a player who changed their mind
 * must be able to back out of the tool (Esc button; Esc and right-click work
 * regardless) without the rails locking the strip's cancel control.
 *
 * Spacing, depth, charge amount, stemming and ramp depth steppers are never
 * allowlisted (#1596): they are shown, not editable -- the panel defaults
 * already equal the scripted values (#1330) and ramp depth is clamped at arm
 * time.
 *
 * `confirmSpent` (#1014): every picker-backed step's Confirm click issues an
 * order the simulation then owns (a survey, a building, a drill grid, a ramp)
 * — and Confirm stays reachable afterward, since nothing here disarms the
 * tool once used. Six call sites need the same "mark the Confirm stage spent
 * once the order lands" shape, so it lives here once rather than in each of
 * them.
 */
function pickerStages(
  pickHintKey: string,
  region: TileRegion,
  confirmSpent?: { spentWhen: (state: GameState) => boolean; waitingKey: string },
): TutorialStage[] {
  return [
    { target: PICKER_CANVAS, hintKey: pickHintKey, region, also: [PICKER_CANCEL] },
    {
      target: PICKER_CONFIRM,
      hintKey: 'tutorial.stage.picker_confirm',
      also: [PICKER_CANVAS, PICKER_CANCEL],
      region,
      ...(confirmSpent ? { spentWhen: confirmSpent.spentWhen, waitingKey: confirmSpent.waitingKey } : {}),
    },
  ];
}

/**
 * Where each guided placement belongs, in tiles on the tutorial map (#458
 * T6.1/D13). Every guided placement is `exact`, so the step lands on the
 * placement it is teaching rather than on wherever the player's drag happened
 * to finish (#489). The picker snaps any click inside the region's live
 * margin onto these corners, so the player aims at a drawn outline and cannot
 * miss.
 *
 * The three tutorial building pins (warehouse, drivingCenter, livingQuarters)
 * are derived, not picked ad hoc: flat for the building's full footprint
 * (`BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD`), clear of every tutorial hazard by
 * `TUTORIAL_SITE_HAZARD_CLEARANCE_TILES` (`tutorialHazards`,
 * `isTutorialSiteHazardClear`), mutually within
 * `TUTORIAL_SITE_CLUSTER_MAX_SPAN_TILES` of each other, and within
 * `TUTORIAL_SITE_DIG_ROUND_TRIP_MAX_ROUTE_COST` real pathfinding route cost
 * (`routeDistanceToRect`, not straight-line Chebyshev tile distance) of the
 * dig/drill area — see git history on this block for the stranding-class
 * postmortems (#1008, #1008-followup) this rule superseded.
 *
 * #1170: the slope-based navmesh (#1151) made a real walking route far
 * longer than the straight-line tile bound this cluster used to be measured
 * against — the old (29,10)/(29,14)/(25,12) cluster, east of the box-cut
 * corridor, sat within the old straight-line bound but far outside a real
 * route's cost once slope gating made the only walkable path a long detour.
 * Moved the whole cluster west of the box-cut corridor instead, to
 * livingQuarters (8,15), drivingCenter (6,15), warehouse (2,12).
 *
 * #1587: the drill pattern used to sit on the (22,20)-(30,28) slope, where
 * 36.7% of 8-neighbour steps were unclimbable and the rig drove switchbacks
 * of up to 16x the straight-line distance between holes. REGION.drill now
 * sits on the west plateau (14,24)-(22,32): the nearest fully climbable 11x11
 * area (every 8-neighbour step in the region + 1 margin passes
 * `isStepClimbable`) that still keeps ore (dirtite 46, rustite 8). Origin
 * (14,24) over the climbable neighbours (14,23)/(13,23): the scripted
 * 4kg/2.5m shot rates `good` there, but `catastrophic` (168 projections) from
 * those two. The
 * box-cut moved with it to x=10, west of the drill, and the warehouse pin to
 * (2,12) to stay in round-trip range. Measured on the seed-42 post-survey
 * grid (the world grows 32 -> 48 after the seismic survey).
 */
export const REGION = {
  // One tile, because a survey is a point pick. Sits inside the old 18→28
  // suggestion area, so nothing downstream of the survey moves.
  survey: { x1: 23, z1: 23, x2: 23, z2: 23, exact: true },
  // Sized to the grid it produces: the tool derives
  // cols = round((x2 - x1) / spacing) + 1. The tool's default spacing is 4
  // (DRILL_GRID_DEFAULT_SPACING_M), so the 8x8 span (14,24)-(22,32) yields a
  // 3x3 grid of 9 holes untouched (#1330) -- not the 16-hole grid that
  // collapsed a lone early-tutorial employee (#586). #1587: on the climbable
  // west plateau, so the rig drives hole to hole near-straight.
  drill: { x1: 14, z1: 24, x2: 22, z2: 32, exact: true },
  // Site derived from isTutorialSiteHazardClear/TUTORIAL_SITE_* — see git
  // history on this file for the stranding-class postmortems (#1008,
  // #1008-followup) this superseded. #1170: moved west of the box-cut
  // corridor, alongside livingQuarters (8,15) and drivingCenter (6,15) — see
  // this file's own REGION doc comment above for the full trace.
  warehouse: { x1: 2, z1: 12, x2: 2, z2: 12, exact: true },
  // The starter cut runs down the west side of where the drill pattern will
  // go, on ground that is still intact — the point of the step is that it is
  // dug *before* anything is blasted, so the first shot has a face to break
  // toward and a void for the rock to fall into. One line, not a corridor of
  // candidate lines: the console hint names this exact ramp.
  boxcut: { x1: 10, z1: 23, x2: 10, z2: 35, exact: true },
  // Site derived from isTutorialSiteHazardClear/TUTORIAL_SITE_* — see git
  // history on this file for the stranding-class postmortems (#1008,
  // #1008-followup) this superseded. #1170: moved west of the box-cut
  // corridor, alongside livingQuarters (8,15) and warehouse (2,12) — see this
  // file's own REGION doc comment above for the full trace.
  drivingCenter: { x1: 6, z1: 15, x2: 6, z2: 15, exact: true },
  // Site derived from isTutorialSiteHazardClear/TUTORIAL_SITE_* — see git
  // history on this file for the stranding-class postmortems (#1008,
  // #1008-followup) this superseded. #1170: moved west of the box-cut
  // corridor, alongside drivingCenter (6,15) and warehouse (2,12) — see this
  // file's own REGION doc comment above for the full trace. Non-overlapping
  // with drivingCenter's own 2x2 footprint at (6,15)-(7,16) and adjacent to
  // (not overlapping) warehouse's 4x4 footprint at (2,12):
  // checkFootprintPlacement refuses an actual overlap, so the pins are
  // placed in the same order the tutorial rail orders them (living_quarters,
  // then driving_center, then freight_warehouse) with each one checked
  // against the prior pins already placed.
  livingQuarters: { x1: 8, z1: 15, x2: 8, z2: 15, exact: true },
} as const satisfies Record<string, TileRegion>;

/** World edge (tiles) after the seismic survey grows the world from 32 to 48. */
export const TUTORIAL_POST_SURVEY_WORLD_SIZE = 48;

/** A single-tile hazard the tutorial's fixed building pins must clear. */
export type TutorialHazard = TileRegion;

/**
 * The tutorial's first-vehicle spawn point. Raw point is the post-survey world
 * centre (the first purchase happens after the survey grew the world to
 * `TUTORIAL_POST_SURVEY_WORLD_SIZE`); given a grid it is snapped with
 * `NavGrid.findNearestSpawnCell` exactly as a real purchase does
 * (`src/console/commands/vehicle.ts`), yielding the real spawn tile.
 */
export function tutorialVehicleSpawnPoint(navGrid?: NavGrid): TutorialHazard {
  const raw = Math.floor(TUTORIAL_POST_SURVEY_WORLD_SIZE / 2);
  const { x, z } = navGrid ? NavGrid.findNearestSpawnCell(navGrid, raw, raw) : { x: raw, z: raw };
  return { x1: x, z1: z, x2: x, z2: z, exact: true };
}

/**
 * Every fixed hazard a tutorial building pin must clear by
 * `TUTORIAL_SITE_HAZARD_CLEARANCE_TILES`: the box-cut corridor, the drill
 * grid, and the vehicle spawn point.
 */
export function tutorialHazards(): readonly TutorialHazard[] {
  return [tutorialVehicleSpawnPoint(), REGION.boxcut, REGION.drill];
}

/** Chebyshev (chessboard) distance between the closest corners of two rects. */
export function chebyshevRectDistance(a: TileRegion, b: TileRegion): number {
  const dx = a.x1 > b.x2 ? a.x1 - b.x2 : (b.x1 > a.x2 ? b.x1 - a.x2 : 0);
  const dz = a.z1 > b.z2 ? a.z1 - b.z2 : (b.z1 > a.z2 ? b.z1 - a.z2 : 0);
  return Math.max(dx, dz);
}

/**
 * The tile rectangle a building of `type`/`tier` occupies when pinned at `region`'s origin corner.
 *
 * The `origin + size - 1` arithmetic here matches `makeFootprintRegion`
 * (`src/console/commands/buildingHelpers.ts`) and the inline sizing in
 * `checkFootprintPlacement` (`src/core/entities/Building.ts`), just expressed
 * in `TileRegion`'s `{x1,z1,x2,z2}` shape instead of `BlastRegion`'s
 * `{minX,minZ,maxX,maxZ}`. Routing through `makeFootprintRegion` and
 * translating its result would mean `src/ui/` importing a `src/console/`
 * command helper — a layering cost bigger than the one line of arithmetic it
 * would save. Left as its own copy; worth revisiting if a shared
 * core-level "rect from origin + size" helper is ever introduced for other reasons.
 */
export function tutorialSiteFootprintRect(type: BuildingType, tier: BuildingTier, region: TileRegion): TileRegion {
  const { sizeX, sizeZ } = getDefSize(getBuildingDef(type, tier));
  return { x1: region.x1, z1: region.z1, x2: region.x1 + sizeX - 1, z2: region.z1 + sizeZ - 1, exact: false };
}

/** Whether `rect` clears every `tutorialHazards()` entry by `TUTORIAL_SITE_HAZARD_CLEARANCE_TILES`. */
export function isTutorialSiteHazardClear(rect: TileRegion): boolean {
  return tutorialHazards().every((h) => chebyshevRectDistance(rect, h) >= TUTORIAL_SITE_HAZARD_CLEARANCE_TILES);
}

/**
 * Route distance (NavGrid pathfinding cost, not straight-line tiles) from the near corner
 * of `from` to the near corner of `to`. Returns Infinity when no route exists.
 */
export function routeDistanceToRect(grid: NavGrid, from: TileRegion, to: TileRegion): number {
  // Anchored on (x1, z1) — the same origin corner tutorialSiteFootprintRect
  // pins a building's footprint from, rather than the two rects' mutual
  // closest corners (chebyshevRectDistance's convention above).
  const route = findPath(grid, {
    agentId: 0,
    fromX: from.x1, fromZ: from.z1,
    toX: to.x1, toZ: to.z1,
    avoidVehicles: false,
  });
  return route.found ? route.totalCost : Infinity;
}

/** Open the Crew panel, then hire the role's one scripted candidate (#1600). */
function hireStages(role: string, hintKey: string): TutorialStage[] {
  const candidate = TUTORIAL_HIRING_SCRIPT.find(c => c.role === role);
  if (!candidate) throw new Error(`TUTORIAL_HIRING_SCRIPT has no candidate for role ${role}`);
  return [
    { target: TOOLBAR_TARGET.employees, hintKey: 'tutorial.stage.open_crew' },
    { target: `#bs-employee-panel [data-role="${role}"][data-candidate-id="${candidate.id}"]`, hintKey },
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
    { target: '#bs-survey-run', hintKey: 'tutorial.stage.survey_run', also: ['#bs-survey-panel [data-method="seismic"]'] },
    ...pickerStages('tutorial.stage.survey_target', REGION.survey, {
      spentWhen: (state) => hasPendingActionOfType(state, 'survey'),
      waitingKey: 'tutorial.waiting.surveying',
    }),
  ],

  'hire-driller': hireStages('driller', 'tutorial.stage.hire_driller'),

  'build-living-quarters': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    {
      target: '#bs-build-panel [data-build-type="living_quarters"] .bs-build-buy-btn',
      hintKey: 'tutorial.stage.build_living_quarters',
    },
    ...pickerStages('tutorial.stage.build_site', REGION.livingQuarters, {
      spentWhen: (state) => hasPlannedBuildingOfType(state, 'living_quarters'),
      waitingKey: 'tutorial.waiting.building',
    }),
  ],

  // Continuous, not the shift_8h default: applying shift_8h this early interrupts the queued
  // drilling/digging work before it can finish (SHIFT_DURATIONS_TICKS.shift_8h is 8 ticks, shorter
  // than a single drill_hole action). Resolution picks the LAST reachable stage, so Apply and the
  // fatigue hint carry `reachableWhen`: each shows only when it is the next thing to do (#1632).
  // Apply is never in `also`: it must stay railed until it is applicable.
  'set-early-policy': [
    { target: TOOLBAR_TARGET.ops, hintKey: 'tutorial.stage.open_ops' },
    {
      target: CONTINUOUS_BUTTON,
      hintKey: 'tutorial.stage.policy_continuous',
      also: ['#bs-policy-fatigue'],
    },
    {
      target: '#bs-policy-fatigue',
      hintKey: 'tutorial.stage.policy_fatigue_range',
      hintParams: { min: TUTORIAL_POLICY_FATIGUE_MIN, max: TUTORIAL_POLICY_FATIGUE_MAX },
      also: [CONTINUOUS_BUTTON],
      reachableWhen: () => isContinuousSelected(document) && !isPolicyFatigueInRange(document),
    },
    {
      target: '#bs-policy-apply',
      hintKey: 'tutorial.stage.policy_apply',
      also: [CONTINUOUS_BUTTON, '#bs-policy-fatigue'],
      reachableWhen: () => isPolicyApplicable(document),
    },
  ],

  'build-driving-center': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    {
      target: '#bs-build-panel [data-build-type="driving_center"] .bs-build-buy-btn',
      hintKey: 'tutorial.stage.build_driving_center',
    },
    ...pickerStages('tutorial.stage.build_site', REGION.drivingCenter, {
      spentWhen: (state) => hasPlannedBuildingOfType(state, 'driving_center'),
      waitingKey: 'tutorial.waiting.building',
    }),
  ],

  // buy-drill-rig-assign/buy-rock-digger-assign/train-fragmenter:
  // split into tutorialStagesTraining.ts (#557 — see that file's own header).
  ...TUTORIAL_STAGES_TRAINING,

  'drill-plan': [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="grid-tool"]', hintKey: 'tutorial.stage.grid_tool' },
    ...pickerStages('tutorial.stage.drill_area', REGION.drill, {
      spentWhen: (state) => state.plannedDrillHoles.length > 0,
      waitingKey: 'tutorial.waiting.drilling',
    }),
  ],

  // #1596: no amount/stemming steppers -- the panel defaults equal the
  // scripted plan (CHARGE_DEFAULT_*, #1330), so only Charge All is live.
  charge: [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    {
      target: '#bs-blast-panel [data-action="charge-all"]',
      hintKey: 'tutorial.stage.charge_all',
      spentWhen: (state) => Object.keys(state.plannedChargesByHole).length > 0,
      waitingKey: 'tutorial.waiting.charging',
    },
  ],

  // #557, #1362: open the Blast Workshop, press FIRE (opens the pre-flight
  // modal), then DETONATE inside it, which evacuates the zone and fires once
  // clear.
  'evacuate-zone': [
    { target: TOOLBAR_TARGET.blast, hintKey: 'tutorial.stage.open_blast' },
    { target: '#bs-blast-panel [data-action="execute"]', hintKey: 'tutorial.stage.execute' },
    {
      target: '.bs-confirm-overlay:not(#bs-event-dialog) .bs-btn-danger',
      hintKey: 'tutorial.stage.detonate',
    },
    // #1591: DETONATE only arms; the blast fires once the crew has left.
    {
      target: '[data-role="preflight-waiting"][data-phase="evacuating"]',
      hintKey: 'tutorial.stage.detonation_clearing',
      also: ['[data-action="preflight-cancel-detonation"]'],
    },
    {
      target: '[data-role="preflight-waiting"][data-phase="stranded"]',
      hintKey: 'tutorial.stage.detonation_stranded',
      also: ['[data-action="preflight-cancel-detonation"]'],
    },
  ],

  // #1362: DETONATE (the evacuate-zone step) fires the blast; this step only closes the report.
  blast: [
    { target: '[data-action="report-close"]', hintKey: 'tutorial.stage.blast_report_close' },
  ],

  'toggle-survey-overlay': [
    { target: TOOLBAR_TARGET.survey, hintKey: 'tutorial.stage.open_survey' },
    { target: SURVEY_OVERLAY_TOGGLE_TARGET, hintKey: 'tutorial.stage.overlay_toggle' },
  ],

  'event-fire-resolve': [
    { target: '#bs-event-dialog .bs-event-choice:first-child', hintKey: 'tutorial.stage.event_choose' },
    { target: '#bs-event-dialog .bs-event-dismiss', hintKey: 'tutorial.stage.event_dismiss' },
  ],

  finances: [{ target: '.bs-balance', hintKey: 'tutorial.stage.open_finances' }],
  needs: [{ target: TOOLBAR_TARGET.employees, hintKey: 'tutorial.stage.check_needs' }],
  scores: [{ target: '#bs-hud-scores', hintKey: 'tutorial.stage.inspect_scores' }],

  'hire-manager': hireStages('manager', 'tutorial.stage.hire_manager'),

  'hire-driver': hireStages('driver', 'tutorial.stage.hire_driver'),

  // #921: dropped the third (assign-driver) stage — a vehicle's driver is
  // claimed automatically now, so the step completes on purchase alone.
  'vehicle-buy-assign': [
    { target: TOOLBAR_TARGET.vehicles, hintKey: 'tutorial.stage.open_vehicles' },
    { target: '#bs-vehicle-panel button[data-vtype="debris_hauler"][data-tier="1"]', hintKey: 'tutorial.stage.vehicle_buy' },
  ],

  'build-storage': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    {
      target: '#bs-build-panel [data-build-type="freight_warehouse"] .bs-build-buy-btn',
      hintKey: 'tutorial.stage.build_warehouse',
    },
    ...pickerStages('tutorial.stage.build_site', REGION.warehouse, {
      spentWhen: (state) => hasPlannedBuildingOfType(state, 'freight_warehouse'),
      waitingKey: 'tutorial.waiting.building',
    }),
  ],

  // No button to press — hauling self-dispatches (#552). One stage, so the
  // glow just sits on the Fleet toolbar button the whole step, inviting the
  // player to open it and watch the fleet work rather than pointing at a
  // control that no longer exists.
  'haul-debris': [
    {
      target: TOOLBAR_TARGET.vehicles,
      hintKey: 'tutorial.stage.vehicle_watch',
      spentWhen: isHaulDispatched,
      orderIssuedWhen: null, // no player order: hauling self-dispatches
      waitingKey: 'tutorial.waiting.hauling',
    },
  ],

  // Accepting happens here: the player takes an ore offer the pit can fill,
  // then delivers it. A single merged stage, not separate accept/deliver
  // stages (#959): the step is repeatable across several accept/deliver
  // rounds (2b), and resolveStageIndex's "last reachable stage wins" would
  // otherwise bounce between an accept stage and a deliver stage every cycle
  // as the panel's own offered/active cards come and go. `also` keeps the
  // deliver button and amount field clickable alongside accept for the whole
  // step, matching how the old contract-deliver stage kept its own amount
  // field alongside deliver.
  'sell-ore': [
    { target: TOOLBAR_TARGET.contracts, hintKey: 'tutorial.stage.open_contracts' },
    {
      target: FILLABLE_ORE_ACCEPT,
      hintKey: 'tutorial.stage.sell_ore',
      also: ['#bs-contract-panel .bs-contract-deliver', '#bs-contract-panel .bs-contract-amount'],
      // Accepting removes the fillable Accept card from the offered list, so
      // `target` vanishes; the active ore card's Deliver keeps this stage
      // resolved instead of regressing to "open the Contracts panel" (#1335).
      doneTarget: '#bs-contract-panel [data-contract-type="ore_sale"] .bs-contract-deliver',
      spentWhen: isSellOreWaiting,
      orderIssuedWhen: hasActiveOreSale,
      waitingKey: 'tutorial.waiting.delivering',
    },
  ],

  'box-cut': [
    { target: TOOLBAR_TARGET.build, hintKey: 'tutorial.stage.open_build' },
    { target: '#bs-build-panel .bs-build-ramp-btn', hintKey: 'tutorial.stage.ramp_tool' },
    ...pickerStages('tutorial.stage.boxcut_area', REGION.boxcut, {
      spentWhen: (state) => state.plannedRamps.length > 0,
      waitingKey: 'tutorial.waiting.excavating',
    }),
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
