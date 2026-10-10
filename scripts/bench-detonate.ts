/**
 * BlastSimulator2026 — detonate frame-hitch benchmark (#1603)
 *
 * Drives the real game in a browser through drill → charge → blast and reports
 * what pressing DETONATE costs the frame:
 *
 *   - how long the synchronous `blast` call takes (core blast + terrain remesh);
 *   - how long the first game tick after it takes (one haul order per fragment);
 *   - every WebGL shader program compiled after it, by name and link stall;
 *   - the total first-draw wait on programs, warmed-up ones included.
 *
 * A program compiled at detonate means something first became visible, or the
 * scene's light count changed, and the frame waited on the driver to compile
 * it — the multi-second hitch #1603 was. Compiles are counted by wrapping the
 * WebGL context's own `linkProgram`, and their stall timed through
 * `getProgramInfoLog` (three.js calls it on a program's first draw, and it
 * blocks until the link is done), so nothing in the game needs instrumenting.
 * Exits 1 when any program is compiled inside the watch window.
 *
 * Starts its own Vite dev server, so nothing else needs to be running.
 *
 *   npm run bench:detonate                    # 6-hole blast (blast-basic)
 *   npm run bench:detonate -- --blast large   # 30-hole, ~4500-fragment blast
 *   npm run bench:detonate -- --mode frames   # the player's flow, frame by frame
 *
 * `--mode frames` plays it as a player does — DETONATE arms the shot, the crew
 * evacuates at 1x, the game fires on its own — and times every animation-frame
 * callback (simulation ticks, renderer update, UI) from the press until a few
 * seconds after the blast, with GPU drawing off so a software rasteriser's
 * seconds-long draws do not drown the CPU cost. It prints the worst frames and
 * the commands that ran inside them, and exits 1 when any frame exceeds
 * `--budget` milliseconds (default 16.7, one 60 fps frame). `--profile <file>`
 * also records a main-thread CPU profile of the measured window, for DevTools.
 *
 * Without a GPU every frame takes seconds and link times are inflated several
 * times over; compare counts across runs, and times only within one machine.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Page } from 'puppeteer';
import { createServer } from 'vite';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './shared/chrome.js';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
const PORT = 5197;
/** How long after detonate to keep counting program links, in wall-clock ms. */
const WATCH_MS = 4000;

interface BlastSetup { holes: number; commands: string[] }

const BLASTS: Record<string, BlastSetup> = {
  basic: {
    holes: 6,
    commands: [
      'new_game seed:42 staffed:true',
      'drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15',
      'charge hole:* explosive:boomite amount:5 stemming:2',
    ],
  },
  large: {
    holes: 30,
    commands: [
      'new_game seed:42 staffed:true cash:3000000',
      'drill_plan grid rows:5 cols:6 spacing:4 depth:10 start:12,12',
      'charge hole:* explosive:krackle amount:10 stemming:2',
    ],
  },
};

/** Installed before any page script: names every shader, counts every compile and times its stall. */
const PROGRAM_LOG_HOOK = `(() => {
  window.__programLinks = [];
  const names = new WeakMap();
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = C.prototype;
    const shaderSource = P.shaderSource;
    P.shaderSource = function (shader, src) {
      // Built-in materials carry a SHADER_NAME; custom ones are named by
      // the uniforms they declare beyond three's own (the part that tells
      // one custom shader from another).
      const m = src.match(/#define SHADER_NAME (\\S+)/);
      const own = [...src.matchAll(/^uniform \\w+ (\\w+)/gm)].map(u => u[1])
        .filter(u => !/^(model|view|projection|normal)Matrix$|^(cameraPosition|isOrthographic)$/.test(u));
      names.set(shader, m ? m[1] : 'custom[' + own.slice(0, 6).join(',') + ']');
      return shaderSource.call(this, shader, src);
    };
    const attachShader = P.attachShader;
    P.attachShader = function (program, shader) {
      const prev = names.get(program);
      const n = names.get(shader) ?? 'unnamed';
      names.set(program, prev ? prev + '/' + n : n);
      return attachShader.call(this, program, shader);
    };
    // linkProgram is a compile: a program three did not have yet.
    const linkProgram = P.linkProgram;
    P.linkProgram = function (program) {
      window.__programLinks.push({ name: names.get(program) ?? 'unnamed', ms: 0, program });
      return linkProgram.call(this, program);
    };
    // three reads the info log on a program's first draw, which blocks until
    // its link has finished: the stall a compile costs the frame. A program
    // linked earlier (a warmed-up one) reads back in a few milliseconds.
    const getProgramInfoLog = P.getProgramInfoLog;
    P.getProgramInfoLog = function (program) {
      const t = performance.now();
      const log = getProgramInfoLog.call(this, program);
      const ms = performance.now() - t;
      const link = window.__programLinks.find(l => l.program === program);
      if (link) link.ms += ms;
      window.__firstUseWaitMs = (window.__firstUseWaitMs ?? 0) + ms;
      return log;
    };
  }
})()`;

