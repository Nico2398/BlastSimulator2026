// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial rails: per-step whitelist (#1595)
//
// Rails are CSS-only: a control not marked `bs-tutorial-allowed` is inert. A
// stage selector that matches more than the scripted control (every dealership
// tier, every survey method, Apply before Continuous) lets the player diverge
// from the script. This runs every step and stage against a fixture of
// off-script controls and fails when any of them is marked allowed.

import { describe, it, expect, beforeEach } from 'vitest';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import { stagesFor, type TutorialStage } from '../../../src/ui/tutorialStages.js';
import { applyRails, allowedSelectors, resolveStageIndex, ALLOWED_CLASS } from '../../../src/ui/tutorialGuide.js';
import { injectStyles } from '../../../src/ui/styles.js';
import { BASE_PERMANENTLY_ALLOWED } from '../../../src/ui/tutorialRails.js';

const ROLES = ['drill_rig', 'rock_digger', 'debris_hauler', 'rock_fragmenter', 'surveyor_truck'] as const;

interface Probe {
  name: string;
  /** Step ids where this control is the scripted action; it may be allowed there. */
  legitIn: readonly string[];
  el: HTMLElement;
}

function add(parent: HTMLElement, tag: string, attrs: Record<string, string>, className = ''): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (className) e.className = className;
  parent.appendChild(e);
  return e;
}

function buildFixture(): Probe[] {
  document.body.innerHTML = '';
  const probes: Probe[] = [];
  const probe = (name: string, legitIn: readonly string[], el: HTMLElement): void => { probes.push({ name, legitIn, el }); };

  const fleet = add(document.body, 'div', { id: 'bs-vehicle-panel' });
  for (const role of ROLES) {
    for (const tier of [2, 3]) {
      probe(`dealership ${role} tier ${tier}`, [], add(fleet, 'button',
        { 'data-role': role, 'data-tier': String(tier), 'data-vtype': role }, 'bs-fleet-tier-btn'));
    }
  }
  // Tier 1 of a role the step is NOT about is off-script too.
  const legitTier1: Record<string, string> = {
    drill_rig: 'buy-drill-rig-assign', rock_digger: 'buy-rock-digger-assign', debris_hauler: 'vehicle-buy-assign',
  };
  for (const role of ROLES) {
    const legit = legitTier1[role];
    probe(`dealership ${role} tier 1`, legit ? [legit] : [], add(fleet, 'button',
      { 'data-role': role, 'data-tier': '1', 'data-vtype': role }, 'bs-fleet-tier-btn'));
  }
  probe('vehicle scrap', [], add(fleet, 'button', { 'data-action': 'scrap' }));

  const survey = add(document.body, 'div', { id: 'bs-survey-panel' });
  probe('survey method core_sample', [], add(survey, 'div', { 'data-method': 'core_sample' }, 'bs-survey-method'));
  probe('survey method aerial', [], add(survey, 'div', { 'data-method': 'aerial' }, 'bs-survey-method'));
  probe('survey method seismic', ['survey'], add(survey, 'div', { 'data-method': 'seismic' }, 'bs-survey-method'));
  const run = add(survey, 'button', { id: 'bs-survey-run' });
  probe('run survey', ['survey'], run);

  const ops = add(document.body, 'div', { id: 'bs-operations-panel' });
  const shift = add(ops, 'div', { id: 'bs-policy-shift' });
  probe('policy shift_8h', [], add(shift, 'button', { 'data-shift-mode': 'shift_8h' }));
  probe('policy shift_12h', [], add(shift, 'button', { 'data-shift-mode': 'shift_12h' }));
  probe('policy continuous', ['set-early-policy'], add(shift, 'button', { 'data-shift-mode': 'continuous' }));
  // Default fixture: no pressed shift, default fatigue -> Apply is not legitimate yet.
  probe('policy apply (shift not Continuous)', ['set-early-policy'], add(ops, 'button', { id: 'bs-policy-apply' }));

  const blast = add(document.body, 'div', { id: 'bs-blast-panel' });
  probe('grid tool', ['drill-plan'], add(blast, 'button', { 'data-action': 'grid-tool' }));

  const sel = add(document.body, 'div', { id: 'bs-selection-bar' });
  probe('demolish', [], add(sel, 'button', { 'data-action': 'demolish' }));
  probe('fire employee', [], add(sel, 'button', { 'data-action': 'fire-employee' }));

  return probes;
}

