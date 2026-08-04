/**
 * BlastSimulator2026 — a blast, frame by frame.
 *
 * Fires a pattern and photographs the collapse at a handful of moments a
 * fraction of a second apart, so the rock can be watched leaving the face,
 * arcing, and coming to rest rather than inferred from a before and an after.
 *
 * The moments are chosen, not waited for. Without a GPU a frame costs seconds
 * while the animation clock advances at most a tenth of a second per frame, so
 * a harness that simply screenshotted repeatedly would sample a collapse over
 * many minutes of wall clock and land nowhere near the moments it wanted.
 * `window.__seekBlastPlayback` holds the playback at an exact time instead, and
 * every shot in a series shares one camera, so the only thing moving between
 * two images is the rock.
 *
 *   npx tsx scripts/verify-blast-sequence.ts
 */

import puppeteer, { type Page } from 'puppeteer';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = resolve(process.cwd(), 'docs/verification/blast-sequence');
const URL = 'http://localhost:5173';
const CHROME = '/opt/pw-browsers/chromium';

const SITE = { x: 20, z: 20 };
/** Degrees: yaw around the site, pitch above the horizon. Looks into the pit. */
const CAMERA = { distance: 40, yaw: 35, pitch: 45 };

/**
 * When each shot is taken, in seconds, for a collapse lasting `durationS`.
 *
 * Weighted to the first second and then straight to the end. Even spacing over
 * the whole run does not work: a violent shot's rock is out of frame in under a
 * second but its slowest arc keeps the collapse alive for sixteen, so evenly
 * spaced frames spend three of five pictures on an already-settled pit. What
 * changes visibly is the burst; what is worth one last frame is where it all
 * came to rest.
 */
const momentsFor = (durationS: number): number[] => [
  0,
  Math.min(0.10, durationS * 0.12),
  Math.min(0.30, durationS * 0.35),
  Math.min(0.80, durationS * 0.60),
  durationS,
];

interface Scenario {
  id: string;
  title: string;
  kg: string;
  stemming: string;
  rows: number;
  cols: number;
  spacing: number;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'a-stemmed',
    title: '3 kg dynatomics per hole, 2 m stemming, 4x4 at 3 m',
    kg: '3', stemming: '2', rows: 4, cols: 4, spacing: 3,
  },
  {
    id: 'b-unstemmed',
    title: '20 kg dynatomics per hole, NO stemming, 4x4 at 3 m',
    kg: '20', stemming: '0', rows: 4, cols: 4, spacing: 3,
  },
];

async function settle(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

async function run(page: Page, command: string): Promise<string> {
  return page.evaluate((cmd: string) => {
    const w = window as unknown as { __gameConsole?: (c: string) => { output?: string } };
    return w.__gameConsole ? (w.__gameConsole(cmd).output ?? '') : '';
  }, command);
}

/** One camera for the whole series, so only the rock moves between shots. */
async function aimCamera(page: Page): Promise<void> {
  await page.evaluate((c: { x: number; z: number; d: number; yaw: number; pitch: number }) => {
    const w = window as unknown as {
      __cameraFocus?: (x: number, z: number, d: number) => void;
      __cameraOrbit?: (yaw: number, pitch: number) => void;
    };
    w.__cameraOrbit?.(c.yaw, c.pitch);
    w.__cameraFocus?.(c.x, c.z, c.d);
  }, { ...SITE, d: CAMERA.distance, yaw: CAMERA.yaw, pitch: CAMERA.pitch });
}

async function playbackDuration(page: Page): Promise<number> {
  return page.evaluate(
    '(window.__blastPlaybackDuration ? window.__blastPlaybackDuration() : 0)',
  ) as Promise<number>;
}

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate(`window.__seekBlastPlayback && window.__seekBlastPlayback(${t})`);
}

async function muckPile(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(`(() => {
    const st = window.__gameState ? window.__gameState() : null;
    return (st && st.muckPile) ? st.muckPile : { fragments: 0 };
  })()`) as Promise<Record<string, unknown>>;
}

async function shoot(page: Page, scenario: Scenario): Promise<Record<string, unknown>> {
  await run(page, 'new_game seed:42');
  await settle(400);
  await run(page, `drill_plan grid rows:${scenario.rows} cols:${scenario.cols} `
    + `spacing:${scenario.spacing} depth:8 start:${SITE.x - 4},${SITE.z - 4}`);
  await settle(400);
  const charge = await run(page, `charge hole:* explosive:dynatomics `
    + `amount:${scenario.kg} stemming:${scenario.stemming}`);
  if (/error/i.test(charge)) throw new Error(`charge rejected: ${charge.split('\n')[0]}`);
  await settle(400);
  await run(page, 'sequence auto delay_step:25');
  await settle(400);

  await aimCamera(page);
  const report = await run(page, 'blast');
  await settle(600);
  await aimCamera(page);

  const durationS = await playbackDuration(page);
  const moments = momentsFor(durationS);
  const times: number[] = [];

  for (let i = 0; i < moments.length; i++) {
    const t = moments[i]!;
    await seek(page, t);
    await aimCamera(page);
    await settle(300);
    await page.screenshot({
      path: resolve(OUT, `${scenario.id}-${i + 1}.jpg`),
      type: 'jpeg',
      quality: 82,
    });
    times.push(Number(t.toFixed(2)));
  }

  const rating = /Rating: (\w+)/.exec(report)?.[1] ?? '?';
  const throwDistance = /Furthest throw: ([\d.]+)/.exec(report)?.[1] ?? '?';
  const cleared = /Cleared voxels: (\d+)/.exec(report)?.[1] ?? '?';

  return {
    id: scenario.id,
    title: scenario.title,
    durationS: Number(durationS.toFixed(2)),
    times,
    rating,
    throwDistance,
    cleared,
    muckPile: await muckPile(page),
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader'],
  });
  const report: Record<string, unknown>[] = [];

  try {
    for (const scenario of SCENARIOS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1100, height: 660 });
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#game-canvas, canvas', { timeout: 15000 });
      await settle(3000);
      await page.evaluate(() => {
        const menu = document.getElementById('bs-main-menu');
        if (menu) (menu as HTMLElement).style.display = 'none';
      });

      const result = await shoot(page, scenario);
      report.push(result);
      console.log(JSON.stringify(result));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const frames = report.reduce((n, r) => n + (r.times as number[]).length, 0);
  console.log(`\nWrote ${frames} frames to ${OUT}`);
}

void main();
