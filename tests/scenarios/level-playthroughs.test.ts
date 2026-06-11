// @vitest-environment node
// BlastSimulator2026 — Level playthrough scenario tests
// Drives each playthrough scenario via Puppeteer against a running dev server,
// validates screenshots are generated, and confirms final game state outcome.
//
// These tests require the Vite dev server to already be running on port 5173.
// They will fail with a connection error if the server is unavailable.
// Each scenario runs in its own browser instance to prevent state leakage.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer from 'puppeteer';
import { mkdirSync, existsSync, statSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Path helpers ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Constants ──

const DEV_SERVER_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 720 };
const INIT_WAIT_MS = 3000;
const COMMAND_WAIT_MS = 800;
const RENDER_WAIT_MS = 500;
const SCENARIO_DIR = resolve(__dirname, '../../scripts/scenario-defs');

/** Known Chromium binary paths, tried in order */
const CHROMIUM_PATHS = [
  '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

/**
 * Chromium executable path.
 * Falls back to puppeteer's bundled chromium if none of the known paths exist.
 */
const CHROMIUM_EXECUTABLE_PATH = CHROMIUM_PATHS.find(p => existsSync(p)) || puppeteer.executablePath();

// ── Types ──

interface ScenarioDef {
  name: string;
  description: string;
  steps: string[];
}

interface FinalGameState {
  /** The final game state returned by window.__gameState() */
  seed?: number;
  time?: number;
  tickCount?: number;
  isPaused?: boolean;
  mineType?: string;
  drillHoles?: number;
  chargesByHole?: Record<string, unknown>;
  sequenceDelays?: Record<string, unknown>;
  finances?: { cash: number };
  holeCount?: number;
  chargedCount?: number;
  sequencedCount?: number;
  buildingCount?: number;
  vehicleCount?: number;
  employeeCount?: number;
  levelEnded?: boolean;
  levelEndReason?: string | null;
  bankrupt?: boolean;
  revolted?: boolean;
  ecologicalShutdown?: boolean;
  arrested?: boolean;
  cash?: number;
  profit?: number;
  [key: string]: unknown;
}

/** Outcome validators for each playthrough scenario */
interface OutcomeValidator {
  /** Human-readable label for this outcome */
  label: string;
  /** Function that returns true if finalState matches expected outcome */
  check: (state: FinalGameState) => boolean;
}

// ── Scenario loader ──

function loadScenario(name: string): ScenarioDef {
  const filePath = resolve(SCENARIO_DIR, `${name}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ScenarioDef;
}

// ── Screenshot directory helper ──

function screenshotDir(scenarioName: string): string {
  const outDir = resolve(process.cwd(), `screenshots/scenario-${scenarioName}`);
  mkdirSync(outDir, { recursive: true });
  return outDir;
}

// ── Outcome validators (matching spec table) ──

const OUTCOME_VALIDATORS: Record<string, OutcomeValidator> = {
  'level1-playthrough-win': {
    label: 'levelEndReason === "completed" and profit > 0',
    check: (s) => s.levelEndReason === 'completed' && (s.profit ?? 0) > 0,
  },
  'level1-playthrough-revolt': {
    label: 'revolted === true',
    check: (s) => s.revolted === true,
  },
  'level2-playthrough-win': {
    label: 'levelEndReason === "completed" and profit > 0',
    check: (s) => s.levelEndReason === 'completed' && (s.profit ?? 0) > 0,
  },
  'level2-playthrough-bankruptcy': {
    label: 'bankrupt === true OR levelEndReason === "bankruptcy"',
    check: (s) => s.bankrupt === true || s.levelEndReason === 'bankruptcy',
  },
  'level3-playthrough-win': {
    label: 'levelEndReason === "completed" and profit > 0',
    check: (s) => s.levelEndReason === 'completed' && (s.profit ?? 0) > 0,
  },
  'level3-playthrough-ecology': {
    label: 'ecologicalShutdown === true OR levelEndReason === "ecological_shutdown"',
    check: (s) => s.ecologicalShutdown === true || s.levelEndReason === 'ecological_shutdown',
  },
};

// ── Step runner helpers ──

/**
 * Runs a sequence of scenario commands on the page, capturing a screenshot
 * after each step. Asserts every screenshot is created and non-trivial.
 *
 * @param page   - Puppeteer page connected to a running game
 * @param steps  - Array of command strings to execute sequentially
 * @param outDir - Directory where step screenshots will be saved
 */
async function runCommandsOnPage(
  page: puppeteer.Page,
  steps: string[],
  outDir: string,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const command = steps[i];
    const paddedIdx = String(i).padStart(2, '0');
    const cmdSlug = command.split(/\s+/)[0].replace(/[^a-z0-9_-]/gi, '');

    // Execute command via the game console bridge
    try {
      await page.evaluate((cmd: string) => {
        if (typeof (window as any).__gameConsole === 'function') {
          return (window as any).__gameConsole(cmd);
        }
        return 'ERROR: __gameConsole not available';
      }, command);
    } catch (cmdErr: unknown) {
      // Capture the error but continue — don't abort mid-scenario
      const errMsg = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
      console.warn(`  ⚠️  Step ${i} command "${command}" failed: ${errMsg}`);
    }

    // Wait for command to settle
    await new Promise(r => setTimeout(r, COMMAND_WAIT_MS));

    // Force render frames so visual side-effects are captured
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => {
      requestAnimationFrame(() => r(undefined));
    })));
    await new Promise(r => setTimeout(r, RENDER_WAIT_MS));

    // Take screenshot
    const screenshotPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    // Assert screenshot was created and is non-trivial
    expect(existsSync(screenshotPath), `Screenshot missing after step ${i} (${command})`).toBe(true);
    const stat = statSync(screenshotPath);
    expect(stat.size, `Screenshot too small after step ${i} (${command})`).toBeGreaterThan(100);
  }
}

/**
 * Runs one extra game tick to trigger level-complete / game-over detection,
 * then captures the final game state via `window.__gameState()`.
 *
 * @param page - Puppeteer page connected to a running game
 * @returns The final game state extracted from the game
 */
async function captureFinalState(page: puppeteer.Page): Promise<FinalGameState> {
  // Execute one tick to flush any pending level-end / game-over checks
  await page.evaluate(() => (window as any).__gameConsole('tick 1'));
  await new Promise(r => setTimeout(r, 1000));

  const finalState = (await page.evaluate(() => {
    if (typeof (window as any).__gameState === 'function') {
      return (window as any).__gameState();
    }
    return null;
  })) as FinalGameState | null;

  if (!finalState) {
    throw new Error('__gameState() returned null — game may not have initialized properly');
  }

  return finalState;
}

// ── Puppeteer scenario runner ──

/**
 * Runs a single playthrough scenario in its own browser instance.
 *
 * 1. Launches a headless Chromium browser
 * 2. Navigates to the dev server and waits for the game canvas
 * 3. Dismisses the main menu
 * 4. Executes each scenario step while capturing screenshots
 * 5. Runs one extra tick to flush game-over detection
 * 6. Captures and returns the final game state
 *
 * @param scenarioName - Name of the scenario (matches JSON filename without extension)
 * @returns The final game state after running all commands + extra tick
 */
async function runScenario(scenarioName: string): Promise<FinalGameState> {
  const scenario = loadScenario(scenarioName);
  const outDir = screenshotDir(scenarioName);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    // Navigate to the game
    await page.goto(DEV_SERVER_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });

    // Let the game initialize
    await new Promise(r => setTimeout(r, INIT_WAIT_MS));

    // Dismiss main menu if present
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 300));

    // Run all scenario steps with screenshot capture
    await runCommandsOnPage(page, scenario.steps, outDir);

    // Capture final game state after scenario steps + extra tick
    return await captureFinalState(page);
  } finally {
    await browser.close();
  }
}

// ── Test suite ──

describe('Level Playthrough Scenarios', () => {
  // The dev server should already be running.
  // These hooks verify it is reachable before running any scenarios.
  beforeAll(async () => {
    // Quick connectivity check — fetch the dev server
    try {
      const response = await fetch(DEV_SERVER_URL);
      if (!response.ok) {
        console.warn(`⚠️  Dev server at ${DEV_SERVER_URL} returned status ${response.status}. Tests may fail.`);
      } else {
        console.log(`✅ Dev server at ${DEV_SERVER_URL} is reachable.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Cannot reach dev server at ${DEV_SERVER_URL}: ${msg}`);
      console.warn('   Tests will likely fail. Start the server with: npm run dev');
    }

    // Verify Chromium is available
    if (!existsSync(CHROMIUM_EXECUTABLE_PATH)) {
      console.warn(`⚠️  Chromium not found at ${CHROMIUM_EXECUTABLE_PATH}. Puppeteer will use fallback.`);
    } else {
      console.log(`✅ Chromium found at ${CHROMIUM_EXECUTABLE_PATH}.`);
    }

    // Verify scenario JSON files exist
    const scenarioNames = [
      'level1-playthrough-win',
      'level1-playthrough-revolt',
      'level2-playthrough-win',
      'level2-playthrough-bankruptcy',
      'level3-playthrough-win',
      'level3-playthrough-ecology',
    ];
    for (const name of scenarioNames) {
      const filePath = resolve(SCENARIO_DIR, `${name}.json`);
      expect(existsSync(filePath), `Scenario file not found: ${filePath}`).toBe(true);
    }
    console.log(`✅ All ${scenarioNames.length} scenario JSON files found.`);
  }, 30000);

  afterAll(async () => {
    // Nothing to clean up — dev server is managed externally
    console.log('✅ Level playthrough scenario tests complete.');
  }, 10000);

  // ── Level 1: Dusty Hollow — Win ──
  it('level1-playthrough-win — Full Level 1 profitable playthrough reaching $80k profit target', async () => {
    const finalState = await runScenario('level1-playthrough-win');
    const validator = OUTCOME_VALIDATORS['level1-playthrough-win'];

    console.log(`  Final state: levelEndReason=${finalState.levelEndReason}, profit=${finalState.profit}, revolted=${finalState.revolted}`);

    expect(validator.check(finalState)).toBe(true);
  }, 180000);

  // ── Level 1: Dusty Hollow — Worker Revolt ──
  it('level1-playthrough-revolt — Level 1 triggering worker revolt by neglecting well-being', async () => {
    const finalState = await runScenario('level1-playthrough-revolt');
    const validator = OUTCOME_VALIDATORS['level1-playthrough-revolt'];

    console.log(`  Final state: revolted=${finalState.revolted}, levelEndReason=${finalState.levelEndReason}`);

    expect(validator.check(finalState)).toBe(true);
  }, 180000);

  // ── Level 2: Crimson Ridge — Win ──
  it('level2-playthrough-win — Full Level 2 profitable playthrough', async () => {
    const finalState = await runScenario('level2-playthrough-win');
    const validator = OUTCOME_VALIDATORS['level2-playthrough-win'];

    console.log(`  Final state: levelEndReason=${finalState.levelEndReason}, profit=${finalState.profit}, bankrupt=${finalState.bankrupt}`);

    expect(validator.check(finalState)).toBe(true);
  }, 180000);

  // ── Level 2: Crimson Ridge — Bankruptcy ──
  it('level2-playthrough-bankruptcy — Level 2 triggering bankruptcy by overspending', async () => {
    const finalState = await runScenario('level2-playthrough-bankruptcy');
    const validator = OUTCOME_VALIDATORS['level2-playthrough-bankruptcy'];

    console.log(`  Final state: bankrupt=${finalState.bankrupt}, levelEndReason=${finalState.levelEndReason}, cash=${finalState.cash}`);

    expect(validator.check(finalState)).toBe(true);
  }, 180000);

  // ── Level 3: Treranium Depths — Win ──
  it('level3-playthrough-win — Full Level 3 profitable playthrough', async () => {
    const finalState = await runScenario('level3-playthrough-win');
    const validator = OUTCOME_VALIDATORS['level3-playthrough-win'];

    console.log(`  Final state: levelEndReason=${finalState.levelEndReason}, profit=${finalState.profit}, bankrupt=${finalState.bankrupt}`);

    expect(validator.check(finalState)).toBe(true);
  }, 180000);

  // ── Level 3: Treranium Depths — Ecological Shutdown ──
  it('level3-playthrough-ecology — Level 3 ecological shutdown from unchecked blasting', async () => {
    const finalState = await runScenario('level3-playthrough-ecology');
    const validator = OUTCOME_VALIDATORS['level3-playthrough-ecology'];

    console.log(`  Final state: ecologicalShutdown=${finalState.ecologicalShutdown}, levelEndReason=${finalState.levelEndReason}`);

    expect(validator.check(finalState)).toBe(true);
  }, 180000);
});
