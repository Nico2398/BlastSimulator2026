/**
 * BlastSimulator2026 — Targeted harness hot-spot measurements
 *
 * `bench-scenarios.ts --mode interaction` says which buckets are expensive.
 * This says *why*, for the four that dominate: page boot, console commands run
 * through the browser, the fixed post-click settle, and clickSelector.
 *
 * Usage:
 *   npx tsx scripts/bench-hotspots.ts [--port 5173] [--preview-port 5174]
 *
 * `--preview-port` is optional: point it at `vite preview` serving `dist/` to
 * compare a built bundle's boot against the dev server's unbundled one.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './shared/chrome.js';
import { suspendDrawing } from './shared/puppeteer-utils.js';
import { createGameEngine } from './shared/command-runner.js';
import { runCommand } from '../src/console/createRunner.js';

const OUT_DIR = resolve(import.meta.dirname ?? process.cwd(), '..', 'screenshots', 'bench');

/** Commands the scenario suite actually issues, by frequency and by weight. */
const COMMANDS = [
  'new_game seed:42', 'campaign start', 'tick 1', 'tick 10', 'tick 50',
  'state full', 'state', 'scores', 'finances', 'employee list', 'event status',
];

interface Stat { n: number; mean: number; median: number; min: number; max: number }

function stat(times: number[]): Stat {
  const s = [...times].sort((a, b) => a - b);
  return {
    n: s.length,
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
    median: +s[Math.floor(s.length / 2)]!.toFixed(2),
    min: +s[0]!.toFixed(2), max: +s[s.length - 1]!.toFixed(2),
  };
}

async function sample(n: number, fn: () => Promise<unknown>): Promise<Stat> {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  return stat(times);
}

