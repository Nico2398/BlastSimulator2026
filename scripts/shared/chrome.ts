/**
 * BlastSimulator2026 — Shared Chrome/Chromium utilities
 *
 * Common logic for resolving the Chrome/Chromium executable path and
 * recommended launch arguments, used by scenario-test and visual testing
 * infrastructure.
 *
 * @module shared/chrome
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';

/**
 * Recommended launch arguments for Puppeteer/Chromium.
 */
export const LAUNCH_ARGS: string[] = ['--no-sandbox', '--disable-setuid-sandbox'];

/**
 * Browser cache roots that ship a Playwright-style layout
 * (`<root>/chromium-<rev>/chrome-linux/chrome`).
 *
 * `PLAYWRIGHT_BROWSERS_PATH` is set by pre-provisioned agent sandboxes
 * (Claude Code on the web installs Chromium at `/opt/pw-browsers`).
 */
function playwrightRoots(): string[] {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    process.platform === 'win32'
      ? `${process.env.LOCALAPPDATA}\\ms-playwright`
      : process.platform === 'darwin'
        ? `${process.env.HOME}/Library/Caches/ms-playwright`
        : `${process.env.HOME}/.cache/ms-playwright`,
    '/root/.cache/ms-playwright',
  ];
  return roots.filter((r): r is string => Boolean(r) && r !== '0');
}

/**
 * Expands a Playwright-style browser cache root into concrete executable
 * candidates. Handles both the `chromium` convenience symlink and the
 * revisioned `chromium-<rev>` / `chromium_headless_shell-<rev>` directories.
 */
function expandPlaywrightRoot(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const binaries =
    process.platform === 'win32'
      ? ['chrome-win\\chrome.exe']
      : process.platform === 'darwin'
        ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium']
        : ['chrome-linux/chrome', 'chrome-linux/headless_shell'];

  // The bare `<root>/chromium` entry is a direct symlink to the executable.
  const candidates: string[] = [join(root, process.platform === 'win32' ? 'chromium.exe' : 'chromium')];

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return candidates;
  }

  // Newest revision first — directory names sort lexically, revisions are numeric-suffixed.
  const revisioned = entries.filter((e) => e.startsWith('chromium')).sort().reverse();
  for (const entry of revisioned) {
    const dir = join(root, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const binary of binaries) {
      candidates.push(join(dir, binary));
    }
  }

  return candidates;
}

/**
 * Resolves the Chrome/Chromium executable path from well-known locations.
 *
 * Resolution order:
 * 1. `PUPPETEER_EXECUTABLE_PATH` (explicit override)
 * 2. Puppeteer's own cached browser (via `puppeteer.executablePath()`)
 * 3. System-installed Chrome/Chromium paths
 * 4. Playwright-style browser caches, including `PLAYWRIGHT_BROWSERS_PATH`
 *
 * @returns The path if found, or undefined.
 */
export function resolveChromePath(): string | undefined {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // Dynamic candidate: Puppeteer's own cached browser
  const dynamicCandidates: string[] = [];
  try {
    const puppeteer = createRequire(import.meta.url)('puppeteer') as {
      executablePath: () => string;
    };
    const pptrPath = puppeteer.executablePath();
    if (pptrPath && typeof pptrPath === 'string') {
      dynamicCandidates.push(pptrPath);
    }
  } catch {
    // Puppeteer not available or Chrome not downloaded — fall through
  }

  const systemCandidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
          ];

  const cacheCandidates = playwrightRoots().flatMap(expandPlaywrightRoot);

  const candidates = [...dynamicCandidates, ...systemCandidates, ...cacheCandidates];
  return candidates.find((p) => existsSync(p));
}

/**
 * Human-readable remediation steps, printed when no browser can be found.
 * Keeps the failure actionable for autonomous agents.
 */
export const CHROME_MISSING_HELP = [
  'No Chrome/Chromium executable found. Fix with one of:',
  '  1. npx puppeteer browsers install chrome',
  '  2. export PUPPETEER_EXECUTABLE_PATH=/path/to/chrome',
  '  3. pass --puppeteer-path /path/to/chrome',
  'Run `npm run verify:env` to see which verification channels are available.',
].join('\n');

/**
 * Resolves the Chrome/Chromium executable path, throwing an actionable error
 * when none is available.
 *
 * @returns The resolved executable path.
 */
export function resolveChromePathOrThrow(): string {
  const path = resolveChromePath();
  if (!path) {
    throw new Error(CHROME_MISSING_HELP);
  }
  return path;
}
