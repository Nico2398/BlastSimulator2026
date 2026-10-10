// BlastSimulator2026 — Tutorial step definitions
// Defines the TutorialStep interface and ordered step array.

import type { GameState } from '../core/state/GameState.js';
import {
  createComparisonStep,
  createHireStep,
  createHireStepWithEventGuard,
  createUiActionStep,
  getEmployees,
  countVehiclesOfType,
  countBuildingsOfType,
  isBlastReportOutstanding,
  createEvacuateZoneStep,
  createSurveyOverlayToggleStep,
  TOOLBAR_TARGET,
} from './tutorialStepHelpers.js';
import { TUTORIAL_STEPS_CLOSING } from './tutorialStepsClosing.js';

/** The one scripted event the tutorial fires, so the player meets the dialog. */
const TUTORIAL_EVENT_ID = 'tutorial_synergy_consultant';

export interface TutorialStep {
  id: string;
  titleKey: string;
  textKey: string;
  /**
   * Overrides `titleKey` when present, resolved against the current
   * `GameState` — e.g. the closing card picking congratulations vs. a
   * defeat-specific title depending on `state.levelEndReason`. Checked in
   * preference to the static `titleKey` wherever a step's title is rendered.
   */
  titleKeyFor?(state: GameState): string;
  /** Same override shape as `titleKeyFor`, for `textKey`. */
  textKeyFor?(state: GameState): string;
  /** Interpolation params for the step's text, resolved against the current `GameState`. */
  textParamsFor?(state: GameState): Record<string, string | number>;
  /**
   * Console commands equivalent to the step's objective, shown to the player as
   * a hint. These are never executed by the tutorial — completing the step is
   * the player's job.
   */
  commands?: string[];
  /** `false` marks a step past the guided part: rails are lifted (#1328). */
  guided?: false;
  /** `true` renders the goal chip (net profit vs target) on this step (#1328). */
  goalChip?: true;
  /**
   * Commands the tutorial runs itself when the step opens. Reserved for scripted
   * demonstrations (the event pop-up), not for doing the player's work.
   */
  autoCommands?: string[];
  /**
   * Ticks this step may consume before the clock is held. Steps that wait on
   * queued work — a survey being run, ore being hauled — need more than steps
   * that are a single click. Omit for the default.
   */
  tickBudget?: number;
  /**
   * True when the step's completion depends on the simulation running — a
   * surveyor walking out, ore being hauled in. Those steps get a grace period
   * past their allowance so holding the clock cannot deadlock them. Steps that
   * merely wait on a click leave this off, so the world stops while the player
   * decides.
   */
  waitsOnWork?: boolean;
  /**
   * Predicate: true when the clock must keep running regardless of the tick
   * budget (e.g. nothing the player waits on can progress while held).
   */
  clockMustRun?: (state: GameState) => boolean;
  captureSnapshot?: ((state: GameState) => Record<string, unknown>) | undefined;
  isComplete: (state: GameState, snapshot: Record<string, unknown>) => boolean;
  /**
   * CSS selector for the control the player must use. It has to point at
   * something that is on screen while the step is active — highlighting a
   * closed panel glows nothing.
   */
  highlightTarget?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // ── Step 0: hire-surveyor ──
  // Opens the tutorial: hiring is completable immediately (isComplete reads
  // only state.employees), unlike the old opener (time-speed), which asked
  // the player to try a speed control before anything was on the site to
  // speed up. #1015: the speed bar is unconditionally player-controlled from
  // this first step onward — see BASE_PERMANENTLY_ALLOWED (tutorialRails.ts).
  createHireStep('hire-surveyor', 'tutorial.step2.title', 'tutorial.step2', 'surveyor'),

  // ── Step 2: survey ──
  createComparisonStep('survey', 'tutorial.step3.title', 'tutorial.step3', (s) => (s.surveyResults ?? []).length, ['survey seismic x:23 z:23'], TOOLBAR_TARGET.survey, { tickBudget: 20, waitsOnWork: true }),

  // ── Step 2b: toggle-survey-overlay (#905) ──
  createSurveyOverlayToggleStep(),

  // ── Step 3: hire-driller ──
  createHireStep('hire-driller', 'tutorial.step4.title', 'tutorial.step4', 'driller'),

