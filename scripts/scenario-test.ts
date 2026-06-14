/**
 * BlastSimulator2026 — Scenario Test Runner
 *
 * Runs a sequence of game commands in headless Chrome, capturing a screenshot
 * and game state dump after EVERY command. Supports multi-angle shots via --shots.
 * Produces a per-step report for visual + logical verification.
 *
 * Usage:
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic
 *   npx tsx scripts/scenario-test.ts --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15"
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --shots "overview:0:45;closeup:90:10;birdseye:0:80"
 *
 * --shots format: name:yaw:pitch;name:yaw:pitch  (degrees)
 *   Each shot is captured after every step, in addition to the default view.
 *   Screenshots: step-NN-cmd.png (default) + step-NN-cmd-shotname.png (each shot)
 *
 * Output:  screenshots/scenario-{name}/
 *   step-00-new_game.png
 *   step-00-new_game.json      (game state + command output)
 *   step-00-new_game-overview.png   (multi-angle shots)
 *   step-00-new_game-closeup.png
 *   step-01-drill_plan.png
 *   step-01-drill_plan.json
 *   ...
 *   report.json                 (summary)
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DEV_SERVER_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 720 };
const INIT_WAIT_MS = 3000;
const COMMAND_WAIT_MS = 800;
const RENDER_WAIT_MS = 500;

interface ScenarioStep {
  command: string;
  description?: string;
}

interface ShotDef {
  name: string;
  yaw: number;
  pitch: number;
}

interface StepResult {
  step: number;
  command: string;
  commandOutput: string;
  gameState: Record<string, unknown> | null;
  uiState: Record<string, unknown> | null;
  screenshotPath: string;
  statePath: string;
}

function parseArgs(): { name: string; steps: ScenarioStep[]; shots: ShotDef[] } {
  const args = process.argv.slice(2);
  let name = 'scenario';
  let steps: ScenarioStep[] = [];
  let shots: ShotDef[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      name = args[i + 1];
      const defPath = resolve(process.cwd(), `scripts/scenario-defs/${name}.json`);
      if (existsSync(defPath)) {
        const def = JSON.parse(readFileSync(defPath, 'utf-8'));
        steps = (def.steps as string[]).map(cmd => ({ command: cmd }));
      } else {
        console.error(`Scenario file not found: ${defPath}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--commands' && args[i + 1]) {
      const commands = args[i + 1].split(';').map(c => c.trim()).filter(Boolean);
      steps = commands.map(cmd => ({ command: cmd }));
      i++;
    } else if (args[i] === '--name' && args[i + 1]) {
      name = args[i + 1];
      i++;
    } else if (args[i] === '--shots' && args[i + 1]) {
      const parts = args[i + 1].split(';').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        const [shotName, yawStr, pitchStr] = part.split(':');
        if (shotName && yawStr && pitchStr) {
          shots.push({ name: shotName, yaw: parseFloat(yawStr), pitch: parseFloat(pitchStr) });
        }
      }
      i++;
    }
  }

  return { name, steps, shots };
}

async function runScenario(name: string, steps: ScenarioStep[], shots: ShotDef[]): Promise<StepResult[]> {
  const outDir = resolve(process.cwd(), `screenshots/scenario-${name}`);
  mkdirSync(outDir, { recursive: true });

  const CHROMIUM_PATHS = [
    '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  const executablePath = CHROMIUM_PATHS.find(p => existsSync(p));

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results: StepResult[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    console.log(`Navigating to ${DEV_SERVER_URL}...`);
    await page.goto(DEV_SERVER_URL, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
    console.log('Game canvas detected. Waiting for initialization...');
    await new Promise(r => setTimeout(r, INIT_WAIT_MS));

    // Dismiss main menu
    await page.evaluate(() => {
      const menu = document.getElementById('bs-main-menu');
      if (menu) (menu as HTMLElement).style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 300));

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const paddedIdx = String(i).padStart(2, '0');
      const cmdSlug = step.command.split(/\s+/)[0].replace(/[^a-z0-9_-]/gi, '');

      console.log(`\n--- Step ${i}: ${step.command} ---`);

      // Execute command and capture output
      const commandOutput = await page.evaluate((cmd: string) => {
        if (typeof (window as any).__gameConsole === 'function') {
          const result = (window as any).__gameConsole(cmd);
          // __gameConsole returns CommandResult { success, output }
          return typeof result === 'object' ? (result.output ?? '') : String(result);
        }
        return 'ERROR: __gameConsole not available';
      }, step.command);

      console.log(`  Output: ${commandOutput}`);

      // Wait for render to settle
      await new Promise(r => setTimeout(r, COMMAND_WAIT_MS));

      // Force a render frame
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => {
        requestAnimationFrame(() => r(undefined));
      })));
      await new Promise(r => setTimeout(r, RENDER_WAIT_MS));

      // Extract game state
      const gameState = await page.evaluate(() => {
        if (typeof (window as any).__gameState === 'function') {
          return (window as any).__gameState();
        }
        return null;
      });

      // Extract UI state
      const uiState = await page.evaluate(() => {
        if (typeof (window as any).__uiState === 'function') {
          return (window as any).__uiState();
        }
        return null;
      });

      // Take default screenshot
      const screenshotPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      // Save state JSON
      const stateData = {
        step: i,
        command: step.command,
        commandOutput,
        gameState,
        uiState,
      };
      const statePath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}.json`);
      writeFileSync(statePath, JSON.stringify(stateData, null, 2));

      console.log(`  Screenshot: ${screenshotPath}`);
      console.log(`  State: ${statePath}`);

      // Multi-angle shots (--shots parameter)
      const shotPaths: string[] = [];
      for (const shot of shots) {
        await page.evaluate(
          ({ y, p }: { y: number; p: number }) => {
            (window as any).__cameraOrbit(y, p);
          },
          { y: shot.yaw, p: shot.pitch },
        );
        await new Promise(r => setTimeout(r, RENDER_WAIT_MS));
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => {
          requestAnimationFrame(() => r(undefined));
        })));
        await new Promise(r => setTimeout(r, RENDER_WAIT_MS));
        const shotPath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}-${shot.name}.png`);
        await page.screenshot({ path: shotPath, fullPage: false });
        shotPaths.push(shotPath);
        console.log(`  Shot [${shot.name}]: ${shotPath}`);
      }

      // Reset camera after multi-angle shots
      if (shots.length > 0) {
        await page.evaluate(() => (window as any).__cameraReset());
        await new Promise(r => setTimeout(r, RENDER_WAIT_MS));
      }

      if (gameState) {
        const gs = gameState as any;
        console.log(`  Holes: ${gs.holeCount ?? 0}, Charged: ${gs.chargedCount ?? 0}, Sequenced: ${gs.sequencedCount ?? 0}`);
      }

      results.push({
        step: i,
        command: step.command,
        commandOutput: commandOutput as string,
        gameState: gameState as any,
        uiState: uiState as any,
        screenshotPath,
        statePath,
      });
    }

    // Save report
    const reportPath = resolve(outDir, 'report.json');
    const report = results.map(r => ({
      step: r.step,
      command: r.command,
      output: r.commandOutput,
      holes: (r.gameState as any)?.holeCount ?? 0,
      charged: (r.gameState as any)?.chargedCount ?? 0,
      sequenced: (r.gameState as any)?.sequencedCount ?? 0,
      screenshot: r.screenshotPath,
    }));
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved: ${reportPath}`);

    return results;
  } finally {
    await browser.close();
  }
}

// Main
const { name, steps, shots } = parseArgs();
if (steps.length === 0) {
  console.error('No steps defined. Use --scenario <name> or --commands "cmd1; cmd2; ..."');
  process.exit(1);
}

if (shots.length > 0) {
  console.log(`Multi-angle shots: ${shots.map(s => `${s.name}(${s.yaw}°,${s.pitch}°)`).join(', ')}`);
}

runScenario(name, steps, shots)
  .then(() => {
    console.log('\nScenario complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Scenario failed:', err);
    process.exit(1);
  });
