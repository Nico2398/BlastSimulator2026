/**
 * BlastSimulator2026 — Scenario harness profiler
 *
 * Measures where wall-clock time goes in the two scenario modes, per kind of
 * operation, so the interaction/command gap can be attributed rather than
 * guessed at.
 *
 * Two levels of attribution are collected at once:
 *   - operation buckets — per scenario-step phase and per interaction action
 *     type (`action.clickSelector`, `settle.sleep`, `state.tail.gameState`, …)
 *   - primitive buckets — every CDP round-trip the harness makes, counted by
 *     Puppeteer method (`cdp.evaluate`, `cdp.click`, …), collected by wrapping
 *     the Page in a Proxy so nested helper calls are attributed too
 *
 * Operation buckets nest the primitives, so the two tables are read side by
 * side, never summed.
 *
 * Usage:
 *   npx tsx scripts/bench-scenarios.ts --mode both [--limit N] [--scenarios a b]
 *   npx tsx scripts/bench-scenarios.ts --mode micro    # CDP/​bridge micro-costs
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './shared/chrome.js';
import { executeActionOnPage } from './shared/interaction-executor.js';
import { suspendDrawing, captureFrame, DEFAULT_STEP_TIMEOUT } from './shared/puppeteer-utils.js';
import { checkGoal, gameState } from './shared/interaction-driver.js';
import { createGameEngine } from './shared/command-runner.js';
import { runCommand } from '../src/console/createRunner.js';
import { serializeGameState } from '../src/console-api.js';
import { checkGoalAgainstState } from './shared/scenario-goal.js';
import {
  loadScenarioDef, scenarioFiles, formatStepIndex, formatCommandSlug, effectiveStepTimeoutMs, SCENARIO_DIR,
} from './shared/scenario-utils.js';
import type { ScenarioStepDef } from './shared/scenario-types.js';

const INTERACTION_SETTLE_MS = 300;
const SETTLE_AFTER = new Set([
  'click', 'clickSelector', 'pickTile', 'dragTiles', 'mousedown', 'mouseup', 'type',
]);
const OUT_DIR = resolve(import.meta.dirname ?? process.cwd(), '..', 'screenshots', 'bench');

// ─────────────────────────── timing buckets ───────────────────────────

interface Bucket { count: number; ms: number; max: number }
const ops = new Map<string, Bucket>();
const prims = new Map<string, Bucket>();

function record(map: Map<string, Bucket>, label: string, ms: number): void {
  const b = map.get(label) ?? { count: 0, ms: 0, max: 0 };
  b.count++; b.ms += ms; b.max = Math.max(b.max, ms);
  map.set(label, b);
}

async function timed<T>(map: Map<string, Bucket>, label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  try { return await fn(); } finally { record(map, label, performance.now() - t); }
}

function timedSync<T>(label: string, fn: () => T): T {
  const t = performance.now();
  try { return fn(); } finally { record(ops, label, performance.now() - t); }
}

// ───────────────────── CDP round-trip instrumentation ─────────────────────

/** Page methods worth attributing individually; everything else is `cdp.other`. */
const TIMED_PAGE_METHODS = new Set([
  'evaluate', 'waitForSelector', 'click', 'screenshot', 'type', 'goto', '$', '$$',
  'setViewport', 'close', 'evaluateHandle', 'waitForFunction',
]);

/**
 * Wrap a Page so every CDP-crossing call it receives is counted. Methods are
 * bound to the real page, so Puppeteer's own internal calls do not re-enter the
 * proxy and nothing is double counted.
 */
function instrumentPage(page: Page): Page {
  const wrapNamespace = (obj: object, prefix: string): object => new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const t = performance.now();
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (out instanceof Promise) {
          return out.finally(() => record(prims, `${prefix}.${String(prop)}`, performance.now() - t));
        }
        record(prims, `${prefix}.${String(prop)}`, performance.now() - t);
        return out;
      };
    },
  });

  return new Proxy(page, {
    get(target, prop, receiver) {
      if (prop === 'mouse') return wrapNamespace(target.mouse, 'cdp.mouse');
      if (prop === 'keyboard') return wrapNamespace(target.keyboard, 'cdp.keyboard');
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const name = String(prop);
      const label = TIMED_PAGE_METHODS.has(name) ? `cdp.${name}` : `cdp.other:${name}`;
      return (...args: unknown[]) => {
        const t = performance.now();
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (out instanceof Promise) {
          return out.finally(() => record(prims, label, performance.now() - t));
        }
        record(prims, label, performance.now() - t);
        return out;
      };
    },
  }) as Page;
}

// ─────────────────────────── interaction mode ───────────────────────────

