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
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const SCREENSHOTS_DIR = resolve(process.cwd(), 'screenshots');
const INIT_WAIT_MS = 3000;
const COMMAND_WAIT_MS = 500;

interface ScreenshotOptions {
    name: string;
    commands: string[];
    port: number;
    puppeteerPath?: string;
    viewport: { width: number; height: number };
}

function parseArgs(): ScreenshotOptions {
    const args = process.argv.slice(2);
    let name = 'screenshot';
    let commands: string[] = [];
    let port = 5173;
    let puppeteerPath: string | undefined;
    let viewport = { width: 1280, height: 720 };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--name' && args[i + 1]) {
            name = args[i + 1];
            i++;
        } else if (args[i] === '--commands' && args[i + 1]) {
            commands = args[i + 1].split(';').map((c) => c.trim()).filter(Boolean);
            i++;
        } else if (args[i] === '--port' && args[i + 1]) {
            port = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === '--puppeteer-path' && args[i + 1]) {
            puppeteerPath = args[i + 1];
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
        }
    }

    return { name, commands, port, puppeteerPath, viewport };
}

function resolveChromePath(): string | undefined {
    const { existsSync } = require('fs');
    const CANDIDATES = [
        ...(process.platform === 'win32'
            ? [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
                `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
            ]
            : [
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
                '/usr/bin/google-chrome',
                '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
            ]),
    ];
    return CANDIDATES.find((p) => existsSync(p));
}

async function captureScreenshot(options: ScreenshotOptions): Promise<string> {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    const devServerUrl = `http://localhost:${options.port}`;

    const executablePath = options.puppeteerPath
        ?? process.env.PUPPETEER_EXECUTABLE_PATH
        ?? resolveChromePath();

    const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        await page.setViewport(options.viewport);

        console.log(`Navigating to ${devServerUrl} (viewport: ${options.viewport.width}x${options.viewport.height})...`);
        await page.goto(devServerUrl, { waitUntil: 'networkidle0' });

        await page.waitForSelector('#game-canvas, canvas', { timeout: 10000 });
        console.log('Game canvas detected. Waiting for initialization...');
        await new Promise((r) => setTimeout(r, INIT_WAIT_MS));

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
