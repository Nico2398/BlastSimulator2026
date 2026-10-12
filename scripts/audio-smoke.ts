/**
 * BlastSimulator2026 — Audio smoke test
 *
 * Proves the audio WIRING end to end in a real (headless) browser, without ears. It serves the game itself
 * (a Vite server started in this process and stopped at the end), opens it with `?audioLog=1`, which makes
 * main.ts record every sound request in `window.__audioLog`, and asserts on that log.
 *
 *   (a) REAL ENGINE   /?audioLog=1: the real AudioEngine preloads every sample and recipe with zero failures,
 *                     the context state is recorded, and real mouse clicks on main-menu controls produce the
 *                     interface cues they should, once each.
 *   (b) INTENDED CUES /?scenarioMode=1&audioLog=1: the null player plays nothing, but the interface layer and the
 *                     game director still call it, so a short scripted game (hire, purchase, build, drill, charge,
 *                     weather, blast) shows which sounds the game INTENDS. Asserts the cue ids and prints a count table.
 *
 *   npm run audio:smoke
 *   npm run audio:smoke -- --phase intended        # only (b), no preload wait
 *
 * It says nothing about how anything sounds: for that see `npm run sounds:check` (levels) and a pair of ears.
 *
 * Exit codes: 0 all clear, 1 a check failed, 2 the smoke test could not run (no Chromium, server, bad arguments).
 */

import type { Browser, Page } from 'puppeteer';
import { countCues, formatCueTable, isInterfaceCue, missingCues, repeatedCues } from '../src/audio/debug/logAnalysis.js';
import type { PlayRecord } from '../src/audio/debug/playLog.js';
import type { AudioStatus } from '../src/audio/debug/audioDebug.js';
import { chromeOrFail, EXIT_COULD_NOT_RUN, EXIT_FAILED, errorText, fail, launchAudioBrowser, sleep } from './shared/audio-check.js';
import { clickWithTransientRetry } from './shared/click-retry.js';
import { ensureDevServer, findFreePort, type DevServerHandle } from './shared/dev-server.js';

/**
 * Small on purpose: the sandbox has no GPU, so software rasterisation costs seconds per frame. Wide and tall enough
 * for the whole main menu column to be on screen, so real clicks reach every control.
 */
const VIEWPORT = { width: 480, height: 400 };
const POLL_MS = 500;
/** After a click, wait for the interface layer's deferred click cue (it yields one macrotask to a command cue). */
const SETTLE_MS = 150;
/** Page-side tick budget guards: a stuck crew fails the check instead of hanging it. */
const TICK_CHUNK = 5;
const USAGE = 'Usage: npm run audio:smoke -- [--phase real|intended|all] [--timeout <s>]\n  --timeout  seconds to wait for the engine preload and the game bridge (default 300)';

type PhaseName = 'real' | 'intended';
type AudioWindow = Window & { __audioLog?: PlayRecord[]; __audioStatus?: () => AudioStatus };

interface Options {
  readonly phases: readonly PhaseName[];
  readonly timeoutS: number;
}

const failures: string[] = [];

function parseArgs(argv: readonly string[]): Options | 'help' | string {
  let phases: readonly PhaseName[] = ['real', 'intended'];
  let timeoutS = 300;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--help' || flag === '-h') return 'help';
    if (flag === '--phase') {
      if (value === 'real' || value === 'intended') phases = [value];
      else if (value !== 'all') return '--phase needs real, intended or all';
      i++;
    } else if (flag === '--timeout') {
      const seconds = Number(value);
      if (!(seconds > 0)) return '--timeout needs a positive number';
      timeoutS = seconds;
      i++;
    } else {
      return `unknown argument "${String(flag)}"`;
    }
  }
  return { phases, timeoutS };
}