/** Boot one page and report goto / canvas-wait / first-evaluate separately. */
async function measureBoot(page: Page, url: string): Promise<Record<string, number>> {
  const t0 = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const t1 = performance.now();
  await page.waitForSelector('#game-canvas, canvas', { timeout: 60000 });
  const t2 = performance.now();
  await suspendDrawing(page);
  const t3 = performance.now();
  const nav = await page.evaluate(() => {
    const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      domContentLoaded: Math.round(e?.domContentLoadedEventEnd ?? 0),
      loadEvent: Math.round(e?.loadEventEnd ?? 0),
      resources: performance.getEntriesByType('resource').length,
      transferKb: Math.round(performance.getEntriesByType('resource')
        .reduce((n, r) => n + ((r as PerformanceResourceTiming).transferSize ?? 0), 0) / 1024),
    };
  });
  return {
    gotoMs: +(t1 - t0).toFixed(0),
    waitCanvasMs: +(t2 - t1).toFixed(0),
    suspendDrawingMs: +(t3 - t2).toFixed(0),
    totalMs: +(t3 - t0).toFixed(0),
    ...nav,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let port = 5173;
  let previewPort = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i]);
    else if (argv[i] === '--preview-port') previewPort = Number(argv[++i]);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const out: Record<string, unknown> = {};

  // ── 1. Node-side cost of the same commands, for the comparison column ──
  const engine = createGameEngine();
  const nodeCmd: Record<string, Stat> = {};
  for (const cmd of COMMANDS) {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (cmd === 'campaign start') runCommand(engine, 'new_game seed:42');
      const t = performance.now();
      runCommand(engine, cmd);
      times.push(performance.now() - t);
    }
    nodeCmd[cmd] = stat(times);
  }
  out.nodeCommandMs = nodeCmd;

  const browser = await puppeteer.launch({
    headless: true, args: LAUNCH_ARGS, executablePath: resolveChromePathOrThrow(),
  });

  // ── 2. Page boot: cold tab, then warm tabs (dev server module cache hot) ──
  const boots: Array<Record<string, number>> = [];
  for (let i = 0; i < 4; i++) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 720 });
    boots.push(await measureBoot(p, `http://localhost:${port}/?scenarioMode=1`));
    await p.close();
  }
  out.bootDevServer = boots;

  if (previewPort > 0) {
    const previewBoots: Array<Record<string, number>> = [];
    for (let i = 0; i < 4; i++) {
      const p = await browser.newPage();
      await p.setViewport({ width: 1280, height: 720 });
      previewBoots.push(await measureBoot(p, `http://localhost:${previewPort}/?scenarioMode=1`));
      await p.close();
    }
    out.bootVitePreview = previewBoots;
  }

  // ── 3. Working page for the per-operation measurements ──
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await measureBoot(page, `http://localhost:${port}/?scenarioMode=1`);

  // rAF period with drawing suspended — the ceiling on how cheap a
  // "wait one UI update" settle could be, versus the fixed 300 ms sleep.
  const frames0 = await page.evaluate(() => (window as any).__gameState?.()?.frameCount ?? 0);
  const fpsT0 = performance.now();
  await new Promise(r => setTimeout(r, 1000));
  const frames1 = await page.evaluate(() => (window as any).__gameState?.()?.frameCount ?? 0);
  const fpsElapsed = performance.now() - fpsT0;
  out.rafPeriod = {
    frames: frames1 - frames0,
    fps: Math.round(((frames1 - frames0) / fpsElapsed) * 1000),
    periodMs: +(fpsElapsed / Math.max(frames1 - frames0, 1)).toFixed(1),
  };

  // Round-trip cost of a two-frame wait, the deterministic settle replacement.
  out.twoFrameWaitMs = await sample(10, () => page.evaluate(() => new Promise<void>(res => {
    requestAnimationFrame(() => requestAnimationFrame(() => res()));
  })));

  // Same wait once a level is loaded — the state a settle actually runs in,
  // where the rAF callback also drives uiManager.update.
  await page.evaluate(() => (window as any).__gameConsole('new_game seed:42'));
  out.oneFrameWaitAfterLevelMs = await sample(10, () => page.evaluate(() => new Promise<void>(res => {
    requestAnimationFrame(() => res());
  })));
  out.twoFrameWaitAfterLevelMs = await sample(10, () => page.evaluate(() => new Promise<void>(res => {
    requestAnimationFrame(() => requestAnimationFrame(() => res()));
  })));

  // ── 4. Per-command cost in the browser: round trip and in-page ──
  const browserCmd: Record<string, unknown> = {};
  for (const cmd of COMMANDS) {
    const n = cmd === 'new_game seed:42' || cmd === 'campaign start' ? 3 : 6;
    // campaign start needs a menu-ish state each time; new_game gives it one.
    const roundTrip = await sample(n, async () => {
      if (cmd === 'campaign start') await page.evaluate(() => (window as any).__gameConsole('new_game seed:42'));
      await page.evaluate((c: string) => (window as any).__gameConsole(c), cmd);
    });
    const inPage = await page.evaluate((c: string) => {
      const w = window as any;
      const times: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        w.__gameConsole(c);
        times.push(performance.now() - t);
      }
      return Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100;
    }, cmd);
    const outputBytes = await page.evaluate((c: string) =>
      String((window as any).__gameConsole(c).output ?? '').length, cmd);
    browserCmd[cmd] = { roundTrip, inPageMeanMs: inPage, outputBytes };
  }
  out.browserCommandMs = browserCmd;

  // How much of a gameState round trip is the piggy-backed lastCommandOutput?
  await page.evaluate(() => (window as any).__gameConsole('new_game seed:42'));
  await page.evaluate(() => (window as any).__gameConsole('state full'));
  out.gameStateAfterStateFull = {
    roundTrip: await sample(10, () => page.evaluate(() => (window as any).__gameState())),
    bytes: await page.evaluate(() => JSON.stringify((window as any).__gameState()).length),
  };
  await page.evaluate(() => (window as any).__gameConsole('scores'));
  out.gameStateAfterSmallCommand = {
    roundTrip: await sample(10, () => page.evaluate(() => (window as any).__gameState())),
    bytes: await page.evaluate(() => JSON.stringify((window as any).__gameState()).length),
  };

  // ── 4b. Level entry, each on a page that has not loaded one yet ──
  const levelEntry: Record<string, number[]> = {
    'new_game seed:42': [], 'campaign start level:dusty_hollow': [], 'campaign start level:tutorial_pit': [],
  };
  for (const cmd of Object.keys(levelEntry)) {
    for (let i = 0; i < 2; i++) {
      const p = await browser.newPage();
      await p.setViewport({ width: 1280, height: 720 });
      await measureBoot(p, `http://localhost:${port}/?scenarioMode=1`);
      // `campaign start` refuses without a loaded game, so pay for one first
      // and time only the level entry itself — the shape a scenario uses.
      if (cmd.startsWith('campaign')) {
        await p.evaluate(() => (window as any).__gameConsole('new_game seed:42'));
      }
      const t = performance.now();
      await p.evaluate((c: string) => (window as any).__gameConsole(c), cmd);
      levelEntry[cmd]!.push(Math.round(performance.now() - t));
      await p.close();
    }
  }
  out.levelEntryOnFreshPage = levelEntry;

  // ── 5. clickSelector decomposition on whatever control is usable now ──
  await page.evaluate(() => (window as any).__gameConsole('new_game seed:42'));
  const sel = await page.evaluate(() => {
    const acts = (window as any).__uiActions() as Array<{ selector: string; usable: boolean }>;
    return acts.find(a => a.usable)?.selector ?? '#bs-open-blast';
  });
  out.clickSelectorTarget = sel;
  const exists = await page.$(sel);
  if (exists) {
    out.clickSelectorParts = {
      waitForSelector: await sample(10, () => page.waitForSelector(sel, { timeout: 5000 })),
      probeOnce: await sample(10, () => page.evaluate((s: string) => {
        document.querySelector(s)?.scrollIntoView({ block: 'center', inline: 'nearest' });
        return (window as any).__probeSelector(s);
      }, sel)),
      click: await sample(10, () => page.click(sel)),
    };
  } else {
    out.clickSelectorParts = { note: `${sel} absent — panel not open` };
  }

  // ── 6. Why a raw canvas mouse move is expensive ──
  out.mouseMoveOverCanvas = await sample(6, () => page.mouse.move(640, 400));
  out.mouseMoveOverHud = await sample(6, () => page.mouse.move(20, 20));

  await browser.close();
  writeFileSync(resolve(OUT_DIR, 'hotspots.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
