// BlastSimulator2026 — Shared ConsoleRunner factory
// Creates a fully-configured ConsoleRunner with all game commands registered.
// Used by both console.ts (CLI mode) and main.ts (browser console bridge).

import { ConsoleRunner, parseCommand, type CommandResult } from './ConsoleRunner.js';
import { incrementActionCount } from '../core/events/EventSystem.js';
import {
  newGameCommand,
  inspectCommand,
  terrainInfoCommand,
  landscapeInfoCommand,
} from './commands/world.js';
import {
  type MiningContext,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  blastCommand,
  blastPlanCommand,
  previewCommand,
  blastPreviewCommand,
  buySoftwareCommand,
  buildRampCommand,
  weatherCommand,
  tubingCommand,
  surveyCommand,
} from './commands/mining.js';
import {
  financesCommand,
  contractCommand,
  fragmentsCommand,
} from './commands/economy.js';
import {
  buildCommand,
  employeeCommand,
  scoresCommand,
  zoneCommand,
  needsCommand,
} from './commands/entities.js';
import { researchCommand } from './commands/research.js';
import { setPolicyCommand } from './commands/policy.js';
import { vehicleCommand } from './commands/vehicle.js';
import {
  tickCommand,
  eventCommand,
  corruptCommand,
  mafiaCommand,
  timeCommand,
} from './commands/events.js';
import {
  campaignStatusCommand,
  campaignCompleteCommand,
  campaignStartCommand,
  statsCommand,
} from './commands/campaign.js';
import { sandboxCommand } from './commands/sandbox.js';
import { stateCommand } from './commands/state.js';
import { saveCommand, loadCommand } from './commands/saveload.js';
import { setupEvents } from '../core/events/index.js';
import { EventEmitter } from '../core/state/EventEmitter.js';

export interface RunnerWithContext {
  runner: ConsoleRunner;
  ctx: MiningContext;
  /** Typed emitter — subscribe in main.ts / console.ts for game-over UI or log messages. */
  emitter: EventEmitter;
}

/** Console commands that should not count as user actions for event cooldown gating. */
export const META_COMMANDS = ['tick', 'speed', 'pause', 'time'] as const;

/**
 * `event` subcommands that are harness/UI bookkeeping rather than a player
 * decision, exempted the same way META_COMMANDS is: `status` is a pure read
 * (interaction mode's `resolveEventIfPending` polls it every step, pending or
 * not, to decide whether to wait for a real click — command-mode scenarios
 * never issue an equivalent poll, so counting it inflates interaction mode's
 * actionCountSinceEvent for a call no real player ever makes); `dismiss`
 * closes an already-resolved outcome panel — command-mode scenarios never
 * model it either, since nothing downstream depends on it. `fire` is a real
 * (debug) decision and still counts unconditionally. `choose` is handled
 * separately below — it counts only when it actually resolved something.
 */
const META_EVENT_SUBCOMMANDS = ['status', 'dismiss'] as const;

/**
 * Run a command through the runner and apply the same action-count gating
 * every command entry point must apply — browser (`window.__gameConsole`),
 * CLI (`console.ts`), and headless scenario runners alike. Centralized here
 * so command mode and interaction mode stay behaviorally identical: without
 * this increment, `EventSystem`'s `MIN_EVENT_INTERVAL_ACTIONS` cooldown gate
 * never opens, and timer-based events (e.g. politics_ev_mandate) can fire in
 * one mode and never in the other despite an identical seed and command list.
 * The same divergence resurfaces two different ways: a mode-specific
 * bookkeeping call (like `event status`) counting on one side with no
 * equivalent on the other (META_EVENT_SUBCOMMANDS), or the same call
 * counting on both sides but at a different real/no-op rate. The second is
 * exactly what happened here: command-mode scenario steps issue `event
 * choose 0` unconditionally, on a fixed schedule, whether or not a dialog
 * would actually be showing — a real player only ever clicks a choice when
 * one is; interaction mode's `resolveEventIfPending` mirrors that correctly
 * (skips the console entirely when nothing is pending), so an `event choose`
 * that resolves nothing (`success: false`, "No pending event or invalid
 * option") gave command mode free, uncontested credit toward the cooldown
 * that interaction mode never got for the identical no-op moment. Fixed by
 * only counting `event choose` when it actually resolved an event.
 */