/** Installed before any page script: times every animation-frame callback, and each game command inside one. */
const FRAME_HOOK = `(() => {
  window.__frames = [];
  window.__frameRec = false;
  window.__outsideCmds = [];
  window.__longTasks = [];
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => {
    const frame = { t, start: performance.now(), ms: 0, cmds: [] };
    window.__curFrame = frame;
    try { cb(t); } finally {
      frame.ms = performance.now() - frame.start;
      window.__curFrame = null;
      if (window.__frameRec) window.__frames.push(frame);
    }
  });
  try {
    new PerformanceObserver(list => {
      if (!window.__frameRec) return;
      for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
})()`;

/** Wraps the console bridge (once the game defined it) so each command is timed into its frame. */
const TIME_COMMANDS = `(() => {
  const run = window.__gameConsole;
  window.__gameConsole = cmd => {
    const start = performance.now();
    const result = run(cmd);
    const entry = [cmd.slice(0, 40), performance.now() - start];
    if (window.__curFrame) window.__curFrame.cmds.push(entry);
    else if (window.__frameRec) window.__outsideCmds.push(entry);
    return result;
  };
})()`;

interface FrameRecord { t: number; ms: number; cmds: Array<[string, number]> }

/** Runs in the page: fires the blast and watches WATCH_MS of frames after it. */
const DETONATE = `(async () => {
  const before = window.__programLinks.length;
  const waitBefore = window.__firstUseWaitMs ?? 0;
  const t0 = performance.now();
  const result = window.__gameConsole('blast');
  const blastMs = performance.now() - t0;
  const t1 = performance.now();
  window.__gameConsole('tick 1');
  const tickMs = performance.now() - t1;
  await new Promise(r => setTimeout(r, ${WATCH_MS}));
  return { ok: result.success, output: result.output, blastMs, tickMs, links: window.__programLinks.slice(before).map(l => ({ name: l.name, ms: l.ms })), firstUseWaitMs: (window.__firstUseWaitMs ?? 0) - waitBefore };
})()`;

interface DetonateResult {
  ok: boolean;
  output: string;
  blastMs: number;
  tickMs: number;
  links: Array<{ name: string; ms: number }>;
  firstUseWaitMs: number;
}

async function command(page: Page, cmd: string): Promise<string> {
  return page.evaluate(`window.__gameConsole(${JSON.stringify(cmd)}).output`) as Promise<string>;
}

async function gameField(page: Page, field: string): Promise<number> {
  return page.evaluate(`window.__gameState()?.${field} ?? 0`) as Promise<number>;
}

/** Tick the sim until `done`, bounded so a stuck crew fails instead of hanging. */
async function tickUntil(page: Page, done: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (await done()) return;
    await command(page, 'tick 10');
  }
  throw new Error(`gave up waiting for ${what} after 10000 ticks`);
}

/** Value after `--name` on the command line, or `fallback`. */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

/**
 * The player's flow: arm with DETONATE, let the crew clear the zone at 1x and
 * the game fire on its own, then keep running a few seconds. Frame callbacks are
 * summed per frame (several can share one), so a frame's time is all the main
 * thread did for it.
 */
