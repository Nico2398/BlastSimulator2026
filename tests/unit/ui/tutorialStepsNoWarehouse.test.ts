// @vitest-environment jsdom
// BlastSimulator2026 — The tutorial and Build menu teach and offer no explosive warehouse (#2154)

import { describe, it, expect, beforeAll } from 'vitest';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import { TUTORIAL_STAGES, REGION } from '../../../src/ui/tutorialStages.js';
import { BuildMenu } from '../../../src/ui/BuildMenu.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

beforeAll(() => setLocale('en'));

describe('the tutorial has no explosive warehouse step (#2154)', () => {
  it('no step id names the warehouse', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).not.toContain('build-explosive-warehouse');
    for (const s of TUTORIAL_STEPS) expect(s.id).not.toContain('warehouse-explosive');
  });

  it('no step title or body key names the removed step', () => {
    const text = JSON.stringify(TUTORIAL_STEPS.map((s) => ({ ...s, completionCheck: undefined })));
    expect(text).not.toContain('step_explosivewarehouse');
  });

  it('no step runs a build command for the removed type', () => {
    for (const s of TUTORIAL_STEPS) {
      for (const cmd of (s as { commands?: string[]; suggestedCommands?: string[] }).commands ?? []) {
        expect(cmd, s.id).not.toContain('explosive_warehouse');
      }
    }
    expect(JSON.stringify(TUTORIAL_STEPS, (_k, v) => (typeof v === 'function' ? undefined : v))).not.toContain('explosive_warehouse');
  });

  it('has no stage list for the step', () => {
    expect(Object.keys(TUTORIAL_STAGES)).not.toContain('build-explosive-warehouse');
  });

  it('no stage targets the removed Build row or uses its hint key', () => {
    const stages = Object.values(TUTORIAL_STAGES).flat();
    for (const st of stages) {
      expect(st.target).not.toContain('explosive_warehouse');
      expect(st.hintKey).not.toContain('explosive_warehouse');
      for (const extra of st.also ?? []) expect(extra).not.toContain('explosive_warehouse');
    }
  });

  it('the pin region for the removed building is gone', () => {
    expect(Object.keys(REGION)).not.toContain('explosiveWarehouse');
  });
});

describe('the Build menu offers no explosive warehouse (#2154)', () => {
  it('has no catalog row for it but keeps the other rows', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const menu = new BuildMenu(container);
    try {
      const state = createGame({ seed: 42, mineType: 'desert' });
      state.cash = 99999;
      menu.update(state);
      expect(container.querySelector('[data-build-type="explosive_warehouse"]')).toBeNull();
      expect(container.querySelector('[data-build-type="management_office"]')).not.toBeNull();
      expect(container.querySelector('[data-build-type="freight_warehouse"]')).not.toBeNull();
    } finally {
      menu.dispose();
      container.remove();
    }
  });
});
