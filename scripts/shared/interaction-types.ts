/**
 * BlastSimulator2026 — Interaction types
 *
 * Types shared by every channel that plays the game the way a player does and
 * asserts the game actually moved: `interaction-driver.ts`'s `checkGoal`,
 * `interaction-executor.ts`, and both interaction-mode scenario runners.
 * A goal names what must be true after a step's actions and fails when it is
 * not reached, with the reason the blocking control could not be used.
 *
 * @module shared/interaction-types
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
   * by kind + id rather than a baked world coordinate: a step that just hired
   * an employee has no static x/z to click, only the id the hire produced,
   * and the driver looks up its current position itself.
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
  /** Let the simulation run. This is the only way a `PlayerAction` sequence passes time. */
  | { do: 'letTimePass'; ticks: number };

/**
 * What must be true after a step's actions. At least one field is required —
 * a goal with no checkable field proves nothing.
 */
export interface InteractionGoal {
  /** The tutorial card must show this step id. */
  tutorialStep?: string;
  /** These numeric fields of the state dump must have grown. */
  increased?: string[];
  /** These numeric fields of the state dump must have shrunk. */
  decreased?: string[];
  /** Field/value pairs the state dump must match exactly. */
  equals?: Record<string, unknown>;
  /**
   * Field/amount pairs: `after[field] - before[field]` must equal the given amount exactly
   * (negative for a decrease). See `ScenarioStepGoal.changedBy` (scenario-types.ts) for the
   * rationale — this is its field-for-field mirror.
   */
  changedBy?: Record<string, number>;
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

/**
 * Console commands a `role: 'setup'` scenario step may use.
 *
 * Everything else has to be reachable by clicking, because a console command
 * standing in for a player action is how a dead end hides: a step that runs
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

/** True when `command`'s first token may appear in a `role: 'setup'` step. */
export function isAllowedSetupCommand(command: string): boolean {
  const token = command.trim().split(/\s+/)[0] ?? '';
  return (SETUP_COMMAND_ALLOWLIST as readonly string[]).includes(token)
    || (TIME_COMMAND_ALLOWLIST as readonly string[]).includes(token);
}
