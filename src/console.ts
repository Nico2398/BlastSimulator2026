// BlastSimulator2026 — Console Mode entry point
// Usage: npx tsx src/console.ts  OR  npm run console

import * as readline from 'readline';
import { createRunner } from './console/createRunner.js';
import { bold, error, info } from './console/ConsoleFormatter.js';

console.log(bold('BlastSimulator2026 Console Mode'));
console.log(info('Type "help" for available commands.\n'));

const { runner } = createRunner();

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
