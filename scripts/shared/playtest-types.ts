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
  /**
   * Click a live scene entity (redesign P2 — src/ui/scene/ScenePicking.ts)
   * by kind + id rather than a baked world coordinate: a playtest that just
   * hired an employee has no static x/z to click, only the id the hire
   * produced, and the driver looks up its current position itself.
   */
  | { do: 'clickEntity'; kind: 'building' | 'vehicle' | 'employee' | 'fragment'; id: number; distance?: number }
  /**
   * Scroll the wheel out N ticks (design doc: always available, even while a
   * placement tool is armed). P3's in-scene picker only accepts a click on a
   * tile actually on screen — unlike the retired 2D picker, which showed the
   * whole site regardless of the 3D camera. A beat whose target tile isn't
   * near wherever the camera last looked needs this before pickTile/
   * dragTiles, the same way a real player would zoom out to find their spot.
   */
  | { do: 'zoomOut'; ticks?: number }
  /**
   * Re-aim the camera at a world tile, the way a real player looks at where
   * they're about to click before clicking it. Unlike zoomOut (a blind
   * dolly-back), this sets the camera's *target* to (x, z), so the tile is
   * guaranteed to land at screen centre — clear of the bottom-docked
   * placement strip that a target's default screen position can otherwise
   * end up directly under (title/RESULT/CONFIRM/ESC all catch clicks across
   * their full bar, not just the buttons, so a click that lands on the strip
   * never reaches the canvas beneath it). Needed before pickTile/dragTiles
   * whenever the beat's target tile isn't already clear of every docked
   * panel, the same instinctive adjustment a player makes without thinking
   * about it.
   */
  | { do: 'focusTile'; x: number; z: number; distance?: number }
  /** Wait for a selector to exist and be usable. */
  | { do: 'awaitUsable'; selector: string; timeoutMs?: number }
  /**
   * Wait for the tutorial card to reach a step id, or any of several. Needed
   * because some cards auto-advance on a timer: acting on the next card before
   * it appears makes the step capture its "before" snapshot after the change it
   * is watching for. A list covers the case where two cards are both a correct
   * outcome and which one is showing depends on how fast the run got there.
   */
  | { do: 'awaitTutorialStep'; stepId: string | string[]; timeoutMs?: number }
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
  /** These numeric fields of the state dump must have shrunk. */
  decreased?: string[];
  /** Field/value pairs the state dump must match exactly. */
  equals?: Record<string, unknown>;
  /** A control that must be usable by now. */
  usable?: string;
  /**
   * A control that must NOT be reachable. For guided flows, where letting the
   * player press the wrong thing is the defect.
   */
  blocked?: string;
  /**
   * DOM `textContent` that must exactly match, keyed by CSS selector. Fails if
   * a selector is absent from the DOM or its text differs. Added for #492
   * section 3: `equals` only reads the numeric/state `__gameState()` dump, so
   * it cannot prove a rendered string followed a locale switch — some panel
   * text (a tooltip, a chip label) is applied once at construction and never
   * re-applied on a language change, which no other goal field can catch.
   */
  textEquals?: Record<string, string>;
  /**
   * DOM `title` attribute (tooltip) that must exactly match, keyed by CSS
   * selector. Same rationale and failure shape as `textEquals`.
   */
  titleEquals?: Record<string, string>;
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
  'save',
  'load',
  'sandbox',
] as const;

/** Time control is a player affordance (the speed button), so it is separate. */
export const TIME_COMMAND_ALLOWLIST = ['tick', 'time'] as const;

/** True when `command`'s first token may appear in a playtest setup block. */
export function isAllowedSetupCommand(command: string): boolean {
  const token = command.trim().split(/\s+/)[0] ?? '';
  return (SETUP_COMMAND_ALLOWLIST as readonly string[]).includes(token)
    || (TIME_COMMAND_ALLOWLIST as readonly string[]).includes(token);
}
