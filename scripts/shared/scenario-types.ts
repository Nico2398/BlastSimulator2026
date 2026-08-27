/**
 * BlastSimulator2026 — Shared Scenario Types
 *
 * Canonical type definitions for scenario steps, interaction actions,
 * and scenario definitions. Used by:
 *   - scripts/scenario-test.ts
 *   - scripts/convert-scenarios.ts
 *   - tests/unit/scenario-defs-validation/*.test.ts
 *
 * @module shared/scenario-types
 */

/**
 * Default inner deadline (ms) for a `waitForTutorialStep` action whose own
 * `timeout` field is absent. Shared so `interaction-executor.ts` (which
 * applies it) and `scenario-utils.ts`'s `effectiveStepTimeoutMs` (which must
 * fold the identical value into its outer-timeout margin computation, or the
 * two silently drift out of lockstep) read one source instead of repeating
 * the bare literal.
 */
export const WAIT_FOR_TUTORIAL_STEP_DEFAULT_TIMEOUT_MS = 30000;

/**
 * A single interaction action within a scenario step.
 * Covers all supported Puppeteer interaction types.
 */
export type InteractionStepAction =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'clickSelector'; selector: string; button?: 'left' | 'right' | 'middle'; timeout?: number }
  | { type: 'mousedown'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'mouseup'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'mousemove'; x: number; y: number }
  // Tile-space picker actions. Prefer these over raw `click`/`mousedown` pixel
  // coordinates whenever the target is a tile: the picker canvas moves with the
  // HUD layout, so baked pixels silently drift onto the wrong tile — or off the
  // grid — and surface only as "the step did not complete".
  | { type: 'pickTile'; x: number; z: number }
  | { type: 'dragTiles'; x1: number; z1: number; x2: number; z2: number }
  // Snaps the camera onto a known world point before a raw click/mousemove
  // targets a scene entity (redesign P2) — there's no picker canvas to
  // recompute pixels from the way pickTile/dragTiles do, so this pins the
  // camera instead and callers click the viewport centre. Forces a render
  // frame afterward (interaction mode suspends drawing — #475 — so neither
  // the camera's nor the scene's matrixWorld is current until one is drawn).
  | { type: 'cameraFocus'; x: number; z: number; distance: number }
  | { type: 'keypress'; key: string }
  | { type: 'keydown'; key: string }
  | { type: 'keyup'; key: string }
  | { type: 'scroll'; x: number; y: number }
  | { type: 'wheel'; deltaX: number; deltaY: number }
  | { type: 'wait'; durationMs: number }
  | { type: 'waitForSelector'; selector: string; timeout?: number }
  // Waits until the tutorial reaches one of the named steps (or ends).
  // `wait` durations cannot express "the tutorial noticed", which is why
  // tutorial-driven scenarios desynced from the rails (#481).
  //
  // #601: loops the console's own `tick 1` (`__gameConsole('tick 1')`, the
  // same call the real auto-tick loop itself makes) up to `maxTicks` times
  // instead of driving the page's real rAF clock — real-world elapsed time
  // no longer has any bearing on how many game ticks pass while this waits,
  // so a scenario using it produces the identical trace on a fast sandbox
  // and a loaded CI runner alike. Deliberately does NOT auto-resolve a
  // pending event (unlike `waitUntil`): a scenario can wait for the
  // tutorial's own "an event just fired" checkpoint by `stepId`, with a
  // dedicated later player step clicking the real dialog, so resolving it
  // here would consume the same event the wait was asked to stop at.
  // `tickCommand` itself refuses to advance while an event is pending, so
  // an unrelated event genuinely pauses this wait, same as a real player's
  // game — matching this action's original real-time behavior. `timeout`
  // (ms) remains as an outer wall-clock safety net against a genuine hang,
  // separate from and much larger than the tick budget itself.
  | { type: 'waitForTutorialStep'; stepId: string | string[]; timeout?: number; maxTicks?: number }
  | { type: 'type'; selector: string; text: string; delay?: number }
  | { type: 'assert'; selector?: string; property?: string; expectedValue?: unknown }
  | { type: 'viewport'; width: number; height: number }
  | { type: 'command'; command: string }
  | { type: 'screenshot' }
  // Drives the loading screen's debug preview bridge directly, bypassing a
  // real level entry, so a scenario can assert the new comp blocks (eyebrow,
  // briefing, stage row, tip) without paying for terrain generation.
  | { type: 'loadingScreenDebug'; action: 'preview' | 'hide'; kind?: 'level' | 'sandbox'; locale?: 'en' | 'fr' }
  // ── Ported from the playability harness (issue #479) ──────────────────
  // A player step can only be expressed in clicks if the vocabulary covers
  // everything a player does, and the scenario vocabulary did not: there was
  // no way to set a <select>, so a step like `charge hole:* explosive:X
  // amount:Y` had no click-equivalent and stayed a console command. Each of
  // these delegates to `runAction` in `interaction-driver.ts` — the same
  // implementation every interaction-mode caller uses, rather than a second
  // copy that can drift from it.
  /** Set a form control's value the way typing or picking would. */
  | { type: 'set'; selector: string; value: string }
  /** Click the first usable control whose label matches (case-insensitive). */
  | { type: 'clickLabel'; label: string; region?: string }
  /** Wait for a selector to exist and be genuinely usable, not merely present. */
  | { type: 'awaitUsable'; selector: string; timeoutMs?: number }
  /** Scroll the wheel out N ticks, to bring an off-screen tile into view. */
  | { type: 'zoomOut'; ticks?: number }
  /** Re-aim the camera at a world tile before clicking it. */
  | { type: 'focusTile'; x: number; z: number; distance?: number }
  /** Click a live scene entity by kind + id rather than a baked coordinate. */
  | { type: 'clickEntity'; kind: 'building' | 'vehicle' | 'employee' | 'fragment'; id: number; distance?: number }
  /**
   * Click a control **only if** it is on screen and usable; do nothing when it
   * is absent. Models a player who answers a dialog when one appears and
   * carries on when none does.
   *
   * Exists for genuinely nondeterministic beats — overwhelmingly `event choose`
   * after a bare `tick`, where whether an event fired is a random roll. A hard
   * `clickSelector` fails on every run where nothing appeared, which is why 339
   * such steps across 47 files were left as console commands instead (the
   * single largest block of un-clicked steps in the suite). The console command
   * they fell back to no-ops in exactly the same circumstances ("No pending
   * event or invalid option."), so this is strictly stronger: when a dialog IS
   * up, a real click has to work.
   *
   * Not an escape hatch for a control that is merely hard to reach: if the
   * target is deterministic, use `clickSelector` so a missing control fails
   * loudly. `timeoutMs` (default 0) allows a brief settle for a dialog that
   * animates in; 0 checks once, immediately.
   */
  | { type: 'clickIfPresent'; selector: string; timeoutMs?: number }
  /**
   * Resolve a pending event through the dialog's own buttons — but decide
   * whether one is pending from **authoritative game state**, not from whether
   * the DOM happens to have rendered yet.
   *
   * `clickIfPresent` is the wrong tool here and shipping it was a real bug:
   * `event choose 0` resolved the event straight from state, while a DOM probe
   * only fires once the modal has painted. Without a GPU a frame costs ~6s
   * (#475), so a short probe silently found nothing, the event stayed pending,
   * later `tick` steps halted on it, and the whole trajectory diverged —
   * `needs-proactive-queue-visual` had an employee rest early and the run went
   * green in command mode while being wrong in the browser.
   *
   * Asking the game whether an event is pending is instant and exact: no wait
   * when there is nothing (the common case, so the suite stays fast), and a
   * generous wait when there genuinely is. The state read is harness
   * bookkeeping deciding whether to wait — the actual resolution is still a
   * real click, which is the thing under test.
   */
  | { type: 'resolveEventIfPending'; timeoutMs?: number }
  /**
   * Advance time until a named state-dump field reaches a target value,
   * bounded by a maximum so a stall fails loudly instead of hanging (issue
   * #590). Replaces a hand-measured `tick N` pad — #553's own migration
   * needed one in 51 scenario files, none of which assert anything about
   * whether the pad was actually long enough: `tick 130` passes whether the
   * work landed at tick 40 or tick 130, and only a tight `equals`/`increased`
   * immediately after it catches drift, if the author remembered to write
   * one. This primitive asserts the wait itself.
   *
   * Command mode loops the console's own `tick 1` (reusing `tickCommand`
   * exactly as it stands, `runCommand(engine, 'tick 1')` — see
   * `command-runner.ts`'s `runWaitUntil`) up to `maxTicks` times, checking
   * the state dump after each. #601: interaction mode now loops the exact
   * same `tick 1` call through the console (`__gameConsole('tick 1')`, the
   * same function the real auto-tick loop itself calls) instead of driving
   * the page's real rAF clock — real-world elapsed time no longer affects
   * how many ticks pass, so both harnesses advance identically regardless
   * of host machine speed or render cost, closing a class of CI-only
   * flakiness (a slow frame let more ticks fire than the equivalent
   * command-mode wait, overshooting a fragile score threshold into an
   * outcome — e.g. a worker_revolt — command mode's own trace never
   * reached). `timeoutMs` remains as an outer wall-clock safety net against
   * a genuine hang, no longer the loop's own pacing budget.
   *
   * `equals` matches with `===` — for a numeric field that settles exactly
   * (a count, a boolean, an id), not a score that merely trends. A step
   * using this is `role: 'setup'`, the same class as `tick N` and
   * `waitForTutorialStep` — not a player action.
   */
  | { type: 'waitUntil'; field: string; equals: unknown; maxTicks: number; timeoutMs: number }
  /**
   * Open a toolbar panel — but only if it is not already open. `#bs-toolbar
   * [data-panel="X"]` toggles: a step's own bare `clickSelector` on that
   * control assumes the panel's current state instead of asserting it, and
   * PR #616 shipped two real bugs from exactly that assumption —
   * `blast-execution-visual.json` toggled the Employee panel *closed* with a
   * redundant open click (it was already open from a preceding step), and
   * `level1-lose-ecology.json` clicked a Blast-panel step tab while the
   * Employee panel was the one actually open. `ensurePanel` reads
   * `__uiState().panels['bs-<panel>-panel'].visible` (issue: main.ts's own
   * "ask the game, not the DOM" bridge, the same principle already applied
   * to `pendingEvent`) and clicks the toolbar tab only when the panel is not
   * already showing — idempotent by construction, so a step never has to
   * know or assume what a preceding step left open.
   *
   * `panel` is one of `#bs-toolbar`'s own `data-panel` values (see
   * `tutorialStepHelpers.ts`'s `TOOLBAR_TARGET`, which `ensurePanel`'s own
   * implementation reuses for the click selector): `blast`, `contracts`,
   * `ops`, `build`, `vehicles`, `employees`, `survey`. `settings` is not a
   * toggle panel (it opens a modal) and is not supported here.
   */
  | { type: 'ensurePanel'; panel: string; timeout?: number }
  /**
   * Select a Blast Workshop step tab (`#bs-blast-panel [data-step="N"]`,
   * `N` 1-5 for Drill/Charge/Sequence/Preview/Fire) — but only if it is not
   * already the active tab. The panel's own `autoAdvance` (`suggestStep`,
   * `BlastWorkshop.ts`) moves the active tab on its own the instant a
   * drilled hole goes uncharged or a charged hole goes unsequenced, out from
   * under a scenario that assumed a step tab a preceding step had left
   * active was still active — the exact root cause behind two of PR #616's
   * fixes (`level1-playthrough-win.json`'s 12 remove-hole clicks, and the
   * `[data-step="2"]` re-clicks documented on `blast-execution-visual.json`'s
   * per-hole charge steps). `ensureStep` reads
   * `__uiState().activeBlastStep` (`UIManager.blastActiveStep`, delegating
   * to `BlastWorkshop.currentStep`) and clicks the tab only when it is not
   * already active, the same idempotent-by-construction shape as
   * `ensurePanel`.
   */
  | { type: 'ensureStep'; step: 1 | 2 | 3 | 4 | 5; timeout?: number };

