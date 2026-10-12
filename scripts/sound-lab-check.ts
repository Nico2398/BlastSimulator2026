/**
 * BlastSimulator2026 — Sound lab check
 *
 * Proves the audio pipeline works in a real (headless) browser and measures the
 * final mix without ears. Opens /sound-lab.html?autotest=1, which loads every
 * sample and synth recipe through the game's own engine, checks that the live
 * AudioContext runs and plays, then renders the lab's mix scenarios (interface
 * tour, blast, busy mine) offline through the real graph and measures them.
 * Fails (exit 1) on: a sample or recipe that does not load or render, a context
 * that never runs, NaN in a mix, a peak above -0.1 dBFS after the limiter, or a
 * silent mix (gated RMS under -60 dBFS).
 *
 * The dev server must already be running on :5173 (this script starts nothing):
 *
 *   npm run dev                                   # terminal 1
 *   npm run sounds:check                          # terminal 2
 *   npm run sounds:check -- --scenario blast --out /tmp/mixes
 *
 * Output: a table of every mix, and each mix as <out>/<scenario>.wav plus
 * <out>/report.json, to open in any audio tool or inspect with ffmpeg.
 *
 * Exit codes: 0 all clear, 1 a check failed, 2 the check could not run
 * (server unreachable, no Chromium, bad arguments).
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECK_USAGE, parseCheckArgs, type CheckOptions } from '../src/audio/lab/checkArgs.js';
import { evaluateReport } from '../src/audio/lab/checks.js';
import { formatEnvelope, formatMixTable } from '../src/audio/lab/formatReport.js';
import type { SoundLabReport } from '../src/audio/lab/labReport.js';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './shared/chrome.js';

const EXIT_FAILED = 1;
const EXIT_COULD_NOT_RUN = 2;
const PROGRESS_POLL_MS = 1000;
const SERVER_PROBE_TIMEOUT_MS = 3000;
/** Without a user gesture the page still needs this to start its context. */
const AUTOPLAY_FLAG = '--autoplay-policy=no-user-gesture-required';

interface PageHandle {
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
}

type LabWindow = Window & { __soundLab?: SoundLabReport; __soundLabWav?: (name: string) => string | null };

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function labUrl(options: CheckOptions): string {
  return `http://localhost:${options.port}/sound-lab.html`;
}

async function serverIsUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SERVER_PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

/** Wait for `done`, printing each new progress line; false when the timeout ran out first. */
async function waitForDone(page: PageHandle, timeoutS: number): Promise<boolean> {
  const started = Date.now();
  let lastProgress = '';
  while ((Date.now() - started) / 1000 < timeoutS) {
    const state = await page.evaluate(() => {
      const lab = (window as LabWindow).__soundLab;
      return lab ? { done: lab.done, progress: lab.progress } : null;
    });
    if (state && state.progress !== lastProgress) {
      lastProgress = state.progress;
      console.log(`[${((Date.now() - started) / 1000).toFixed(0)} s] ${state.progress}`);
    }
    if (state?.done) return true;
    await sleep(PROGRESS_POLL_MS);
  }
  console.error(`Timed out after ${timeoutS} s; last progress: "${lastProgress}"`);
  return false;
}

async function saveMixes(page: PageHandle, report: SoundLabReport, outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const mix of report.mixes) {
    const base64 = await page.evaluate((name: string) => (window as LabWindow).__soundLabWav?.(name) ?? null, mix.name);
    if (!base64) continue;
    const file = join(outDir, `${mix.name}.wav`);
    writeFileSync(file, Buffer.from(base64, 'base64'));
    written.push(file);
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  return written;
}

