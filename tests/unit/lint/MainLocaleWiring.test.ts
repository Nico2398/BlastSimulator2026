// BlastSimulator2026 — main.ts language-change wiring (issue #492 section 3)
//
// main.ts fans a language switch out to every panel's own refreshLocale()
// from two symmetric call sites: uiManager.setLanguageChangeHandler(...)
// (settings panel switch) and mainMenu.setOnLanguageChange(...) (main-menu
// pill switch). ~25 panels are already wired into both; `tutorial` (the
// TutorialOverlay instance) is not, so a language switch made mid-tutorial
// never reaches the coach card. Constructing main.ts directly in a unit test
// isn't practical — it wires up a full SceneManager/Three.js canvas, audio,
// and IndexedDB persistence as import-time side effects — so this is a
// static-source check on the two handler bodies rather than a runtime one.
// TutorialOverlay's own refreshLocale() behavior (the chip/title/text
// actually updating) is covered directly in TutorialOverlay.test.ts; this
// test only proves the call site exists in main.ts's fan-out lists.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const MAIN_TS_PATH = join(ROOT, 'src/main.ts');

/** Extract the body of `<marker>(() => { ... });` — non-greedy up to the first `});`. */
function extractHandlerBody(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) throw new Error(`marker not found in src/main.ts: ${marker}`);
  const bodyStart = idx + marker.length;
  const bodyEnd = source.indexOf('});', bodyStart);
  if (bodyEnd === -1) throw new Error(`no closing "});" found for marker: ${marker}`);
  return source.slice(bodyStart, bodyEnd);
}

describe('src/main.ts — TutorialOverlay is included in the language-change fan-out (issue #492 section 3)', () => {
  const source = readFileSync(MAIN_TS_PATH, 'utf8');

  it('uiManager.setLanguageChangeHandler(...) calls tutorial.refreshLocale()', () => {
    const body = extractHandlerBody(source, 'uiManager.setLanguageChangeHandler(() => {');
    expect(body).toContain('tutorial.refreshLocale()');
  });

  it('mainMenu.setOnLanguageChange(...) calls tutorial.refreshLocale()', () => {
    const body = extractHandlerBody(source, 'mainMenu.setOnLanguageChange(() => {');
    expect(body).toContain('tutorial.refreshLocale()');
  });

  it('sanity: both marker call sites are still present in src/main.ts (guards against the scanner silently finding nothing)', () => {
    expect(source).toContain('uiManager.setLanguageChangeHandler(() => {');
    expect(source).toContain('mainMenu.setOnLanguageChange(() => {');
  });
});
