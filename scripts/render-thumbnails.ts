/**
 * BlastSimulator2026 — Render portrait thumbnails (#2241)
 *
 * Drives /thumbs.html (src/thumb-studio.ts) in headless Chrome and writes one
 * transparent WebP per worker role, vehicle role and tier, and building type
 * and tier into public/thumbs/, where the inspector header and the grid cards
 * load them (src/ui/portraits.ts). Rerun after a model changes; the images are
 * committed next to the .glb they were taken from. Starts its own Vite server
 * when none answers on the port.
 *
 *   npm run thumbs:build                      # every thumbnail
 *   npm run thumbs:build -- worker_driller    # only these ids
 *
 * Output: public/thumbs/<model id>.webp
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './shared/chrome.js';
import { ensureDevServer } from './shared/dev-server.js';
import { THUMB_SIZE_PX } from '../src/renderer/models/Thumbnails.js';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
const OUT_DIR = resolve(ROOT, 'public', 'thumbs');
/** Software rasterisation and a cold model fetch: give the studio a while before calling it stuck. */
const READY_TIMEOUT_MS = 120_000;
const DATA_URL_PREFIX = 'data:image/webp;base64,';

/** The studio's page bridge (src/thumb-studio.ts). */
interface StudioWindow {
  __renderThumb?: (id: string) => Promise<string | null>;
  __thumbIds?: string[];
}

async function main(): Promise<void> {
  const port = Number(process.env['VISUAL_TEST_PORT'] ?? 5173);
  const only = process.argv.slice(2);
  const server = await ensureDevServer(port, '/thumbs.html');
  const browser = await puppeteer.launch({ headless: true, args: LAUNCH_ARGS, executablePath: resolveChromePathOrThrow() });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: THUMB_SIZE_PX, height: THUMB_SIZE_PX });
    await page.goto(`${server.origin}/thumbs.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as unknown as StudioWindow).__renderThumb === 'function', { timeout: READY_TIMEOUT_MS });
    const ids = (await page.evaluate(() => (window as unknown as StudioWindow).__thumbIds ?? [])).filter(id => only.length === 0 || only.includes(id));
    mkdirSync(OUT_DIR, { recursive: true });
    let failed = 0;
    for (const id of ids) {
      const url = await page.evaluate((i: string) => (window as unknown as StudioWindow).__renderThumb!(i), id);
      if (!url || !url.startsWith(DATA_URL_PREFIX)) {
        console.error(`  ${id}: render failed`);
        failed++;
        continue;
      }
      const bytes = Buffer.from(url.slice(DATA_URL_PREFIX.length), 'base64');
      writeFileSync(resolve(OUT_DIR, `${id}.webp`), bytes);
      console.log(`  ${id}.webp  ${(bytes.length / 1024).toFixed(1)} KB`);
    }
    console.log(`Done. ${ids.length - failed}/${ids.length} thumbnails in ${OUT_DIR}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch(err => {
  console.error('Thumbnail render failed:', err);
  process.exit(1);
});
