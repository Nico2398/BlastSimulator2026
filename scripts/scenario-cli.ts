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
  reportDrift: boolean;
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
  let reportDrift = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      name = args[i + 1]!;
      try {
        const def = loadScenarioDef(name, resolve(process.cwd(), 'scripts/scenario-defs'));
        steps = def.steps;
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
    } else if (args[i] === '--report-drift') {
      reportDrift = true;
    }
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
    reportDrift,
  };
}
