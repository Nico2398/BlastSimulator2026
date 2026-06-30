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
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --frames 3 --interval 100
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --viewport "1920x1080"
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --port 5174
 *   npx tsx scripts/scenario-test.ts --scenario blast-basic --puppeteer-path "/path/to/chrome"
 *
 * --shots format: name:yaw:pitch;name:yaw:pitch  (degrees)
 *   Each shot is captured after every step, in addition to the default view.
 *   Screenshots: step-NN-cmd.png (default) + step-NN-cmd-shotname.png (each shot)
 *
 * --frames N: capture N sequential frames per step for animation verification
 * --interval MS: milliseconds between animation frames
 * --viewport "WxH": browser viewport size (default 1280x720)
 *
 * Per-step timeouts: scenarios can define `timeout` (seconds) per step.
 * Screenshot size monitoring: warns if PNG > 5MB.
 *
 * Environment variables:
 *   PUPPETEER_EXECUTABLE_PATH — path to Chrome/Chromium executable
 *
 * Output:  screenshots/scenario-{name}/
 *   step-00-new_game.png
 *   step-00-new_game.json      (game state + command output)
 *   step-00-new_game-overview.png   (multi-angle shots)
 *   step-00-new_game-closeup.png
 *   step-00-new_game-f0.png         (animation frames)
 *   step-00-new_game-f1.png
 *   ...
 *   step-01-drill_plan.png
 *   step-01-drill_plan.json
 *   ...
 *   report.json                 (summary)
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { resolveChromePath } from './shared/chrome.js';
import { executeActionOnPage } from './shared/interaction-executor.js';
import type { InteractionStepAction } from './shared/scenario-types.js';

const VIEWPORT = { width: 1280, height: 720 };
const INIT_WAIT_MS = 3000;
const COMMAND_WAIT_MS = 800;
const RENDER_WAIT_MS = 500;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

interface ScenarioStep {
  command: string;
  description?: string;
  timeout?: number;
  /** Per-step animation frame capture count (default: 1 = no additional frames). */
  frames?: number;
  /** Milliseconds between animation frames (default: 200). */
  interval?: number;
  /** Optional interaction actions to execute before/instead of the command. */
  interaction?: InteractionStepAction[];
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
  error?: string;
  warning?: string;
}

/**
 * Executes an array of interaction actions on the given Puppeteer page.
 * @param page - Puppeteer page object.
 * @param actions - Array of interaction actions to execute sequentially.
 * @param timeout - Optional timeout in milliseconds for the entire sequence.
 */
export async function executeInteractionStep(
  page: puppeteer.Page,
  actions: InteractionStepAction[],
  timeout?: number,
): Promise<void> {
  const execute = async () => {
    for (const action of actions) {
      try {
        await executeActionOnPage(page, action as any);
      } catch (err: any) {
        console.error(`  Interaction action error (${action.type}): ${err.message ?? String(err)}`);
      }
    }
  };

  if (timeout !== undefined && timeout > 0) {
    await Promise.race([
      execute(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`executeInteractionStep timed out after ${timeout}ms`)), timeout),
      ),
    ]);
  } else {
    await execute();
  }
}

function parseViewsArg(raw: string): ShotDef[] {
  return raw.split(';').map(s => s.trim()).filter(Boolean).map((part) => {
    const [shotName, yawStr, pitchStr] = part.split(':');
    return { name: shotName, yaw: parseFloat(yawStr), pitch: parseFloat(pitchStr) };
  }).filter(s => s.name && !isNaN(s.yaw) && !isNaN(s.pitch));
}