/**
 * Whether a step's `interaction` models something the player must do by
 * clicking, or setup/observation/guard the harness may still drive by
 * console command.
 *
 * The first three categories are the ones issue #479 measured the suite
 * against; `bootstrap` and `guard` were added by issue #515, which turns
 * `role` from a convention into a structural lint (every step must carry
 * one of these five, or be a documented, individually-tracked exception):
 *
 * - `player` — something a player does. May not reach the console at all.
 * - `setup` — world bootstrapping and time control. May run a command, but
 *   only one `isAllowedSetupCommand` admits, so this cannot quietly become a
 *   hatch for gameplay commands.
 * - `observe` — read-only inspection (`state`, `scores`, `vehicle list`).
 *   This is how the harness records what happened, and it has no UI
 *   equivalent by design, so it stays a command — but only a command on
 *   `OBSERVATION_COMMANDS`, which is checked, not assumed.
 * - `bootstrap` — a mutating command with no UI equivalent and no business
 *   having one (e.g. `employee assign_skill`, which exists so a test doesn't
 *   have to grind XP for real), narrower than `setup`'s allowlist and
 *   checked against its own `isAllowedBootstrapCommand`.
 * - `guard` — a step proving a control is unreachable (`expect.blocked`),
 *   not that one was clicked — the rejection-path counterpart to `player`.
 *
 * Omitted means the step predates this distinction and is unconstrained.
 * A step opts in by setting this explicitly; nothing infers it from the
 * step's command, because inference is exactly the kind of convention a
 * future edit can quietly violate.
 */
