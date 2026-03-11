// BlastSimulator2026 — Console Mode entry point
// Usage: npx tsx src/console.ts  OR  npm run console

import * as readline from 'readline';
import { ConsoleRunner } from './console/ConsoleRunner.js';
import { bold, error, info } from './console/ConsoleFormatter.js';
import {
  newGameCommand,
  inspectCommand,
  terrainInfoCommand,
  surveyCommand,
} from './console/commands/world.js';
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
} from './console/commands/mining.js';
import { createTubingState } from './core/mining/Tubing.js';
import {
  financesCommand,
  contractCommand,
  fragmentsCommand,
} from './console/commands/economy.js';
import {
  buildCommand,
  vehicleCommand,
  employeeCommand,
  scoresCommand,
  zoneCommand,
} from './console/commands/entities.js';

console.log(bold('BlastSimulator2026 Console Mode'));
console.log(info('Type "help" for available commands.\n'));

const runner = new ConsoleRunner();
const ctx: MiningContext = { state: null, grid: null, softwareTier: 0, tubingState: createTubingState() };

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

// --- Entity commands (Phase 5) ---
runner.register('build', 'Place/manage buildings (list|destroy|move|<type> at:x,z)', (args, named) =>
  buildCommand(ctx, args, named),
);
runner.register('vehicle', 'Manage vehicles (list|buy|assign|move)', (args, named) =>
  vehicleCommand(ctx, args, named),
);
runner.register('employee', 'Manage employees (list|hire|raise|fire)', (args, named) =>
  employeeCommand(ctx, args, named),
);
runner.register('scores', 'Show all four scores', (args, named) =>
  scoresCommand(ctx, args, named),
);
runner.register('zone', 'Safety zones (clear|status)', (args, named) =>
  zoneCommand(ctx, args, named),
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

rl.prompt();

rl.on('line', (line: string) => {
  const trimmed = line.trim();

  if (trimmed === 'exit' || trimmed === 'quit') {
    console.log('Goodbye.');
    rl.close();
    return;
  }

  const result = runner.run(trimmed);
  if (result.output) {
    if (result.success) {
      console.log(result.output);
    } else {
      console.log(error(result.output));
    }
  }

  rl.prompt();
});

rl.on('close', () => {
  process.exit(0);
});