  // ── Step 3a-i: build-living-quarters ──
  // #681: the box-cut/drill-plan/charge stretch that follows runs
  // this same 2-person crew continuously for ~400 ticks with nothing to
  // protect their well-being. Nothing built this early forces a revolt on
  // its own, but leaving the gap open does: #680's own survivability model
  // only holds for a crew with a living_quarters and an applied policy, and
  // neither existed anywhere in this tutorial's canonical order until here.
  // Placed before the grind starts, not after well-being already cratered —
  // by the time a real UI warning could fire, the mitigation these two new
  // steps teach could no longer land in time to matter.
  createComparisonStep(
    'build-living-quarters',
    'tutorial.step_livingquarters.title',
    'tutorial.step_livingquarters',
    (s) => countBuildingsOfType(s, 'living_quarters'),
    ['build living_quarters at:8,15'],
    TOOLBAR_TARGET.build,
    // #556: ordering a building is queued work now — a site goes up over
    // BUILDING_CONSTRUCTION_BASE_DURATION_TICKS plus the walk to it, so without
    // waitsOnWork this step's clock is held the moment the default budget
    // elapses and the tutorial never advances past it. Same budget and reason as
    // build-storage below, whose own comment carries the arithmetic.
    { tickBudget: 60, waitsOnWork: true },
  ),

