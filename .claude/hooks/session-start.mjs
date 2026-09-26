// SessionStart hook — make the verification channels usable before work begins.
//
// A fresh container has no node_modules, so every verification channel
// (typecheck, tests, scenarios, screenshots) fails until dependencies exist.
// This installs them once, then reports which channels are live.
//
// Output on stdout is added to the session context. Always exits 0: a session
// that cannot install still has to start, and the report says what is missing.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin } from './lib/hook-io.mjs';

readStdin();

const root =
  process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// npm and npx are `.cmd` shims on Windows, which only a shell resolves. Both
// commands below are fixed strings, so running them through one is safe.
const run = (command) =>
  spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (!existsSync(join(root, 'node_modules', 'vitest'))) {
  process.stdout.write('Installing dependencies (node_modules absent)...\n');
  const install = run('npm ci --no-audit --no-fund');
  const lines = `${install.stdout ?? ''}${install.stderr ?? ''}`.trimEnd().split('\n');
  process.stdout.write(`${lines.slice(-5).join('\n')}\n`);
  if (install.status !== 0) {
    process.stdout.write('npm ci failed — run it manually before relying on any verification channel.\n');
    process.exit(0);
  }
}

const report = run('npx --no-install tsx scripts/verify-env.ts');
process.stdout.write(report.stdout ?? '');
