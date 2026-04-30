// BlastSimulator2026 — Shared ConsoleRunner factory
// Creates a fully-configured ConsoleRunner with all game commands registered.
// Used by both console.ts (CLI mode) and main.ts (browser console bridge).

import { ConsoleRunner, type CommandResult } from './ConsoleRunner.js';
import {
  newGameCommand,
  inspectCommand,
  terrainInfoCommand,
  surveyCommand,
} from './commands/world.js';
import {
  type MiningContext,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  blastCommand,
  blastPlanCommand,
  previewCommand,
  buySoftwareCommand,
  buildRampCommand,
  weatherCommand,
  tubingCommand,
} from './commands/mining.js';
import { createTubingState } from '../core/mining/Tubing.js';
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
} from './commands/entities.js';
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
import { stateCommand } from './commands/state.js';
import { setupEvents } from '../core/events/index.js';
import { EventEmitter } from '../core/state/EventEmitter.js';

export interface RunnerWithContext {
  runner: ConsoleRunner;
  ctx: MiningContext;
  /** Typed emitter — subscribe in main.ts / console.ts for game-over UI or log messages. */
  emitter: EventEmitter;
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
  const ctx: MiningContext = { state: null, grid: null, softwareTier: 0, tubingState: createTubingState(), emitter };

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
  runner.register('survey', 'Survey terrain at x,z', (args, named) =>
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
  runner.register('buy_software', 'Buy software upgrade', (args, named) =>
    buySoftwareCommand(ctx, args, named),
  );
  runner.register('build_ramp', 'Build ramp (origin:X,Z direction:south length:10)', (args, named) =>
    buildRampCommand(ctx, args, named),
  );
  runner.register('weather', 'Show/advance weather (advance)', (args, named) =>
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
  runner.register('vehicle', 'Manage vehicles (list|buy|assign|move)', (args, named) =>
    vehicleCommand(ctx, args, named),
  );
  runner.register('employee', 'Manage employees (list|hire|raise|fire|assign_skill)', (args, named) =>
    employeeCommand(ctx, args, named),
  );
  runner.register('scores', 'Show all four scores', (args, named) =>
    scoresCommand(ctx, args, named),
  );
  runner.register('zone', 'Safety zones (clear|status)', (args, named) =>
    zoneCommand(ctx, args, named),
  );
  runner.register('set_policy', 'Set site policy (mode:shift_8h|shift_12h|continuous|custom [hunger:N] [fatigue:N] [social:N])', (args, named) =>
    setPolicyCommand(ctx, args, named),
  );

  // --- Event commands (Phase 6) ---
  runner.register('tick', 'Advance time by N ticks (default 1)', (args, named) =>
    tickCommand(ctx, args, named),
  );
  runner.register('event', 'Event system (status|choose|timers)', (args, named) =>
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
  runner.register('stats', 'Show per-level success stats and star rating', (args, named) =>
    statsCommand(ctx, args, named),
  );

  // --- State inspection (agent-friendly) ---
  runner.register('state', 'Dump game state as JSON (full|summary)', (args, named) =>
    stateCommand(ctx, args, named),
  );

  return { runner, ctx, emitter };
}