  // ── Step 3a-ii: set-early-policy ──
  // The policy rest path (forceShiftRestIfNeededByPolicy, ForceShiftRest.ts)
  // is always in force with the default policy (#1379); applying one here
  // swaps it for the player's choice (revision counts those edits only).
  // 'continuous', not 'shift_8h': SHIFT_DURATIONS_TICKS.shift_8h is 8 ticks,
  // shorter than a single drill_hole action plus its walk, so applying it
  // this early forces a shift-end interruption before the queued
  // vehicle-gated work below could ever finish landing a hole (confirmed
  // live pre-#700). 'continuous' has no shift-length cap (getShiftDurationTicks
  // returns Infinity) but shouldForceRest's fatigue-threshold check
  // still applies in every mode — exactly the protection this step exists
  // to add, without capping how long a single queued task may run.
  // Ops keeps the policy panel for the player to revisit afterwards.
  {
    id: 'set-early-policy',
    titleKey: 'tutorial.step_earlypolicy.title',
    textKey: 'tutorial.step_earlypolicy',
    commands: ['set_policy mode:continuous'],
    highlightTarget: TOOLBAR_TARGET.ops,
    captureSnapshot: (state: GameState) => ({
      policyRevision: state.sitePolicy?.revision ?? 0,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const before = (snapshot.policyRevision as number | undefined) ?? 0;
      return (state.sitePolicy?.revision ?? 0) > before;
    },
  },

  // ── Step 3b: hire-driver ──
  // Arrives holding the truck and excavator licences, so the ramp work of
  // box-cut and the later hauling need no course.
  createHireStep('hire-driver', 'tutorial.step13.title', 'tutorial.step13', 'driver'),

  // ── Step 3c: buy-drill-rig-assign ──
  // Driver assignment is automatic now (VehicleReservation/ArrivalGate, #921)
  // — completion is purchase alone, the same synchronous "value increased"
  // shape as the other instant steps (tickBudget: 1, no waitsOnWork: buying a
  // vehicle is instant, nothing to wait on).
  createComparisonStep(
    'buy-drill-rig-assign',
    'tutorial.step_buydrillrig.title',
    'tutorial.step_buydrillrig',
    (s) => countVehiclesOfType(s, 'drill_rig'),
    ['vehicle buy drill_rig'],
    TOOLBAR_TARGET.vehicles,
    { tickBudget: 1 },
  ),

  // ── Step 3d: buy-rock-digger-assign ──
  // Same purchase-completes-alone shape as buy-drill-rig-assign above (#921).
  createComparisonStep(
    'buy-rock-digger-assign',
    'tutorial.step_buyrockdigger.title',
    'tutorial.step_buyrockdigger',
    (s) => countVehiclesOfType(s, 'rock_digger'),
    ['vehicle buy rock_digger'],
    TOOLBAR_TARGET.vehicles,
    { tickBudget: 1 },
  ),

  // ── Step 4: box-cut ──
  // Real pits start the way this step does: an access ramp and a starter cut
  // are dug *before* the first shot, because blasted rock swells and has to
  // have somewhere to go. Firing into flat ground leaves the fragments sitting
  // in a stable layout — nothing visibly collapses, and the player learns
  // nothing about free faces. The cut is dug just west of where the drill
  // pattern goes, so the first blast breaks toward it.
  {
    id: 'box-cut',
    titleKey: 'tutorial.step_boxcut.title',
    textKey: 'tutorial.step_boxcut',
    highlightTarget: TOOLBAR_TARGET.build,
    commands: ['build_ramp start:10,23 end:10,35 depth:6'],
    waitsOnWork: true,
    // #1210: tracks the player's own ramp order(s), not NavGrid classification
    // — a pre-existing ramp elsewhere, or any other mechanism that produces a
    // 'ramp' NavCell, could false-trigger the old countNavCellsByType check
    // without the player having ordered anything here. A ramp only ever gets
    // an id (nextPlannedRampId++) on a successful order, so "id >= prev"
    // identifies exactly the order(s) made since this step's snapshot, and
    // `state.plannedRamps` no longer holding one means it finished (its
    // PlannedRamp entry is spliced out once every segment is done —
    // TaskCompletionEffects.ts).
    captureSnapshot: (state: GameState) => ({
      prevNextRampId: state.nextPlannedRampId ?? 1,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevNextRampId as number;
      const current = state.nextPlannedRampId ?? 1;
      if (current <= prev) return false;
      return !(state.plannedRamps ?? []).some((r) => r.id >= prev);
    },
  },

  // ── Step 5: drill-plan ──
  // #554-followup: drilling is real, queued work -- same waitsOnWork gap as
  // 'charge' below. #1596: complete only once at least one hole is drilled AND
  // no ordered hole is still waiting to be drilled, so the first blast is
  // always the full scripted grid. waitsOnWork keeps the rail from holding the
  // clock (tutorialGuide.ts's decideClock) while the crew is still drilling.
  {
    id: 'drill-plan',
    titleKey: 'tutorial.step5.title',
    textKey: 'tutorial.step5',
    commands: ['drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:14,24'],
    highlightTarget: TOOLBAR_TARGET.blast,
    tickBudget: 20,
    waitsOnWork: true,
    isComplete: (state: GameState) =>
      (state.drillHoles?.length ?? 0) > 0 && (state.plannedDrillHoles ?? []).length === 0,
  },

  // ── Step 5: charge ──
  // #554: charging is real, queued work now (was instant) -- without
  // waitsOnWork the rail's clock-hold (tutorialGuide.ts's decideClock) has no
  // way to tell "still charging" from "stuck", and holds the game paused the
  // instant DEFAULT_TICK_BUDGET (10 ticks) elapses without every hole done,
  // which a 16-hole charge order never finishes that fast. Matches the same
  // fix already applied to every other real-queued-work step (survey,
  // contract-deliver, etc.) above.
  //
  // #926: not a createComparisonStep any more -- its generic "value
  // increased" fired the instant the FIRST of nine holes charged, moving the
  // tutorial on while the crew was still mid-charge. The panel
  // (suggestStep, BlastWorkshop.ts) rightly keeps showing the Charge tab
  // until every hole is charged. #1596: isComplete additionally requires no
  // planned drill holes and no planned charge orders still queued, so the step
  // does not advance while the crew is mid-work. That is stricter than
  // suggestStep's "every drilled hole is charged" check alone.
  {
    id: 'charge',
    titleKey: 'tutorial.step6.title',
    textKey: 'tutorial.step6',
    commands: ['charge hole:* explosive:boomite amount:4 stemming:2.5'],
    highlightTarget: TOOLBAR_TARGET.blast,
    tickBudget: 20,
    waitsOnWork: true,
    isComplete: (state: GameState) => {
      const holes = state.drillHoles ?? [];
      const chargesByHole = state.chargesByHole ?? {};
      return (
        holes.length > 0 &&
        (state.plannedDrillHoles ?? []).length === 0 &&
        holes.every((h) => chargesByHole[h.id]) &&
        Object.keys(state.plannedChargesByHole ?? {}).length === 0
      );
    },
  },

  // ── Step 6b: evacuate-zone ── (#557 — see createEvacuateZoneStep)
  createEvacuateZoneStep(),

  // ── Step 7: blast ──
  // Counts blasts fired as well as ore types collected. Keying only on ore
  // dead-ends the tutorial when a legitimate blast comes up barren — the player
  // did exactly what was asked and the card would never move on.
  //
  // #707: not a plain createComparisonStep — the count alone goes up the
  // instant the simulation effect lands (blastCommand, synchronous), well
  // before BlastReportModal ever opens (its own 3s real-time delay, #545).
  // Without a gate the rail advanced to the next step within one guide poll
  // (250ms) of the count changing — long before the report was even on
  // screen, let alone closed (the next step, 'scores', now waits for the
  // player's own inspect click, but the gate still matters). A click on
  // the report's own CLOSE button then landed after the rail had already
  // moved on, against a control the guide no longer kept live. Gating
  // completion on `!isBlastReportOutstanding()` as well keeps this step (and
  // the rail) on 'blast' for the whole arm-delay-open-dismiss lifecycle of
  // the report, so CLOSE stays reachable (#951: no 'blast' sub-stage targets
  // anything inside BlastReportModal, so applyRails's per-modal restriction
  // in tutorialGuide.ts never narrows it -- it keeps the old blanket
  // allowance) until the player actually clicks it.
  {
    id: 'blast',
    titleKey: 'tutorial.step8.title',
    textKey: 'tutorial.step8',
    // No command: DETONATE (the evacuate-zone step) fires the blast itself (#1362).
    highlightTarget: TOOLBAR_TARGET.blast,
    captureSnapshot: (state: GameState) => ({
      prevValue: (state.levelStats?.blastsPerformed ?? 0) + Object.keys(state.collectedOre ?? {}).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevValue as number;
      const value = (state.levelStats?.blastsPerformed ?? 0) + Object.keys(state.collectedOre ?? {}).length;
      // A blast fired at once by DETONATE (#1362) already counted in the snapshot.
      const firedEarlier = (state.levelStats?.blastsPerformed ?? 0) > 0;
      return (value > prev || firedEarlier) && !isBlastReportOutstanding();
    },
  },

  // ── Step 7b: build-driving-center ──
  // The first blast leaves oversized boulders only a rock fragmenter can break,
  // and its licence is taught only here -- the one course the tutorial needs.
  // Every role arrives able to do its own job (ROLE_STARTING_QUALIFICATIONS).
  createComparisonStep(
    'build-driving-center',
    'tutorial.step_drivingcenter.title',
    'tutorial.step_drivingcenter',
    (s) => countBuildingsOfType(s, 'driving_center'),
    ['build driving_center at:6,15'],
    TOOLBAR_TARGET.build,
    // #556: ordering a building is queued work -- same budget and reason as
    // build-storage below, whose own comment carries the arithmetic.
    { tickBudget: 60, waitsOnWork: true },
  ),

  // ── Step 7c: train-fragmenter ──
  // Existence check, not a comparison: nobody is hired holding the licence.
  {
    id: 'train-fragmenter',
    titleKey: 'tutorial.step_trainfragmenter.title',
    textKey: 'tutorial.step_trainfragmenter',
    commands: ['employee train <driverId> skill:driving.rock_fragmenter'],
    highlightTarget: TOOLBAR_TARGET.employees,
    tickBudget: 25,
    waitsOnWork: true,
    isComplete: (state: GameState) =>
      (state.employees?.employees ?? []).some((e) => e.qualifications.some((q) => q.category === 'driving.rock_fragmenter')),
  },

  // ── Step 8: scores ──
  createUiActionStep('scores', 'tutorial.step9.title', 'tutorial.step9', { kind: 'scores' }, (state: GameState) => ({
    scores: { ...(state.scores ?? {}) },
    collectedOre: { ...(state.collectedOre ?? {}) },
  }), '#bs-hud-scores'),

  // ── Step 9: event-fire-resolve ──
  // The only step the tutorial drives itself: it fast-forwards a few ticks and
  // fires the scripted consultant event so the player sees the dialog once.
  {
    id: 'event-fire-resolve',
    titleKey: 'tutorial.step10.title',
    textKey: 'tutorial.step10',
    highlightTarget: '#bs-hud-top .bs-event-badge',
    autoCommands: ['tick 3', 'event fire tutorial_synergy_consultant'],
    // The step asks the player to answer the dialog, so it completes on
    // fired-then-resolved. Completing on "an event is pending" was only true
    // while the dialog was open: a player who answered between two polls left
    // the tutorial stuck on this card with nothing left to click, because the
    // event fires at most once per level and cannot be brought back.
    isComplete: (state: GameState) => {
      const events = state.events;
      if (!events) return false;
      return (events.firedEventIds ?? []).includes(TUTORIAL_EVENT_ID)
        && events.pendingEvent == null;
    },
  },

  // ── Step 10: hire-manager ──
  // A manager runs contract negotiation (#1340); hiring/firing/policy are not gated on one yet.
  createHireStepWithEventGuard('hire-manager', 'tutorial.step11.title', 'tutorial.step11', 'manager'),

  // ── Step 13: vehicle-buy-assign ──
  // #553: no longer the tutorial's first-ever vehicle purchase -- the
  // drill_rig and rock_digger are bought long before this step. Driver assignment is
  // automatic now (VehicleReservation/ArrivalGate, #921) — completion is
  // purchase alone, the same synchronous shape as buy-drill-rig-assign
  // above, so the drill_rig's own driver has no bearing on this check.
  createComparisonStep(
    'vehicle-buy-assign',
    'tutorial.step14.title',
    'tutorial.step14',
    (s) => countVehiclesOfType(s, 'debris_hauler'),
    ['vehicle buy debris_hauler'],
    TOOLBAR_TARGET.vehicles,
    { tickBudget: 1 },
  ),

  // ── Step 14: build-storage ──
  // #556: placing a building is no longer instant -- confirming the order
  // queues a `place_building` action (BUILDING_CONSTRUCTION_BASE_DURATION_TICKS
  // for a tier-1 warehouse) that an employee has to walk to and
  // work before the freight_warehouse count actually moves. Without
  // waitsOnWork the rail's clock-hold (tutorialGuide.ts's decideClock) treats
  // the step as already resolved and stalls waiting on a count that hasn't
  // changed yet -- same gap 'drill-plan'/'charge' document above.
  // tickBudget 60 comfortably clears the build plus walk time.
  createComparisonStep('build-storage', 'tutorial.step15.title', 'tutorial.step15', (s) => countBuildingsOfType(s, 'freight_warehouse'), ['build freight_warehouse at:2,12'], TOOLBAR_TARGET.build, { tickBudget: 60, waitsOnWork: true }),

  // ── Step 14b: haul-debris ──
  // Fires when stored mass increases — the same "value went up" pattern every
  // other comparison step uses. Hauling is self-dispatching (#552): a
  // qualified idle employee auto-claims a free debris_hauler and drives it to
  // the nearest fragment on its own, no player click required — so this step
  // carries no command hint (nothing to type or press) and just points at the
  // Fleet panel to watch it happen.
  createComparisonStep(
    'haul-debris',
    'tutorial.step_haul.title',
    'tutorial.step_haul',
    (s) => s.logistics?.storedMassKg ?? 0,
    undefined,
    TOOLBAR_TARGET.vehicles,
    { tickBudget: 20, waitsOnWork: true },
  ),

  // ── Step 16: finances ──
  createUiActionStep('finances', 'tutorial.step17.title', 'tutorial.step17', { kind: 'panel', rootSelector: '#bs-finances-panel' }, (state: GameState) => ({
    cash: state.cash,
    contracts: { ...(state.contracts ?? {}) },
  }), '#bs-hud-top .bs-balance'),

  // ── Step 18: needs ──
  createUiActionStep('needs', 'tutorial.step19.title', 'tutorial.step19', { kind: 'panel', rootSelector: '#bs-employee-panel' }, (state: GameState) => ({
    employees: getEmployees(state).map(e => ({
      id: (e as unknown as Record<string, unknown>).id as number ?? 0,
      fatigue: (e as unknown as Record<string, unknown>).fatigue as number ?? 0,
    })),
  }), TOOLBAR_TARGET.employees),

  // ── Step 15: sell-ore ──
  // Replaces the old contract-deliver step (#959): the tutorial never hauled
  // and sold the blasted ore for money, so a player following it to the
  // letter finished with negative cash. Repeatable — the player may accept
  // and deliver more than one ore-sale contract before the step is done,
  // since the tier-1 warehouse's own capacity is far smaller than the
  // blasted ore's total mass. Completion is keyed off the contract
  // completion history itself (a genuine ore_sale contract closing since
  // this step opened) rather than a fixed cycle count, so it self-adjusts
  // regardless of how many accept/deliver rounds that turns out to take —
  // exactly createComparisonStep's "value increased since snapshot" shape,
  // like 'drill-plan' above. `completedHistory` also holds
  // EXPIRED contracts (Contract.ts's checkDeadlines pushes there too), so
  // the count is filtered to `completed: true` — a contract that merely
  // timed out with a penalty must not falsely advance this step without a
  // single dollar sold (#959).
  //
  // The fillable offer is scripted (#1600: Level.ts's scriptedOreSale puts it on
  // the board), so the step never waits on the random contract pool and needs
  // no `clockMustRun` to let the clock run until one appears.
  createComparisonStep(
    'sell-ore',
    'tutorial.step_sellore.title',
    'tutorial.step_sellore',
    (s) => (s.contracts?.completedHistory ?? []).filter((c) => c.type === 'ore_sale' && c.completed).length,
    ['contract accept type:ore_sale', 'contract deliver type:ore_sale amount:2000'],
    TOOLBAR_TARGET.contracts,
    {
      tickBudget: 20,
      waitsOnWork: true,
    },
  ),

  // ── free-play, congratulations ──
  // Free play starts once the first ore sale lands; the guided part ends there (#1328).
  // Split into tutorialStepsClosing.ts (#557 — see that file's own header).
  ...TUTORIAL_STEPS_CLOSING,
];

export const TOTAL_TUTORIAL_STEPS = TUTORIAL_STEPS.length;
