import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';

// Shared constant fixtures for the scenario-defs-*.test.ts split (issue #703).
// Not a test file — no `describe`/`it`, so vitest's test-file glob never
// collects it. Moved verbatim out of the original scenario-defs.test.ts.

// ── Dual-play interaction action types ──

export const KNOWN_INTERACTION_ACTION_TYPES = [
  'click', 'clickSelector', 'mousedown', 'mouseup', 'mousemove',
  'pickTile', 'dragTiles', 'cameraFocus',
  'keypress', 'keydown', 'keyup',
  'scroll', 'wheel',
  'wait', 'waitForSelector', 'waitForTutorialStep', 'type',
  'assert', 'viewport', 'command', 'screenshot',
  'loadingScreenDebug',
  // Ported from the former playtest harness (issue #479) — same names, same
  // implementations, so a converted step behaves the same way the harness's
  // beats used to. See InteractionStepAction in scripts/shared/scenario-types.ts.
  'set', 'clickLabel', 'awaitUsable', 'zoomOut', 'focusTile', 'clickEntity',
  // Conditional click for genuinely nondeterministic beats (`event choose`
  // after a bare tick). Not an escape hatch — see InteractionStepAction.
  'clickIfPresent',
  // Resolves a pending event via its dialog, deciding from game state rather
  // than DOM render timing. See InteractionStepAction.
  'resolveEventIfPending',
  // Advances time until a named state-dump field reaches a target value,
  // bounded by maxTicks/timeoutMs so a stall fails loudly (issue #590). See
  // InteractionStepAction.
  'waitUntil',
  // Idempotent panel/step-tab selection: click only if not already open/
  // active, instead of a step assuming what a preceding one left in place
  // (PR #616 review round, item 7). See InteractionStepAction.
  'ensurePanel', 'ensureStep',
  // Polls a DOM property until it matches, bounded by timeoutMs — the
  // condition-based alternative to padding with a flat `wait` for something
  // the browser settles asynchronously (PR #888). See InteractionStepAction.
  'waitForProperty',
  // Drives a -/value/+ stepper to an explicit value instead of encoding it
  // as a click count. See InteractionStepAction.
  'setStepper',
] as const;

/**
 * Every definition whose name carries `-playthrough` — the long, campaign-
 * shaped files `shape.test.ts` holds to a minimum step count and an
 * inspection-command ending. Read from the directory, not hand-listed: a
 * hand-maintained list silently skips any file nobody remembered to add
 * (29 of 141 definitions were in no category list at all when this was
 * derived), and a playthrough that dodges its own shape checks is exactly
 * the file most likely to need them.
 */
export const PLAYTHROUGH_SCENARIO_NAMES: readonly string[] =
  scenarioFiles(SCENARIO_DIR).filter((name) => name.includes('-playthrough'));

/**
 * Every definition that declares a multi-angle `shots` array, whatever its
 * name. The shots-shape check applies to the property, not to a naming
 * convention: 20 files with a real `shots` array were unlisted under the old
 * hand-written list and went unchecked, while four `-visual` files carry no
 * `shots` at all (their per-step screenshots are the visual evidence) and
 * must not be forced to.
 */
export const VISUAL_SCENARIO_NAMES: readonly string[] =
  scenarioFiles(SCENARIO_DIR).filter((name) => {
    const def = loadScenarioDef(name, SCENARIO_DIR) as { shots?: unknown };
    return Array.isArray(def.shots) && def.shots.length > 0;
  });

/**
 * Scenarios that exercise the UI by clicking real controls rather than
 * replaying console commands. These are the ones that prove a panel is
 * reachable and a button is not covered by something else.
 */
export const UI_DRIVEN_SCENARIO_NAMES = [
  'tutorial-interactive',
  'building-tier-system-visual',
] as const;

/**
 * Every scenario definition on disk, read from the directory rather than
 * concatenated from the category lists above — the same rule
 * `tests/unit/lint/`'s scenario lints already follow through
 * `scenarioFiles()`.
 *
 * A hand-maintained union silently skips any file nobody remembered to add
 * to it: 28 of the 140 definitions had never been seen by a single check in
 * this directory, and `building-construction-continuous-policy.json` was one
 * of them — its `role: 'setup'` step running `set_policy` sailed past the
 * `checkStepActionAllowed` lint below and only failed in CI's interaction
 * shard, on `main`, after merge. The category lists are derived from
 * the same directory, each by the property its checks are about.
 */
export const ALL_SCENARIO_NAMES: readonly string[] = scenarioFiles(SCENARIO_DIR);

export const KNOWN_COMMANDS = [
  'new_game', 'campaign', 'time', 'scores', 'finances',
  'employee', 'state', 'survey', 'tick', 'event',
  'drill_plan', 'charge', 'sequence', 'blast', 'contract',
  'build', 'vehicle', 'stats', 'inspect', 'zone', 'research',
  'tutorial_start', 'corrupt', 'mafia', 'buy_software', 'weather', 'buy',
  'fragments', 'preview', 'blast_preview', 'install_tubing',
  'build_ramp', 'level_ground', 'set_policy', 'terrain_info', 'help',
  'blast_plan', 'needs', 'save', 'load', 'sandbox',
];

/** Commands that inspect state — valid as a final playthrough step */
export const INSPECTION_COMMANDS = ['campaign', 'state', 'scores', 'finances', 'stats', 'inspect'];