export type ScenarioStepRole = 'player' | 'setup' | 'observe' | 'bootstrap' | 'guard';

/**
 * What must be true after a step's actions ran. A scenario with no `expect`
 * anywhere only proves "nothing threw", which is not the same as "the step
 * actually happened" (a click that silently no-ops still throws nothing).
 * Field-for-field mirror of `InteractionGoal` (scripts/shared/interaction-types.ts)
 * so interaction mode reuses `checkGoal` from `interaction-driver.ts` directly
 * — one evaluator, not two that can drift apart.
 *
 * `usable`/`blocked`/`tutorialStep` need a live page and are only checked
 * when the scenario runs in interaction mode; command mode has no DOM, so it
 * checks `equals`/`increased`/`decreased` only (`scenario-goal.ts`'s
 * `checkGoalAgainstState`). This is the same asymmetry the rest of the dual
 * -play mechanism already has — interaction mode is strictly the stronger
 * proof, command mode the faster one.
 */
export interface ScenarioStepGoal {
  /** These numeric fields of the state dump must have grown since before this step's actions ran. */
  increased?: string[];
  /** These numeric fields of the state dump must have shrunk since before this step's actions ran. */
  decreased?: string[];
  /** Field/value pairs the state dump must match exactly after this step's actions ran. */
  equals?: Record<string, unknown>;
  /**
   * Field/amount pairs: `after[field] - before[field]` must equal the given amount exactly
   * (negative for a decrease). The step-local counterpart to `equals` — asserts what this
   * step's own actions did to a field without pinning the field's running total, so an
   * edit earlier in the scenario that shifts the field's value going in does not invalidate
   * this step. Prefer this over `equals` for any field that accumulates across a scenario
   * (cash, scores, counts); reserve `equals` for a field that describes a state rather than
   * a running total (flags, ids, terminal outcomes, counts that are set rather than accrued).
   */
  changedBy?: Record<string, number>;
  /** A control that must be usable after this step (interaction mode only). */
  usable?: string;
  /** A control that must NOT be reachable after this step (interaction mode only). For guard/rejection proofs. */
  blocked?: string;
  /** The tutorial card must show this step id after this step (interaction mode only). */
  tutorialStep?: string;
  /** Free-text note shown in failure reports. */
  note?: string;
}

