/**
 * BlastSimulator2026 — Model preview capture
 *
 * Screenshots public/models/*.glb through /model-viewer.html — the game's own
 * scene pipeline — from a few camera angles, so a model can be inspected the
 * way the player will see it. Dev server must be running on :5173.
 *
 *   npx tsx scripts/model-preview.ts                       # every model, default views
 *   npx tsx scripts/model-preview.ts worker_driller        # one model
 *   npx tsx scripts/model-preview.ts --views "front:35:20;back:215:20;top:35:70" vehicle_drill_rig_t2
 *   npx tsx scripts/model-preview.ts --sheet               # also tile the captures into one contact sheet
 *   npx tsx scripts/model-preview.ts worker_driller --query "fy=0.86" --zoom 3 --tag face   # extra viewer params
 *   npx tsx scripts/model-preview.ts worker_driller --query "pose=walk" --times 2,2.06,2.12 --tag walk   # a motion, frame by frame
 *
 * Output: screenshots/models/<id>-<view>.png (and screenshots/models/sheet.png).
 */

import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './shared/chrome.js';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
const MODEL_DIR = resolve(ROOT, 'public', 'models');
const OUT_DIR = resolve(ROOT, 'screenshots', 'models');
const DEFAULT_VIEWS = 'front:35:20;back:215:20;top:35:65';
/** Software rasterisation: give a heavy model a while before calling it stuck. */
const READY_TIMEOUT_MS = 180_000;

interface View { name: string; yaw: number; pitch: number }

interface Options {
  models: string[];
  views: View[];
  port: number;
  size: number;
  zoom: number;
  sheet: boolean;
  /** Extra model-viewer URL parameters (`fy=0.86&pose=walk&t=0.25`), passed through verbatim. */
  query: string;
  /** Suffix for the capture file names, so differently framed captures of one view do not overwrite each other. */
  tag: string;
  /** Posed workers: simulated seconds to capture, one frame each (`&t=` per capture). */
  times: number[];
}

function parseViews(spec: string): View[] {
  return spec.split(';').filter(Boolean).map(part => {
    const [name, yaw, pitch] = part.split(':');
    return { name: name!, yaw: Number(yaw), pitch: Number(pitch) };
  });
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    models: [], views: parseViews(DEFAULT_VIEWS), port: 5173, size: 640, zoom: 1, sheet: false, query: '', tag: '',
    times: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--views') options.views = parseViews(args[++i] ?? DEFAULT_VIEWS);
    else if (a === '--port') options.port = Number(args[++i]);
    else if (a === '--size') options.size = Number(args[++i]);
    else if (a === '--zoom') options.zoom = Number(args[++i]);
    else if (a === '--sheet') options.sheet = true;
    else if (a === '--query') options.query = args[++i] ?? '';
    else if (a === '--tag') options.tag = args[++i] ?? '';
    else if (a === '--times') options.times = (args[++i] ?? '').split(',').filter(Boolean).map(Number);
    else options.models.push(a);
  }
  if (options.models.length === 0) {
    options.models = readdirSync(MODEL_DIR).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4)).sort();
  }
  return options;
}

async function settleFrames(page: Page, frames: number): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => r())));
  }
}

async function capture(options: Options): Promise<string[]> {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS, executablePath: resolveChromePathOrThrow() });
  const files: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: options.size, height: options.size });
    const frames: Array<number | null> = options.times.length ? options.times : [null];
    for (const model of options.models) {
      for (const view of options.views) for (const [fi, time] of frames.entries()) {
        const at = time === null ? '' : `&t=${time}`;
        const url = `http://localhost:${options.port}/model-viewer.html?model=${model}&yaw=${view.yaw}&pitch=${view.pitch}&zoom=${options.zoom}${options.query ? `&${options.query}` : ''}${at}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => (window as unknown as { __viewerReady?: boolean }).__viewerReady !== undefined, { timeout: READY_TIMEOUT_MS });
        const ready = await page.evaluate(() => (window as unknown as { __viewerReady?: boolean }).__viewerReady);
        if (!ready) console.warn(`  ${model}: asset failed to load (stand-in box captured)`);
        await settleFrames(page, 3);
        const frame = time === null ? '' : `-f${String(fi).padStart(2, '0')}`;
        const file = resolve(OUT_DIR, `${model}-${view.name}${options.tag ? `-${options.tag}` : ''}${frame}.png`);
        await page.screenshot({ path: file });
        files.push(file);
        console.log(`captured ${model} ${view.name}`);
      }
    }
  } finally {
    await browser.close();
  }
  return files;
}

const options = parseArgs();
capture(options)
  .then(files => {
    console.log(`Done. ${files.length} captures in ${OUT_DIR}`);
    if (options.sheet && existsSync(resolve(ROOT, 'assets', 'models', 'blender', 'sheet.py'))) {
      console.log('Contact sheet: python3 assets/models/blender/sheet.py');
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Model preview failed:', err);
    process.exit(1);
  });
