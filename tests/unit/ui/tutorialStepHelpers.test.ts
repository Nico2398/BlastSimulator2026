// @vitest-environment jsdom
// BlastSimulator2026 — tutorialStepHelpers: UI-action completion steps (#1334)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createUiActionStep, isPanelVisible, readPanelOpenCount, readScoresInspectCount, createEvacuateZoneStep,
} from '../../../src/ui/tutorialStepHelpers.js';
import type { TutorialUiAction } from '../../../src/ui/tutorialStepHelpers.js';
import type { GameState } from '../../../src/core/state/GameState.js';

const SCORES: TutorialUiAction = { kind: 'scores' };
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
      expect('autoAdvanceMs' in step).toBe(false);
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

    it('completes on a click after a resume restored a snapshot above the reset DOM count', () => {
      const hud = addScoresHud(0); // TopBar reset the counter on page load
      const step = make();
      const staleSnap = { inspectCount: 5 }; // persisted before the reload
      expect(step.isComplete(STATE, staleSnap)).toBe(false);
      hud.dataset['inspectCount'] = '1';
      expect(step.isComplete(STATE, staleSnap)).toBe(true);
    });

    it('stores inspectCount in the snapshot only for the scores action', () => {
      addScoresHud(4);
      const panel = createUiActionStep('p', 't', 'x', { kind: 'panel', rootSelector: '#a' });
      expect('inspectCount' in panel.captureSnapshot!(STATE)).toBe(false);
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

    it('completes on open (snapshot captured hidden): finances panel', () => {
      addPanel('bs-finances-panel', 'block');
      expect(make('#bs-finances-panel').isComplete(STATE, { panelWasVisible: false })).toBe(true);
    });

    it('completes on open (snapshot captured hidden): employee panel', () => {
      addPanel('bs-employee-panel', 'block');
      expect(make('#bs-employee-panel').isComplete(STATE, { panelWasVisible: false })).toBe(true);
    });

    it('does not complete from an unrelated panel being open', () => {
      addPanel('bs-employee-panel', 'block');
      expect(make('#bs-finances-panel').isComplete(STATE, {})).toBe(false);
    });
  });
});

