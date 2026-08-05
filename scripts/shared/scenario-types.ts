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
  | { type: 'screenshot' };

/**
 * Whether a step's `interaction` models something the player must do by
 * clicking, or setup/observation the harness may still drive by console
 * command.
 *
 * Omitted means the step predates this distinction and is unconstrained —
 * true of every scenario except the pilot conversion (tutorial-interactive.json,
 * issue #479). A step opts in by setting this explicitly; nothing infers it
 * from the step's command, because inference is exactly the kind of
 * convention a future edit can quietly violate.
 */
export type ScenarioStepRole = 'player' | 'setup';

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
