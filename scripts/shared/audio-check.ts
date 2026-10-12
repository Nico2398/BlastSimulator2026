/**
 * BlastSimulator2026 — Scaffolding shared by the audio browser checks
 *
 * `npm run sounds:check` and `npm run audio:smoke` share their exit codes, the headless Chromium they launch and
 * the way they stop: the pieces here, so the two scripts hold only what they check.
 *
 * @module shared/audio-check
 */

import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import { LAUNCH_ARGS, resolveChromePathOrThrow } from './chrome.js';

/** A check ran and found a problem. */
export const EXIT_FAILED = 1;
/** The check could not run at all: no Chromium, no server, bad arguments. */
export const EXIT_COULD_NOT_RUN = 2;

/** Autoplay without a gesture, so the audio context starts and the engine really decodes in a headless run. */
const AUTOPLAY_FLAG = '--autoplay-policy=no-user-gesture-required';

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Print `message` to stderr and end the process with `code`. */
export function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

export const errorText = (error: unknown): string => String(error instanceof Error ? error.message : error);

/** The Chromium to drive, or the process ends with `EXIT_COULD_NOT_RUN` and the remedy. */
export function chromeOrFail(): string {
  try {
    return resolveChromePathOrThrow();
  } catch (error) {
    return fail(errorText(error), EXIT_COULD_NOT_RUN);
  }
}

/** A headless Chromium that lets a page start its audio context without a click. */
export function launchAudioBrowser(executablePath: string): Promise<Browser> {
  return puppeteer.launch({ headless: true, args: [...LAUNCH_ARGS, AUTOPLAY_FLAG], executablePath });
}
