/**
 * BlastSimulator2026 — Shared Chrome/Chromium utilities
 *
 * Common logic for resolving the Chrome/Chromium executable path and
 * recommended launch arguments, used by scenario-test and visual testing
 * infrastructure.
 *
 * @module shared/chrome
 */

import { existsSync } from 'fs';
import { createRequire } from 'module';

/**
 * Recommended launch arguments for Puppeteer/Chromium.
 */
export const LAUNCH_ARGS: string[] = ['--no-sandbox', '--disable-setuid-sandbox'];

/**
 * Resolves the Chrome/Chromium executable path from well-known locations.
 *
 * Resolution order:
 * 1. Puppeteer's own cached browser (via `puppeteer.executablePath()`)
 * 2. System-installed Chrome/Chromium paths
 * 3. Playwright cache paths
 *
 * @returns The path if found, or undefined.
 */
export function resolveChromePath(): string | undefined {
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

  const staticCandidates = [
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

  const candidates = [...dynamicCandidates, ...staticCandidates];
  return candidates.find((p) => existsSync(p));
}
