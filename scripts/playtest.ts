/**
 * BlastSimulator2026 — Playtest runner
 *
 * Plays the game the way a player does: clicks only, no console shortcuts for
 * anything a player would have to do themselves. Every beat states a goal and
 * fails loudly when the goal is not reached, naming the control that blocked
 * and why.
 *
 * This exists because a scenario can report "0 errors" while the game is stuck.
 * A harness that calls `employee assign_skill` to hand itself a qualification
 * will never discover that no button in the game grants one.
 *
 * Usage:
 *   npm run playtest                      # every playtest
 *   npm run playtest -- tutorial          # by name
 *   npm run playtest -- tutorial --screenshots
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Page } from 'puppeteer';
import { initBrowser } from './shared/puppeteer-utils.js';
import type { PlaytestDef } from './shared/playtest-types.js';
import { isAllowedSetupCommand } from './shared/playtest-types.js';
import { PLAYTEST_DIR, loadPlaytests } from './shared/playtest-utils.js';
import {
  runAction, checkGoal, gameState, tutorialState, probe, describeAvailable,
  PlaytestFailure,
} from './shared/playtest-driver.js';

const OUT_DIR = resolve(process.cwd(), 'screenshots/playtests');

interface BeatResult {
  goal: string;
  passed: boolean;
  error?: string;
  diagnosis?: string;
}

async function runBeatSetup(page: Page, commands: string[]): Promise<void> {
  for (const command of commands) {
    if (!isAllowedSetupCommand(command)) {
      throw new PlaytestFailure(
        `setup command "${command}" is not allowed in a playtest — a player cannot type it`,
        'Only new_game, campaign, tutorial_start, tick and time may appear in setup.',
      );
    }
    await page.evaluate((c: string) => (window as unknown as {
      __gameConsole: (cmd: string) => unknown;
    }).__gameConsole(c), command);
  }
  await new Promise(r => setTimeout(r, 400));
}

async function runPlaytest(
  page: Page, def: PlaytestDef, screenshots: boolean,
): Promise<BeatResult[]> {
  const results: BeatResult[] = [];
  const outDir = resolve(OUT_DIR, def.name);
  if (screenshots) mkdirSync(outDir, { recursive: true });

  console.log(`\n=== playtest: ${def.name} ===`);
  console.log(def.description);

  for (let i = 0; i < def.beats.length; i++) {
    const beat = def.beats[i]!;
    const label = `${String(i).padStart(2, '0')} ${beat.goal}`;
    const before = await gameState(page);

    try {
      if (beat.setup) await runBeatSetup(page, beat.setup);
      for (const action of beat.actions ?? []) {
        await runAction(page, action);
      }
      if (beat.expect) await checkGoal(page, beat.expect, before);

      console.log(`  PASS  ${label}`);
      results.push({ goal: beat.goal, passed: true });
    } catch (err) {
      const failure = err instanceof PlaytestFailure ? err : null;
      const message = err instanceof Error ? err.message : String(err);
      const diagnosis = failure?.diagnosis ?? describeAvailable(await probe(page));
      const tut = await tutorialState(page);

      console.error(`  FAIL  ${label}`);
      console.error(`        ${message}`);
      console.error(`        tutorial is on: ${tut.stepId ?? 'n/a'} (${tut.title})`);
      console.error(diagnosis);

      results.push({ goal: beat.goal, passed: false, error: message, diagnosis });

      if (screenshots) {
        const shot = resolve(outDir, `FAIL-${String(i).padStart(2, '0')}.png`);
        await page.screenshot({ path: shot });
        console.error(`        screenshot: ${shot}`);
      }
      // A blocked beat invalidates everything after it — stop here.
      break;
    }

    if (screenshots) {
      await page.screenshot({ path: resolve(outDir, `beat-${String(i).padStart(2, '0')}.png`) });
    }
  }

  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const screenshots = args.includes('--screenshots');
  const filter = args.find(a => !a.startsWith('--'));
  const portArg = args.indexOf('--port');
  const port = portArg >= 0 ? Number(args[portArg + 1]) : 5173;

  const defs = loadPlaytests(filter);
  if (defs.length === 0) {
    console.error(`No playtests matched ${filter ?? '(all)'} in ${PLAYTEST_DIR}`);
    process.exit(1);
  }

  const { browser, page } = await initBrowser({ port, viewport: { width: 1280, height: 720 } });
  let failed = 0;

  try {
    for (const def of defs) {
      // Each playtest starts from a fresh page so state cannot leak between
      // them. See puppeteer-utils.ts's initBrowser() for why this isn't
      // 'networkidle0' (#458 T5.1 — EffectComposer/OutputPass regression).
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#game-canvas, canvas', { timeout: 15000 });
      await page.evaluate(() => {
        const menu = document.getElementById('bs-main-menu');
        if (menu) (menu as HTMLElement).style.display = 'none';
      });

      const results = await runPlaytest(page, def, screenshots);
      const bad = results.filter(r => !r.passed).length;
      failed += bad;

      if (screenshots) {
        mkdirSync(resolve(OUT_DIR, def.name), { recursive: true });
        writeFileSync(
          resolve(OUT_DIR, def.name, 'report.json'),
          JSON.stringify({ name: def.name, results }, null, 2),
        );
      }

      const done = results.filter(r => r.passed).length;
      console.log(`  ${done}/${def.beats.length} beats reached${bad > 0 ? ' — BLOCKED' : ''}`);
    }
  } finally {
    await browser.close();
  }

  console.log('');
  if (failed > 0) {
    console.error(`PLAYTEST FAILED — ${failed} beat(s) unreachable by a player.`);
    process.exit(1);
  }
  console.log('PLAYTEST PASSED — every beat reachable by clicking alone.');
}

void main();
