// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargeStep } from '../../../../../src/ui/panels/blastSteps/Charge.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { getExplosive, getAllExplosives } from '../../../../../src/core/world/ExplosiveCatalog.js';
import type { DrillHole } from '../../../../../src/core/mining/DrillPlan.js';
import type { ColumnRock } from '../../../../../src/core/mining/ExplosiveRockFit.js';
import { wetAllHoles, setHoleWater } from '../../../../helpers/holeWater.js';
import { t } from '../../../../../src/core/i18n/I18n.js';
import { TUBING_COST } from '../../../../../src/core/mining/Tubing.js';
import { placeBuilding, storeExplosives } from '../../../../../src/core/entities/Building.js';
import { buyStockBlockReason } from '../../../../../src/core/mining/ExplosiveStock.js';
import { CHARGE_DEFAULT_AMOUNT_KG, CHARGE_DEFAULT_STEMMING_M, STOCK_BUY_STEP_KG } from '../../../../../src/core/config/balance.js';
import { dispatchChargeAction } from '../../../../../src/core/mining/ChargeOrder.js';
import { explosiveHoleLimits } from '../../../../../src/core/mining/ChargePlan.js';
import { chargeKgPerMetre } from '../../../../../src/core/mining/HoleDiameter.js';
import { formatGameDuration } from '../../../../../src/ui/formatGameDuration.js';

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

