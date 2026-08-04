/**
 * BlastSimulator2026 — visual verification harness for the blast pipeline.
 *
 * Drives the real game in a browser, looks down into the blast site, and
 * captures matched before/after pairs so the terrain surface can be compared
 * directly rather than inferred. Every shot in a group uses the identical
 * camera, so anything that differs between two images is the game changing, not
 * the view.
 *
 * Also dumps the muck pile behind each shot — fragment size, launch speed, and
 * whether any rock came to rest on nothing — so the pictures can be checked
 * against the state that produced them.
 *
 *   npx tsx scripts/verify-blast-visual.ts
 */

import puppeteer, { type Page } from 'puppeteer';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = resolve(process.cwd(), 'screenshots/blast-verify');
const URL = 'http://localhost:5173';
const CHROME = '/opt/pw-browsers/chromium';

/**
 * Blast site, and where the camera sits to look at it.
 *
 * The pitch is steep on purpose. A blast digs a pit and fills it with muck, and
 * from a low angle the crater's own rim hides everything inside it — a shot at
 * eye level shows undisturbed desert and reads as "nothing happened". Looking
 * down into the hole is the only way to see the floor of it.
 *
 * `__cameraFocus` aims at the *current* ground height, which the blast lowers by
 * several metres, so a low camera also drops between the before and after shots
 * and stops framing the same thing. From above that shift barely moves the view.
 *
 * Yaw and pitch are **degrees** above the horizon, not radians — `setOrbit`
 * converts them itself. Passing radians aims the camera along the ground.
 */
const SITE = { x: 20, z: 20 };
const CAMERA = { distance: 42, yaw: 35, pitch: 50 };

interface Shot {
  name: string;
  commands: string[];
  /** Leave the collapse playing, for a shot of rock still in the air. */
  keepPlayback?: boolean;
}

async function run(page: Page, command: string): Promise<string> {
  return page.evaluate((cmd: string) => {
    const w = window as unknown as { __gameConsole?: (c: string) => { output?: string } };
    return w.__gameConsole ? (w.__gameConsole(cmd).output ?? '') : '';
  }, command);
}

async function settle(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

/** Park the camera so every shot in a group frames the bench identically. */
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

/**
 * The muck pile the blast left, straight out of the running game — fragment
 * size, launch speed, and whether any rock came to rest in mid-air.
 *
 * Evaluated from a source string rather than a function reference: the
 * TypeScript loader rewrites nested arrow functions with helpers that only
 * exist in Node, and those blow up inside the page.
 */
async function probe(page: Page): Promise<Record<string, unknown>> {
  const source = `(() => {
    const st = window.__gameState ? window.__gameState() : null;
    return (st && st.muckPile) ? st.muckPile : { fragments: 0 };
  })()`;
  return page.evaluate(source) as Promise<Record<string, unknown>>;
}

async function capture(page: Page, shot: Shot, group: string): Promise<Record<string, unknown>> {
  for (const command of shot.commands) {
    await run(page, command);
    await settle(400);
  }
  // Without a GPU a frame costs seconds while the collapse advances at most
  // 0.1 s per frame, so a shot taken straight after the blast catches rock in
  // mid-air. Putting the playback on its end shows the muck pile the blast
  // actually produced — the same state a headless run reaches.
  if (!shot.keepPlayback) {
    await page.evaluate('window.__skipBlastPlayback && window.__skipBlastPlayback()');
  }
  // Aimed twice, either side of the wait. A blast rebuilds the terrain on the
  // next frame and re-frames the view on the site it has just changed, which
  // lands *after* the first aim and quietly pulls the camera back — so the
  // before and after shots stop framing the same thing. The second aim is the
  // one the screenshot gets.
  await aimCamera(page);
  await settle(1200);
  await aimCamera(page);

  const stats = await probe(page);
  await page.screenshot({ path: resolve(OUT, `${group}-${shot.name}.png`) });
  return { shot: shot.name, ...stats };
}

/** A 4x4 pattern over the blast site: charge weight and stemming vary per shot. */
const PATTERN = (kg: string, stem: string, rows = 4, cols = 4, spacing = 3): string[] => [
  `drill_plan grid rows:${rows} cols:${cols} spacing:${spacing} depth:8 start:${SITE.x - 4},${SITE.z - 4}`,
  `charge hole:* explosive:dynatomics amount:${kg} stemming:${stem}`,
  'sequence auto delay_step:25',
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader'],
  });
  const report: Record<string, unknown>[] = [];

  try {
    for (const [group, shots] of Object.entries(GROUPS)) {
      for (const shot of shots) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.goto(URL, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#game-canvas, canvas', { timeout: 15000 });
        await settle(3000);
        await page.evaluate(() => {
          const menu = document.getElementById('bs-main-menu');
          if (menu) (menu as HTMLElement).style.display = 'none';
        });

        const stats = await capture(page, shot, group);
        report.push({ group, ...stats });
        console.log(`${group}/${shot.name}`, JSON.stringify(stats));
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nWrote ${report.length} shots to ${OUT}`);
}

const SETTLED = ['tick 5', 'tick 5', 'tick 5', 'tick 5'];

const GROUPS: Record<string, Shot[]> = {
  // Same camera, same seed, same pattern — the only difference is whether the
  // charge has gone off. Anything that changes between these shots is the blast.
  //
  // A well-stemmed 3 kg pattern: rated PERFECT, nothing thrown off site, so the
  // muck stays in the hole it came out of and the collapse is what the picture
  // shows. A 20 kg overcharge scatters rock to the far corners of the map, which
  // says nothing about whether the ground came down.
  collapse: [
    { name: '1-before', commands: ['new_game seed:42', ...PATTERN('3', '2')] },
    // Caught mid-collapse, with the rock still on its way down.
    {
      name: '2-in-flight',
      commands: ['new_game seed:42', ...PATTERN('3', '2'), 'blast'],
      keepPlayback: true,
    },
    { name: '3-settled', commands: ['new_game seed:42', ...PATTERN('3', '2'), 'blast', ...SETTLED] },
  ],
  // One variable at a time, everything else held fixed.
  setup: [
    { name: '1-small-charge', commands: ['new_game seed:42', ...PATTERN('3', '2'), 'blast', ...SETTLED] },
    { name: '2-large-charge', commands: ['new_game seed:42', ...PATTERN('20', '2'), 'blast', ...SETTLED] },
    { name: '3-large-unstemmed', commands: ['new_game seed:42', ...PATTERN('20', '0'), 'blast', ...SETTLED] },
    { name: '4-wide-spacing', commands: ['new_game seed:42', ...PATTERN('20', '2', 3, 3, 6), 'blast', ...SETTLED] },
  ],
};

void main();
