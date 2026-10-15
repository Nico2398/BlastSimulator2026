// BlastSimulator2026 — the tutorial trains through the employee inspector (#1763).
//
// The Crew roster's inline expansion retires in #1765; the inspector holds the
// same detail. No tutorial source or tutorial scenario may reach the train
// button or the in-training marker through #bs-employee-panel.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../../..');
const UI_DIR = resolve(ROOT, 'src/ui');
const SCENARIO_DIR = resolve(ROOT, 'scripts/scenario-defs');

const files = [
  ...readdirSync(UI_DIR).filter(f => /^tutorial.*\.ts$/.test(f)).map(f => resolve(UI_DIR, f)),
  ...readdirSync(SCENARIO_DIR).filter(f => /^tutorial-.*\.json$/.test(f)).map(f => resolve(SCENARIO_DIR, f)),
];

/** Lines (or JSON selector strings) that pair the crew panel with a train control. */
function offenders(text: string): string[] {
  return text.split('\n').filter(l =>
    l.includes('bs-employee-panel') && (l.includes('.bs-train-btn') || l.includes('.bs-training-active')));
}

describe('tutorial reaches train controls through the inspector, not the crew panel (#1763)', () => {
  it('scans tutorial sources and scenarios', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map(f => [f.slice(ROOT.length + 1), f]))('%s', (_name, f) => {
    expect(offenders(readFileSync(f as string, 'utf8'))).toEqual([]);
  });

  it('the train-fragmenter stage targets #bs-inspector', () => {
    const src = readFileSync(resolve(UI_DIR, 'tutorialStagesTraining.ts'), 'utf8');
    expect(src).toContain('#bs-inspector');
  });
});