/**
 * Object form of a scenario step with command and optional interaction array.
 */
export interface ScenarioStepDef {
  command: string;
  timeout?: number;
  description?: string;
  frames?: number;
  interval?: number;
  interaction?: InteractionStepAction[];
  /** See {@link ScenarioStepRole}. */
  role?: ScenarioStepRole;
  /** See {@link ScenarioStepGoal}. */
  expect?: ScenarioStepGoal;
  /**
   * How this step's command result must be judged, beyond "didn't throw".
   * Absent (the default) means the console must accept the command —
   * success:false fails the step, naming the command and the console's
   * own refusal text. Command-mode only; interaction mode is unchanged.
   *
   * - 'refused' — refusal is the assertion (a guard/negative-path step):
   *   the command succeeding is the failure. Independent of `role` — a
   *   guard-role step still has to say this explicitly.
   * - 'either' — genuinely nondeterministic (e.g. `event choose 0` after a
   *   bare `tick`, where an event may or may not be pending): either
   *   outcome passes. Reserved for beats that are truly nondeterministic,
   *   never a blanket silencer.
   */
  commandOutcome?: 'refused' | 'either';
  /**
   * Run this step's command (command mode) or full `interaction` array
   * (interaction mode) `repeat` times in immediate succession before
   * `expect` is evaluated, instead of writing `repeat` byte-identical step
   * objects.
   *
   * - Absent, or `1` — no behavior change from today.
   * - Integer `N >= 2` — runs N times. Exactly one entry is written to the
   *   step's report/state-dump/screenshot, carrying the LAST iteration's
   *   command output and game state.
   * - `0`, a negative number, or a non-integer — invalid.
   *
   * `commandOutcome` (command mode only) is checked after EVERY iteration
   * independently — so iteration 5 of 24 failing is reported as iteration 5
   * failing, not silently absorbed. `expect` itself is never evaluated per
   * iteration: its state-goal fields (`increased`/`decreased`/`equals`/
   * `changedBy`) are evaluated exactly ONCE per step, always — against the
   * state captured immediately before the FIRST iteration and immediately
   * after the LAST — never per-iteration, and NOT auto-scaled by N.
   * `changedBy` values therefore describe the whole block's aggregate
   * delta, not one iteration's — a `repeat: 24` block hiring one employee
   * per iteration needs `changedBy: { employeeCount: 24 }`, not `1`.
   *
   * May not combine with a `waitUntil` interaction action on the same step
   * (both are looping constructs; combining them is rejected as invalid).
   */
  repeat?: number;
}