/**
 * Mirror of `executeInteractionActions` (puppeteer-utils.ts) with per-action
 * and per-phase timers. Kept structurally identical so the numbers describe
 * the real harness, not a variant of it.
 */
let lastState: unknown = null;

async function runStepActions(
  page: Page,
  step: ScenarioStepDef,
  onProgress?: (detail: string) => void,
): Promise<void> {
  for (const action of step.interaction ?? []) {
    if (action.type === 'screenshot') continue;
    onProgress?.(`action ${action.type}`);
    await timed(ops, `action.${action.type}`, () => executeActionOnPage(page, action, step, onProgress));
    if (SETTLE_AFTER.has(action.type)) {
      await timed(ops, 'settle.sleep', () => new Promise<void>(r => setTimeout(r, INTERACTION_SETTLE_MS)));
    }
  }

  await timed(ops, 'state.tail.resetTick', () => page.evaluate(() => {
    (window as any).__resetTickAccumulator?.();
  }));
  lastState = await timed(ops, 'state.tail.gameState', () => page.evaluate(() =>
    typeof (window as any).__gameState === 'function' ? (window as any).__gameState() : null));
  await timed(ops, 'state.tail.uiState', () => page.evaluate(() =>
    typeof (window as any).__uiState === 'function' ? (window as any).__uiState() : null));
  await timed(ops, 'state.tail.commandOutput', () => page.evaluate(() => {
    const s = (window as any).__gameState?.();
    return s?.lastCommandOutput ? String(s.lastCommandOutput) : '';
  }));
}

async function benchInteraction(names: string[], port: number, screenshots: boolean): Promise<void> {
  const browser: Browser = await timed(ops, 'browser.launch', () => puppeteer.launch({
    headless: true, args: LAUNCH_ARGS, executablePath: resolveChromePathOrThrow(),
  }));

  const perScenario: Array<{ name: string; ms: number; steps: number; failedAt?: number; error?: string | undefined }> = [];

  try {
    for (const name of names) {
      const scenarioStart = performance.now();
      const raw = await timed(ops, 'page.new', () => browser.newPage());
      const page = instrumentPage(raw);
      await timed(ops, 'page.setViewport', () => page.setViewport({ width: 1280, height: 720 }));
      await timed(ops, 'page.goto', () =>
        page.goto(`http://localhost:${port}/?scenarioMode=1`, { waitUntil: 'domcontentloaded' }));
      await timed(ops, 'page.waitCanvas', () => page.waitForSelector('#game-canvas, canvas', { timeout: 30000 }));
      await timed(ops, 'page.suspendDrawing', () => suspendDrawing(page));

      const steps = loadScenarioDef(name, SCENARIO_DIR).steps;
      let failedAt: number | undefined;
      let error: string | undefined;

      for (let s = 0; s < steps.length; s++) {
        const step = steps[s]!;
        const stepTimeout = effectiveStepTimeoutMs(step, DEFAULT_STEP_TIMEOUT);
        // See scenario-interaction-runner.ts's own copy of this comment
        // (PR #616 review round, item 5).
        let lastProgress = 'no interaction action has started yet';
        try {
          await Promise.race([
            (async () => {
              const before = step.expect
                ? await timed(ops, 'state.before', () => gameState(page))
                : {};
              await runStepActions(page, step, (detail) => { lastProgress = detail; });
              if (step.expect) {
                await timed(ops, 'expect.checkGoal', () =>
                  checkGoal(page, step.expect!, before, (lastState as Record<string, unknown> | null) ?? undefined));
              }
              if (screenshots) {
                await timed(ops, 'screenshot.capture', () => captureFrame(page,
                  resolve(OUT_DIR, `${name}-${formatStepIndex(s)}-${formatCommandSlug(step.command)}.png`)));
              }
              timedSync('io.writeState', () => {
                writeFileSync(resolve(OUT_DIR, `${name}-${formatStepIndex(s)}.json`),
                  JSON.stringify({ step: s, command: step.command, gameState: lastState }, null, 2));
              });
            })(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`step ${s} timed out after ${stepTimeout}ms (last progress: ${lastProgress})`)),
                stepTimeout,
              )),
          ]);
        } catch (err: unknown) {
          failedAt = s;
          error = err instanceof Error ? err.message.split('\n')[0] : String(err);
          break;
        }
      }

      await timed(ops, 'page.close', () => page.close());
      const ms = performance.now() - scenarioStart;
      perScenario.push({ name, ms, steps: steps.length, ...(failedAt !== undefined ? { failedAt, error } : {}) });
      console.log(`  [interaction] ${name.padEnd(42)} ${(ms / 1000).toFixed(1)}s  ${steps.length} steps`
        + (failedAt !== undefined ? `  FAILED@${failedAt}: ${error}` : ''));
    }
  } finally {
    await timed(ops, 'browser.close', () => browser.close());
  }

  writeFileSync(resolve(OUT_DIR, 'per-scenario-interaction.json'), JSON.stringify(perScenario, null, 2));
}

