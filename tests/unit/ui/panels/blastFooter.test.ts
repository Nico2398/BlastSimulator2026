// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlastFooter } from '../../../../src/ui/panels/blastFooter.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeFooter(): { footer: BlastFooter; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const footer = new BlastFooter(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  footer.setGameConsole(gameConsole);
  return { footer, container, gameConsole };
}

beforeEach(() => {
  resetHoleIds();
  document.body.innerHTML = '';
});

describe('BlastFooter', () => {
  it('shows $0 cost/value/margin and a disabled FIRE button for an empty plan', () => {
    const { footer } = makeFooter();
    footer.update(makeState());

    expect(footer.root.textContent).toContain('$0');
    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(true);
  });

  it('sums plan cost from every charged hole\'s explosive cost', () => {
    const { footer } = makeFooter();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth); // boomite: $12/kg
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;

    footer.update(state);

    // 5kg × $12/kg = $60
    expect(footer.root.textContent).toContain('$60');
  });

  it('FIRE stays disabled with a reason when holes are drilled but not fully charged', () => {
    const { footer } = makeFooter();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    addHole(state.drillHoles, 13, 10, 8, 0.15);

    footer.update(state);

    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(true);
    expect(footer.root.textContent).toContain('Missing charge');
  });

  it('FIRE enables once every hole is charged and sequenced', () => {
    const { footer } = makeFooter();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;
    state.sequenceDelays[hole.id] = 0;

    footer.update(state);

    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(false);
  });

  it('clicking FIRE while disabled does not open the confirm dialog', () => {
    const { footer } = makeFooter();
    footer.update(makeState());

    (footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement).click();

    expect(document.body.querySelector('.bs-confirm-overlay')).toBeNull();
  });

  it('clicking FIRE while enabled opens a confirm dialog; Yes dispatches blast', () => {
    const { footer, gameConsole } = makeFooter();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;
    state.sequenceDelays[hole.id] = 0;
    footer.update(state);

    (footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement).click();
    const overlay = document.body.querySelector('.bs-confirm-overlay');
    expect(overlay).not.toBeNull();

    const yesBtn = overlay!.querySelector('.bs-btn-danger') as HTMLButtonElement;
    yesBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('blast');
    expect(document.body.querySelector('.bs-confirm-overlay')).toBeNull();
  });

  it('clicking No in the confirm dialog dispatches nothing and closes it', () => {
    const { footer, gameConsole } = makeFooter();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;
    state.sequenceDelays[hole.id] = 0;
    footer.update(state);
    (footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement).click();

    const overlay = document.body.querySelector('.bs-confirm-overlay') as HTMLElement;
    const noBtn = Array.from(overlay.querySelectorAll('button')).find(b => !b.classList.contains('bs-btn-danger')) as HTMLButtonElement;
    noBtn.click();

    expect(gameConsole).not.toHaveBeenCalled();
    expect(document.body.querySelector('.bs-confirm-overlay')).toBeNull();
  });

  it('dispose() removes the footer from the DOM', () => {
    const { footer, container } = makeFooter();
    footer.dispose();
    expect(container.contains(footer.root)).toBe(false);
  });
});
