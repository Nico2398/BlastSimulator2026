// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlastFooter } from '../../../../src/ui/panels/blastFooter.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeFooter(): { footer: BlastFooter; container: HTMLElement; fireRequested: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const footer = new BlastFooter(container);
  const fireRequested = vi.fn();
  footer.setFireRequestedHandler(fireRequested);
  return { footer, container, fireRequested };
}

function chargeAndSequence(state: ReturnType<typeof makeState>) {
  const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
  const chargeResult = createCharge('boomite', 5, 2, hole.depth);
  if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;
  state.sequenceDelays[hole.id] = 0;
  return hole;
}

beforeEach(() => {
  resetHoleIds();
  document.body.innerHTML = '';
  setLocale('en');
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

  it('FIRE stays disabled with a reason when holes are drilled but not fully charged (default en locale)', () => {
    const { footer } = makeFooter();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    addHole(state.drillHoles, 13, 10, 8, 0.15);

    footer.update(state);

    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(true);
    expect(footer.root.textContent).toContain('Missing charge');
  });

  // #633: BlastPlan.ts's ValidationError.issue must be a translation key, and
  // blastFooter must resolve it through t() at display time — not bake English
  // prose into the fire-blocked reason line regardless of active locale.
  it('FIRE-blocked reason line is translated under the fr locale, not left in English', () => {
    setLocale('fr');
    const { footer } = makeFooter();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    addHole(state.drillHoles, 13, 10, 8, 0.15);

    footer.update(state);

    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(true);
    expect(footer.root.textContent).toContain('Charge manquante');
    expect(footer.root.textContent).not.toContain('Missing charge');
  });

  it('FIRE enables once every hole is charged and sequenced', () => {
    const { footer } = makeFooter();
    const state = makeState();
    chargeAndSequence(state);

    footer.update(state);

    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(false);
  });

  it('clicking FIRE while disabled does not request a preflight confirm', () => {
    const { footer, fireRequested } = makeFooter();
    footer.update(makeState());

    (footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement).click();

    expect(fireRequested).not.toHaveBeenCalled();
  });

  it('clicking FIRE while enabled requests a preflight confirm, without dispatching blast itself', () => {
    const { footer, fireRequested } = makeFooter();
    const state = makeState();
    chargeAndSequence(state);
    footer.update(state);

    (footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement).click();

    expect(fireRequested).toHaveBeenCalledTimes(1);
  });

  it('dispose() removes the footer from the DOM', () => {
    const { footer, container } = makeFooter();
    footer.dispose();
    expect(container.contains(footer.root)).toBe(false);
  });
});
