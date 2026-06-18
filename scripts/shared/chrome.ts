/**
 * BlastSimulator2026 — Shared Chrome/Chromium utilities
 *
 * Common logic for resolving the Chrome/Chromium executable path and
 * recommended launch arguments, used by both interaction-recorder and
 * interaction-replay.
 *
 * @module shared/chrome
 */

import { existsSync } from 'fs';

/**
 * Recommended launch arguments for Puppeteer/Chromium.
 */
export const LAUNCH_ARGS: string[] = ['--no-sandbox', '--disable-setuid-sandbox'];

/**
 * Resolves the Chrome/Chromium executable path from well-known locations.
 * @returns The path if found, or undefined.
 */
export function resolveChromePath(): string | undefined {
  const candidates = [
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
  return candidates.find((p) => existsSync(p));
}