/** Print one check line and remember it when it failed. */
function check(ok: boolean, label: string, detail = ''): boolean {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` - ${detail}`}`);
  if (!ok) failures.push(`${label}${detail === '' ? '' : ` - ${detail}`}`);
  return ok;
}

interface PageWatch {
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
}

/** Open `url` in a fresh small page, collecting page errors and console errors (the missing favicon is not one). */
async function openPage(browser: Browser, url: string): Promise<{ page: Page; watch: PageWatch }> {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const watch: PageWatch = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', error => watch.pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error' || message.location().url?.endsWith('/favicon.ico') === true) return;
    watch.consoleErrors.push(message.text());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { page, watch };
}

async function logLength(page: Page): Promise<number> {
  return page.evaluate(() => (window as AudioWindow).__audioLog?.length ?? 0);
}

/** Records appended since `from`. The log is capped, but the smoke test stays far below the cap. */
async function logSince(page: Page, from: number): Promise<PlayRecord[]> {
  return page.evaluate((start: number) => (window as AudioWindow).__audioLog?.slice(start) ?? [], from);
}

async function waitForPreload(page: Page, timeoutS: number): Promise<AudioStatus | null> {
  const started = Date.now();
  let last = '';
  while ((Date.now() - started) / 1000 < timeoutS) {
    const status = await page.evaluate(() => (window as AudioWindow).__audioStatus?.() ?? null);
    const line = status === null ? 'waiting for the page' : `ready=${status.ready} preloaded=${status.preloaded} context=${status.contextState} failed=${status.failedAssets.length}`;
    if (line !== last) {
      console.log(`  [${((Date.now() - started) / 1000).toFixed(0)} s] ${line}`);
      last = line;
    }
    if (status?.preloaded) return status;
    await sleep(POLL_MS);
  }
  return null;
}

function reportPageHealth(watch: PageWatch, phase: string): void {
  check(watch.pageErrors.length === 0, `${phase}: no page errors`, watch.pageErrors.join(' | '));
  check(watch.consoleErrors.length === 0, `${phase}: no console.error`, watch.consoleErrors.join(' | '));
}

// ── (a) real engine ─────────────────────────────────────────────────────────────────────────────────

/** A real user action on the main menu and what its click must sound like. */
interface MenuAction {
  readonly label: string;
  readonly run: (page: Page) => Promise<void>;
  /** Must appear in the log, exactly this many times. */
  readonly exactly: ReadonlyArray<readonly [string, number]>;
  /** Must not appear at all, even the cues that may repeat. */
  readonly absent?: readonly string[];
  /** No cue beyond `exactly` (and the hover ticks of the mouse's own path, unless `absent` bans them). */
  readonly only?: true;
}

const MENU = '#bs-main-menu';
/** A real mouse click on the element's centre (Puppeteer moves the pointer first, as a player's would). */
const leftClick = (page: Page, selector: string): Promise<void> => clickWithTransientRetry(page, selector, 'left', 'click');
const HOVER_KEY = 'play:ui_hover';
/** The mouse crossing controls on its way produces hover ticks; they may repeat and are not a click's cue. */
const MAY_REPEAT = new Set([HOVER_KEY]);

const MENU_ACTIONS: readonly MenuAction[] = [
  { label: 'hover a menu button', run: page => page.hover('#bs-menu-sandbox'), exactly: [[HOVER_KEY, 1]] },
  { label: 'click the FR language pill', run: page => leftClick(page, `${MENU} .bsx-menu-lang-pill:nth-of-type(2)`), exactly: [['play:ui_click', 1]] },
  { label: 'click the EN language pill', run: page => leftClick(page, `${MENU} .bsx-menu-lang-pill:nth-of-type(1)`), exactly: [['play:ui_click', 1]] },
  { label: 'click Load game', run: page => leftClick(page, '#bs-menu-load'), exactly: [['play:ui_click', 1]] },
  { label: 'press Escape', run: page => page.keyboard.press('Escape'), exactly: [] },
  { label: 'click Settings (opens a panel; the panel cue supersedes the click)', run: page => leftClick(page, `${MENU} .bsx-menu-btn:last-of-type`), exactly: [['play:ui_open', 1]], only: true },
  { label: 'press Escape (closes it; the pointer resting on what lies beneath is not a hover)', run: page => page.keyboard.press('Escape'), exactly: [['play:ui_close', 1]], absent: [HOVER_KEY], only: true },
];

async function runMenuAction(page: Page, action: MenuAction): Promise<void> {
  const from = await logLength(page);
  await action.run(page);
  await sleep(SETTLE_MS);
  const added = (await logSince(page, from)).filter(record => record.kind === 'play');
  const seen = countCues(added);
  const summary = seen.map(row => `${row.key}${row.count > 1 ? ` x${row.count}` : ''}${row.dropped > 0 ? ' (dropped)' : ''}`).join(', ') || 'nothing';
  const wrong = action.exactly
    .map(([key, n]) => [key, n, seen.find(row => row.key === key)?.count ?? 0] as const)
    .filter(([, n, got]) => got !== n);
  const dups = repeatedCues(added, MAY_REPEAT);
  const unexpected = seen.filter(row => {
    if (action.absent?.includes(row.key) === true) return true;
    if (action.only !== true || MAY_REPEAT.has(row.key)) return false;
    return !action.exactly.some(([key]) => key === row.key);
  });
  const refused = action.exactly.flatMap(([key]) => added.filter(r => `play:${r.id}` === key && r.dropped === true && key !== HOVER_KEY));
  check(
    wrong.length === 0 && dups.length === 0 && refused.length === 0 && unexpected.length === 0,
    action.label,
    wrong.length === 0 && dups.length === 0 && refused.length === 0 && unexpected.length === 0
      ? summary
      : `saw ${summary}; ${wrong.map(([key, n, got]) => `${key} expected x${n} got x${got}`).concat(dups.map(([key, n]) => `${key} repeated x${n}`), refused.map(r => `${r.id} dropped by the player`), unexpected.map(row => `${row.key} not expected`)).join('; ')}`,
  );
}

async function realEnginePhase(browser: Browser, origin: string, options: Options): Promise<PlayRecord[]> {
  console.log('\n== (a) real engine: /?audioLog=1 ==');
  const { page, watch } = await openPage(browser, `${origin}/?audioLog=1`);
  try {
    await page.waitForFunction(() => typeof (window as AudioWindow).__audioStatus === 'function', { timeout: options.timeoutS * 1000 });
    const status = await waitForPreload(page, options.timeoutS);
    if (!check(status !== null, 'engine preload finished', status === null ? `timed out after ${options.timeoutS} s` : '')) return [];
    if (status === null) return [];
    check(status.ready, 'engine ready (interface and blast cues decoded)');
    check(status.failedAssets.length === 0, 'zero failed assets', status.failedAssets.join(', '));
    check(status.contextState === 'running' || status.contextState === 'suspended', `audio context exists (state: ${status.contextState})`);
    console.log(`  context state: ${status.contextState}`);
    await page.waitForSelector(`${MENU} .bsx-menu-lang-pill`, { visible: true, timeout: options.timeoutS * 1000 });
    for (const action of MENU_ACTIONS) await runMenuAction(page, action);
    reportPageHealth(watch, 'real engine');
    return await logSince(page, 0);
  } finally {
    await page.close();
  }
}

// ── (b) intended cues ───────────────────────────────────────────────────────────────────────────────

/** One console command of the scripted game, what it must sound like, and optionally ticks to run afterwards. */
interface GameStep {
  readonly label: string;
  readonly command: string;
  /** `kind:id` keys the command itself must add. */
  readonly expect?: readonly string[];
  /** Then tick until `field` equals `value` (at most `maxTicks`) and add these keys. */
  readonly until?: { readonly field: string; readonly value: number; readonly maxTicks: number; readonly expect: readonly string[] };
  /** A refused command is the point of the step. */
  readonly refused?: true;
  /** Wait up to this many seconds for the expected keys: the director retargets weather beds only after a real-time dwell. */
  readonly settleS?: number;
}

const GAME_STEPS: readonly GameStep[] = [
  { label: 'new game starts the wind bed', command: 'new_game seed:42 staffed:true cash:1000000', expect: ['level:amb_wind'] },
  { label: 'hire a driller', command: 'employee hire role:driller', expect: ['play:hire'] },
  { label: 'buy a vehicle', command: 'vehicle buy debris_hauler', expect: ['play:purchase', 'play:vehicle_start'] },
  { label: 'a refused purchase is denied', command: 'vehicle buy no_such_vehicle', expect: ['play:ui_denied'], refused: true },
  // Ordered first and finished by the ticks of the steps below: a long wait for it alone bankrupts the mine.
  { label: 'order a building', command: 'build management_office at:0,3', expect: ['play:build_placed'] },
  {
    label: 'order a drill grid, then holes are drilled',
    command: 'drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15',
    expect: ['play:order_queued'],
    until: { field: 'holeCount', value: 6, maxTicks: 400, expect: ['play:drill_done'] },
  },
  {
    label: 'order charges, then they are loaded',
    command: 'charge hole:* explosive:boomite amount:5 stemming:2',
    expect: ['play:order_queued'],
    until: { field: 'orderedChargeCount', value: 0, maxTicks: 3000, expect: ['play:charge_loaded'] },
  },
  // The director holds a new weather for a real-time dwell before the beds follow, and each page frame advances it by at most 0.1 s.
  { label: 'heavy rain starts the rain bed (after the weather dwell)', command: 'weather set heavy_rain', expect: ['level:amb_rain_heavy'], settleS: 120 },
  { label: 'pause', command: 'time pause', expect: ['play:ui_toggle_off'] },
  { label: 'resume', command: 'time resume', expect: ['play:ui_toggle_on'] },
];

/** Cues the whole run must have produced by its end, from steps that finish while others tick. */
const LATE_CUES = ['play:building_built'];
const BLAST_CUES = ['play:blast_snap', 'play:blast_crack', 'play:blast_boom', 'play:blast_sub', 'play:blast_tail', 'duck:ambient'];
/** The debris rain is built from the rock that actually flies; which sizes fly depends on the blast, so any one proves it. */
const DEBRIS_CUES = ['play:debris_hit', 'play:debris_pebble'];
/** Ticks run after the first boom so the debris rain and the tail are handed to the player. */
const AFTER_BOOM_TICKS = 30;
const BLAST_MAX_TICKS = 400;

interface CommandResult {
  readonly success: boolean;
  readonly output: string;
}

async function gameCommand(page: Page, command: string): Promise<CommandResult> {
  return page.evaluate((cmd: string) => {
    const result = (window as unknown as { __gameConsole: (c: string) => { success: boolean; output: unknown } }).__gameConsole(cmd);
    return { success: result.success, output: String(result.output).split('\n')[0] ?? '' };
  }, command);
}

/** Tick in chunks until a state field has the value, or `maxTicks` ran; the ticks run, so a miss is visible. */
async function tickUntilField(page: Page, field: string, value: number, maxTicks: number): Promise<number> {
  return page.evaluate((f: string, v: number, max: number, chunk: number) => {
    const w = window as unknown as { __gameConsole: (c: string) => unknown; __gameState: () => Record<string, unknown> | null };
    let ticks = 0;
    while (ticks < max && w.__gameState()?.[f] !== v) {
      w.__gameConsole(`tick ${chunk}`);
      ticks += chunk;
    }
    return ticks;
  }, field, value, maxTicks, TICK_CHUNK);
}

/** Tick until the log has a play of `id` (or `maxTicks` ran), then `extra` more ticks. */
async function tickUntilPlay(page: Page, id: string, maxTicks: number, extra: number): Promise<number> {
  return page.evaluate((cue: string, max: number, more: number, chunk: number) => {
    const w = window as unknown as { __gameConsole: (c: string) => unknown; __audioLog: PlayRecord[] };
    let ticks = 0;
    while (ticks < max && !w.__audioLog.some(r => r.kind === 'play' && r.id === cue)) {
      w.__gameConsole(`tick ${chunk}`);
      ticks += chunk;
    }
    if (w.__audioLog.some(r => r.kind === 'play' && r.id === cue)) w.__gameConsole(`tick ${more}`);
    return ticks;
  }, id, maxTicks, extra, TICK_CHUNK);
}

async function runGameStep(page: Page, step: GameStep): Promise<void> {
  const from = await logLength(page);
  const result = await gameCommand(page, step.command);
  let own = await logSince(page, from);
  if (step.settleS !== undefined) {
    const deadline = Date.now() + step.settleS * 1000;
    while (missingCues(own, step.expect ?? []).length > 0 && Date.now() < deadline) {
      await sleep(POLL_MS);
      own = await logSince(page, from);
    }
  }
  const problems = missingCues(own, step.expect ?? []).map(key => `${key} missing after "${step.command}"`);
  if (result.success === (step.refused === true)) problems.push(`"${step.command}" ${result.success ? 'succeeded' : 'failed'}: ${result.output}`);
  if (step.until !== undefined) {
    const ticks = await tickUntilField(page, step.until.field, step.until.value, step.until.maxTicks);
    const later = await logSince(page, from);
    problems.push(...missingCues(later, step.until.expect).map(key => `${key} missing after ${ticks} ticks (until ${step.until?.field}=${step.until?.value})`));
  }
  check(problems.length === 0, step.label, problems.join('; '));
}

async function blastSteps(page: Page): Promise<void> {
  const from = await logLength(page);
  const armed = await gameCommand(page, 'blast detonate');
  const armedCues = await logSince(page, from);
  const problems = missingCues(armedCues, ['loop:blast_siren', 'play:blast_beep']).map(key => `${key} missing when armed`);
  if (!armed.success) problems.push(`"blast detonate" failed: ${armed.output}`);
  check(problems.length === 0, 'arm the blast: siren bed and warning beeps', problems.join('; '));

  const ticks = await tickUntilPlay(page, 'blast_boom', BLAST_MAX_TICKS, AFTER_BOOM_TICKS);
  const fired = await logSince(page, from);
  const noDebris = DEBRIS_CUES.every(key => missingCues(fired, [key]).length > 0);
  const missingBlast = [...missingCues(fired, BLAST_CUES), ...(noDebris ? ['a debris cue (hit or pebble)'] : [])];
  check(missingBlast.length === 0, `the blast fires (after ${ticks} ticks): snap, crack, boom, sub, tail, debris, ambient duck`, missingBlast.join(', '));

  const skipped = await page.evaluate(() => {
    try {
      (window as unknown as { __skipBlastPlayback: () => void }).__skipBlastPlayback();
      return null;
    } catch (error) {
      return String(error);
    }
  });
  check(skipped === null, 'skipping blast playback cancels the scheduled sounds without error', skipped ?? '');
}

async function intendedCuesPhase(browser: Browser, origin: string, options: Options): Promise<PlayRecord[]> {
  console.log('\n== (b) intended cues: /?scenarioMode=1&audioLog=1 ==');
  const { page, watch } = await openPage(browser, `${origin}/?scenarioMode=1&audioLog=1`);
  try {
    await page.waitForFunction(
      () => typeof (window as unknown as { __gameConsole?: unknown }).__gameConsole === 'function' && typeof (window as AudioWindow).__audioLog === 'object',
      { timeout: options.timeoutS * 1000 },
    );
    // Setup runs undrawn: software-rendered frames would cost seconds per tick.
    await page.evaluate(() => (window as unknown as { __setRenderEnabled: (on: boolean) => void }).__setRenderEnabled(false));

    for (const step of GAME_STEPS.slice(0, 1)) await runGameStep(page, step);
    const beforeTick = await logLength(page);
    await gameCommand(page, 'tick 1');
    const bare = (await logSince(page, beforeTick)).filter(isInterfaceCue);
    check(bare.length === 0, 'a bare `tick 1` adds no interface cue', bare.map(r => r.id).join(', '));
    for (const step of GAME_STEPS.slice(1)) await runGameStep(page, step);
    await blastSteps(page);

    const all = await logSince(page, 0);
    check(missingCues(all, LATE_CUES).length === 0, 'the ordered building was built', missingCues(all, LATE_CUES).join(', '));
    reportPageHealth(watch, 'intended cues');
    // The null player refuses every play, so a dropped flag says nothing here.
    return all.map(({ dropped: _refused, ...record }) => record);
  } finally {
    await page.close();
  }
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(USAGE);
    return;
  }
  if (typeof parsed === 'string') fail(`${parsed}\n\n${USAGE}`, EXIT_COULD_NOT_RUN);
  const options = parsed;

  const executablePath = chromeOrFail();
  let server: DevServerHandle;
  try {
    server = await ensureDevServer(await findFreePort());
  } catch (error) {
    return fail(`Could not start a dev server: ${errorText(error)}`, EXIT_COULD_NOT_RUN);
  }
  console.log(`Serving the game at ${server.origin} (stopped when the run ends)`);

  const browser = await launchAudioBrowser(executablePath);
  const tables: Array<readonly [string, PlayRecord[]]> = [];
  try {
    if (options.phases.includes('real')) tables.push(['real engine', await realEnginePhase(browser, server.origin, options)]);
    if (options.phases.includes('intended')) tables.push(['intended cues', await intendedCuesPhase(browser, server.origin, options)]);
  } finally {
    await browser.close();
    await server.stop();
  }

  for (const [name, records] of tables) {
    console.log(`\nCue counts, ${name} (${records.length} requests):`);
    console.log(formatCueTable(countCues(records)));
  }
  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.length} check(s)`);
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(EXIT_FAILED);
  }
  console.log('\nPASS: the audio wiring produced the expected cues, with no page errors.');
}

main().then(() => process.exit(0)).catch((error: unknown) => {
  console.error('Audio smoke test crashed:', error);
  process.exit(EXIT_COULD_NOT_RUN);
});
