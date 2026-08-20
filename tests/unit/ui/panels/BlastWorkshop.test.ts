// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlastWorkshop } from '../../../../src/ui/panels/BlastWorkshop.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeWorkshop(): { workshop: BlastWorkshop; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const workshop = new BlastWorkshop(container);
  workshop.setGameConsole(vi.fn().mockReturnValue({ success: true, output: '' }));
  return { workshop, container };
}

function tabButton(root: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(root.querySelectorAll('button')).find(b => b.textContent?.includes(label)) as HTMLButtonElement;
}

beforeEach(() => {
  resetHoleIds();
  document.body.innerHTML = '';
});

describe('BlastWorkshop', () => {
  it('is hidden initially', () => {
    const { workshop } = makeWorkshop();
    expect(workshop.visible).toBe(false);
  });

  it('show()/hide() toggle visibility', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    expect(workshop.visible).toBe(true);
    workshop.hide();
    expect(workshop.visible).toBe(false);
  });

  it('renders all 5 step labels', () => {
    const { workshop } = makeWorkshop();
    for (const label of ['Drill', 'Charge', 'Sequence', 'Preview', 'Fire']) {
      expect(workshop.root.textContent).toContain(label);
    }
  });

  it('the load-bearing data-action selectors resolve under #bs-blast-panel', () => {
    const { workshop } = makeWorkshop();
    expect(workshop.root.id).toBe('bs-blast-panel');
    for (const action of ['grid-tool', 'clear-holes', 'charge-all', 'auto-sequence', 'execute']) {
      expect(workshop.root.querySelector(`[data-action="${action}"]`), `missing [data-action="${action}"]`).not.toBeNull();
    }
  });

  it('defaults to the Drill step for a fresh, empty plan', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    workshop.update(makeState(), 'sunny');

    const drillGridBtn = workshop.root.querySelector('[data-action="grid-tool"]') as HTMLElement;
    expect(drillGridBtn.closest('div[style*="display: none"]')).toBeNull();
    const chargeAllBtn = workshop.root.querySelector('[data-action="charge-all"]') as HTMLElement;
    expect(chargeAllBtn.closest('div[style*="display: none"]')).not.toBeNull();
  });

  // currentStep (PR #616 review round, item 7): the scenario harness's own
  // "ask the game, not the DOM" read of which tab is active, so a scenario's
  // ensureStep action can assert-or-click instead of assuming a tab a
  // preceding step left active is still active.
  it('currentStep defaults to Drill (1)', () => {
    const { workshop } = makeWorkshop();
    expect(workshop.currentStep).toBe(1);
  });

  it('currentStep tracks a manual tab click', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    tabButton(workshop.root, 'Charge').click();
    expect(workshop.currentStep).toBe(2);
  });

  it('currentStep tracks auto-advance, matching which controls are actually visible', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;

    workshop.update(state, 'sunny');

    expect(workshop.currentStep).toBe(3);
  });

  it('auto-advances to Charge once holes exist but are not fully charged', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);

    workshop.update(state, 'sunny');

    const chargeAllBtn = workshop.root.querySelector('[data-action="charge-all"]') as HTMLElement;
    expect(chargeAllBtn.closest('div[style*="display: none"]')).toBeNull();
  });

  it('auto-advances to Sequence once every hole is charged', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;

    workshop.update(state, 'sunny');

    const autoSeqBtn = workshop.root.querySelector('[data-action="auto-sequence"]') as HTMLElement;
    expect(autoSeqBtn.closest('div[style*="display: none"]')).toBeNull();
  });

  it('auto-advances to Fire once drilled, charged, and sequenced', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;
    state.sequenceDelays[hole.id] = 0;

    workshop.update(state, 'sunny');

    const fireBtn = workshop.root.querySelector('#bs-blast-fire') as HTMLElement;
    expect(fireBtn.closest('div[style*="display: none"]')).toBeNull();
  });

  it('manually clicking a tab stops auto-advance so the plan changing does not yank the view away', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    workshop.update(state, 'sunny');

    tabButton(workshop.root, 'Preview').click();
    addHole(state.drillHoles, 10, 10, 8, 0.15); // would normally auto-suggest Drill (already there) then Charge
    workshop.update(state, 'sunny');

    const previewText = workshop.root.textContent ?? '';
    expect(previewText).toContain('Analysis Suite'); // Preview's own body stayed visible, Preview-specific text
  });

  it('reopening the panel resets auto-advance even after a manual tab pick', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    workshop.update(state, 'sunny');
    tabButton(workshop.root, 'Sequence').click(); // manual pick, disables auto-advance
    workshop.hide();

    workshop.show(); // fresh open re-enables auto-advance
    workshop.update(state, 'sunny');

    const gridBtn = workshop.root.querySelector('[data-action="grid-tool"]') as HTMLElement;
    expect(gridBtn.closest('div[style*="display: none"]')).toBeNull();
  });

  it('the close button fires the registered close handler', () => {
    const { workshop } = makeWorkshop();
    const onClose = vi.fn();
    workshop.setCloseHandler(onClose);

    const closeBtn = Array.from(workshop.root.querySelectorAll('button')).find(b => !b.dataset['action'] && b.textContent === '') as HTMLButtonElement;
    closeBtn.click();

    expect(onClose).toHaveBeenCalled();
  });

  it('dispose() removes the panel from the DOM', () => {
    const { workshop, container } = makeWorkshop();
    workshop.dispose();
    expect(container.contains(workshop.root)).toBe(false);
  });

  it('refreshLocale() does not throw and keeps the panel functional', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    workshop.update(makeState(), 'sunny');

    expect(() => workshop.refreshLocale()).not.toThrow();
    workshop.update(makeState(), 'sunny');
    expect(workshop.root.textContent).toContain('Drill');
  });
});
