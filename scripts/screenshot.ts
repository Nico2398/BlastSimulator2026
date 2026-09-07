/**
 * BlastSimulator2026 — Screenshot Capture Script
 *
 * Launches the game in headless Chrome, optionally executes console commands,
 * and saves screenshots for visual validation.
 *
 * Usage:
 *   npx tsx scripts/screenshot.ts                          # Default screenshot
 *   npx tsx scripts/screenshot.ts --name "after-blast"     # Named screenshot
 *   npx tsx scripts/screenshot.ts --commands "survey 25,30; blast"  # With commands
 *   npx tsx scripts/screenshot.ts --port 5174              # Custom dev server port
 *   npx tsx scripts/screenshot.ts --puppeteer-path "/path/to/chrome"  # Custom Chrome path
 *   npx tsx scripts/screenshot.ts --viewport "1920x1080"  # Custom viewport size
 *   npx tsx scripts/screenshot.ts --focus "40,40,25" --orbit "35,30"  # Frame a world point from an angle
 *   npx tsx scripts/screenshot.ts --focus-entity "employee:1,8"       # Frame a rendered entity
 *
 * Screenshots are saved to: screenshots/{name}-{timestamp}.png
 *
 * Environment variables:
 *   PUPPETEER_EXECUTABLE_PATH — path to Chrome/Chromium executable
 *
 * Prerequisites:
 *   npm install puppeteer --save-dev
 *   The dev server must be running: npm run dev (in another terminal or background)
 */

import puppeteer from 'puppeteer';
import type { PuppeteerLaunchOptions } from 'puppeteer';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './shared/chrome.js';
import { captureFrame, waitForModels } from './shared/puppeteer-utils.js';

const SCREENSHOTS_DIR = resolve(process.cwd(), 'screenshots');
const INIT_WAIT_MS = 3000;
const COMMAND_WAIT_MS = 500;

interface ScreenshotOptions {
    name: string;
    commands: string[];
    port: number;
    puppeteerPath?: string;
    viewport: { width: number; height: number };
    /** Centre + zoom the camera on a world point after the commands run. */
    focus?: { x: number; z: number; distance: number };
    /** Centre + zoom the camera on a rendered entity (its live position is looked up in the page). */
    focusEntity?: { kind: string; id: number; distance: number };
    /** Orbit angles (degrees) applied after the commands run. */
    orbit?: { yaw: number; pitch: number };
}

function parseArgs(): ScreenshotOptions {
    const args = process.argv.slice(2);
    let name = 'screenshot';
    let commands: string[] = [];
    let port = 5173;
    let puppeteerPath: string | undefined;
    let viewport = { width: 1280, height: 720 };
    let focus: ScreenshotOptions['focus'];
    let focusEntity: ScreenshotOptions['focusEntity'];
    let orbit: ScreenshotOptions['orbit'];

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--name' && args[i + 1]) {
            name = args[i + 1]!;
            i++;
        } else if (args[i] === '--commands' && args[i + 1]) {
            commands = args[i + 1]!.split(';').map((c) => c.trim()).filter(Boolean);
            i++;
        } else if (args[i] === '--port' && args[i + 1]) {
            port = parseInt(args[i + 1]!, 10);
            i++;
        } else if (args[i] === '--puppeteer-path' && args[i + 1]) {
            puppeteerPath = args[i + 1];
            i++;
        } else if (args[i] === '--focus' && args[i + 1]) {
            const [x, z, distance] = args[i + 1]!.split(',').map(Number);
            if ([x, z, distance].some(v => v === undefined || isNaN(v))) {
                console.error(`Invalid focus: ${args[i + 1]}. Use x,z,distance`);
                process.exit(1);
            }
            focus = { x: x!, z: z!, distance: distance! };
            i++;
        } else if (args[i] === '--focus-entity' && args[i + 1]) {
            // kind:id,distance — e.g. employee:1,8
            const m = /^(\w+):(\d+),([\d.]+)$/.exec(args[i + 1]!);
            if (!m) {
                console.error(`Invalid focus-entity: ${args[i + 1]}. Use kind:id,distance (e.g. vehicle:1,12)`);
                process.exit(1);
            }
            focusEntity = { kind: m[1]!, id: Number(m[2]), distance: Number(m[3]) };
            i++;
        } else if (args[i] === '--orbit' && args[i + 1]) {
            const [yaw, pitch] = args[i + 1]!.split(',').map(Number);
            if ([yaw, pitch].some(v => v === undefined || isNaN(v))) {
                console.error(`Invalid orbit: ${args[i + 1]}. Use yaw,pitch (degrees)`);
                process.exit(1);
            }
            orbit = { yaw: yaw!, pitch: pitch! };
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
        }
    }

    return {
        name,
        commands,
        port,
        ...(puppeteerPath !== undefined ? { puppeteerPath } : {}),
        viewport,
        ...(focus ? { focus } : {}),
        ...(focusEntity ? { focusEntity } : {}),
        ...(orbit ? { orbit } : {}),
    };
}

