/**
 * BlastSimulator2026 — Verification environment preflight
 *
 * Reports which verification channels are usable right now, so an agent can
 * pick a working channel instead of discovering a broken one mid-task.
 *
 * Usage:
 *   npx tsx scripts/verify-env.ts
 *   npx tsx scripts/verify-env.ts --strict   # exit 1 when any channel is down
 *   npx tsx scripts/verify-env.ts --json
 *
 * Channels:
 *   1. static    — TypeScript type check
 *   2. logic     — Vitest unit + integration suites
 *   3. scenario  — command-mode scenario runner (pure Node.js)
 *   4. visual    — Puppeteer screenshots + interaction-mode scenarios
 *
 * @module verify-env
 */

import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { CHROME_MISSING_HELP, resolveChromePath } from './shared/chrome.js';

type ChannelStatus = 'ready' | 'blocked';

interface Channel {
  /** Channel id used in agent-facing docs. */
  id: string;
  /** What this channel proves about a change. */
  proves: string;
  /** Command an agent runs to exercise the channel. */
  command: string;
  status: ChannelStatus;
  /** Populated when status is 'blocked'. */
  remedy?: string;
  /** Extra context (resolved paths, counts). */
  detail?: string;
}

const ROOT = resolve(import.meta.dirname, '..');

function depsInstalled(): boolean {
  return existsSync(resolve(ROOT, 'node_modules', 'vitest'));
}

function devServerPort(): number {
  const fromEnv = Number(process.env.VISUAL_TEST_PORT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 5173;
}

async function devServerUp(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`http://localhost:${port}`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

function scenarioCount(): number {
  try {
    return readdirSync(resolve(ROOT, 'scripts/scenario-defs')).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function collectChannels(): Promise<Channel[]> {
  const deps = depsInstalled();
  const depsRemedy = 'npm ci';
  const port = devServerPort();
  const chromePath = resolveChromePath();
  const serverUp = await devServerUp(port);

  const channels: Channel[] = [
    {
      id: 'static',
      proves: 'Types line up; nothing references a symbol that does not exist',
      command: 'npm run typecheck',
      status: deps ? 'ready' : 'blocked',
      ...(deps ? {} : { remedy: depsRemedy }),
    },
    {
      id: 'logic',
      proves: 'Unit + integration behaviour matches expectations',
      command: 'npm run test',
      status: deps ? 'ready' : 'blocked',
      ...(deps ? {} : { remedy: depsRemedy }),
    },
    {
      id: 'scenario',
      proves: 'Full command sequences produce the expected game state',
      command: 'npm run scenarios',
      status: deps ? 'ready' : 'blocked',
      detail: `${scenarioCount()} scenario definitions`,
      ...(deps ? {} : { remedy: depsRemedy }),
    },
    {
      id: 'visual',
      proves: 'The game actually renders and the UI responds to real clicks',
      command: 'npm run screenshot -- --name probe --commands "new_game seed:42"',
      status: deps && chromePath ? 'ready' : 'blocked',
      ...(chromePath
        ? {
            detail: `chrome: ${chromePath}; dev server on :${port} ${serverUp ? 'UP' : 'DOWN (start with `npm run dev &`)'}`,
          }
        : {}),
      ...(deps && chromePath ? {} : { remedy: deps ? CHROME_MISSING_HELP : depsRemedy }),
    },
  ];

  return channels;
}

function report(channels: Channel[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify({ channels }, null, 2));
    return;
  }

  console.log('Verification channels\n');
  for (const channel of channels) {
    const mark = channel.status === 'ready' ? 'READY  ' : 'BLOCKED';
    console.log(`${mark} ${channel.id}`);
    console.log(`        proves:  ${channel.proves}`);
    console.log(`        command: ${channel.command}`);
    if (channel.detail) {
      console.log(`        detail:  ${channel.detail}`);
    }
    if (channel.remedy) {
      console.log(`        remedy:  ${channel.remedy.split('\n').join('\n                 ')}`);
    }
    console.log('');
  }

  const blocked = channels.filter((c) => c.status === 'blocked');
  console.log(
    blocked.length === 0
      ? 'All channels ready. Verify every change through at least one, and through `visual` when rendering or UI changed.'
      : `Blocked channels: ${blocked.map((c) => c.id).join(', ')}. Apply the remedy above before claiming a change verified.`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const channels = await collectChannels();
  report(channels, args.includes('--json'));

  if (args.includes('--strict') && channels.some((c) => c.status === 'blocked')) {
    process.exit(1);
  }
}

void main();
