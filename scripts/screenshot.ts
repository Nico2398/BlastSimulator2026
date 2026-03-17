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
 *
 * Screenshots are saved to: screenshots/{name}-{timestamp}.png
 *
 * Prerequisites:
 *   npm install puppeteer --save-dev
 *   The dev server must be running: npm run dev (in another terminal or background)
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const SCREENSHOTS_DIR = resolve(process.cwd(), 'screenshots');
const DEV_SERVER_URL = 'http://localhost:5173';
const VIEWPORT = { width: 1280, height: 720 };
const INIT_WAIT_MS = 3000;
const COMMAND_WAIT_MS = 500;

interface ScreenshotOptions {
    name: string;
    commands: string[];
}

function parseArgs(): ScreenshotOptions {
    const args = process.argv.slice(2);
    let name = 'screenshot';
    let commands: string[] = [];

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--name' && args[i + 1]) {
            name = args[i + 1];
            i++;
        } else if (args[i] === '--commands' && args[i + 1]) {
            commands = args[i + 1].split(';').map((c) => c.trim()).filter(Boolean);
            i++;
        }
    }

    return { name, commands };
}

async function captureScreenshot(options: ScreenshotOptions): Promise<string> {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    // Use system Chromium if puppeteer's bundled Chrome is not available
    const CHROMIUM_PATHS = [
        '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
    ];
    const { existsSync } = await import('fs');
    const executablePath = CHROMIUM_PATHS.find((p) => existsSync(p));

    const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        await page.setViewport(VIEWPORT);

        console.log(`Navigating to ${DEV_SERVER_URL}...`);
        await page.goto(DEV_SERVER_URL, { waitUntil: 'networkidle0' });

        // Wait for game canvas to appear
        await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
        console.log('Game canvas detected. Waiting for initialization...');
        await new Promise((r) => setTimeout(r, INIT_WAIT_MS));

        // Execute console commands if any
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

        // Capture screenshot
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${options.name}-${timestamp}.png`;
        const filepath = resolve(SCREENSHOTS_DIR, filename);

        await page.screenshot({ path: filepath, fullPage: false });
        console.log(`Screenshot saved: ${filepath}`);

        return filepath;
    } finally {
        await browser.close();
    }
}

// Main
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