async function captureScreenshot(options: ScreenshotOptions): Promise<string> {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    const devServerUrl = `http://localhost:${options.port}`;

    const launchOptions: PuppeteerLaunchOptions = {
        headless: true,
        args: LAUNCH_ARGS,
        executablePath: options.puppeteerPath ?? resolveChromePathOrThrow(),
    };

    const browser = await puppeteer.launch(launchOptions);

    try {
        const page = await browser.newPage();
        await page.setViewport(options.viewport);

        console.log(`Navigating to ${devServerUrl} (viewport: ${options.viewport.width}x${options.viewport.height})...`);
        // See puppeteer-utils.ts's initBrowser() for why this isn't
        // 'networkidle0' (#458 T5.1 — EffectComposer/OutputPass regression).
        await page.goto(devServerUrl, { waitUntil: 'domcontentloaded' });

        await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
        console.log('Game canvas detected. Waiting for initialization...');
        await new Promise((r) => setTimeout(r, INIT_WAIT_MS));
        // Enter the level with every model in, as a player would through the
        // loading screen — otherwise the shot shows stand-ins.
        await waitForModels(page);

        await page.evaluate(() => {
            const menu = document.getElementById('bs-main-menu');
            if (menu) (menu as HTMLElement).style.display = 'none';
        });
        await new Promise((r) => setTimeout(r, 300));

        for (const command of options.commands) {
            console.log(`Executing command: ${command}`);
            await page.evaluate(
                (cmd: string) => {
                    if (typeof (window as any).__gameConsole === 'function') {
                        return (window as any).__gameConsole(cmd);
                    } else {
                        console.warn('__gameConsole not available');
                    }
                },
                command,
            );
            await new Promise((r) => setTimeout(r, COMMAND_WAIT_MS));
        }

        // Frame a feature (an entity, a ramp) instead of the whole-site default view.
        if (options.focus || options.focusEntity || options.orbit) {
            await page.evaluate((focus, focusEntity, orbit) => {
                const w = window as unknown as {
                    __cameraFocus?: (x: number, z: number, d: number) => void;
                    __cameraOrbit?: (yaw: number, pitch: number) => void;
                    __entityWorldPosition?: (kind: string, id: number) => { x: number; z: number } | null;
                };
                if (focus) w.__cameraFocus?.(focus.x, focus.z, focus.distance);
                if (focusEntity) {
                    const pos = w.__entityWorldPosition?.(focusEntity.kind, focusEntity.id);
                    if (pos) w.__cameraFocus?.(pos.x, pos.z, focusEntity.distance);
                    else console.warn(`focus-entity: ${focusEntity.kind} ${focusEntity.id} is not rendered`);
                }
                if (orbit) w.__cameraOrbit?.(orbit.yaw, orbit.pitch);
            }, options.focus ?? null, options.focusEntity ?? null, options.orbit ?? null);
            await new Promise((r) => setTimeout(r, COMMAND_WAIT_MS));
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${options.name}-${timestamp}.png`;
        const filepath = resolve(SCREENSHOTS_DIR, filename);

        await captureFrame(page, filepath);
        console.log(`Screenshot saved: ${filepath}`);

        return filepath;
    } finally {
        await browser.close();
    }
}

const options = parseArgs();
captureScreenshot(options)
    .then((path) => {
        console.log(`Done. Screenshot at: ${path}`);
        process.exit(0);
    })
    .catch((err) => {
        console.error('Screenshot failed:', err);
        process.exit(1);
    });
