// @vitest-environment jsdom
// BlastSimulator2026 — probeTutorialState, the harness's view of the tutorial
//
// Backs window.__tutorialState (main.ts) so a scenario can tell a completed
// step from a silently stuck one. It had no test: the module sat under
// vitest.config.ts's `src/ui/**` coverage exclusion, and its sibling
// uiActionProbe.ts is the only half of that pair anything asserted.
//
// What matters here is the parsing, because the probe reads the rendered
// counter ("3 / 12") rather than the tutorial's own index — so a missing or
// malformed counter must degrade to a defined answer (-1 / null / 0) rather
// than NaN, which a scenario would compare against and silently pass.

import { describe, it, expect, beforeEach } from 'vitest';
import { probeTutorialState } from '../../../src/ui/tutorialStateProbe.js';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import type { TutorialOverlay } from '../../../src/ui/TutorialOverlay.js';

/** The three things the probe asks the overlay for, without building a real one. */
function fakeOverlay(over: Partial<{
  isActive: boolean;
  stageProgress: { index: number; total: number; target: string | null };
}> = {}): TutorialOverlay {
  return {
    isActive: over.isActive ?? true,
    stageProgress: over.stageProgress ?? { index: 0, total: 1, target: null },
  } as unknown as TutorialOverlay;
}

/** Renders the DOM the probe scrapes: the title, the "n / total" counter, the paused badge. */
function renderTutorialDom(opts: { title?: string; counter?: string; pausedDisplay?: string | null } = {}): void {
  document.body.replaceChildren();
  const box = document.createElement('div');
  box.className = 'bs-tutorial-box';
  if (opts.title !== undefined) {
    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = opts.title;
    box.appendChild(title);
  }
  document.body.appendChild(box);

  if (opts.counter !== undefined) {
    const counter = document.createElement('div');
    counter.className = 'bs-tutorial-progress';
    counter.textContent = opts.counter;
    document.body.appendChild(counter);
  }
  if (opts.pausedDisplay !== null && opts.pausedDisplay !== undefined) {
    const paused = document.createElement('div');
    paused.className = 'bs-tutorial-paused';
    paused.style.display = opts.pausedDisplay;
    document.body.appendChild(paused);
  }
}

describe('probeTutorialState', () => {
  beforeEach(() => document.body.replaceChildren());

  it('reports the step the rendered counter names, zero-based', () => {
    renderTutorialDom({ title: 'Fire the blast', counter: '3 / 12' });
    const snap = probeTutorialState(fakeOverlay());
    expect(snap.stepIndex).toBe(2);
    expect(snap.total).toBe(12);
    expect(snap.title).toBe('Fire the blast');
  });

  it('resolves the step id from the index, so a scenario can name the step', () => {
    renderTutorialDom({ counter: '1 / 12' });
    expect(probeTutorialState(fakeOverlay()).stepId).toBe(TUTORIAL_STEPS[0]!.id);
  });

  it('tolerates whitespace around the separator', () => {
    renderTutorialDom({ counter: '4/9' });
    const snap = probeTutorialState(fakeOverlay());
    expect(snap.stepIndex).toBe(3);
    expect(snap.total).toBe(9);
  });

  // The degradation that matters: no counter must not produce NaN, which a
  // scenario assertion would compare against and quietly pass.
  it('answers -1 / null / 0 when the counter is absent', () => {
    renderTutorialDom({ title: 'Anything' });
    const snap = probeTutorialState(fakeOverlay());
    expect(snap.stepIndex).toBe(-1);
    expect(snap.stepId).toBeNull();
    expect(snap.total).toBe(0);
    expect(Number.isNaN(snap.stepIndex)).toBe(false);
  });

  it('answers the same way for a counter that does not parse', () => {
    renderTutorialDom({ counter: 'loading…' });
    const snap = probeTutorialState(fakeOverlay());
    expect(snap).toMatchObject({ stepIndex: -1, stepId: null, total: 0 });
  });

  it('reports an empty title when the tutorial box has no title element', () => {
    renderTutorialDom({ counter: '1 / 3' });
    expect(probeTutorialState(fakeOverlay()).title).toBe('');
  });

  it('returns null for a step index past the end of the step list', () => {
    renderTutorialDom({ counter: `${TUTORIAL_STEPS.length + 5} / ${TUTORIAL_STEPS.length}` });
    expect(probeTutorialState(fakeOverlay()).stepId).toBeNull();
  });

  it('passes the overlay stage progress straight through', () => {
    renderTutorialDom({ counter: '2 / 12' });
    const snap = probeTutorialState(fakeOverlay({
      stageProgress: { index: 1, total: 3, target: '#bs-survey-run' },
    }));
    expect(snap).toMatchObject({ stageIndex: 1, stageTotal: 3, stageTarget: '#bs-survey-run' });
  });

  it('mirrors the overlay active flag', () => {
    renderTutorialDom({ counter: '1 / 3' });
    expect(probeTutorialState(fakeOverlay({ isActive: false })).active).toBe(false);
    expect(probeTutorialState(fakeOverlay({ isActive: true })).active).toBe(true);
  });

  describe('clockHeld', () => {
    it('is false when no paused badge is rendered', () => {
      renderTutorialDom({ counter: '1 / 3', pausedDisplay: null });
      expect(probeTutorialState(fakeOverlay()).clockHeld).toBe(false);
    });

    it('is false when the badge exists but is hidden', () => {
      renderTutorialDom({ counter: '1 / 3', pausedDisplay: 'none' });
      expect(probeTutorialState(fakeOverlay()).clockHeld).toBe(false);
    });

    it('is true when the badge is shown', () => {
      renderTutorialDom({ counter: '1 / 3', pausedDisplay: 'flex' });
      expect(probeTutorialState(fakeOverlay()).clockHeld).toBe(true);
    });
  });
});
