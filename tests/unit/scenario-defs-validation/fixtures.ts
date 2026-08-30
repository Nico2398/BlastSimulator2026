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
] as const;

export const PLAYTHROUGH_SCENARIO_NAMES = [
  'tutorial-playthrough',
  'level1-playthrough-win',
  'level1-playthrough-revolt',
  'level2-playthrough-win',
  'level2-playthrough-bankruptcy',
  'level3-playthrough-win',
  'level3-playthrough-ecology',
  'survey-then-blast-playthrough',
] as const;

export const FEATURE_SCENARIO_NAMES = [
  'survey-then-blast',
  'building-lifecycle',
  'research-center-gate',
  'skill-progression',
  'multi-deck-blast',
  'presplit-wall',
  'needs-cycle',
  'ramp-navigation',
  'vibration-budget',
  'vehicle-traffic',
  'employee-training',
  'blast-undercharge',
  'blast-overcharge',
  'collapse-recovery',
  'contract-negotiation',
  'weather-flood',
  'blast-basic',
  'blast-charge-loading-ui',
  'blast-detonation-sequence-ui',
  'blast-drill-plan-ui',
  'blast-execution-effects',
  'blast-preview-software-tiers',
  'blast-report-metrics',
  'blast-voxel-fragmentation',
  'employee-skills-visual',
  'level1-lose-arrest',
  'level1-lose-bankruptcy',
  'level1-lose-ecology',
  'level1-lose-revolt',
  'level1-win-conservative',
  'level1-win-efficient',
  'hauling-gate',
  'economy-full-loop',
  'maintenance-cost-drain',
  'action-cancel',
] as const;

export const VISUAL_SCENARIO_NAMES = [
  'blast-drill-plan-visual',
  'blast-charge-sequence-visual',
  'blast-preview-tiers-visual',
  'blast-execution-visual',
  'blast-report-visual',
  'blast-voxel-fragmentation-visual',
  'blast-visual-full',
  'employee-skill-progression-visual',
  'needs-gauges-visual',
  'needs-drain-visual',
  'needs-morale-visual',
  'needs-collapse-visual',
  'needs-replenishment-visual',
  'needs-proactive-queue-visual',
  'needs-cost-visual',
  'needs-shift-cycle-visual',
  'nav-cell-types-visual',
  'nav-move-costs-visual',
  'nav-pathfinding-visual',
  'nav-ramp-routing-visual',
  'nav-dynamic-updates-visual',
  'nav-path-following-visual',
  'nav-minimap-integration-visual',
  'core-loop-visual',
  'economy-display-visual',
  'contract-panel-visual',
  'event-dialog-visual',
  'scores-display-visual',
  'time-management-visual',
  'weather-display-visual',
  'safety-projection-visual',
  'save-load-visual',
  'i18n-display-visual',
  'main-menu-visual',
  'tutorial-steps-visual',
  'building-menu-visual',
  'building-placement-visual',
  'building-tier-system-visual',
  'building-training-visual',
  'building-living-visual',
  'building-warehouse-visual',
  'building-research-visual',
  'building-research-progression-visual',
  'building-vehicle-depot-visual',
  'building-ramp-visual',
  'building-destruction-visual',
  'vehicle-3d-rendering-visual',
  'vehicle-driver-assignment-visual',
  'vehicle-purchase-tier-ui-visual',
  'vehicle-purchase-visual',
  'vehicle-roles-panel-visual',
  'vehicle-task-states-visual',
  'vehicle-traffic-routing-visual',
  'survey-confidence-display',
  'survey-confidence-overlay',
  'survey-execution',
  'survey-method-selection',
  'survey-ore-vein-visibility',
  'survey-overlay-lifecycle',
  'survey-post-blast-ore-report',
  'survey-result-visualization',
  'survey-seismic-side-effects',
  'survey-stale-handling',
  'tutorial-interactive',
  'scene-picking-visual',
  'landscape-continuity-visual',
  'insufficient-funds-guards-visual',
] as const;

/**
 * Scenarios that exercise the UI by clicking real controls rather than
 * replaying console commands. These are the ones that prove a panel is
 * reachable and a button is not covered by something else.
 */
export const UI_DRIVEN_SCENARIO_NAMES = [
  'tutorial-interactive',
  'building-tier-system-visual',
] as const;

export const ALL_SCENARIO_NAMES = [
  ...PLAYTHROUGH_SCENARIO_NAMES,
  ...FEATURE_SCENARIO_NAMES,
  ...VISUAL_SCENARIO_NAMES,
] as const;

export const KNOWN_COMMANDS = [
  'new_game', 'campaign', 'time', 'scores', 'finances',
  'employee', 'state', 'survey', 'tick', 'event',
  'drill_plan', 'charge', 'sequence', 'blast', 'contract',
  'build', 'vehicle', 'stats', 'inspect', 'zone', 'research',
  'tutorial_start', 'corrupt', 'mafia', 'buy_software', 'weather', 'buy',
  'fragments', 'preview', 'blast_preview', 'install_tubing',
  'build_ramp', 'set_policy', 'terrain_info', 'help',
  'blast_plan', 'needs', 'save', 'load',
];

/** Commands that inspect state — valid as a final playthrough step */
export const INSPECTION_COMMANDS = ['campaign', 'state', 'scores', 'finances', 'stats', 'inspect'];