/** Put every hole under water (tight rock unless a porosity is given), as a storm would have. */
function soak(state: ReturnType<typeof makeState>, porosity = 0.03): void {
  for (const h of state.drillHoles) state.holeWater[h.id] = { level: 0.9, porosity };
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);

    step.update(state, 'sunny'); // not raining — no wet holes
    const waterSensitiveId = ['pop_rock', 'krackle', 'shatternite', 'obliviax'].find(id => getExplosive(id)?.waterSensitive)!;
    expect(card(step, waterSensitiveId).textContent).not.toContain('WATER-SENSITIVE');

    wetAllHoles(state); // the hole holds water now, whatever the weather
    step.update(state, 'heavy_rain');
    expect(card(step, waterSensitiveId).textContent).toContain('WATER-SENSITIVE');
  });

  it('never shows the badge on a non-water-sensitive explosive, even while raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    wetAllHoles(state);
    step.update(state, 'heavy_rain');

    const dryId = ['boomite', 'big_bada_boom', 'rumblox', 'dynatomics'].find(id => getExplosive(id)?.waterSensitive === false)!;
    expect(card(step, dryId).textContent).not.toContain('WATER-SENSITIVE');
  });

  it('Charge All dispatches the selected explosive, amount, and stemming for every hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    card(step, 'krackle').click();

    const chargeAllBtn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    chargeAllBtn.click();

    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain('charge hole:*');
    expect(cmd).toContain('explosive:krackle');
    expect(cmd).toContain(`amount:${CHARGE_DEFAULT_AMOUNT_KG}kg`);
    expect(cmd).toContain(`stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
    // #1330: the retuned panel defaults, spelled out
    expect(cmd).toContain('amount:7kg');
    expect(cmd).toContain('stemming:2.5m');
  });

  it('keeps the overflow reason line as the Charge All button next sibling (#1361 scenario selector)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 6, 0.089);
    step.update(state, 'sunny');
    card(step, 'krackle').click();
    const chargeAllBtn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    const stepper = step.root.querySelector('[data-field="amount"]') as HTMLElement;
    const plus = Array.from(stepper.querySelectorAll('button')).pop() as HTMLButtonElement;
    for (let i = 0; i < 10; i++) plus.click();
    step.update(state, 'sunny');
    expect(chargeAllBtn.disabled).toBe(true);
    expect(chargeAllBtn.nextElementSibling?.textContent ?? '').toContain('Shallowest hole is 6 m');
  });

  it('renders one per-hole row per drill hole, keyed by data-hole, each with its own charge button', () => {
    const { step } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    step.update(state, 'sunny');

    expect(step.root.querySelectorAll('[data-action="charge-hole"]')).toHaveLength(2);
    expect(step.root.querySelector(`[data-hole="${h1.id}"] [data-action="charge-hole"]`)).not.toBeNull();
    expect(step.root.querySelector(`[data-hole="${h2.id}"] [data-action="charge-hole"]`)).not.toBeNull();
  });

  it('a per-hole Charge button dispatches charge for that hole alone, with the panel\'s selected explosive/amount/stemming', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    step.update(state, 'sunny');
    card(step, 'krackle').click();

    (step.root.querySelector(`[data-hole="${h2.id}"] [data-action="charge-hole"]`) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith(`charge hole:${h2.id} explosive:krackle amount:${CHARGE_DEFAULT_AMOUNT_KG}kg stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
  });

  it('a per-hole Charge button picks up the amount/stemming steppers, not the defaults', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
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
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
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
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
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

  it('shows the tubing "settled" card when every hole is dry and tubed', () => {
    const { step } = makeStep();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    state.tubingState.installedHoles.add(hole.id);

    step.update(state);

    expect(step.root.textContent).toContain('dry or tubed');
    expect(step.root.querySelector('[data-action="tubing-install"]')).toBeNull();
  });

  it('shows the tubing card with buy and install in dry weather, so holes can be tubed ahead of rain (#1350)', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    state.tubingState.inventory = 5;

    step.update(state, 'sunny');

    const buyBtn = step.root.querySelector('[data-action="tubing-buy"]') as HTMLButtonElement;
    const installBtn = step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement;
    expect(buyBtn).not.toBeNull();
    expect(installBtn).not.toBeNull();
    expect(installBtn.disabled).toBe(false);
    expect(t('ui.blast_workshop.charge.tubing_ahead', { count: 2 })).not.toBe('ui.blast_workshop.charge.tubing_ahead');
    expect(step.root.textContent).not.toContain('holes are taking on water');

    installBtn.click();
    expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h1.id}`);
    expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h2.id}`);

    buyBtn.click();
    expect(gameConsole).toHaveBeenCalledWith('buy amount:10');
  });

  it('dry-weather tubing install skips holes that are already tubed', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    state.tubingState.installedHoles.add(h1.id);
    state.tubingState.inventory = 5;

    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h2.id}`);
  });

  it('shows the tubing "needed" card with the wet count once it starts raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    soak(state);

    wetAllHoles(state);
    step.update(state, 'heavy_rain');

    expect(step.root.textContent).toContain('2 holes are taking on water');
    const installBtn = step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement;
    expect(installBtn).not.toBeNull();
    expect(installBtn.textContent).toContain('Install on 2');
  });

  it('Buy Tubing dispatches the registered buy command', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    wetAllHoles(state);
    step.update(state, 'heavy_rain');

    (step.root.querySelector('[data-action="tubing-buy"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('buy amount:10');
  });

  it('the Buy Tubing button shows the real cost (10 × TUBING_COST), not a stale price', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    wetAllHoles(state);
    step.update(state, 'heavy_rain');

    const buyBtn = step.root.querySelector('[data-action="tubing-buy"]') as HTMLButtonElement;
    expect(buyBtn.textContent).toContain(`$${10 * TUBING_COST}`);
  });

  it('Install Tubing dispatches one install_tubing per untubed hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    const h3 = addHole(holeCounter, state.drillHoles, 16, 10, 8, 0.089);
    state.tubingState.installedHoles.add(h3.id);
    state.tubingState.inventory = 5;
    wetAllHoles(state);
    step.update(state, 'heavy_rain');

    (step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h1.id}`);
    expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h2.id}`);
    expect(gameConsole).toHaveBeenCalledTimes(2);
  });

  it('disables Install Tubing when stock is short, with a reason line', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    state.tubingState.inventory = 1; // 2 holes wet, only 1 tube in stock
    wetAllHoles(state);
    step.update(state, 'heavy_rain');

    const installBtn = step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement;
    expect(installBtn.disabled).toBe(true);
    expect(step.root.textContent).toContain('Only 1 tubes in stock, 2 holes need one');

    installBtn.click();
    expect(gameConsole).not.toHaveBeenCalled();
  });

  describe('draining (#1350)', () => {
    const drainAll = (step: ChargeStep) => step.root.querySelector('[data-action="drain-holes"]') as HTMLButtonElement;

    it('Drain button is disabled with a visible localized reason when no hole is wet', () => {
      const { step, gameConsole } = makeStep();
      const state = makeState();
      addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);

      step.update(state, 'sunny');

      expect(drainAll(step)).not.toBeNull();
      expect(drainAll(step).disabled).toBe(true);
      expect(step.root.textContent).toContain(t('ui.blast_workshop.charge.drain_none_reason'));
      drainAll(step).click();
      expect(gameConsole).not.toHaveBeenCalled();
    });

    it('Drain button is enabled for a wet untubed tight-rock hole and drains every hole', () => {
      const { step, gameConsole } = makeStep();
      const state = makeState();
      const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
      setHoleWater(state, [h1.id], 0.9, 0.03);

      step.update(state, 'sunny');

      expect(drainAll(step).disabled).toBe(false);
      expect(step.root.textContent).not.toContain(t('ui.blast_workshop.charge.drain_none_reason'));
      drainAll(step).click();
      expect(gameConsole).toHaveBeenCalledWith('drain_hole hole:*');
    });

    it('Drain button is disabled with the porous reason when every wet hole is untubed porous rock', () => {
      const { step, gameConsole } = makeStep();
      const state = makeState();
      const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
      setHoleWater(state, [h1.id], 0.9, 0.35);

      step.update(state, 'heavy_rain');

      expect(drainAll(step).disabled).toBe(true);
      expect(step.root.textContent).toContain(t('ui.blast_workshop.charge.drain_porous_reason'));
      drainAll(step).click();
      expect(gameConsole).not.toHaveBeenCalled();
    });

    it('Drain button is enabled once the porous wet hole is tubed', () => {
      const { step } = makeStep();
      const state = makeState();
      const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
      setHoleWater(state, [h1.id], 0.9, 0.35);
      state.tubingState.installedHoles.add(h1.id);

      step.update(state, 'sunny');

      expect(drainAll(step).disabled).toBe(false);
    });

    it('each wet hole row has its own drain button dispatching drain_hole for that hole', () => {
      const { step, gameConsole } = makeStep();
      const state = makeState();
      const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
      const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
      setHoleWater(state, [h2.id], 0.9, 0.03);

      step.update(state, 'sunny');

      const btn = step.root.querySelector(`[data-hole="${h2.id}"] [data-action="drain-hole"]`) as HTMLButtonElement;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(false);
      btn.click();
      expect(gameConsole).toHaveBeenCalledWith(`drain_hole hole:${h2.id}`);

      const dryBtn = step.root.querySelector(`[data-hole="${h1.id}"] [data-action="drain-hole"]`) as HTMLButtonElement | null;
      expect(dryBtn === null || dryBtn.disabled).toBe(true);
    });
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 4, 0.089); // shallowest: default 7 kg (3.5 m column) + 2.5 m stemming > 4 m
    step.update(state, 'sunny');

    expect(chargeAll(step).disabled).toBe(true);
    // max for the 4 m hole under 2.5 m stemming = (4 - 2.5) * 2 = 3 kg
    expect(reasonText(step)).toMatch(/at most 3 kg/);
  });

  it('shows no overflow reason and leaves Charge All enabled when the charge fits every hole', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 6, 0.089);
    step.update(state, 'sunny');

    expect(chargeAll(step).disabled).toBe(false);
    // Only the fit line is under test: the drain and tubing blocks carry their own reasons.
    expect(chargeAll(step).nextElementSibling?.querySelectorAll('.bsx-reason') ?? []).toHaveLength(0);
    expect(chargeAll(step).nextElementSibling?.textContent ?? '').toBe('');
  });

  it('shows no overflow reason, only the no-holes reason, when there are no holes (#1345)', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    expect(chargeAll(step).disabled).toBe(true);
    const reasons = step.root.querySelectorAll('.bsx-reason');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]!.textContent).toBe(t('ui.blast_workshop.charge.no_holes_reason'));
  });

  it('a disabled Charge All dispatches no command when clicked', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 13, 10, 4, 0.089);
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
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
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
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

describe('ChargeStep — pattern line, awaiting funds, refusal notice (#1345)', () => {
  it('shows the pattern line only while a pattern charge is set', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-info="pattern-charge"]')).toBeNull();

    state.patternCharge = { explosiveId: 'boomite', amountKg: 4, stemmingM: 2 };
    step.update(state, 'sunny');
    const line = step.root.querySelector('[data-info="pattern-charge"]')!;
    expect(line.textContent).toBe(t('ui.blast_workshop.charge.pattern_line', {
      explosive: t(getExplosive('boomite')!.nameKey), amount: 4, stemming: 2,
    }));

    state.patternCharge = null;
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-info="pattern-charge"]')).toBeNull();
  });

  it('shows the awaiting-funds reason listing the waiting holes, and clears it when empty', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 14, 10, 8, 0.089);
    state.chargeAwaitingFunds = ['H1', 'H2'];
    step.update(state, 'sunny');
    const warning = step.root.querySelector('[data-warning="awaiting-funds"]')!;
    expect(warning.textContent).toContain(t('ui.blast_workshop.charge.awaiting_funds_reason', { count: 2, holes: 'H1, H2' }));

    state.chargeAwaitingFunds = [];
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-warning="awaiting-funds"]')).toBeNull();
  });

  it('shows a refused command output as a notice and hides it after a successful one', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    const chargeAll = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;

    gameConsole.mockReturnValue({ success: false, output: 'Not enough cash.' });
    chargeAll.click();
    expect(step.root.textContent).toContain('Not enough cash.');

    gameConsole.mockReturnValue({ success: true, output: 'Charged.' });
    chargeAll.click();
    expect(step.root.textContent).not.toContain('Not enough cash.');
  });
});

describe('ChargeStep — draining (#1350)', () => {
  const drainAll = (step: ChargeStep) => step.root.querySelector('[data-action="drain-holes"]') as HTMLButtonElement;
  const drainRow = (step: ChargeStep, id: string) =>
    step.root.querySelector(`[data-hole="${id}"] [data-action="drain-hole"]`) as HTMLButtonElement;

  it('disables Drain with a visible reason when no hole is wet', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state);

    expect(drainAll(step).disabled).toBe(true);
    expect(step.root.textContent).toContain(t('ui.blast_workshop.charge.drain_none_reason'));
    drainAll(step).click();
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('Drain all sends drain_hole hole:* when a wet hole can be drained', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    state.cash = 1000;
    const h = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    soak(state);
    step.update(state);

    expect(drainAll(step).disabled).toBe(false);
    drainAll(step).click();
    expect(gameConsole).toHaveBeenCalledWith('drain_hole hole:*');
    expect(drainRow(step, h.id).disabled).toBe(false);
    drainRow(step, h.id).click();
    expect(gameConsole).toHaveBeenCalledWith(`drain_hole hole:${h.id}`);
  });

  it('blocks an untubed wet hole in porous rock with the porous reason, until it is tubed', () => {
    const { step } = makeStep();
    const state = makeState();
    state.cash = 1000;
    const h = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    soak(state, 0.35);
    step.update(state);

    expect(drainAll(step).disabled).toBe(true);
    expect(drainRow(step, h.id).disabled).toBe(true);
    expect(step.root.textContent).toContain(t('ui.blast_workshop.charge.drain_porous_reason'));

    state.tubingState.installedHoles.add(h.id);
    step.update(state);
    expect(drainAll(step).disabled).toBe(false);
    expect(drainRow(step, h.id).disabled).toBe(false);
  });

  it('repaints when the water level changes', () => {
    const { step } = makeStep();
    const state = makeState();
    state.cash = 1000;
    const h = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    soak(state);
    step.update(state);
    expect(drainAll(step).disabled).toBe(false);

    state.holeWater[h.id]!.level = 0;
    step.update(state);
    expect(drainAll(step).disabled).toBe(true);
  });
});

// ── Explosive Warehouse stock in the Charge step (#1685) ────────────────────
// Hooks the implementation must provide:
//   [data-stock="<explosiveId>"]          one stock row per offered explosive; text shows its kg in stock
//   [data-field="stock-kg"]               -/value/+ stepper (.bsx-stepper-value), starts at STOCK_BUY_STEP_KG, moves by it
//   [data-action="stock-buy"]             buy button for the SELECTED explosive; sends `buy explosive:<id> kg:<n>`
//   [data-info="stock-buy-reason"]        visible reason, present only while the buy button is disabled
//   [data-info="paid-from"]               line: kg from stock and $ cash for the current pattern

function withWarehouse(state: ReturnType<typeof makeState>, stock: Record<string, number> = {}): void {
  placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1);
  for (const [id, kg] of Object.entries(stock)) storeExplosives(state.buildings, id, kg);
}

function stockRow(step: ChargeStep, id: string): HTMLElement | null {
  return step.root.querySelector(`[data-stock="${id}"]`);
}
function buyBtn(step: ChargeStep): HTMLButtonElement {
  return step.root.querySelector('[data-action="stock-buy"]') as HTMLButtonElement;
}
function reasonEl(step: ChargeStep): HTMLElement | null {
  return step.root.querySelector('[data-info="stock-buy-reason"]');
}
function paidFrom(step: ChargeStep): string {
  return step.root.querySelector('[data-info="paid-from"]')?.textContent ?? '';
}
function kgStepper(step: ChargeStep): { value: () => string; plus: HTMLButtonElement; minus: HTMLButtonElement } {
  const f = step.root.querySelector('[data-field="stock-kg"]') as HTMLElement;
  const btns = f.querySelectorAll('button');
  return {
    value: () => f.querySelector('.bsx-stepper-value')!.textContent ?? '',
    minus: btns[0] as HTMLButtonElement,
    plus: btns[btns.length - 1] as HTMLButtonElement,
  };
}

describe('ChargeStep explosive stock (#1685)', () => {
  it('shows a stock row for every offered explosive with its kg in stock', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state, { boomite: 120, krackle: 40 });
    step.update(state, 'sunny');

    expect(stockRow(step, 'boomite')!.textContent).toContain('120');
    expect(stockRow(step, 'krackle')!.textContent).toContain('40');
    expect(stockRow(step, 'dynatomics')!.textContent).toContain('0');
  });

  it('shows 0 kg for every explosive with no warehouse', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    expect(stockRow(step, 'boomite')!.textContent).toContain('0');
  });

  it('repaints the stock row when the stock changes', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state, { boomite: 10 });
    step.update(state, 'sunny');
    expect(stockRow(step, 'boomite')!.textContent).toContain('10');
    storeExplosives(state.buildings, 'boomite', 90);
    step.update(state, 'sunny');
    expect(stockRow(step, 'boomite')!.textContent).toContain('100');
  });

  it('buy control starts at the step amount and the stepper moves by STOCK_BUY_STEP_KG, never below it', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state);
    step.update(state, 'sunny');
    const s = kgStepper(step);

    expect(s.value()).toContain(String(STOCK_BUY_STEP_KG));
    s.plus.click();
    expect(s.value()).toContain(String(2 * STOCK_BUY_STEP_KG));
    s.minus.click();
    s.minus.click();
    expect(s.value()).toContain(String(STOCK_BUY_STEP_KG));
  });

  it('buy button sends `buy explosive:<selected> kg:<n>` and is enabled with warehouse, room and cash', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    withWarehouse(state);
    step.update(state, 'sunny');
    card(step, 'krackle').click();
    kgStepper(step).plus.click();

    expect(buyBtn(step).disabled).toBe(false);
    expect(reasonEl(step)).toBeNull();
    buyBtn(step).click();

    expect(gameConsole).toHaveBeenCalledWith(`buy explosive:krackle kg:${2 * STOCK_BUY_STEP_KG}`);
  });

  it('disables buy with a visible reason when there is no warehouse, and a click sends nothing', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    step.update(state, 'sunny');

    expect(buyBtn(step).disabled).toBe(true);
    expect(reasonEl(step)).not.toBeNull();
    expect(reasonEl(step)!.textContent!.length).toBeGreaterThan(0);
    buyBtn(step).click();
    expect(gameConsole).not.toHaveBeenCalled();
    expect(buyStockBlockReason(state, 'boomite', STOCK_BUY_STEP_KG)).toBe('no_warehouse');
  });

  it('disables buy with a visible reason when the purchase would exceed capacity', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state, { boomite: 480 }); // tier 1 holds 500 kg
    step.update(state, 'sunny');
    // STOCK_BUY_STEP_KG (50) > 20 kg free
    expect(buyStockBlockReason(state, 'boomite', STOCK_BUY_STEP_KG)).toBe('over_capacity');
    expect(buyBtn(step).disabled).toBe(true);
    expect(reasonEl(step)).not.toBeNull();
  });

  it('disables buy with a visible reason when cash cannot pay the bulk price', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state);
    state.cash = 1;
    step.update(state, 'sunny');
    expect(buyStockBlockReason(state, 'boomite', STOCK_BUY_STEP_KG)).toBe('insufficient_funds');
    expect(buyBtn(step).disabled).toBe(true);
    expect(reasonEl(step)).not.toBeNull();
  });

  it('re-enables buy and drops the reason once the blocker is gone', () => {
    const { step } = makeStep();
    const state = makeState();
    step.update(state, 'sunny');
    expect(buyBtn(step).disabled).toBe(true);
    withWarehouse(state);
    step.update(state, 'sunny');
    expect(buyBtn(step).disabled).toBe(false);
    expect(reasonEl(step)).toBeNull();
  });

  it('charging with no warehouse still works as before', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).click();
    expect(gameConsole.mock.calls[0]![0]).toContain('charge hole:*');
  });

  it('paid-from line: stock covering the whole pattern shows all kg from stock and $0 cash', () => {
    const { step } = makeStep();
    const state = makeState();
    for (let i = 0; i < 3; i++) addHole(holeCounter, state.drillHoles, 10 + 3 * i, 10, 8, 0.089);
    withWarehouse(state, { boomite: 100 });
    step.update(state, 'sunny');

    const line = paidFrom(step);
    expect(line).toContain(String(3 * CHARGE_DEFAULT_AMOUNT_KG)); // 21 kg
    expect(line).toContain('$0');
  });

  it('paid-from line: partly covered prices only the shortfall in cash', () => {
    const { step } = makeStep();
    const state = makeState();
    for (let i = 0; i < 3; i++) addHole(holeCounter, state.drillHoles, 10 + 3 * i, 10, 8, 0.089);
    withWarehouse(state, { boomite: 5 });
    step.update(state, 'sunny');

    const line = paidFrom(step);
    const cash = (3 * CHARGE_DEFAULT_AMOUNT_KG - 5) * getExplosive('boomite')!.costPerKg;
    expect(line).toContain('5');
    expect(line).toContain(`$${cash}`);
  });

  it('paid-from line: no stock shows 0 kg from stock and the full list price in cash', () => {
    const { step } = makeStep();
    const state = makeState();
    for (let i = 0; i < 3; i++) addHole(holeCounter, state.drillHoles, 10 + 3 * i, 10, 8, 0.089);
    step.update(state, 'sunny');
    const full = 3 * CHARGE_DEFAULT_AMOUNT_KG * getExplosive('boomite')!.costPerKg;
    expect(paidFrom(step)).toContain(`$${full}`);
  });

  it('paid-from line follows the selected explosive', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    withWarehouse(state, { krackle: 100 });
    step.update(state, 'sunny');
    // Krackle is the stocked explosive, so it is preselected (#2016).
    expect(paidFrom(step)).toContain('$0');
    card(step, 'boomite').click();
    step.update(state, 'sunny');
    expect(paidFrom(step)).not.toContain('$0');
  });

  it('Charge All line (button sub-label) shows net cash cost when stock covers the pattern', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    withWarehouse(state, { boomite: 100 });
    step.update(state, 'sunny');
    const btn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('$0');
  });
});

describe('ChargeStep delivery wait (#1966)', () => {
  function inTransitState() {
    const state = makeState();
    state.tickCount = 280;
    state.cash = 100_000;
    state.finances.cash = 100_000;
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    dispatchChargeAction(state, { id: hole.id, x: 10, z: 10 }, { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    return state;
  }
  const banner = (step: ChargeStep) => step.root.querySelector('[data-info="delivery-transit"]') as HTMLElement | null;

  it('puts the in-transit banner first in the step, visible without scrolling', () => {
    const { step } = makeStep();
    step.update(inTransitState(), 'sunny');
    const first = step.root.firstElementChild as HTMLElement;
    expect(first.dataset['info']).toBe('delivery-transit');
    expect(first.style.display).not.toBe('none');
  });

  it('shows the arrival as day and hour and the rest as a duration, never a tick', () => {
    const { step } = makeStep();
    step.update(inTransitState(), 'sunny');
    const text = banner(step)!.textContent ?? '';
    expect(text).toContain('Day 29, 08:00');
    expect(text).toContain(formatGameDuration(400));
    expect(text).not.toContain('tick');
  });

  it('the remaining duration follows the clock', () => {
    const { step } = makeStep();
    const state = inTransitState();
    step.update(state, 'sunny');
    state.tickCount = 280 + 26;
    step.update(state, 'sunny');
    expect(banner(step)!.textContent).toContain(formatGameDuration(400 - 26));
  });

  it('is hidden when nothing is in transit', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    const el = banner(step);
    expect(el === null || el.style.display === 'none').toBe(true);
  });

  it('hides again once the delivery arrived', () => {
    const { step } = makeStep();
    const state = inTransitState();
    step.update(state, 'sunny');
    state.tickCount = 700;
    step.update(state, 'sunny');
    const el = banner(step);
    expect(el === null || el.style.display === 'none').toBe(true);
  });

  it('the transit data-info occurs once only', () => {
    const { step } = makeStep();
    step.update(inTransitState(), 'sunny');
    expect(step.root.querySelectorAll('[data-info="delivery-transit"]')).toHaveLength(1);
  });

  it('the delivery hint states a duration, not ticks', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    const hint = step.root.querySelector('[data-info="delivery-hint"]') as HTMLElement | null;
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain(formatGameDuration(400));
    expect(hint!.textContent).not.toContain('tick');
  });
});

describe('ChargeStep — hole diameter (#1934)', () => {
  it('capacity line names the narrowest hole\'s bore and kg per metre', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.127);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.165);
    step.update(state, 'sunny');

    const line = step.root.querySelector('[data-info="hole-capacity"]')!.textContent;
    expect(line).toBe(t('ui.blast_workshop.charge.hole_capacity', {
      diameter: 127, kgPerMetre: +chargeKgPerMetre(0.127).toFixed(2),
    }));
  });

  it('kg max label scales with the narrowest hole', () => {
    const { step } = makeStep();
    const narrow = makeState();
    addHole(holeCounter, narrow.drillHoles, 10, 10, 8, 0.089);
    step.update(narrow, 'sunny');
    const narrowLabel = card(step, 'boomite').textContent;

    const { step: wideStep } = makeStep();
    const wide = makeState();
    addHole(holeCounter, wide.drillHoles, 10, 10, 8, 0.127);
    wideStep.update(wide, 'sunny');

    const boomite = getExplosive('boomite')!;
    const maxOf = (d: number) => Math.round(explosiveHoleLimits(boomite, d).maxKg * 10) / 10;
    expect(narrowLabel).toContain(`${maxOf(0.089)} kg max`);
    expect(card(wideStep, 'boomite').textContent).toContain(`${maxOf(0.127)} kg max`);
  });

  it('Charge All amount is raised to the widest hole\'s minimum', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.165);
    step.update(state, 'sunny');
    card(step, 'boomite').click();

    (step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).click();
    const minWide = explosiveHoleLimits(getExplosive('boomite')!, 0.165).minKg;
    const amount = Number(/amount:([\d.]+)/.exec(gameConsole.mock.calls[0]![0] as string)![1]);
    expect(amount).toBeGreaterThanOrEqual(minWide);
  });
});

// ── Initial explosive follows pattern charge, then stock (#2016) ─────────────
// Until the player clicks a card: pattern explosive (if allowed) > allowed explosive
// with the most kg in stock (ties by allowed order) > boomite. A card click wins for
// the session; the rule re-applies only if the pick becomes disallowed.

describe('ChargeStep initial explosive (#2016)', () => {
  function chargeAllBtn(step: ChargeStep): HTMLButtonElement {
    return step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
  }
  function selectedIds(step: ChargeStep): string[] {
    return Array.from(step.root.querySelectorAll('[data-action="select-explosive"]'))
      .filter(c => (c as HTMLElement).dataset['selected'] === 'true')
      .map(c => (c as HTMLElement).dataset['explosive']!);
  }
  const nameOf = (id: string) => t(getExplosive(id)!.nameKey);

  it('preselects the explosive with stock when nothing is picked and Boomite has none', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    withWarehouse(state, { krackle: 300 });
    step.update(state, 'sunny');

    expect(card(step, 'krackle').dataset['selected']).toBe('true');
    expect(card(step, 'boomite').dataset['selected']).toBe('false');
    expect(selectedIds(step)).toEqual(['krackle']);
    const label = chargeAllBtn(step).textContent!;
    expect(label).toContain(nameOf('krackle'));
    expect(label).toContain('$0');
  });

  it('Charge All sends the preselected stocked explosive', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    withWarehouse(state, { krackle: 300 });
    step.update(state, 'sunny');
    chargeAllBtn(step).click();
    expect(gameConsole.mock.calls[0]![0]).toContain('explosive:krackle');
  });

  it('the buy button buys the preselected explosive', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    withWarehouse(state, { krackle: 300 });
    step.update(state, 'sunny');
    buyBtn(step).click();
    expect(gameConsole).toHaveBeenCalledWith(`buy explosive:krackle kg:${STOCK_BUY_STEP_KG}`);
  });

  it('preselects Boomite with an empty warehouse', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state);
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
  });

  it('preselects Boomite with no warehouse', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
  });

  it('picks the explosive with the most kg in stock', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state, { boomite: 20, krackle: 60, dynatomics: 40 });
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);
  });

  it('breaks a stock tie by allowed order', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state, { dynatomics: 100, krackle: 100 });
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);
  });

  it('the pattern charge explosive wins over a larger stock of another', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state, { krackle: 300 });
    state.patternCharge = { explosiveId: 'boomite', amountKg: 4, stemmingM: 2 };
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
  });

  it('the pattern charge explosive wins even with no stock of it at all', () => {
    const { step } = makeStep();
    const state = makeState();
    state.patternCharge = { explosiveId: 'krackle', amountKg: 4, stemmingM: 2 };
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);
  });

  it('a pattern explosive the level does not allow falls through to the most-stocked allowed one', () => {
    const { step } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = 'dusty_hollow'; // pop_rock, boomite, krackle
    withWarehouse(state, { dynatomics: 300, krackle: 80, pop_rock: 10 }); // 500 kg warehouse capacity
    state.patternCharge = { explosiveId: 'dynatomics', amountKg: 4, stemmingM: 2 };
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);
  });

  it('stock of a disallowed explosive is ignored; with no allowed stock Boomite is selected', () => {
    const { step } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = 'dusty_hollow';
    withWarehouse(state, { dynatomics: 500 });
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
  });

  it('keeps the player\'s card pick when the stock then changes', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state);
    step.update(state, 'sunny');
    card(step, 'boomite').click();
    storeExplosives(state.buildings, 'krackle', 300);
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
  });

  it('keeps a player pick of the stocked-out default even when it equals the unpicked default', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state, { boomite: 10 });
    step.update(state, 'sunny');
    card(step, 'boomite').click();
    storeExplosives(state.buildings, 'krackle', 300);
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
  });

  it('re-applies the rule when the player\'s pick becomes disallowed', () => {
    const { step } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = null;
    withWarehouse(state, { krackle: 50 });
    step.update(state, 'sunny');
    card(step, 'dynatomics').click();
    expect(selectedIds(step)).toEqual(['dynatomics']);
    state.campaign.activeLevelId = 'dusty_hollow';
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);
  });

  it('an unpicked selection follows the stock between updates', () => {
    const { step } = makeStep();
    const state = makeState();
    withWarehouse(state);
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);

    storeExplosives(state.buildings, 'krackle', 100);
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);

    storeExplosives(state.buildings, 'dynatomics', 200);
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['dynatomics']);
  });

  it('clamps the amount to the preselected explosive\'s limits in the narrowest hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = 'dusty_hollow';
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    withWarehouse(state, { pop_rock: 200 });
    step.update(state, 'sunny');

    const { maxKg } = explosiveHoleLimits(getExplosive('pop_rock')!, 0.089);
    expect(CHARGE_DEFAULT_AMOUNT_KG).toBeGreaterThan(maxKg);
    expect(selectedIds(step)).toEqual(['pop_rock']);
    expect(chargeAllBtn(step).textContent).toContain(`${maxKg} kg`);
    expect(step.root.querySelector('[data-field="amount"] .bsx-stepper-value')!.textContent).toBe(`${maxKg} kg`);
    chargeAllBtn(step).click();
    expect(gameConsole.mock.calls[0]![0]).toContain(`amount:${maxKg}kg`);
  });
});
