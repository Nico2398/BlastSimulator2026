/**
 * BlastSimulator2026 — Scenario CLI Argument Parser
 *
 * Parses command-line arguments for scenario-test.ts.
 * Extracted from scenario-test.ts to meet the 300-line file limit.
 *
 * @module scripts/scenario-cli
 */

import { resolve } from 'path';
import type { ScenarioStepDef } from './shared/scenario-types.js';
import { loadScenarioDef } from './shared/scenario-utils.js';
import type { ShotDef } from './scenario-interaction-runner.js';

export interface ParsedArgs {
  name: string;
  steps: ScenarioStepDef[];
  shots: ShotDef[];
  port: number;
  puppeteerPath?: string;
  frames: number;
  intervalMs: number;
  viewport: { width: number; height: number };
  mode: string;
  screenshots: boolean;
  /**
   * The steps to capture when only some are wanted (`--screenshot-steps`);
   * undefined captures every step `screenshots` enables.
   */
  screenshotSteps?: ReadonlySet<number>;
  reportDrift: boolean;
  skipBlastPlayback: boolean;
  realTutorialClock: boolean;
}

function parseViewsArg(raw: string): ShotDef[] {
  return raw.split(';').map(s => s.trim()).filter(Boolean).map((part) => {
    const [shotName, yawStr, pitchStr] = part.split(':');
    const name = shotName ?? '';
    const yaw = parseFloat(yawStr ?? '');
    const pitch = parseFloat(pitchStr ?? '');
    return { name, yaw, pitch };
  }).filter(s => s.name && !isNaN(s.yaw) && !isNaN(s.pitch));
}

/**
 * The steps `--screenshot-steps` names, 0-based as the `step-NN` files are:
 * `3`, `2-5`, `last`, comma-separated. Every capture renders a frame in
 * software without a GPU — seconds each, and a scenario captured at every step
 * ran 40–125× longer than CI's uncaptured run of it — so a check looks at the
 * steps that show its change and no others. Refuses a step the scenario does
 * not have rather than capturing nothing.
 */
export function parseStepSelection(spec: string, stepCount: number): { steps: ReadonlySet<number> } | { error: string } {
  const steps = new Set<number>();
  const tokens = spec.split(',').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return { error: '--screenshot-steps names no step' };
  if (stepCount === 0) return { error: '--screenshot-steps: the scenario has no steps to capture' };
  for (const token of tokens) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    const bounds = token === 'last' ? [stepCount - 1, stepCount - 1]
      : range ? [Number(range[1]), Number(range[2])]
      : /^\d+$/.test(token) ? [Number(token), Number(token)]
      : undefined;
    if (!bounds) return { error: `--screenshot-steps: "${token}" is not a step index, a range a-b, or last` };
    const [from, to] = bounds as [number, number];
    if (from > to || from < 0 || to >= stepCount) {
      return { error: `--screenshot-steps: "${token}" is outside steps 0-${stepCount - 1}` };
    }
    for (let step = from; step <= to; step++) steps.add(step);
  }
  return { steps };
}

export function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let name = 'scenario';
  let steps: ScenarioStepDef[] = [];
  let shots: ShotDef[] = [];
  let port = 5173;
  let puppeteerPath: string | undefined;
  let frames = 1;
  let intervalMs = 200;
  let viewport = { width: 1280, height: 720 };
  let mode = 'command'; // default mode
  let screenshots = false;
  let screenshotStepsSpec: string | undefined;
  let reportDrift = false;
  let skipBlastPlayback = false;
  let realTutorialClock = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      name = args[i + 1]!;
      try {
        const def = loadScenarioDef(name, resolve(process.cwd(), 'scripts/scenario-defs'));
        steps = def.steps;
        skipBlastPlayback = def.skipBlastPlayback ?? false;
        realTutorialClock = def.realTutorialClock ?? false;
        if (def.shots && Array.isArray(def.shots)) {
          shots = def.shots.map(s => ({
            name: s.name, yaw: s.yaw, pitch: s.pitch,
            ...(s.target !== undefined ? { target: s.target } : {}),
            ...(s.distance !== undefined ? { distance: s.distance } : {}),
          }));
        }
      } catch (err) {
        console.error(`Scenario file not found: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--commands' && args[i + 1]) {
      const commands = args[i + 1]!.split(';').map(c => c.trim()).filter(Boolean);
      steps = commands.map(cmd => ({ command: cmd }));
      i++;
    } else if (args[i] === '--name' && args[i + 1]) {
      name = args[i + 1]!;
      i++;
    } else if (args[i] === '--shots' && args[i + 1]) {
      shots = parseViewsArg(args[i + 1]!);
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--puppeteer-path' && args[i + 1]) {
      puppeteerPath = args[i + 1];
      i++;
    } else if (args[i] === '--frames' && args[i + 1]) {
      frames = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--interval' && args[i + 1]) {
      intervalMs = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--viewport' && args[i + 1]) {
      const viewportStr = args[i + 1]!;
      const parts = viewportStr.split('x').map(v => parseInt(v, 10));
      if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
        viewport = { width: parts[0]!, height: parts[1]! };
      } else {
        console.error(`Invalid viewport format: ${viewportStr}. Use WxH (e.g. 1920x1080)`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--mode' && args[i + 1]) {
      const modeArg = args[i + 1]!;
      if (modeArg !== 'command' && modeArg !== 'interaction') {
        console.error(`Invalid mode: "${modeArg}". Supported modes: command, interaction`);
        process.exit(1);
      }
      mode = modeArg;
      i++;
    } else if (args[i] === '--screenshots') {
      screenshots = true;
    } else if (args[i] === '--screenshot-steps' && args[i + 1]) {
      screenshotStepsSpec = args[i + 1]!;
      screenshots = true;
      i++;
    } else if (args[i] === '--report-drift') {
      reportDrift = true;
    }
  }

  let screenshotSteps: ReadonlySet<number> | undefined;
  if (screenshotStepsSpec !== undefined) {
    const selection = parseStepSelection(screenshotStepsSpec, steps.length);
    if ('error' in selection) {
      console.error(selection.error);
      process.exit(1);
    }
    screenshotSteps = selection.steps;
  }

  return {
    name,
    steps,
    shots,
    port,
    ...(puppeteerPath !== undefined ? { puppeteerPath } : {}),
    frames,
    intervalMs,
    viewport,
    mode,
    screenshots,
    ...(screenshotSteps !== undefined ? { screenshotSteps } : {}),
    reportDrift,
    skipBlastPlayback,
    realTutorialClock,
  };
}