function printReport(report: SoundLabReport, files: string[], outDir: string): void {
  const assets = `${report.loaded.length}/${report.expected.samples + report.expected.recipes + 1}`;
  console.log('');
  console.log(`live AudioContext : ${report.contextState} at ${report.sampleRate} Hz (clock ${report.contextClockAdvanced ? 'advanced' : 'did not advance'})`);
  console.log(`engine ready      : ${report.ready}; live play returned a voice: ${report.livePlayOk}`);
  console.log(`assets loaded     : ${assets} (${report.expected.samples} samples, ${report.expected.recipes} recipes, 1 reverb impulse)`);
  console.log('');
  if (report.mixes.length > 0) {
    console.log(formatMixTable(report.mixes));
    console.log('');
    for (const mix of report.mixes) console.log(`${mix.name.padEnd(10)} envelope (1 s cells, -60..0 dBFS): |${formatEnvelope(mix)}|`);
    for (const mix of report.mixes.filter(m => m.dropped > 0)) {
      console.log(`${mix.name.padEnd(10)} dropped: ${Object.entries(mix.droppedById).map(([id, n]) => `${id} x${n}`).join(', ')}`);
    }
    console.log('');
  }
  console.log(files.length > 0 ? `Mixes written to ${outDir}:\n  ${files.join('\n  ')}` : `Report written to ${outDir}`);
}

async function main(): Promise<void> {
  const parsed = parseCheckArgs(process.argv.slice(2), join(tmpdir(), 'blastsim-sound-lab'));
  if (parsed.kind === 'help') {
    console.log(CHECK_USAGE);
    return;
  }
  if (parsed.kind === 'error') fail(`${parsed.message}\n\n${CHECK_USAGE}`, EXIT_COULD_NOT_RUN);
  const options = parsed.options;

  const url = labUrl(options);
  if (!(await serverIsUp(url))) {
    fail(
      `Dev server not reachable at ${url}.\nStart it in another terminal, then run this again:\n  npm run dev\n  npm run sounds:check`,
      EXIT_COULD_NOT_RUN,
    );
  }

  let executablePath: string;
  try {
    executablePath = resolveChromePathOrThrow();
  } catch (error) {
    fail(String(error instanceof Error ? error.message : error), EXIT_COULD_NOT_RUN);
  }

  const browser = await puppeteer.launch({ headless: true, args: [...LAUNCH_ARGS, AUTOPLAY_FLAG], executablePath });
  let report: SoundLabReport | null = null;
  let files: string[] = [];
  const pageErrors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') console.warn(`  [page] ${message.text()}`);
    });
    console.log(`Opening ${url} (scenarios: ${options.scenarios.join(', ')})`);
    await page.goto(`${url}?autotest=1&scenarios=${options.scenarios.join(',')}`, { waitUntil: 'domcontentloaded' });
    const finished = await waitForDone(page, options.timeoutS);
    report = await page.evaluate(() => {
      const lab = (window as LabWindow).__soundLab;
      return lab ? JSON.parse(JSON.stringify(lab)) as SoundLabReport : null;
    });
    if (report) files = await saveMixes(page, report, options.outDir);
    if (!finished && report) report.errors = [...report.errors, `timed out after ${options.timeoutS} s at "${report.progress}"`];
  } finally {
    await browser.close();
  }

  if (!report) fail('The page never published window.__soundLab (did sound-lab.html fail to load?).', EXIT_FAILED);
  report.errors = [...report.errors, ...pageErrors.map(error => `page error: ${error}`)];
  printReport(report, files, options.outDir);

  const verdict = evaluateReport(report);
  for (const warning of verdict.warnings) console.warn(`warning: ${warning}`);
  if (verdict.problems.length > 0) {
    console.error(`\nFAIL: ${verdict.problems.length} problem(s)`);
    for (const problem of verdict.problems) console.error(`  - ${problem}`);
    process.exit(EXIT_FAILED);
  }
  console.log('\nPASS: every asset loaded, the context runs, and every mix is finite, limited and audible.');
}

main().catch((error: unknown) => {
  console.error('Sound lab check crashed:', error);
  process.exit(EXIT_COULD_NOT_RUN);
});
