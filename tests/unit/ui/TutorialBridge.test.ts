// Tutorial Bridge — window.__startTutorial visual-testing bridge (#383)
// Verifies that the browser entry point exposes __startTutorial on the
// window global so Puppeteer scenario tests can start the tutorial
// overlay programmatically via __gameConsole interactions.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const MAIN_TS = resolve(currentDir, '../../../src/main.ts');

function readMainSource(): string {
  return readFileSync(MAIN_TS, 'utf-8');
}

describe('Tutorial Bridge — window.__startTutorial', () => {
  it('main.ts has a declare global block with __startTutorial type', () => {
    const src = readMainSource();
    // The global augmentation must declare __startTutorial on Window
    expect(src).toMatch(/__startTutorial\s*:\s*\(\)\s*=>\s*void/);
  });

  it('main.ts contains a runtime assignment of window.__startTutorial (not a skeleton comment)', () => {
    const src = readMainSource();
    // Must have an actual assignment — not just the skeleton placeholder
    expect(src).not.toMatch(
      /\/\/\s*SKELETON.*__startTutorial/,
      'src/main.ts still contains the SKELETON comment placeholder for __startTutorial',
    );
    // Must contain the real assignment pattern
    expect(src).toMatch(
      /window\.__startTutorial\s*=/,
      'src/main.ts is missing the runtime assignment: window.__startTutorial = ...',
    );
  });

  it('window.__startTutorial is assigned a no-argument function', () => {
    const src = readMainSource();
    // Extract the assignment line and verify it's a function
    const match = src.match(
      /window\.__startTutorial\s*=\s*((?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>)/,
    );
    expect(match).not.toBeNull();
  });

  it('window.__startTutorial delegates to tutorial.start()', () => {
    const src = readMainSource();
    // The bridge must call tutorial.start() so Puppeteer can trigger the overlay
    expect(src).toMatch(
      /window\.__startTutorial[\s\S]{0,200}?tutorial\.start\(/,
      'window.__startTutorial must call tutorial.start()',
    );
  });
});
