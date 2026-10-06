// @vitest-environment jsdom
// BlastSimulator2026 — tutorialStepHelpers: UI-action completion steps (#1334)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createUiActionStep, isPanelVisible, readScoresInspectCount,
} from '../../../src/ui/tutorialStepHelpers.js';
import type { UiAction } from '../../../src/ui/tutorialStepHelpers.js';
import type { GameState } from '../../../src/core/state/GameState.js';

const SCORES: UiAction = { kind: 'scores' };
const STATE = { isPaused: false } as GameState;

function addScoresHud(inspectCount?: number): HTMLElement {
  const el = document.createElement('div');
  el.id = 'bs-hud-scores';
  if (inspectCount !== undefined) el.dataset['inspectCount'] = String(inspectCount);
  document.body.appendChild(el);
  return el;
}

function addPanel(id: string, display: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.style.display = display;
  document.body.appendChild(el);
  return el;
}

describe('tutorialStepHelpers UI-action steps (#1334)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  describe('isPanelVisible', () => {
    it('is false when the element is absent', () => {
      expect(isPanelVisible('#bs-finances-panel')).toBe(false);
    });

    it('is false when the root is display:none', () => {
      addPanel('bs-finances-panel', 'none');
      expect(isPanelVisible('#bs-finances-panel')).toBe(false);
    });

    it('is true when the root is displayed', () => {
      addPanel('bs-finances-panel', 'block');
      expect(isPanelVisible('#bs-finances-panel')).toBe(true);
    });

    it('is true when display is unset (default)', () => {
      addPanel('bs-employee-panel', '');
      expect(isPanelVisible('#bs-employee-panel')).toBe(true);
    });

    it('never throws on an invalid selector', () => {
      expect(() => isPanelVisible('###')).not.toThrow();
    });
  });

  describe('readScoresInspectCount', () => {
    it('is 0 when the HUD is absent', () => {
      expect(readScoresInspectCount()).toBe(0);
    });

    it('is 0 when the HUD has no inspectCount yet', () => {
      addScoresHud();
      expect(readScoresInspectCount()).toBe(0);
    });

    it('reads the numeric dataset value', () => {
      addScoresHud(3);
      expect(readScoresInspectCount()).toBe(3);
    });

    it('is 0 for a non-numeric value', () => {
      const el = addScoresHud();
      el.dataset['inspectCount'] = 'abc';
      expect(readScoresInspectCount()).toBe(0);
    });
  });

  describe('createUiActionStep: scores action', () => {
    const make = () => createUiActionStep('scores', 'title.key', 'text.key', SCORES, undefined, '#bs-hud-scores');

    it('carries id, keys and highlight target, and no timer', () => {
      const step = make();
      expect(step.id).toBe('scores');
      expect(step.titleKey).toBe('title.key');
      expect(step.textKey).toBe('text.key');
      expect(step.highlightTarget).toBe('#bs-hud-scores');
      expect(step.autoAdvanceMs).toBeUndefined();
    });

    it('is not complete on a DOM-less run and never throws', () => {
      const step = make();
      const snap = step.captureSnapshot ? step.captureSnapshot(STATE) : {};
      expect(() => step.isComplete(STATE, snap)).not.toThrow();
      expect(step.isComplete(STATE, snap)).toBe(false);
      expect(step.isComplete(STATE, {})).toBe(false);
    });

    it('is not complete while inspectCount equals the snapshot', () => {
      addScoresHud(2);
      const step = make();
      const snap = step.captureSnapshot!(STATE);
      expect(step.isComplete(STATE, snap)).toBe(false);
    });

    it('completes only when inspectCount rises above the snapshot', () => {
      const hud = addScoresHud(2);
      const step = make();
      const snap = step.captureSnapshot!(STATE);
      hud.dataset['inspectCount'] = '3';
      expect(step.isComplete(STATE, snap)).toBe(true);
    });

    it('does not complete when the count was already high before the step opened', () => {
      addScoresHud(5);
      const step = make();
      const snap = step.captureSnapshot!(STATE);
      expect(step.isComplete(STATE, snap)).toBe(false);
    });

    it('keeps the caller-supplied snapshot fields alongside its own', () => {
      addScoresHud(1);
      const step = createUiActionStep(
        'scores', 't', 'x', { kind: 'scores' }, () => ({ cash: 7 }),
      );
      const snap = step.captureSnapshot!(STATE);
      expect(snap['cash']).toBe(7);
    });
  });

  describe('createUiActionStep: panel action', () => {
    const make = (root: string) => createUiActionStep('p', 't', 'x', { kind: 'panel', rootSelector: root });

    it('is not complete on a DOM-less run and never throws', () => {
      const step = make('#bs-finances-panel');
      expect(() => step.isComplete(STATE, {})).not.toThrow();
      expect(step.isComplete(STATE, {})).toBe(false);
    });

    it('is not complete while the panel root is display:none', () => {
      addPanel('bs-finances-panel', 'none');
      expect(make('#bs-finances-panel').isComplete(STATE, {})).toBe(false);
    });

    it('completes while the finances panel is displayed', () => {
      addPanel('bs-finances-panel', 'block');
      expect(make('#bs-finances-panel').isComplete(STATE, {})).toBe(true);
    });

    it('completes while the employee panel is displayed', () => {
      addPanel('bs-employee-panel', 'block');
      expect(make('#bs-employee-panel').isComplete(STATE, {})).toBe(true);
    });

    it('does not complete from an unrelated panel being open', () => {
      addPanel('bs-employee-panel', 'block');
      expect(make('#bs-finances-panel').isComplete(STATE, {})).toBe(false);
    });
  });
});
