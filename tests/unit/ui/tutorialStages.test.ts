// BlastSimulator2026 — Tutorial stage table
//
// A stage selector that matches nothing strands the player: the guide blocks
// every control and highlights none, with no way forward and no Skip button to
// escape with. These tests are the guard against that.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { TUTORIAL_STAGES, stagesFor } from '../../../src/ui/tutorialStages.js';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import { TOOLBAR_TARGET } from '../../../src/ui/tutorialStepHelpers.js';
import en from '../../../src/core/i18n/locales/en.json' with { type: 'json' };
import fr from '../../../src/core/i18n/locales/fr.json' with { type: 'json' };

const UI_DIR = resolve(import.meta.dirname, '../../../src/ui');

/** Every .ts source in src/ui, concatenated — where selectors are produced. */
const UI_SOURCE = readdirSync(UI_DIR)
  .filter(f => f.endsWith('.ts'))
  .map(f => readFileSync(resolve(UI_DIR, f), 'utf-8'))
  .join('\n');

const messages = en as Record<string, string>;
const messagesFr = fr as Record<string, string>;

/**
 * The identifying tokens of a selector: ids, classes and data-attribute values.
 * Each must appear somewhere in the UI source, or nothing will ever match it.
 */
function selectorTokens(selector: string): string[] {
  const tokens: string[] = [];
  for (const m of selector.matchAll(/#([\w-]+)/g)) tokens.push(m[1]!);
  for (const m of selector.matchAll(/\.([\w-]+)/g)) tokens.push(m[1]!);
  for (const m of selector.matchAll(/\[data-[\w-]+="([^"]+)"\]/g)) tokens.push(m[1]!);
  return tokens;
}

const ALL_STAGES = Object.entries(TUTORIAL_STAGES)
  .flatMap(([stepId, stages]) => stages.map((stage, i) => ({ stepId, i, stage })));

describe('tutorial stage table', () => {
  it('every keyed step id is a real tutorial step', () => {
    const known = new Set(TUTORIAL_STEPS.map(s => s.id));
    for (const stepId of Object.keys(TUTORIAL_STAGES)) {
      expect(known.has(stepId), `"${stepId}" is not a tutorial step`).toBe(true);
    }
  });

  it('every step the player must act on has stages', () => {
    // Auto-advancing and terminal cards are the only ones allowed to have none.
    for (const step of TUTORIAL_STEPS) {
      const isPassive = step.autoAdvanceMs !== undefined
        || step.id === 'victory' || step.id === 'congratulations';
      if (isPassive) continue;
      expect(
        stagesFor(step.id, step.highlightTarget).length,
        `step "${step.id}" gives the player nothing to click`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(ALL_STAGES)('$stepId stage $i targets a selector the UI produces', ({ stage }) => {
    for (const token of selectorTokens(stage.target)) {
      expect(UI_SOURCE.includes(token), `nothing in src/ui produces "${token}"`).toBe(true);
    }
  });

  it.each(ALL_STAGES)('$stepId stage $i helper selectors exist too', ({ stage }) => {
    for (const selector of stage.also ?? []) {
      for (const token of selectorTokens(selector)) {
        expect(UI_SOURCE.includes(token), `nothing in src/ui produces "${token}"`).toBe(true);
      }
    }
  });

  it.each(ALL_STAGES)('$stepId stage $i has an English instruction', ({ stage }) => {
    expect(messages[stage.hintKey], `missing en key ${stage.hintKey}`).toBeTruthy();
  });

  it.each(ALL_STAGES)('$stepId stage $i has a French instruction', ({ stage }) => {
    expect(messagesFr[stage.hintKey], `missing fr key ${stage.hintKey}`).toBeTruthy();
  });

  it('no stage repeats the selector of the stage before it', () => {
    for (const [stepId, stages] of Object.entries(TUTORIAL_STAGES)) {
      for (let i = 1; i < stages.length; i++) {
        expect(
          stages[i]!.target,
          `${stepId} stage ${i} repeats stage ${i - 1}, so it can never advance`,
        ).not.toBe(stages[i - 1]!.target);
      }
    }
  });

  it('the stage that asks for an exact selection names the coordinates', () => {
    // "Drag a rectangle over the middle of the map" is not an answer when only
    // one rectangle will be accepted. Checked on the stage that asks for the
    // selection — the Confirm stage that follows it just says "Press Confirm".
    for (const { stepId, stage } of ALL_STAGES) {
      if (!stage.region?.exact || !stage.target.includes('canvas')) continue;
      const text = messages[stage.hintKey] ?? '';
      for (const token of ['{x1}', '{z1}', '{x2}', '{z2}']) {
        expect(
          text.includes(token),
          `${stepId}: exact stage hint must name ${token}`,
        ).toBe(true);
      }
      expect(messagesFr[stage.hintKey] ?? '').toContain('{x1}');
    }
  });

  it('a region is a well-formed rectangle', () => {
    for (const { stepId, stage } of ALL_STAGES) {
      const r = stage.region;
      if (!r) continue;
      expect(r.x2, `${stepId} region x`).toBeGreaterThanOrEqual(r.x1);
      expect(r.z2, `${stepId} region z`).toBeGreaterThanOrEqual(r.z1);
      expect(r.x1).toBeGreaterThanOrEqual(0);
      expect(r.z1).toBeGreaterThanOrEqual(0);
    }
  });

  it('the grid tool demands an exact rectangle', () => {
    const canvasStage = TUTORIAL_STAGES['drill-plan']!
      .find(s => s.target.includes('canvas'))!;
    expect(canvasStage.region?.exact).toBe(true);
  });

  it('multi-click steps really do have more than one stage', () => {
    // Every one of these opens a panel before acting in it. A single stage here
    // is the bug this whole table exists to fix.
    for (const stepId of [
      'hire-surveyor', 'survey', 'drill-plan', 'blast', 'contract-accept',
      'vehicle-buy-assign', 'build-storage', 'haul-debris', 'build-ramp', 'set-policy',
    ]) {
      expect(TUTORIAL_STAGES[stepId]!.length, `${stepId} should be multi-stage`)
        .toBeGreaterThan(1);
    }
  });
});

describe('haul-debris stage list (#466)', () => {
  it('is a two-stage Vehicles-only sequence: open the toolbar, then use the Haul button', () => {
    const stages = TUTORIAL_STAGES['haul-debris'];
    expect(stages, 'TUTORIAL_STAGES is missing a "haul-debris" entry').toBeDefined();
    expect(stages).toHaveLength(2);
    expect(stages![0]!.target).toBe(TOOLBAR_TARGET.vehicles);
    expect(stages![1]!.target).toBe('#bs-vehicle-panel .bs-vehicle-haul-btn');
  });
});

describe('stagesFor', () => {
  it('falls back to the step highlight target when no stages are keyed', () => {
    const stages = stagesFor('not-a-step', '#bs-toolbar [data-panel="blast"]');
    expect(stages).toHaveLength(1);
    expect(stages[0]!.target).toBe('#bs-toolbar [data-panel="blast"]');
  });

  it('returns nothing when there is neither a table entry nor a target', () => {
    expect(stagesFor('not-a-step')).toEqual([]);
  });

  it('prefers the table over the step highlight target', () => {
    const stages = stagesFor('survey', '#ignored');
    expect(stages.length).toBeGreaterThan(1);
    expect(stages[0]!.target).not.toBe('#ignored');
  });
});
