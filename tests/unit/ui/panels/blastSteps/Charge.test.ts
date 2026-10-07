// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargeStep } from '../../../../../src/ui/panels/blastSteps/Charge.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { getExplosive, getAllExplosives } from '../../../../../src/core/world/ExplosiveCatalog.js';
import type { DrillHole } from '../../../../../src/core/mining/DrillPlan.js';
import type { ColumnRock } from '../../../../../src/core/mining/ExplosiveRockFit.js';
import { t } from '../../../../../src/core/i18n/I18n.js';
import { TUBING_COST } from '../../../../../src/core/mining/Tubing.js';
import { CHARGE_DEFAULT_AMOUNT_KG, CHARGE_DEFAULT_STEMMING_M } from '../../../../../src/core/config/balance.js';

const holeCounter = { nextHoleId: 1 };

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

beforeEach(() => { holeCounter.nextHoleId = 1; });

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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);

    step.update(state, 'sunny'); // not raining — no wet holes
    const waterSensitiveId = ['pop_rock', 'krackle', 'shatternite', 'obliviax'].find(id => getExplosive(id)?.waterSensitive)!;
    expect(card(step, waterSensitiveId).textContent).not.toContain('WATER-SENSITIVE');

    step.update(state, 'heavy_rain'); // raining, hole untubed → wet
    expect(card(step, waterSensitiveId).textContent).toContain('WATER-SENSITIVE');
  });

  it('never shows the badge on a non-water-sensitive explosive, even while raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
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
    expect(cmd).toContain(`amount:${CHARGE_DEFAULT_AMOUNT_KG}kg`);
    expect(cmd).toContain(`stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
    // #1330: the retuned panel defaults, spelled out
    expect(cmd).toContain('amount:4kg');
    expect(cmd).toContain('stemming:2.5m');
  });

  it('renders one per-hole row per drill hole, keyed by data-hole, each with its own charge button', () => {
    const { step } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);
    step.update(state, 'sunny');

    expect(step.root.querySelectorAll('[data-action="charge-hole"]')).toHaveLength(2);
    expect(step.root.querySelector(`[data-hole="${h1.id}"] [data-action="charge-hole"]`)).not.toBeNull();
    expect(step.root.querySelector(`[data-hole="${h2.id}"] [data-action="charge-hole"]`)).not.toBeNull();
  });

  it('a per-hole Charge button dispatches charge for that hole alone, with the panel\'s selected explosive/amount/stemming', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);
    step.update(state, 'sunny');
    card(step, 'krackle').click();

    (step.root.querySelector(`[data-hole="${h2.id}"] [data-action="charge-hole"]`) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith(`charge hole:${h2.id} explosive:krackle amount:${CHARGE_DEFAULT_AMOUNT_KG}kg stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
  });

  it('a per-hole Charge button picks up the amount/stemming steppers, not the defaults', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'sunny');

    const amountIncBtn = step.root.querySelectorAll('.bsx-stepper-btn')[1] as HTMLButtonElement;
    amountIncBtn.click(); // default kg → default + 1 kg
    const stemmingIncBtn = step.root.querySelectorAll('.bsx-stepper-btn')[3] as HTMLButtonElement;
    stemmingIncBtn.click(); // default m → one stemming step up (step size not pinned here)
    const stemmingShown = parseFloat(step.root.querySelector('[data-field="stemming"] .bsx-stepper-value')!.textContent!);
    expect(stemmingShown).toBeGreaterThan(CHARGE_DEFAULT_STEMMING_M);

    (step.root.querySelector(`[data-hole="${h1.id}"] [data-action="charge-hole"]`) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith(`charge hole:${h1.id} explosive:boomite amount:${CHARGE_DEFAULT_AMOUNT_KG + 1}kg stemming:${stemmingShown}m`);
  });

  it('marks a charged hole distinguishable from an uncharged one and shows its charge', () => {
    const { step } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);
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
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
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

  it('one stemming increment moves 2.5 -> 2.6 (0.1 m step)', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    const stemmingValue = step.root.querySelectorAll('.bsx-stepper-value')[1] as HTMLElement;
    expect(stemmingValue.textContent).toBe('2.5 m');
    (step.root.querySelectorAll('.bsx-stepper-btn')[3] as HTMLButtonElement).click();
    expect(stemmingValue.textContent).toBe('2.6 m');
  });

  it('stemming stepper floors at 0.5m', () => {
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('dry or tubed');
    expect(step.root.querySelector('[data-action="tubing-install"]')).toBeNull();
  });

  it('shows the tubing "needed" card with the wet count once it starts raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);

    step.update(state, 'heavy_rain');

    expect(step.root.textContent).toContain('2 holes are taking on water');
    const installBtn = step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement;
    expect(installBtn).not.toBeNull();
    expect(installBtn.textContent).toContain('Install on 2');
  });

  it('Buy Tubing dispatches the registered buy command', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'heavy_rain');

    (step.root.querySelector('[data-action="tubing-buy"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('buy amount:10');
  });

  it('the Buy Tubing button shows the real cost (10 × TUBING_COST), not a stale price', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'heavy_rain');

    const buyBtn = step.root.querySelector('[data-action="tubing-buy"]') as HTMLButtonElement;
    expect(buyBtn.textContent).toContain(`$${10 * TUBING_COST}`);
  });

  it('Install Tubing dispatches one install_tubing per wet hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);
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

describe('ChargeStep level-limited product list (#1357)', () => {
  function cardIds(step: ChargeStep): string[] {
    return Array.from(step.root.querySelectorAll('[data-action="select-explosive"]'))
      .map(c => (c as HTMLElement).dataset['explosive']!);
  }

  it('shows exactly the active level explosives on dusty_hollow', () => {
    const { step } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = 'dusty_hollow';
    step.update(state, 'sunny');
    expect(cardIds(step)).toEqual(['pop_rock', 'boomite', 'krackle']);
  });

  it('shows the full catalog when activeLevelId is null', () => {
    const { step } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = null;
    step.update(state, 'sunny');
    expect(cardIds(step).length).toBe(getAllExplosives().length);
    expect(card(step, 'dynatomics')).not.toBeNull();
  });

  it('shows the full catalog for an unknown level id', () => {
    const { step } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = 'sandbox_site';
    step.update(state, 'sunny');
    expect(cardIds(step).length).toBe(getAllExplosives().length);
  });

  it('resets a selection that falls outside the list when the level changes', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = null;
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'sunny');
    card(step, 'dynatomics').click();
    expect(card(step, 'dynatomics').dataset['selected']).toBe('true');

    state.campaign.activeLevelId = 'dusty_hollow';
    step.update(state, 'sunny');

    expect(card(step, 'dynatomics')).toBeNull();
    const selected = Array.from(step.root.querySelectorAll('[data-action="select-explosive"][data-selected="true"]'));
    expect(selected).toHaveLength(1);
    expect(['pop_rock', 'boomite', 'krackle']).toContain((selected[0] as HTMLElement).dataset['explosive']);

    (step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).click();
    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole.mock.calls[0]![0]).not.toContain('dynatomics');
  });
});


