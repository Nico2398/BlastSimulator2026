/**
 * BlastSimulator2026 — Shared Scenario Types
 *
 * Canonical type definitions for scenario steps, interaction actions,
 * and scenario definitions. Used by:
 *   - scripts/scenario-test.ts
 *   - scripts/convert-scenarios.ts
 *   - tests/unit/scenario-defs.test.ts
 *
 * @module shared/scenario-types
 */

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
  // Waits until the tutorial reaches one of the named steps (or ends), driving
  // the game's real auto-tick clock for the duration of the wait — the same
  // bracketing the playtest harness uses — so queued work the step depends on
  // (a surveyor walking out, a driver boarding) can actually finish. Fixed
  // `wait` durations cannot express "the tutorial noticed", which is why
  // tutorial-driven scenarios desynced from the rails (#481). `timeout` is ms.
  | { type: 'waitForTutorialStep'; stepId: string | string[]; timeout?: number }
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
  // these delegates to `runAction` in `playtest-driver.ts` — the same
  // implementation the playtest channel uses, rather than a second copy that
  // can drift from it.
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
  | { type: 'clickIfPresent'; selector: string; timeoutMs?: number };

/**
 * Whether a step's `interaction` models something the player must do by
 * clicking, or setup/observation the harness may still drive by console
 * command.
 *
 * The three categories are the ones issue #479 measured the suite against:
 *
 * - `player` — something a player does. May not reach the console at all.
 * - `setup` — world bootstrapping and time control. May run a command, but
 *   only one `isAllowedSetupCommand` admits, so this cannot quietly become a
 *   hatch for gameplay commands.
 * - `observe` — read-only inspection (`state`, `scores`, `vehicle list`).
 *   This is how the harness records what happened, and it has no UI
 *   equivalent by design, so it stays a command — but only a command on
 *   `OBSERVATION_COMMANDS`, which is checked, not assumed.
 *
 * Omitted means the step predates this distinction and is unconstrained.
 * A step opts in by setting this explicitly; nothing infers it from the
 * step's command, because inference is exactly the kind of convention a
 * future edit can quietly violate.
 */
export type ScenarioStepRole = 'player' | 'setup' | 'observe';

/**
 * What must be true after a step's actions ran. A scenario with no `expect`
 * anywhere only proves "nothing threw" — the playtest harness's whole
 * argument was that this is not the same as "the step actually happened"
 * (a click that silently no-ops still throws nothing). Field-for-field
 * mirror of `PlaytestGoal` (scripts/shared/playtest-types.ts) so interaction
 * mode reuses `checkGoal` from `playtest-driver.ts` directly — one evaluator,
 * not two that can drift apart.
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
}

/**
 * Unified step result from running a scenario step.
 * Used by both command-runner.ts and scenario-test.ts.
 */
export interface StepResult {
  step: number;
  command: string;
  commandOutput: string;
  gameState: Record<string, unknown> | null;
  uiState?: Record<string, unknown> | null;
  screenshotPath?: string;
  statePath: string;
  error?: string;
  warning?: string;
}