export function runCommand(engine: RunnerWithContext, cmd: string): CommandResult {
  const result = engine.runner.run(cmd);
  const parsed = parseCommand(cmd);
  const sub = parsed.args[0] ?? '';
  const isMetaEvent = parsed.command === 'event'
    && (META_EVENT_SUBCOMMANDS as readonly string[]).includes(sub);
  const isNoOpChoose = parsed.command === 'event' && sub === 'choose' && !result.success;
  const isExempt = META_COMMANDS.includes(parsed.command as typeof META_COMMANDS[number])
    || isMetaEvent || isNoOpChoose;
  if (engine.ctx.state && !isExempt) {
    incrementActionCount(engine.ctx.state.events);
  }
  return result;
}

/**
 * Create and return a fully-configured ConsoleRunner with all game commands.
 * Call setupEvents() before using the runner to ensure the event pool is filled.
 */
export function createRunner(): RunnerWithContext {
  // Register all 258 events into the global pool (idempotent)
  setupEvents();

  const emitter = new EventEmitter();
  const runner = new ConsoleRunner();
  const ctx: MiningContext = { state: null, grid: null, landscape: null, playableArea: null, emitter };

  // --- World commands (Phase 2) ---
  runner.register('new_game', 'Create a new game (mine_type:desert seed:42)', (args, named) =>
    newGameCommand(ctx, args, named),
  );
  runner.register('inspect', 'Inspect a voxel at x,y,z', (args, named) =>
    inspectCommand(ctx, args, named),
  );
  runner.register('terrain_info', 'Show terrain grid info', (args, named) =>
    terrainInfoCommand(ctx, args, named),
  );
  runner.register('landscape_info', 'Build (if needed) and show the landscape zone tile count/layout', (args, named) =>
    landscapeInfoCommand(ctx, args, named),
  );
  runner.register('survey', 'Survey terrain (seismic|core_sample|aerial) x:<X> z:<Z>', (args, named) =>
    surveyCommand(ctx, args, named),
  );

  // --- Mining commands (Phase 3) ---
  runner.register('drill_plan', 'Manage drill plan (grid|add|show)', (args, named) =>
    drillPlanCommand(ctx, args, named),
  );
  runner.register('charge', 'Set charges (hole:* explosive:X amount:Ykg stemming:Zm)', (args, named) =>
    chargeCommand(ctx, args, named),
  );
  runner.register('sequence', 'Detonation sequence (auto|set|show)', (args, named) =>
    sequenceCommand(ctx, args, named),
  );
  runner.register('blast', 'Execute the current blast plan', (args, named) =>
    blastCommand(ctx, args, named),
  );
  runner.register('blast_plan', 'Save/load/validate blast plans', (args, named) =>
    blastPlanCommand(ctx, args, named),
  );
  runner.register('preview', 'Preview blast (energy|fragments|projections|vibrations)', (args, named) =>
    previewCommand(ctx, args, named),
  );
  runner.register('blast_preview', 'Comprehensive blast preview (energy, fragments, projections, vibrations)', (args, named) =>
    blastPreviewCommand(ctx, args, named),
  );
  runner.register('buy_software', 'Buy software upgrade', (args, named) =>
    buySoftwareCommand(ctx, args, named),
  );
  runner.register('build_ramp', 'Build ramp (origin:X,Z direction:south length:10)', (args, named) =>
    buildRampCommand(ctx, args, named),
  );
  runner.register('weather', 'Show/advance/set weather (advance|set <state>)', (args, named) =>
    weatherCommand(ctx, args, named),
  );
  runner.register('buy', 'Buy items (tubing amount:10)', (_args, named) =>
    tubingCommand(ctx, ['buy'], named),
  );
  runner.register('install_tubing', 'Install tubing on a hole (hole:3)', (_args, named) =>
    tubingCommand(ctx, ['install'], named),
  );

  // --- Economy commands (Phase 4) ---
  runner.register('finances', 'Show balance and transactions', (args, named) =>
    financesCommand(ctx, args, named),
  );
  runner.register('contract', 'Contracts (list|accept|status|deliver|negotiate)', (args, named) =>
    contractCommand(ctx, args, named),
  );
  runner.register('fragments', 'Fragment logistics (status)', (args, named) =>
    fragmentsCommand(ctx, args, named),
  );
  runner.alias('fragment', (args, named) =>
    fragmentsCommand(ctx, args, named),
  );

  // --- Entity commands (Phase 5) ---
  runner.register('build', 'Place/manage buildings (list|destroy|move|<type> at:x,z)', (args, named) =>
    buildCommand(ctx, args, named),
  );
  runner.register('vehicle', 'Manage vehicles (list|buy|assign|move|driver|haul)', (args, named) =>
    vehicleCommand(ctx, args, named),
  );
  runner.register('employee', 'Manage employees (list|hire|raise|fire|assign_skill|dispatch|train)', (args, named) =>
    employeeCommand(ctx, args, named),
  );
  runner.register('scores', 'Show all four scores', (args, named) =>
    scoresCommand(ctx, args, named),
  );
  runner.register('zone', 'Safety zones (clear|status)', (args, named) =>
    zoneCommand(ctx, args, named),
  );
  runner.register('needs', 'Show all employees need gauges (hunger, fatigue, break)', (args, named) =>
    needsCommand(ctx, args, named),
  );
  runner.register('set_policy', 'Set site policy (mode:shift_8h|shift_12h|continuous|custom [hunger:N] [fatigue:N] [social:N])', (args, named) =>
    setPolicyCommand(ctx, args, named),
  );
  runner.register('research', 'Research Center tasks (queue type:<BuildingType> tier:2|3|status)', (args, named) =>
    researchCommand(ctx, args, named),
  );

  // --- Event commands (Phase 6) ---
  runner.register('tick', 'Advance time by N ticks (default 1)', (args, named) =>
    tickCommand(ctx, args, named),
  );
  runner.register('event', 'Event system (status|choose|timers|fire <id>)', (args, named) =>
    eventCommand(ctx, args, named),
  );
  runner.register('corrupt', 'Corruption (target:judge cost:50000)', (args, named) =>
    corruptCommand(ctx, args, named),
  );
  runner.register('mafia', 'Mafia ops (status|accident|frame|smuggle)', (args, named) =>
    mafiaCommand(ctx, args, named),
  );
  runner.register('time', 'Time control (status|pause|resume|speed 4)', (args, named) =>
    timeCommand(ctx, args, named),
  );

  // --- Campaign commands (Phase 7) ---
  runner.register('campaign', 'Campaign (status|start level:<id>|complete)', (args, named): CommandResult => {
    const sub = args[0] ?? named['sub'] ?? 'status';
    const rest = args.slice(1);
    if (sub === 'status') return campaignStatusCommand(ctx, rest, named);
    if (sub === 'start') return campaignStartCommand(ctx, rest, named);
    if (sub === 'complete') return campaignCompleteCommand(ctx, rest, named);
    return { success: false, output: `Unknown sub-command: "${sub}". Use: status | start | complete` };
  });
  runner.register('sandbox', 'Sandbox mode (start biome:<id> seed:<n|random> size:<n> ...)', (args, named) =>
    sandboxCommand(ctx, args, named),
  );
  runner.register('stats', 'Show per-level success stats and star rating', (args, named) =>
    statsCommand(ctx, args, named),
  );

  // --- State inspection (agent-friendly) ---
  runner.register('state', 'Dump game state as JSON (full|summary)', (args, named) =>
    stateCommand(ctx, args, named),
  );

  // --- Save/Load (quick-save round trip; see saveload.ts) ---
  runner.register('save', 'Save game to a quick-save slot (slot:name)', (args, named) =>
    saveCommand(ctx, args, named),
  );
  runner.register('load', 'Load game from a quick-save slot (slot:name)', (args, named) =>
    loadCommand(ctx, args, named),
  );

  return { runner, ctx, emitter };
}