async function measureFrames(page: Page, budgetMs: number, profilePath: string | null): Promise<number> {
  await page.evaluate(TIME_COMMANDS);
  const cdp = profilePath === null ? null : await page.createCDPSession();
  if (cdp !== null) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  }
  await command(page, 'time speed 1');
  await command(page, 'time resume'); // a new game starts paused
  await page.evaluate('window.__frames = []; window.__outsideCmds = []; window.__longTasks = []; window.__frameRec = true');
  const armed = await command(page, 'blast detonate');
  if (cdp !== null) await cdp.send('Profiler.start');
  console.log(`  armed: ${armed.split('\n')[0]}`);
  // The crew walks out at 1x before the game fires; bounded, so a stranded crew fails loudly.
  for (let waited = 0; !(await page.evaluate('window.__gameState()?.holeCount === 0')); waited += 500) {
    if (waited > 300000) {
      const why = await page.evaluate(`JSON.stringify({ tick: window.__gameState()?.tickCount, paused: window.__gameState()?.isPaused, status: window.__gameConsole('blast status').output, menu: getComputedStyle(document.getElementById('bs-main-menu') ?? document.body).display })`);
      throw new Error(`the armed blast never fired within 300 s: ${why}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  const firedAt = await page.evaluate('performance.now()') as number;
  await new Promise(r => setTimeout(r, 6000));
  await page.evaluate('window.__frameRec = false');
  if (cdp !== null && profilePath !== null) {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(profilePath, JSON.stringify(profile));
    console.log(`  CPU profile: ${profilePath}`);
  }
  const raw = await page.evaluate('window.__frames') as FrameRecord[];
  const outside = await page.evaluate('window.__outsideCmds') as Array<[string, number]>;
  const longTasks = await page.evaluate('window.__longTasks') as number[];

  const byFrame = new Map<number, FrameRecord>();
  for (const f of raw) {
    const merged = byFrame.get(f.t);
    if (merged) { merged.ms += f.ms; merged.cmds.push(...f.cmds); } else byFrame.set(f.t, { ...f, cmds: [...f.cmds] });
  }
  const frames = [...byFrame.values()];
  const after = frames.filter(f => f.t >= firedAt - 2000);
  const over = (limit: number) => frames.filter(f => f.ms > limit).length;
  console.log(`  frames timed: ${frames.length} (${after.length} from 2 s before the blast on)`);
  console.log(`  frames over 16.7 ms: ${over(16.7)}   over 33 ms: ${over(33)}   over 100 ms: ${over(100)}`);
  console.log('  worst frames (ms, then commands run inside):');
  for (const f of [...frames].sort((a, b) => b.ms - a.ms).slice(0, 10)) {
    const cmds = f.cmds.filter(([, ms]) => ms >= 1).map(([c, ms]) => `${c} ${ms.toFixed(0)}`).join('; ');
    console.log(`    ${f.ms.toFixed(1).padStart(7)}  @${((f.t - firedAt) / 1000).toFixed(2)}s  ${cmds}`);
  }
  for (const [c, ms] of outside.filter(([, ms]) => ms >= 5)) console.log(`  outside a frame: ${c} ${ms.toFixed(0)} ms`);
  if (longTasks.length > 0) console.log(`  long tasks (ms): ${longTasks.join(' ')}`);
  const worst = Math.max(0, ...frames.map(f => f.ms), ...outside.map(([, ms]) => ms));
  return worst <= budgetMs ? 0 : 1;
}

async function main(): Promise<number> {
  const mode = arg('--mode', 'shaders');
  const budgetMs = Number(arg('--budget', '16.7'));
  const flag = process.argv.indexOf('--blast');
  const blastName = flag >= 0 ? process.argv[flag + 1] ?? '' : 'basic';
  const setup = BLASTS[blastName];
  if (!setup) {
    console.error(`unknown --blast "${blastName}" (one of: ${Object.keys(BLASTS).join(', ')})`);
    return 2;
  }

  const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS, executablePath: resolveChromePathOrThrow() });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.evaluateOnNewDocument(PROGRAM_LOG_HOOK);
    await page.evaluateOnNewDocument(FRAME_HOOK);
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('typeof window.__gameConsole === "function"', { timeout: 180000 });

    // Setup runs undrawn: software-rendered frames would cost minutes of ticks.
    await page.evaluate('window.__setRenderEnabled(false)');
    const [newGame, drill, charge] = setup.commands as [string, string, string];
    await command(page, newGame);
    await command(page, drill);
    await tickUntil(page, async () => (await gameField(page, 'holeCount')) >= setup.holes, 'drilling');
    await command(page, charge);
    await tickUntil(page, async () => (await gameField(page, 'orderedChargeCount')) === 0, 'charging');

    if (mode === 'frames') {
      console.log(`blast "${blastName}", frame by frame:`);
      return await measureFrames(page, budgetMs, process.argv.includes('--profile') ? arg('--profile', '') : null);
    }

    // Draw the loaded site long enough for every pre-blast shader to compile,
    // so only what detonate itself brings in is counted.
    await page.evaluate('window.__setRenderEnabled(true)');
    await page.evaluate('window.__cameraFocus?.(19, 17, 40)');
    await page.waitForFunction('window.__programLinks.length > 0', { timeout: 120000 });
    await new Promise(r => setTimeout(r, 15000));

    const result = await page.evaluate(DETONATE) as DetonateResult;
    if (!result.ok) {
      console.error(`blast refused:\n${result.output}`);
      return 2;
    }
    const linkMs = result.links.reduce((sum, l) => sum + l.ms, 0);
    console.log(`blast "${blastName}": ${result.output.match(/Fragments: \d+/)?.[0] ?? ''}`);
    console.log(`  blast call (sync):        ${result.blastMs.toFixed(0)} ms`);
    console.log(`  first tick after it:      ${result.tickMs.toFixed(0)} ms`);
    console.log(`  programs compiled after:  ${result.links.length} (${linkMs.toFixed(0)} ms stalled)`);
    for (const l of result.links) console.log(`    ${l.ms.toFixed(0).padStart(6)} ms  ${l.name}`);
    console.log(`  first-draw program waits: ${result.firstUseWaitMs.toFixed(0)} ms (warmed-up programs included)`);
    return result.links.length === 0 ? 0 : 1;
  } finally {
    await browser.close();
    await server.close();
  }
}

main().then(code => process.exit(code), err => { console.error(err); process.exit(2); });