// ──────────────────────────── command mode ────────────────────────────

function benchCommand(names: string[]): void {
  const engine = timedSync('engine.create', () => createGameEngine());
  const perScenario: Array<{ name: string; ms: number; steps: number }> = [];

  for (const name of names) {
    const start = performance.now();
    const steps = loadScenarioDef(name, SCENARIO_DIR).steps;
    for (const step of steps) {
      const before = timedSync('cmd.state.before', () =>
        (serializeGameState(engine.ctx) as Record<string, unknown> | null) ?? {});
      try {
        const result = timedSync('cmd.runCommand', () => runCommand(engine, step.command));
        const after = timedSync('cmd.state.after', () =>
          serializeGameState(engine.ctx) as Record<string, unknown> | null);
        if (step.expect) {
          timedSync('cmd.expect', () => checkGoalAgainstState(step.expect!, before, after));
        }
        timedSync('cmd.io.writeState', () => {
          writeFileSync(resolve(OUT_DIR, `cmd-${name}.json`), JSON.stringify(
            { step: step.command, commandOutput: result.output, gameState: after, uiState: null }, null, 2));
        });
      } catch { /* command-mode runner records step errors and continues */ }
    }
    const ms = performance.now() - start;
    perScenario.push({ name, ms, steps: steps.length });
  }

  writeFileSync(resolve(OUT_DIR, 'per-scenario-command.json'), JSON.stringify(perScenario, null, 2));
}

// ───────────────────────────── micro-benchmarks ─────────────────────────────

