// BlastSimulator2026 — Chrome/Chromium resolution for the visual channel
// The visual verification channel is unusable when the browser cannot be found,
// so resolution must cover every sandbox layout the project runs in.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CHROME_MISSING_HELP, LAUNCH_ARGS, resolveChromePath, resolveChromePathOrThrow } from '../../../scripts/shared/chrome.js';

/**
 * The layout a Playwright cache uses on this OS. The resolver looks for the
 * host's own binaries, so a Linux-only layout is never found on Windows and the
 * test falls through to whatever Chrome the host happens to have installed.
 */
const LINK = process.platform === 'win32' ? 'chromium.exe' : 'chromium';
const BINARY: readonly string[] =
  process.platform === 'win32'
    ? ['chrome-win', 'chrome.exe']
    : process.platform === 'darwin'
      ? ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']
      : ['chrome-linux', 'chrome'];

const created: string[] = [];
const savedEnv = { ...process.env };

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bs-chrome-'));
  created.push(dir);
  return dir;
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  process.env = { ...savedEnv };
});

describe('resolveChromePath', () => {
  it('honours PUPPETEER_EXECUTABLE_PATH when the file exists', () => {
    const root = tempRoot();
    const exe = join(root, 'my-chrome');
    touch(exe);
    process.env.PUPPETEER_EXECUTABLE_PATH = exe;

    expect(resolveChromePath()).toBe(exe);
  });

  it('ignores PUPPETEER_EXECUTABLE_PATH pointing at a missing file', () => {
    const root = tempRoot();
    process.env.PUPPETEER_EXECUTABLE_PATH = join(root, 'absent');

    expect(resolveChromePath()).not.toBe(join(root, 'absent'));
  });

  it('resolves the chromium symlink inside PLAYWRIGHT_BROWSERS_PATH', () => {
    const root = tempRoot();
    const exe = join(root, LINK);
    touch(exe);
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = root;

    expect(resolveChromePath()).toBe(exe);
  });

  it('resolves a revisioned chromium directory inside PLAYWRIGHT_BROWSERS_PATH', () => {
    const root = tempRoot();
    const exe = join(root, 'chromium-1194', ...BINARY);
    touch(exe);
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = root;

    expect(resolveChromePath()).toBe(exe);
  });

  it('prefers the newest revision when several are installed', () => {
    const root = tempRoot();
    touch(join(root, 'chromium-1100', ...BINARY));
    const newest = join(root, 'chromium-1194', ...BINARY);
    touch(newest);
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = root;

    expect(resolveChromePath()).toBe(newest);
  });

  it('tolerates a browser root that does not exist', () => {
    const root = tempRoot();
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, 'nope');

    expect(() => resolveChromePath()).not.toThrow();
  });
});

describe('resolveChromePathOrThrow', () => {
  it('returns the resolved path when a browser exists', () => {
    const root = tempRoot();
    const exe = join(root, LINK);
    touch(exe);
    process.env.PUPPETEER_EXECUTABLE_PATH = exe;

    expect(resolveChromePathOrThrow()).toBe(exe);
  });

  it('reports actionable remediation steps in the failure message', () => {
    expect(CHROME_MISSING_HELP).toContain('puppeteer browsers install chrome');
    expect(CHROME_MISSING_HELP).toContain('PUPPETEER_EXECUTABLE_PATH');
    expect(CHROME_MISSING_HELP).toContain('verify:env');
  });
});

describe('LAUNCH_ARGS', () => {
  it('disables the sandbox so Chromium starts as root in CI containers', () => {
    expect(LAUNCH_ARGS).toContain('--no-sandbox');
    expect(LAUNCH_ARGS).toContain('--disable-setuid-sandbox');
  });
});