/**
 * Top-level scenario definition loaded from JSON files.
 */
export interface ScenarioDef {
  name: string;
  description: string;
  steps: ScenarioStepDef[];
  shots?: Array<{
    name: string;
    yaw: number;
    pitch: number;
    /** World (x, z) to centre the shot on; terrain Y is resolved at capture time. Defaults to the whole-site framing when omitted. */
    target?: [number, number];
    /** Camera distance from `target`, in world units. Ignored unless `target` is also set. */
    distance?: number;
  }>;
  /**
   * Interaction mode default is OBSERVE: a blast's fragment collapse plays out
   * on screen (window.__skipBlastPlayback is never called). Set true only for
   * a scenario that has no visual checkpoint over the collapse and would
   * otherwise pay real wall-clock time for it — e.g. tutorial-interactive.json
   * (functional/bootstrap flow, not a blast-visual scenario per
   * dev-testing-strategy's playthrough checkpoint table).
   */
  skipBlastPlayback?: boolean;
}

/**
 * Unified step result from running a scenario step.
 * Used by both command-runner.ts and scenario-test.ts.
 */
export interface StepResult {
  step: number;
  command: string;
  commandOutput: string;
  /**
   * The console's own `success` flag for this step's command, as distinct
   * from `error` — a refused command (`success: false`) is only an `error`
   * when the step did not declare `commandOutcome`. Read by
   * compare-scenario-traces.ts (issue #674), which compares this against
   * interaction mode's own per-command success flag: the same command
   * accepted in one mode and refused in the other is exactly the shape of a
   * click that resolved onto a different entity than the command names.
   */
  commandSuccess?: boolean;
  gameState: Record<string, unknown> | null;
  uiState?: Record<string, unknown> | null;
  screenshotPath?: string;
  statePath: string;
  error?: string;
  warning?: string;
}