describe('ChargeStep — column overflow guard (#1361)', () => {
  const reasonText = (step: ChargeStep): string =>
    Array.from(step.root.querySelectorAll('.bsx-reason')).map(e => e.textContent ?? '').join(' | ');
  const chargeAll = (step: ChargeStep) => step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;

  it('shows a reason line with the max kg and disables Charge All when amount + stemming overflow the shallowest hole', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 10, 4, 0.15); // shallowest: default 4 kg (2 m column) + 2.5 m stemming > 4 m
    step.update(state, 'sunny');

    expect(chargeAll(step).disabled).toBe(true);
    // max for the 4 m hole under 2.5 m stemming = (4 - 2.5) * 2 = 3 kg
    expect(reasonText(step)).toMatch(/at most 3 kg/);
  });

  it('shows no overflow reason and leaves Charge All enabled when the charge fits every hole', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 10, 6, 0.15);
    step.update(state, 'sunny');

    expect(chargeAll(step).disabled).toBe(false);
    expect(step.root.querySelectorAll('.bsx-reason')).toHaveLength(0);
  });

  it('shows no overflow reason when there are no holes', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    expect(step.root.querySelectorAll('.bsx-reason')).toHaveLength(0);
  });

  it('a disabled Charge All dispatches no command when clicked', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 13, 10, 4, 0.15);
    step.update(state, 'sunny');

    chargeAll(step).click();

    expect(gameConsole).not.toHaveBeenCalled();
  });
});

describe('ChargeStep — explosive too weak for the rock warning (#1358)', () => {
  const WARNING = '[data-warning="weak-explosive"]';
  const warningEl = (step: ChargeStep) => step.root.querySelector(WARNING) as HTMLElement | null;
  const chargeAll = (step: ChargeStep) => step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
  const HARD = { rockId: 'obstiite', tier: 4 };
  const SOFT = { rockId: 'cruite', tier: 1 };

  function stepWithHoles(sample: (hole: DrillHole) => ColumnRock | null) {
    const made = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);
    made.step.setHoleRockSampler(sample);
    return { ...made, state };
  }

  it('shows the too-weak warning with count, total and explosive when the selected explosive is below the rock tier', () => {
    const { step, state } = stepWithHoles(() => HARD);
    step.update(state, 'sunny');
    card(step, 'pop_rock').click();
    step.update(state, 'sunny');

    const el = warningEl(step);
    expect(el).not.toBeNull();
    expect(el!.textContent).toMatch(/too weak for .* under 2 of 2 holes/);
  });

  it('counts only the holes whose rock outclasses the explosive', () => {
    const { step, state } = stepWithHoles(hole => (hole.id === 'H1' ? HARD : SOFT));
    step.update(state, 'sunny');
    card(step, 'pop_rock').click();
    step.update(state, 'sunny');

    expect(warningEl(step)!.textContent).toMatch(/under 1 of 2 holes/);
  });

  it('shows no warning when the selected explosive meets the rock tier', () => {
    const { step, state } = stepWithHoles(() => HARD);
    step.update(state, 'sunny');
    card(step, 'obliviax').click(); // minRockTier 4
    step.update(state, 'sunny');

    expect(warningEl(step)).toBeNull();
  });

  it('shows no warning when the sampler reports no rock for any hole', () => {
    const { step, state } = stepWithHoles(() => null);
    step.update(state, 'sunny');
    card(step, 'pop_rock').click();
    step.update(state, 'sunny');

    expect(warningEl(step)).toBeNull();
  });

  it('shows no warning when no sampler was provided', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'sunny');
    card(step, 'pop_rock').click();
    step.update(state, 'sunny');

    expect(warningEl(step)).toBeNull();
  });

  it('keeps Charge All enabled and dispatching while the warning shows', () => {
    const { step, state, gameConsole } = stepWithHoles(() => HARD);
    step.update(state, 'sunny');
    card(step, 'pop_rock').click();
    step.update(state, 'sunny');

    expect(warningEl(step)).not.toBeNull();
    expect(chargeAll(step).disabled).toBe(false);
    chargeAll(step).click();
    expect(gameConsole).toHaveBeenCalled();
  });
});