async function benchMicro(port: number): Promise<void> {
  const browser = await puppeteer.launch({
    headless: true, args: LAUNCH_ARGS, executablePath: resolveChromePathOrThrow(),
  });
  const results: Record<string, unknown> = {};
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const gotoStart = performance.now();
  await page.goto(`http://localhost:${port}/?scenarioMode=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#game-canvas, canvas', { timeout: 60000 });
  results.coldPageLoadMs = performance.now() - gotoStart;

  const sample = async (label: string, n: number, fn: () => Promise<unknown>): Promise<void> => {
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      await fn();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    results[label] = {
      n, mean: +(times.reduce((a, b) => a + b, 0) / n).toFixed(2),
      median: +times[Math.floor(n / 2)]!.toFixed(2), min: +times[0]!.toFixed(2),
      max: +times[n - 1]!.toFixed(2),
    };
  };

  // With drawing ON (the pre-#475 situation, still the state of a page that
  // never calls the bridge) — few samples, each may cost seconds.
  await sample('evaluate.noop.drawingOn', 5, () => page.evaluate(() => 1));
  await sample('evaluate.gameState.drawingOn', 3, () => page.evaluate(() => (window as any).__gameState?.()));

  await suspendDrawing(page);
  await sample('evaluate.noop.drawingSuspended', 40, () => page.evaluate(() => 1));

  // Start a level so the state bridges have something real to serialize.
  const newGameStart = performance.now();
  await page.evaluate(() => (window as any).__gameConsole('new_game seed:42'));
  results.newGameMs = performance.now() - newGameStart;

  await sample('evaluate.noop.afterNewGame', 40, () => page.evaluate(() => 1));

  // What the draw loop costs per CDP call once terrain exists — i.e. what
  // `suspendDrawing` buys, measured rather than assumed (#475).
  await page.evaluate(() => (window as any).__setRenderEnabled?.(true));
  await sample('evaluate.noop.drawingOnWithTerrain', 4, () => page.evaluate(() => 1));
  await sample('evaluate.gameState.drawingOnWithTerrain', 3, () =>
    page.evaluate(() => (window as any).__gameState()));
  await page.evaluate(() => (window as any).__setRenderEnabled?.(false));
  await sample('evaluate.gameState.roundTrip', 20, () => page.evaluate(() => (window as any).__gameState()));
  await sample('evaluate.uiState.roundTrip', 20, () => page.evaluate(() => (window as any).__uiState()));
  await sample('evaluate.uiActions.roundTrip', 20, () => page.evaluate(() => (window as any).__uiActions()));
  await sample('evaluate.probeSelector.roundTrip', 20, () =>
    page.evaluate(() => (window as any).__probeSelector('#bs-open-blast')));
  await sample('evaluate.tutorialState.roundTrip', 20, () => page.evaluate(() => (window as any).__tutorialState()));
  await sample('waitForSelector.present', 20, () => page.waitForSelector('canvas', { timeout: 5000 }));
  await sample('evaluate.gameConsole.tick1', 10, () =>
    page.evaluate(() => (window as any).__gameConsole('tick 1')));
  await sample('evaluate.gameConsole.status', 10, () =>
    page.evaluate(() => (window as any).__gameConsole('status')));
  await sample('evaluate.gameConsole.eventStatus', 10, () =>
    page.evaluate(() => (window as any).__gameConsole('event status')));
  await sample('screenshot.captureFrame', 3, () =>
    captureFrame(page, resolve(OUT_DIR, 'micro-frame.png')));
  await sample('renderFrame.only', 3, () => page.evaluate(() => (window as any).__renderFrame?.()));

  // In-page cost of each bridge, transport excluded. No named inner functions:
  // esbuild's keepNames helper (`__name`) is not defined inside an evaluate.
  results.inPage = await page.evaluate(() => {
    const w = window as any;
    const out: Record<string, number> = {};
    const cases: Array<[string, number, () => unknown]> = [
      ['gameStateMs', 30, () => w.__gameState()],
      ['uiStateMs', 30, () => w.__uiState()],
      ['uiActionsMs', 20, () => w.__uiActions()],
      ['probeSelectorMs', 30, () => w.__probeSelector('#bs-open-blast')],
      ['tutorialStateMs', 30, () => w.__tutorialState()],
      ['consoleStatusMs', 10, () => w.__gameConsole('status')],
      ['consoleTickMs', 10, () => w.__gameConsole('tick 1')],
      ['querySelectorMs', 200, () => document.querySelector('#bs-open-blast')],
      ['jsonStringifyGameStateMs', 20, () => JSON.stringify(w.__gameState())],
    ];
    for (const [label, n, fn] of cases) {
      fn();
      const t = performance.now();
      for (let i = 0; i < n; i++) fn();
      out[label] = Math.round(((performance.now() - t) / n) * 1000) / 1000;
    }
    out.gameStateJsonBytes = JSON.stringify(w.__gameState()).length;
    out.uiActionsCount = (w.__uiActions() as unknown[]).length;
    return out;
  });

  await browser.close();
  writeFileSync(resolve(OUT_DIR, 'micro.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

// ──────────────────────────────── report ────────────────────────────────

function table(title: string, map: Map<string, Bucket>): void {
  const rows = [...map.entries()].sort((a, b) => b[1].ms - a[1].ms);
  const total = rows.reduce((n, [, b]) => n + b.ms, 0);
  console.log(`\n${title}  (sum ${(total / 1000).toFixed(1)}s)`);
  console.log(`${'operation'.padEnd(34)} ${'count'.padStart(7)} ${'total s'.padStart(9)} ${'mean ms'.padStart(9)} ${'max ms'.padStart(9)} ${'%'.padStart(6)}`);
  for (const [label, b] of rows) {
    console.log(`${label.padEnd(34)} ${String(b.count).padStart(7)} ${(b.ms / 1000).toFixed(2).padStart(9)} `
      + `${(b.ms / b.count).toFixed(1).padStart(9)} ${b.max.toFixed(0).padStart(9)} ${((100 * b.ms) / total).toFixed(1).padStart(6)}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let mode = 'both';
  let port = 5173;
  let limit = 0;
  let screenshots = false;
  const picked: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--mode') mode = argv[++i]!;
    else if (a === '--port') port = Number(argv[++i]);
    else if (a === '--limit') limit = Number(argv[++i]);
    else if (a === '--screenshots') screenshots = true;
    else if (a === '--scenarios') { while (argv[i + 1] && !argv[i + 1]!.startsWith('--')) picked.push(argv[++i]!); }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const all = scenarioFiles();
  let names = picked.length > 0 ? picked : all;
  if (limit > 0) names = names.slice(0, limit);

  console.log(`bench: mode=${mode} scenarios=${names.length}/${all.length}`);
  const start = performance.now();

  if (mode === 'micro') { await benchMicro(port); return; }
  if (mode === 'command' || mode === 'both') benchCommand(names);
  if (mode === 'interaction' || mode === 'both') await benchInteraction(names, port, screenshots);

  table('OPERATIONS', ops);
  table('CDP PRIMITIVES (nested inside operations — do not sum with the table above)', prims);
  console.log(`\nwall clock: ${((performance.now() - start) / 1000).toFixed(1)}s`);

  writeFileSync(resolve(OUT_DIR, `buckets-${mode}.json`), JSON.stringify({
    ops: Object.fromEntries(ops), prims: Object.fromEntries(prims),
    scenarios: names.length, wallMs: performance.now() - start,
  }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
