// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargeStep } from '../../../../../src/ui/panels/blastSteps/Charge.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../../src/core/mining/DrillPlan.js';
import { getExplosive } from '../../../../../src/core/world/ExplosiveCatalog.js';
import { t } from '../../../../../src/core/i18n/I18n.js';
import { TUBING_COST } from '../../../../../src/core/mining/Tubing.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeStep(): { step: ChargeStep; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new ChargeStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, container, gameConsole };
}

function card(step: ChargeStep, explosiveId: string): HTMLButtonElement {
  return step.root.querySelector(`[data-explosive="${explosiveId}"]`) as HTMLButtonElement;
}

beforeEach(() => resetHoleIds());

describe('ChargeStep', () => {
  it('renders a product card for every explosive in the catalog, with its cost', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    const boomite = getExplosive('boomite')!;
    expect(card(step, 'boomite')).not.toBeNull();
    expect(card(step, 'boomite').textContent).toContain(`$${boomite.costPerKg.toFixed(2)} / kg`);
    expect(card(step, 'krackle')).not.toBeNull();
    expect(card(step, 'dynatomics')).not.toBeNull();
  });

  it('clicking a product card selects it without dispatching a charge command', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'sunny');

    card(step, 'krackle').click();

    expect(gameConsole).not.toHaveBeenCalled();
    // data-selected, not style inspection — jsdom's CSS parser doesn't reliably
    // reflect cssText strings containing var(...) refs back through the style
    // attribute after a rebuild, so a dedicated data attribute is the robust hook.
    expect(card(step, 'krackle').dataset['selected']).toBe('true');
    expect(card(step, 'boomite').dataset['selected']).toBe('false');
  });

  it('shows the WATER-SENSITIVE badge only for water-sensitive explosives while a hole is wet', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);

    step.update(state, 'sunny'); // not raining — no wet holes
    const waterSensitiveId = ['pop_rock', 'krackle', 'shatternite', 'obliviax'].find(id => getExplosive(id)?.waterSensitive)!;
    expect(card(step, waterSensitiveId).textContent).not.toContain('WATER-SENSITIVE');

    step.update(state, 'heavy_rain'); // raining, hole untubed → wet
    expect(card(step, waterSensitiveId).textContent).toContain('WATER-SENSITIVE');
  });

  it('never shows the badge on a non-water-sensitive explosive, even while raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'heavy_rain');

    const dryId = ['boomite', 'big_bada_boom', 'rumblox', 'dynatomics'].find(id => getExplosive(id)?.waterSensitive === false)!;
    expect(card(step, dryId).textContent).not.toContain('WATER-SENSITIVE');
  });

  it('Charge All dispatches the selected explosive, amount, and stemming for every hole', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState(), 'sunny');
    card(step, 'krackle').click();

    const chargeAllBtn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    chargeAllBtn.click();

    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain('charge hole:*');
    expect(cmd).toContain('explosive:krackle');
    expect(cmd).toContain('amount:5kg');
    expect(cmd).toContain('stemming:2m');
  });

  it('renders one per-hole row per drill hole, keyed by data-hole, each with its own charge button', () => {
    const { step } = makeStep();
    const state = makeState();
    const h1 = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const h2 = addHole(state.drillHoles, 13, 10, 8, 0.15);
    step.update(state, 'sunny');

    expect(step.root.querySelectorAll('[data-action="charge-hole"]')).toHaveLength(2);
    expect(step.root.querySelector(`[data-hole="${h1.id}"] [data-action="charge-hole"]`)).not.toBeNull();
    expect(step.root.querySelector(`[data-hole="${h2.id}"] [data-action="charge-hole"]`)).not.toBeNull();
  });

  it('a per-hole Charge button dispatches charge for that hole alone, with the panel\'s selected explosive/amount/stemming', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    const h2 = addHole(state.drillHoles, 13, 10, 8, 0.15);
    step.update(state, 'sunny');
    card(step, 'krackle').click();

    (step.root.querySelector(`[data-hole="${h2.id}"] [data-action="charge-hole"]`) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith(`charge hole:${h2.id} explosive:krackle amount:5kg stemming:2m`);
  });

  it('a per-hole Charge button picks up the amount/stemming steppers, not the defaults', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'sunny');

    const amountIncBtn = step.root.querySelectorAll('.bsx-stepper-btn')[1] as HTMLButtonElement;
    amountIncBtn.click(); // 5 kg → 6 kg
    const stemmingIncBtn = step.root.querySelectorAll('.bsx-stepper-btn')[3] as HTMLButtonElement;
    stemmingIncBtn.click(); // 2.0 m → 2.2 m

    (step.root.querySelector(`[data-hole="${h1.id}"] [data-action="charge-hole"]`) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith(`charge hole:${h1.id} explosive:boomite amount:6kg stemming:2.2m`);
  });

  it('marks a charged hole distinguishable from an uncharged one and shows its charge', () => {
    const { step } = makeStep();
    const state = makeState();
    const h1 = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const h2 = addHole(state.drillHoles, 13, 10, 8, 0.15);
    state.chargesByHole[h1.id] = { explosiveId: 'krackle', amountKg: 7, stemmingM: 2 };
    step.update(state, 'sunny');

    const chargedRow = step.root.querySelector(`[data-hole="${h1.id}"]`) as HTMLElement;
    const uncharged = step.root.querySelector(`[data-hole="${h2.id}"]`) as HTMLElement;
    expect(chargedRow.dataset['charged']).toBe('true');
    expect(uncharged.dataset['charged']).toBe('false');
    expect(chargedRow.textContent).toContain('7 kg');
    expect(chargedRow.textContent).toContain(t(getExplosive('krackle')!.nameKey));
    expect(uncharged.textContent).toContain('Not charged');
  });

  it('re-renders the hole rows once a charge lands, so a row cannot go stale', () => {
    const { step } = makeStep();
    const state = makeState();
    const h1 = addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'sunny');
    expect((step.root.querySelector(`[data-hole="${h1.id}"]`) as HTMLElement).dataset['charged']).toBe('false');

    state.chargesByHole[h1.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    step.update(state, 'sunny');

    expect((step.root.querySelector(`[data-hole="${h1.id}"]`) as HTMLElement).dataset['charged']).toBe('true');
  });

  it('shows an empty state instead of hole rows when no hole is drilled yet', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    expect(step.root.querySelector('[data-action="charge-hole"]')).toBeNull();
    expect(step.root.textContent).toContain('No holes to charge yet');
  });

  it('amount stepper clamps to the selected explosive\'s min/max charge', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    card(step, 'pop_rock').click(); // narrower min/max than the default boomite

    const popRock = getExplosive('pop_rock')!;
    const decBtn = step.root.querySelectorAll('.bsx-stepper-btn')[0] as HTMLButtonElement;
    for (let i = 0; i < 20; i++) decBtn.click();
    const amountValue = step.root.querySelector('.bsx-stepper-value') as HTMLElement;
    expect(Number(amountValue.textContent!.replace(' kg', ''))).toBe(popRock.minChargeKg);
  });

  it('stemming stepper steps by 0.2m and floors at 0.5m', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    const stemmingDecBtn = step.root.querySelectorAll('.bsx-stepper-btn')[2] as HTMLButtonElement;
    for (let i = 0; i < 20; i++) stemmingDecBtn.click();
    const stemmingValue = step.root.querySelectorAll('.bsx-stepper-value')[1] as HTMLElement;
    expect(stemmingValue.textContent).toBe('0.5 m');
  });

  it('shows the tubing "settled" card when no hole is wet', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('dry or tubed');
    expect(step.root.querySelector('[data-action="tubing-install"]')).toBeNull();
  });

  it('shows the tubing "needed" card with the wet count once it starts raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    addHole(state.drillHoles, 13, 10, 8, 0.15);

    step.update(state, 'heavy_rain');

    expect(step.root.textContent).toContain('2 holes are taking on water');
    const installBtn = step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement;
    expect(installBtn).not.toBeNull();
    expect(installBtn.textContent).toContain('Install on 2');
  });

  it('Buy Tubing dispatches the registered buy command', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'heavy_rain');

    (step.root.querySelector('[data-action="tubing-buy"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('buy amount:10');
  });

  it('the Buy Tubing button shows the real cost (10 × TUBING_COST), not a stale price', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'heavy_rain');

    const buyBtn = step.root.querySelector('[data-action="tubing-buy"]') as HTMLButtonElement;
    expect(buyBtn.textContent).toContain(`$${10 * TUBING_COST}`);
  });

  it('Install Tubing dispatches one install_tubing per wet hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const h2 = addHole(state.drillHoles, 13, 10, 8, 0.15);
    state.tubingState.inventory = 5;
    step.update(state, 'heavy_rain');

    (step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h1.id}`);
    expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h2.id}`);
    expect(gameConsole).toHaveBeenCalledTimes(2);
  });

  it('disables Install Tubing when stock is short, with a reason line', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    addHole(state.drillHoles, 13, 10, 8, 0.15);
    state.tubingState.inventory = 1; // 2 holes wet, only 1 tube in stock
    step.update(state, 'heavy_rain');

    const installBtn = step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement;
    expect(installBtn.disabled).toBe(true);
    expect(step.root.textContent).toContain('Only 1 tubes in stock, 2 wet holes need one');

    installBtn.click();
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('dispose() removes the step from the DOM', () => {
    const { step, container } = makeStep();
    step.dispose();
    expect(container.contains(step.root)).toBe(false);
  });

  it('refreshLocale() does not throw and keeps rendering', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    expect(() => step.refreshLocale()).not.toThrow();
    step.update(makeState(), 'sunny');
    expect(card(step, 'boomite')).not.toBeNull();
  });
});
