/**
 * BlastSimulator2026 — Playtest definitions
 *
 * A playtest is stricter than a scenario: it plays the game the way a player
 * does and asserts that the game actually moved. Scenarios can pass while the
 * game is stuck, because "no selector timed out" is not the same as "the step
 * completed". A playtest names the goal of each beat and fails when the goal is
 * not reached, with the reason the blocking control could not be used.
 *
 * @module shared/playtest-types
 */

/** One thing a player does. Nothing here can reach the console. */
export type PlayerAction =
  /** Click a control. Fails if it is absent, disabled, or covered. */
  | { do: 'click'; selector: string }
  /** Click the first usable control whose label matches (case-insensitive). */
  | { do: 'clickLabel'; label: string; region?: string }
  /** Set a form control's value the way typing would. */
  | { do: 'set'; selector: string; value: string }
  /** Click a tile in the open tile picker, in grid coordinates. */
  | { do: 'pickTile'; x: number; z: number }
  /** Drag a rectangle in the open tile picker, in grid coordinates. */
  | { do: 'dragTiles'; x1: number; z1: number; x2: number; z2: number }
  /** Wait for a selector to exist and be usable. */
  | { do: 'awaitUsable'; selector: string; timeoutMs?: number }
  /**
   * Wait for the tutorial card to reach a step id. Needed because some cards
   * auto-advance on a timer: acting on the next card before it appears makes the
   * step capture its "before" snapshot after the change it is watching for.
   */
  | { do: 'awaitTutorialStep'; stepId: string; timeoutMs?: number }
  /** Let the simulation run. This is the only way a playtest passes time. */
  | { do: 'letTimePass'; ticks: number };

/**
 * What must be true after a beat's actions. At least one field is required —
 * a beat with no goal proves nothing.
 */
export interface PlaytestGoal {
  /** The tutorial card must show this step id. */
  tutorialStep?: string;
  /** These numeric fields of the state dump must have grown. */
  increased?: string[];
  /** Field/value pairs the state dump must match exactly. */
  equals?: Record<string, unknown>;
  /** A control that must be usable by now. */
  usable?: string;
  /** Free-text note shown in the report. */
  note?: string;
}

export interface PlaytestBeat {
  /** What the player is trying to do, in plain words. */
  goal: string;
  /** Setup commands, allowed only in beats flagged `setup`. */
  setup?: string[];
  /** Player actions, in order. */
  actions?: PlayerAction[];
  /** Assertions that decide pass or fail. */
  expect?: PlaytestGoal;
}

export interface PlaytestDef {
  name: string;
  description: string;
  beats: PlaytestBeat[];
}

/**
 * Console commands a playtest may use, and only in a beat's `setup`.
 *
 * Everything else has to be reachable by clicking, because a console command
 * standing in for a player action is how a dead end hides: a harness that runs
 * `employee assign_skill` will never notice that no button grants a
 * qualification.
 */
export const SETUP_COMMAND_ALLOWLIST = [
  'new_game',
  'campaign',
  'tutorial_start',
] as const;

/** Time control is a player affordance (the speed button), so it is separate. */
export const TIME_COMMAND_ALLOWLIST = ['tick', 'time'] as const;

/** True when `command`'s first token may appear in a playtest setup block. */
export function isAllowedSetupCommand(command: string): boolean {
  const token = command.trim().split(/\s+/)[0] ?? '';
  return (SETUP_COMMAND_ALLOWLIST as readonly string[]).includes(token)
    || (TIME_COMMAND_ALLOWLIST as readonly string[]).includes(token);
}