describe('createEvacuateZoneStep completes on the real fire, not on arming (#1591)', () => {
  const step = createEvacuateZoneStep();
  const ARMED = { armedTick: 0, strandedEmployeeIds: [], strandedVehicleIds: [], lastEvacuationTick: 0 };
  const make = (blasts: number, armed: boolean): GameState => ({
    levelStats: { blastsPerformed: blasts },
    pendingDetonation: armed ? ARMED : null,
  }) as unknown as GameState;

  it('is not complete when only a detonation is armed', () => {
    const snapshot = step.captureSnapshot!(make(0, false));
    expect(step.isComplete(make(0, true), snapshot)).toBe(false);
  });

  it('is not complete while idle', () => {
    const snapshot = step.captureSnapshot!(make(2, false));
    expect(step.isComplete(make(2, false), snapshot)).toBe(false);
  });

  it('is complete once blastsPerformed exceeds the snapshot', () => {
    const snapshot = step.captureSnapshot!(make(2, false));
    expect(step.isComplete(make(3, false), snapshot)).toBe(true);
  });

  it('is complete after the fire even when a detonation is still recorded as armed', () => {
    const snapshot = step.captureSnapshot!(make(0, false));
    expect(step.isComplete(make(1, true), snapshot)).toBe(true);
  });

  it('with no prevBlasts in the snapshot and 0 blasts, is not complete', () => {
    expect(step.isComplete(make(0, false), {})).toBe(false);
    expect(step.isComplete(make(0, true), {})).toBe(false);
  });

  describe('createUiActionStep: panel action needs a fresh open (#1595)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { document.body.innerHTML = ''; });
    const make = (root: string) => createUiActionStep('p', 't', 'x', { kind: 'panel', rootSelector: root });

    it('does not complete when the panel is already visible at capture', () => {
      addPanel('bs-finances-panel', 'block');
      const step = make('#bs-finances-panel');
      const snap = step.captureSnapshot!(STATE);
      expect(step.isComplete(STATE, snap)).toBe(false);
    });

    it('still not complete while the panel stays open across repeated checks', () => {
      addPanel('bs-finances-panel', 'block');
      const step = make('#bs-finances-panel');
      const snap = step.captureSnapshot!(STATE);
      for (let i = 0; i < 3; i++) expect(step.isComplete(STATE, snap)).toBe(false);
    });

    it('completes after the panel is hidden and then shown again', () => {
      const panel = addPanel('bs-finances-panel', 'block');
      const step = make('#bs-finances-panel');
      const snap = step.captureSnapshot!(STATE);
      expect(step.isComplete(STATE, snap)).toBe(false);
      panel.style.display = 'none';
      expect(step.isComplete(STATE, snap)).toBe(false);
      panel.style.display = 'block';
      expect(step.isComplete(STATE, snap)).toBe(true);
    });

    it('completes when the panel was closed at capture and then opened', () => {
      const panel = addPanel('bs-employee-panel', 'none');
      const step = make('#bs-employee-panel');
      const snap = step.captureSnapshot!(STATE);
      expect(step.isComplete(STATE, snap)).toBe(false);
      panel.style.display = 'block';
      expect(step.isComplete(STATE, snap)).toBe(true);
    });

    it('isComplete mutates only its own snapshot, not a sibling step\'s', () => {
      addPanel('bs-finances-panel', 'block');
      const a = make('#bs-finances-panel');
      const b = make('#bs-finances-panel');
      const snapA = a.captureSnapshot!(STATE);
      const snapB = b.captureSnapshot!(STATE);
      const panel = document.getElementById('bs-finances-panel')!;
      panel.style.display = 'none';
      expect(a.isComplete(STATE, snapA)).toBe(false);
      expect(snapA['panelWasVisible']).toBe(false);
      expect(snapB['panelWasVisible']).toBe(true);
      panel.style.display = 'block';
      expect(b.isComplete(STATE, snapB)).toBe(false);
      expect(a.isComplete(STATE, snapA)).toBe(true);
    });
  });

  describe('readPanelOpenCount (#1628)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { document.body.innerHTML = ''; });

    it('is 0 when the panel root is absent', () => {
      expect(readPanelOpenCount('#bs-finances-panel')).toBe(0);
    });

    it('is 0 for an invalid selector without throwing', () => {
      expect(() => readPanelOpenCount('###')).not.toThrow();
      expect(readPanelOpenCount('###')).toBe(0);
    });

    it('is 0 when the root has no openCount dataset entry', () => {
      addPanel('bs-finances-panel', 'block');
      expect(readPanelOpenCount('#bs-finances-panel')).toBe(0);
    });

    it('is 0 when the dataset entry is not numeric', () => {
      addPanel('bs-finances-panel', 'block').dataset['openCount'] = 'abc';
      expect(readPanelOpenCount('#bs-finances-panel')).toBe(0);
    });

    it('reads the numeric dataset.openCount', () => {
      addPanel('bs-finances-panel', 'block').dataset['openCount'] = '3';
      expect(readPanelOpenCount('#bs-finances-panel')).toBe(3);
    });
  });

  describe('createUiActionStep: panel re-show while open (#1628)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { document.body.innerHTML = ''; });
    const make = (root: string) => createUiActionStep('p', 't', 'x', { kind: 'panel', rootSelector: root });
    const bump = (el: HTMLElement) => { el.dataset['openCount'] = String(Number(el.dataset['openCount'] ?? 0) + 1); };

    it('captures the panel open count in the snapshot', () => {
      addPanel('bs-finances-panel', 'block').dataset['openCount'] = '2';
      const snap = make('#bs-finances-panel').captureSnapshot!(STATE);
      expect(snap['panelOpenCount']).toBe(2);
    });

    it('captures 0 when the panel is absent', () => {
      expect(make('#bs-finances-panel').captureSnapshot!(STATE)['panelOpenCount']).toBe(0);
    });

    it('open at capture: repeated polls with an unchanged count never complete', () => {
      const panel = addPanel('bs-finances-panel', 'block');
      panel.dataset['openCount'] = '1';
      const step = make('#bs-finances-panel');
      const snap = step.captureSnapshot!(STATE);
      for (let i = 0; i < 5; i++) expect(step.isComplete(STATE, snap)).toBe(false);
    });

    it('open at capture: completes after the count bumps while still visible', () => {
      const panel = addPanel('bs-finances-panel', 'block');
      panel.dataset['openCount'] = '1';
      const step = make('#bs-finances-panel');
      const snap = step.captureSnapshot!(STATE);
      expect(step.isComplete(STATE, snap)).toBe(false);
      bump(panel); // show() on an already-visible panel
      expect(step.isComplete(STATE, snap)).toBe(true);
    });

    it('open at capture, count bumped but panel hidden: not complete', () => {
      const panel = addPanel('bs-finances-panel', 'block');
      const step = make('#bs-finances-panel');
      const snap = step.captureSnapshot!(STATE);
      bump(panel);
      panel.style.display = 'none';
      expect(step.isComplete(STATE, snap)).toBe(false);
    });

    it('hide then show still completes (count bumped too)', () => {
      const panel = addPanel('bs-employee-panel', 'block');
      const step = make('#bs-employee-panel');
      const snap = step.captureSnapshot!(STATE);
      panel.style.display = 'none';
      expect(step.isComplete(STATE, snap)).toBe(false);
      panel.style.display = 'block';
      bump(panel);
      expect(step.isComplete(STATE, snap)).toBe(true);
    });

    it('closed at capture then opened completes without needing a count', () => {
      const panel = addPanel('bs-employee-panel', 'none');
      const step = make('#bs-employee-panel');
      const snap = step.captureSnapshot!(STATE);
      panel.style.display = 'block';
      expect(step.isComplete(STATE, snap)).toBe(true);
    });

    it('a snapshot lacking panelOpenCount with the panel open does not complete spuriously', () => {
      const panel = addPanel('bs-finances-panel', 'block');
      panel.dataset['openCount'] = '4';
      const step = make('#bs-finances-panel');
      expect(step.isComplete(STATE, { panelWasVisible: true })).toBe(false);
    });
  });
});