function parseArgs(): {
  name: string; steps: ScenarioStep[]; shots: ShotDef[];
  port: number; puppeteerPath?: string; frames: number; intervalMs: number;
  viewport: { width: number; height: number };
  mode: string;
} {
  const args = process.argv.slice(2);
  let name = 'scenario';
  let steps: ScenarioStep[] = [];
  let shots: ShotDef[] = [];
  let port = 5173;
  let puppeteerPath: string | undefined;
  let frames = 1;
  let intervalMs = 200;
  let viewport = { width: 1280, height: 720 };
  let mode = 'command'; // default mode

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      name = args[i + 1];
      const defPath = resolve(process.cwd(), `scripts/scenario-defs/${name}.json`);
      if (existsSync(defPath)) {
        const def = JSON.parse(readFileSync(defPath, 'utf-8'));
        steps = def.steps.map((s: any) => typeof s === 'string' ? { command: s } : s);
        if (def.shots && Array.isArray(def.shots)) {
          shots = def.shots.map((s: any) => ({ name: s.name, yaw: s.yaw, pitch: s.pitch }));
        }
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
      shots = parseViewsArg(args[i + 1]);
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--puppeteer-path' && args[i + 1]) {
      puppeteerPath = args[i + 1];
      i++;
    } else if (args[i] === '--frames' && args[i + 1]) {
      frames = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--interval' && args[i + 1]) {
      intervalMs = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--viewport' && args[i + 1]) {
      const parts = args[i + 1].split('x').map(v => parseInt(v, 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        viewport = { width: parts[0], height: parts[1] };
      } else {
        console.error(`Invalid viewport format: ${args[i+1]}. Use WxH (e.g. 1920x1080)`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--mode' && args[i + 1]) {
      const modeArg = args[i + 1];
      if (modeArg !== 'command' && modeArg !== 'interaction') {
        console.error(`Invalid mode: "${modeArg}". Supported modes: command, interaction`);
        process.exit(1);
      }
      mode = modeArg;
      i++;
    }
  }

  return { name, steps, shots, port, puppeteerPath, frames, intervalMs, viewport, mode };
}

function checkScreenshotSize(filepath: string): string | undefined {
  try {
    const size = statSync(filepath).size;
    if (size > MAX_SCREENSHOT_BYTES) {
      const mb = (size / (1024 * 1024)).toFixed(1);
      return `Screenshot ${mb}MB exceeds ${MAX_SCREENSHOT_BYTES / (1024*1024)}MB limit: ${filepath}`;
    }
  } catch { /* ignore stat errors */ }
  return undefined;
}

async function runScenario(
  name: string, steps: ScenarioStep[], shots: ShotDef[],
  port: number, puppeteerPath: string | undefined, frames: number, intervalMs: number,
  viewport: { width: number; height: number },
  mode: string,
): Promise<StepResult[]> {
  const outDir = resolve(process.cwd(), `screenshots/scenario-${name}-${mode}`);
  mkdirSync(outDir, { recursive: true });

  const devServerUrl = `http://localhost:${port}`;

  const executablePath = puppeteerPath
    ?? process.env.PUPPETEER_EXECUTABLE_PATH
    ?? resolveChromePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results: StepResult[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);

    console.log(`Navigating to ${devServerUrl}...`);
    await page.goto(devServerUrl, { waitUntil: 'networkidle0' });
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

      // Per-step timeout
      let timedOut = false;
      const stepTimeout = (step.timeout ?? 30) * 1000;
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => { timedOut = true; reject(new Error(`Step ${i} timed out after ${stepTimeout}ms`)); }, stepTimeout)
      );

      try {
        await Promise.race([
          (async () => {
            // Mode-based execution
            let commandOutput = '';
            if (mode === 'interaction') {
              if (step.interaction && step.interaction.length > 0) {
                await executeInteractionStep(page, step.interaction);
                // Capture command output for any command-type actions in the interaction
                const commandActions = step.interaction.filter(a => a.type === 'command');
                if (commandActions.length > 0) {
                  // Execute last command action to capture its output
                  const lastCmd = commandActions[commandActions.length - 1];
                  commandOutput = await page.evaluate((cmd: string) => {
                    if (typeof (window as any).__gameConsole === 'function') {
                      const result = (window as any).__gameConsole(cmd);
                      return typeof result === 'object' ? (result.output ?? '') : String(result);
                    }
                    return 'ERROR: __gameConsole not available';
                  }, lastCmd.command);
                  console.log(`  Output: ${commandOutput}`);
                }
              } else {
                console.warn(`  Step ${i}: interaction mode but no interaction defined, skipping.`);
              }
            } else {
              // Execute command and capture output
              commandOutput = await page.evaluate((cmd: string) => {
                if (typeof (window as any).__gameConsole === 'function') {
                  const result = (window as any).__gameConsole(cmd);
                  return typeof result === 'object' ? (result.output ?? '') : String(result);
                }
                return 'ERROR: __gameConsole not available';
              }, step.command);
              console.log(`  Output: ${commandOutput}`);
            }

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

            // Screenshot size monitoring
            const sizeWarn = checkScreenshotSize(screenshotPath);
            if (sizeWarn) console.warn(`  WARNING: ${sizeWarn}`);

            // Animation frames — step-level setting overrides CLI default
            const stepFrames = step.frames ?? frames;
            const stepInterval = step.interval ?? intervalMs;
            const framePaths: string[] = [];
            if (stepFrames > 1) {
              for (let f = 0; f < stepFrames; f++) {
                await new Promise(r => setTimeout(r, stepInterval));
                await page.evaluate(() => new Promise(r => requestAnimationFrame(() => {
                  requestAnimationFrame(() => r(undefined));
                })));
                const framePath = resolve(outDir, `step-${paddedIdx}-${cmdSlug}-f${f}.png`);
                await page.screenshot({ path: framePath, fullPage: false });
                framePaths.push(framePath);
                console.log(`  Frame ${f}: ${framePath} (interval=${stepInterval}ms)`);

                const fSizeWarn = checkScreenshotSize(framePath);
                if (fSizeWarn) console.warn(`  WARNING: ${fSizeWarn}`);
              }
            }

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

            // Multi-angle shots (--shots or scenario-defined)
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

              const sSizeWarn = checkScreenshotSize(shotPath);
              if (sSizeWarn) console.warn(`  WARNING: ${sSizeWarn}`);
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
              warning: sizeWarn,
            });
          })(),
          timeoutPromise,
        ]);
      } catch (err: any) {
        const errorMsg = err.message ?? String(err);
        console.error(`  ERROR: ${errorMsg}`);

        results.push({
          step: i,
          command: step.command,
          commandOutput: '',
          gameState: null,
          uiState: null,
          screenshotPath: '',
          statePath: '',
          error: errorMsg,
        });

        if (timedOut) {
          console.error('  Step timed out. Skipping remaining steps.');
          break;
        }
      }
    }

    // Save report
    const reportPath = resolve(outDir, 'report.json');
    const report = results.map(r => ({
      step: r.step,
      command: r.command,
      output: r.commandOutput,
      error: r.error,
      warning: r.warning,
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
const { name, steps, shots, port, puppeteerPath, frames, intervalMs, viewport, mode } = parseArgs();
if (steps.length === 0) {
  console.error('No steps defined. Use --scenario <name> or --commands "cmd1; cmd2; ..."');
  process.exit(1);
}

console.log(`Viewport: ${viewport.width}x${viewport.height}`);
console.log(`Dev server port: ${port}`);
if (shots.length > 0) {
  console.log(`Multi-angle shots: ${shots.map(s => `${s.name}(${s.yaw}°,${s.pitch}°)`).join(', ')}`);
}
if (frames > 1) {
  console.log(`Animation frames: ${frames} at ${intervalMs}ms interval`);
}

runScenario(name, steps, shots, port, puppeteerPath, frames, intervalMs, viewport, mode)
  .then(() => {
    console.log('\nScenario complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Scenario failed:', err);
    process.exit(1);
  });
