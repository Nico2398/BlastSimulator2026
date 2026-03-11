// BlastSimulator2026 — Console Mode entry point
// Usage: npx tsx src/console.ts  OR  npm run console

import * as readline from 'readline';
import { ConsoleRunner } from './console/ConsoleRunner.js';
import { bold, error, info } from './console/ConsoleFormatter.js';
import {
  type GameContext,
  newGameCommand,
  inspectCommand,
  terrainInfoCommand,
  surveyCommand,
} from './console/commands/world.js';

console.log(bold('BlastSimulator2026 Console Mode'));
console.log(info('Type "help" for available commands.\n'));

const runner = new ConsoleRunner();
const ctx: GameContext = { state: null, grid: null };

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