const STEP_STAGES = TUTORIAL_STEPS.flatMap(step =>
  stagesFor(step.id, step.highlightTarget).map((stage, i) => ({ stepId: step.id, i, stage })));

describe('tutorial rails whitelist (#1595)', () => {
  let probes: Probe[];
  beforeEach(() => { probes = buildFixture(); });

  it('covers every tutorial step', () => {
    expect(STEP_STAGES.length).toBeGreaterThan(30);
  });

  it.each(STEP_STAGES)('$stepId stage $i leaves off-script controls inert', ({ stepId, stage }) => {
    applyRails(stage, document, BASE_PERMANENTLY_ALLOWED, false);
    for (const p of probes) {
      if (p.legitIn.includes(stepId)) continue;
      expect(p.el.classList.contains(ALLOWED_CLASS), `${p.name} is live during ${stepId}`).toBe(false);
    }
  });

  it.each(STEP_STAGES)('$stepId stage $i while spent leaves every scripted control inert', ({ stage }) => {
    applyRails(stage, document, BASE_PERMANENTLY_ALLOWED, true);
    for (const p of probes) {
      expect(p.el.classList.contains(ALLOWED_CLASS), `${p.name} is live while the order is spent`).toBe(false);
    }
  });

  it('the pause toggle is always live, even while the order is spent (#1627)', () => {
    const pause = add(document.body, 'button', { 'data-action': 'pause-toggle' });
    applyRails({ target: '#bs-blast-panel [data-action="grid-tool"]', hintKey: 'k' }, document, BASE_PERMANENTLY_ALLOWED, true);
    expect(pause.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('a spent stage still keeps the permanent base list allowed', () => {
    const speed = add(document.body, 'button', { 'data-speed': '2' });
    document.body.querySelector('#bs-hud-top')?.remove();
    const bar = add(document.body, 'div', { id: 'bs-hud-top' });
    const grp = add(bar, 'div', {}, 'bs-speed-btn');
    const real = add(grp, 'button', { 'data-speed': '4' });
    const panelOpener = add(document.body, 'button', { 'data-panel': 'survey' });
    applyRails({ target: '#bs-survey-run', hintKey: 'k' }, document, BASE_PERMANENTLY_ALLOWED, true);
    expect(real.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(panelOpener.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(speed.classList.contains(ALLOWED_CLASS)).toBe(false);
  });

  it('a spent stage keeps an open confirm modal dismissable', () => {
    const modal = add(document.body, 'div', {}, 'bs-confirm-overlay');
    const cancel = add(modal, 'button', { 'data-action': 'replace-cancel' });
    applyRails({ target: '#bs-blast-panel [data-action="grid-tool"]', hintKey: 'k' }, document, BASE_PERMANENTLY_ALLOWED, true);
    expect(cancel.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  describe('vehicle steps allow only the tier-1 button of their own role', () => {
    it.each([
      ['buy-drill-rig-assign', 'drill_rig'],
      ['buy-rock-digger-assign', 'rock_digger'],
      ['vehicle-buy-assign', 'debris_hauler'],
    ])('%s', (stepId, role) => {
      const stages = stagesFor(stepId);
      const buy = stages[stages.length - 1] as TutorialStage;
      applyRails(buy, document, BASE_PERMANENTLY_ALLOWED, false);
      const live = probes.filter(p => p.el.classList.contains(ALLOWED_CLASS)).map(p => p.name);
      expect(live).toEqual([`dealership ${role} tier 1`]);
    });
  });

  describe('survey step', () => {
    it('run stage keeps the chosen seismic method live and other methods inert', () => {
      const stages = stagesFor('survey');
      const runStage = stages.find(s => s.target === '#bs-survey-run')!;
      applyRails(runStage, document, BASE_PERMANENTLY_ALLOWED, false);
      const by = (m: string) => document.querySelector(`#bs-survey-panel [data-method="${m}"]`)!;
      expect(by('seismic').classList.contains(ALLOWED_CLASS)).toBe(true);
      expect(by('core_sample').classList.contains(ALLOWED_CLASS)).toBe(false);
      expect(by('aerial').classList.contains(ALLOWED_CLASS)).toBe(false);
    });

    it('method rows are railed in CSS (plain divs need their own guided rule)', () => {
      injectStyles();
      const css = Array.from(document.head.querySelectorAll('style')).map(el => el.textContent).join('\n');
      expect(css).toMatch(/body\.bs-tutorial-guided\s+\.bs-survey-method:not\(\.bs-tutorial-allowed\)/);
    });
  });

  describe('set-early-policy: Apply needs Continuous and an in-range fatigue threshold', () => {
    const stages = (): TutorialStage[] => stagesFor('set-early-policy', undefined);
    /** Boxes make every fixture control reachable, so resolveStageIndex follows reachableWhen alone. */
    function setPolicy(pressed: string | null, fatigue: string): void {
      const cont = document.querySelector('#bs-policy-shift button[data-shift-mode="continuous"]')!;
      for (const b of Array.from(document.querySelectorAll('#bs-policy-shift button'))) b.removeAttribute('aria-pressed');
      if (pressed) cont.setAttribute('aria-pressed', pressed);
      let input = document.querySelector('#bs-policy-fatigue') as HTMLInputElement | null;
      if (!input) input = add(document.body, 'input', { id: 'bs-policy-fatigue' }) as HTMLInputElement;
      input.value = fatigue;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('#bs-operations-panel *, #bs-policy-fatigue'))) {
        el.getBoundingClientRect = () => ({ width: 40, height: 20, top: 0, left: 0, right: 40, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      }
    }
    const apply = () => document.querySelector('#bs-policy-apply')!;
    const activeStage = (): TutorialStage => stages()[resolveStageIndex(stages())]!;

    it('declares Apply as a gated stage target, never through `also`', () => {
      for (const s of stages()) expect(s.also ?? []).not.toContain('#bs-policy-apply');
      const applyStage = stages().find(s => s.target === '#bs-policy-apply');
      expect(applyStage?.reachableWhen).toBeTypeOf('function');
    });

    it('Apply stays inert when Continuous is not pressed', () => {
      setPolicy(null, '60');
      applyRails(activeStage(), document, BASE_PERMANENTLY_ALLOWED, false);
      expect(apply().classList.contains(ALLOWED_CLASS)).toBe(false);
      expect(allowedSelectors(activeStage(), document)).not.toContain('#bs-policy-apply');
    });

    it.each(['40', '49', '70', '100', '', 'abc'])('Apply stays inert at fatigue %s', (v) => {
      setPolicy('true', v);
      applyRails(activeStage(), document, BASE_PERMANENTLY_ALLOWED, false);
      expect(apply().classList.contains(ALLOWED_CLASS)).toBe(false);
    });

    it.each(['50', '60', '69'])('Apply goes live with Continuous pressed and fatigue %s', (v) => {
      setPolicy('true', v);
      applyRails(activeStage(), document, BASE_PERMANENTLY_ALLOWED, false);
      expect(apply().classList.contains(ALLOWED_CLASS)).toBe(true);
      expect(allowedSelectors(activeStage(), document)).toContain('#bs-policy-apply');
    });

    it('Apply goes inert again once the order is spent', () => {
      setPolicy('true', '60');
      applyRails(activeStage(), document, BASE_PERMANENTLY_ALLOWED, true);
      expect(apply().classList.contains(ALLOWED_CLASS)).toBe(false);
    });
  });
});
