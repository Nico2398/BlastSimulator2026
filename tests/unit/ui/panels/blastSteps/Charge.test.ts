// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChargeStep } from '../../../../../src/ui/panels/blastSteps/Charge.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { getExplosive, getAllExplosives } from '../../../../../src/core/world/ExplosiveCatalog.js';
import { wetAllHoles, setHoleWater } from '../../../../helpers/holeWater.js';
import { drainRainReasonText } from '../../../../../src/ui/panels/blastSteps/ChargeHoleList.js';
import { createCharge, fillChargeKg } from '../../../../../src/core/mining/ChargePlan.js';
import { VoxelGrid } from '../../../../../src/core/world/VoxelGrid.js';
import { recommendedPowderFactors, stemmingSweepRangeM } from '../../../../../src/core/mining/SoftwarePreview.js';
import { t } from '../../../../../src/core/i18n/I18n.js';
import { TUBING_COST } from '../../../../../src/core/mining/Tubing.js';
import { CHARGE_DEFAULT_STEMMING_M, MIN_STEMMING_M } from '../../../../../src/core/config/balance.js';
import { dispatchChargeAction } from '../../../../../src/core/mining/ChargeOrder.js';
import { chargeKgPerMetre } from '../../../../../src/core/mining/HoleDiameter.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';
import { setLocale } from '../../../../../src/core/i18n/I18n.js';
import { createGradeState } from '../../../../../src/core/economy/MineGrade.js';
import { chargeKgLimitWarning, permitPreview } from '../../../../../src/ui/panels/permitPreview.js';
import { stemmingExplain } from '../../../../../src/ui/blastWorkshopExplain.js';
import { pinnedDryCycle, pinnedCycle, rainAfterCycle, dryForCycle } from '../../../../helpers/weatherCycles.js';
import { recommendedRangeText } from '../../../../../src/ui/bandMix.js';
import { permitLimitsFor } from '../../../../../src/core/economy/PermitLimits.js';

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

/** The stemming stepper's shown value, e.g. "2.5 m". */
function stemmingText(step: ChargeStep): string {
  return step.root.querySelector('[data-field="stemming"] .bsx-stepper-value')!.textContent ?? '';
}

/** The stemming stepper's minus and plus buttons. */
function stemmingButtons(step: ChargeStep): { minus: HTMLButtonElement; plus: HTMLButtonElement } {
  const buttons = Array.from(step.root.querySelectorAll<HTMLButtonElement>('[data-field="stemming"] .bsx-stepper-btn'));
  return { minus: buttons[0]!, plus: buttons[buttons.length - 1]! };
}

/** Click the stemming stepper until it shows `m` metres (0.1 m steps). */
function stepStemmingTo(step: ChargeStep, m: number): void {
  const { minus, plus } = stemmingButtons(step);
  const want = `${m.toFixed(1)} m`;
  for (let i = 0; i < 200 && stemmingText(step) !== want; i++) (parseFloat(stemmingText(step)) < m ? plus : minus).click();
  expect(stemmingText(step)).toBe(want);
}

/** The read-only "Per hole" readout: what each hole holds filled up to the stemming. */
function perHoleText(step: ChargeStep): string {
  return step.root.querySelector('[data-role="charge-per-hole"]')!.textContent ?? '';
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

  it('shows the WATER-SENSITIVE badge on every water-sensitive explosive, wet or dry', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);

    step.update(state, 'sunny'); // not raining — no wet holes
    const waterSensitiveId = ['pop_rock', 'krackle', 'shatternite', 'obliviax'].find(id => getExplosive(id)?.waterSensitive)!;
    expect(card(step, waterSensitiveId).textContent).toContain('WATER-SENSITIVE');

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

  it('Charge All fills every hole with the selected explosive up to the stemming: explosive and stemming, no amount', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    card(step, 'krackle').click();

    const chargeAllBtn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    chargeAllBtn.click();

    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toBe(`charge hole:* explosive:krackle stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
    expect(cmd).not.toContain('amount:');
    // #1330: the panel's default stemming, spelled out
    expect(cmd).toContain('stemming:2.5m');
  });

  it('keeps the no-room reason line as the Charge All button next sibling (#1361 scenario selector)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 6, 0.089);
    step.update(state, 'sunny');
    card(step, 'krackle').click();
    const chargeAllBtn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    stepStemmingTo(step, 6);
    step.update(state, 'sunny');
    expect(chargeAllBtn.disabled).toBe(true);
    expect(chargeAllBtn.nextElementSibling?.textContent ?? '').toBe(t('ui.blast_workshop.charge.no_room_reason', { depth: 6, stemming: 6 }));
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

  it('a per-hole Charge button dispatches charge for that hole alone, with the panel\'s selected explosive and stemming', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    const h2 = addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    step.update(state, 'sunny');
    card(step, 'krackle').click();

    (step.root.querySelector(`[data-hole="${h2.id}"] [data-action="charge-hole"]`) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith(`charge hole:${h2.id} explosive:krackle stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
  });

  it('a per-hole Charge button picks up the stemming stepper, not the default', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');

    stemmingButtons(step).plus.click(); // default m → one stemming step up (step size not pinned here)
    const stemmingShown = parseFloat(stemmingText(step));
    expect(stemmingShown).toBeGreaterThan(CHARGE_DEFAULT_STEMMING_M);

    (step.root.querySelector(`[data-hole="${h1.id}"] [data-action="charge-hole"]`) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith(`charge hole:${h1.id} explosive:boomite stemming:${stemmingShown}m`);
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

  // ── the kg each hole holds is read, never stepped ─────────────────────────

  it('has no kg stepper: the stemming is the one stepper of the step', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-field="amount"]')).toBeNull();
    expect(step.root.querySelectorAll('.bsx-stepper')).toHaveLength(1);
    expect(step.root.querySelector('[data-field="stemming"] .bsx-stepper')).not.toBeNull();
    const perHole = step.root.querySelector('[data-role="charge-per-hole"]')!;
    expect(perHole.querySelector('button, input')).toBeNull();
  });

  it('the per-hole readout shows what the hole holds of the selected explosive, filled up to the stemming', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    expect(perHoleText(step)).toBe(`${fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.089, 'boomite')} kg`);
    expect(perHoleText(step)).toBe('11 kg');

    card(step, 'pop_rock').click(); // lighter: fewer kg fill the same hole
    step.update(state, 'sunny');
    expect(perHoleText(step)).toBe(`${fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.089, 'pop_rock')} kg`);

    card(step, 'dynatomics').click(); // denser: more kg in the same hole
    step.update(state, 'sunny');
    expect(perHoleText(step)).toBe(`${fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.089, 'dynatomics')} kg`);
  });

  it('the per-hole readout follows the stemming: more stemming, less explosive', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    stepStemmingTo(step, 4);
    step.update(state, 'sunny');
    expect(perHoleText(step)).toBe(`${fillChargeKg(8, 4, 0.089, 'boomite')} kg`);
    expect(perHoleText(step)).toBe('8 kg');
  });

  it('the per-hole readout spans the holes when they hold different amounts, and is a dash without holes', () => {
    const { step } = makeStep();
    const state = makeState();
    step.update(state, 'sunny');
    expect(perHoleText(step)).toBe('—');
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 4, 0.089);
    step.update(state, 'sunny');
    // 4 m hole: 1.5 m under 2.5 m of stemming = 3 kg of boomite; 8 m hole: 11 kg.
    expect(perHoleText(step)).toBe('3–11 kg');
  });

  it('one stemming increment moves 2.5 -> 2.6 (0.1 m step)', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    expect(stemmingText(step)).toBe('2.5 m');
    stemmingButtons(step).plus.click();
    expect(stemmingText(step)).toBe('2.6 m');
  });

  it('stemming stepper floors at 0.5m', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    for (let i = 0; i < 30; i++) stemmingButtons(step).minus.click();
    expect(stemmingText(step)).toBe(`${MIN_STEMMING_M.toFixed(1)} m`);
    expect(stemmingText(step)).toBe('0.5 m');
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

    it('Drain button is a disabled neutral button, with no warning, when no hole is wet (#2149)', () => {
      const { step, gameConsole } = makeStep();
      const state = makeState();
      addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);

      step.update(state, 'sunny');

      expect(drainAll(step)).not.toBeNull();
      expect(drainAll(step).disabled).toBe(true);
      expect(drainAll(step).parentElement!.querySelectorAll('.bsx-reason')).toHaveLength(0);
      expect(step.root.textContent).not.toContain(t('ui.blast_workshop.charge.drain_none_reason'));
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


// A charge fills its hole, so it can never overflow it: what can go wrong is a stemming that leaves no room.
describe('ChargeStep — no-room guard (#1361)', () => {
  const reasonText = (step: ChargeStep): string =>
    Array.from(step.root.querySelectorAll('.bsx-reason')).map(e => e.textContent ?? '').join(' | ');
  const chargeAll = (step: ChargeStep) => step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;

  it('shows a reason line naming the shallowest hole and disables Charge All when the stemming leaves no room in it', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 4, 0.089);
    step.update(state, 'sunny');
    expect(chargeAll(step).disabled).toBe(false);

    stepStemmingTo(step, 4); // the 4 m hole is all stemming now
    step.update(state, 'sunny');

    expect(chargeAll(step).disabled).toBe(true);
    expect(reasonText(step)).toContain(t('ui.blast_workshop.charge.no_room_reason', { depth: 4, stemming: 4 }));
  });

  it('boundary: the last stemming that leaves room keeps Charge All enabled', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 13, 10, 4, 0.089);
    step.update(state, 'sunny');
    stepStemmingTo(step, 3.9); // 0.1 m of boomite: 0.2 kg
    step.update(state, 'sunny');
    expect(perHoleText(step)).toBe('0.2 kg');
    expect(chargeAll(step).disabled).toBe(false);
    expect(chargeAll(step).nextElementSibling?.textContent ?? '').toBe('');
  });

  it('shows no reason and leaves Charge All enabled when every hole has room under the stemming', () => {
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

  it('shows no no-room reason, only the no-holes reason, when there are no holes (#1345)', () => {
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
    stepStemmingTo(step, 4.5);
    step.update(state, 'sunny');
    expect(chargeAll(step).disabled).toBe(true);

    chargeAll(step).click();

    expect(gameConsole).not.toHaveBeenCalled();
  });
});

describe('ChargeStep — no weak-explosive warning (#2197)', () => {
  const WARNING = '[data-warning="weak-explosive"]';
  const chargeAll = (step: ChargeStep) => step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;

  function stepWithHoles() {
    const made = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    return { ...made, state };
  }

  it.each(['pop_rock', 'boomite', 'obliviax', 'dynatomics'])('shows no weak-explosive warning after picking %s', (id) => {
    const { step, state } = stepWithHoles();
    step.update(state, 'sunny');
    card(step, id).click();
    step.update(state, 'sunny');

    expect(step.root.querySelector(WARNING)).toBeNull();
  });

  it('shows no warning before any explosive is picked', () => {
    const { step, state } = stepWithHoles();
    step.update(state, 'sunny');
    expect(step.root.querySelector(WARNING)).toBeNull();
  });

  it('no longer offers a rock sampler to feed the warning', () => {
    const { step } = stepWithHoles();
    expect((step as unknown as Record<string, unknown>)['setHoleRockSampler']).toBeUndefined();
  });

  it('keeps Charge All enabled and dispatching with the weakest explosive selected', () => {
    const { step, state, gameConsole } = stepWithHoles();
    step.update(state, 'sunny');
    card(step, 'pop_rock').click();
    step.update(state, 'sunny');

    expect(chargeAll(step).disabled).toBe(false);
    chargeAll(step).click();
    expect(gameConsole).toHaveBeenCalled();
  });
});

describe('ChargeStep — pattern line, refusal notice (#1345)', () => {
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

  it('a fill pattern (no amount) says each hole is filled up to its stemming', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    state.patternCharge = { explosiveId: 'krackle', amountKg: null, stemmingM: 3 };
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-info="pattern-charge"]')!.textContent).toBe(t('ui.blast_workshop.charge.pattern_line_fill', {
      explosive: t(getExplosive('krackle')!.nameKey), stemming: 3,
    }));
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

  it('disables Drain without any warning element when no hole is wet (#2149)', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state);

    expect(drainAll(step).disabled).toBe(true);
    expect(drainAll(step).parentElement!.querySelectorAll('.bsx-reason')).toHaveLength(0);
    expect(step.root.textContent).not.toContain(t('ui.blast_workshop.charge.drain_none_reason'));
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

// ── Charge step prices at list price, no stock (#2153) ──────────────────────

describe('ChargeStep prices the pattern at list price (#2153)', () => {
  it('charging with no warehouse works', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).click();
    expect(gameConsole.mock.calls[0]![0]).toContain('charge hole:*');
  });

  it('shows holes x fill x list price for the pattern', () => {
    const { step } = makeStep();
    const state = makeState();
    for (let i = 0; i < 3; i++) addHole(holeCounter, state.drillHoles, 10 + 3 * i, 10, 8, 0.089);
    step.update(state, 'sunny');
    const full = 3 * fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.089, 'boomite') * getExplosive('boomite')!.costPerKg;
    expect(step.root.textContent).toContain(`$${full}`);
  });

  it('prices each hole at its own fill when the holes differ', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 5, 0.089);
    step.update(state, 'sunny');
    const kg = fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.089, 'boomite') + fillChargeKg(5, CHARGE_DEFAULT_STEMMING_M, 0.089, 'boomite');
    const line = (step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).textContent ?? '';
    expect(line).toContain(`$${formatMoney(kg * getExplosive('boomite')!.costPerKg)}`);
  });

  it('has no stock rows, stock buy control or paid-from line', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-stock]')).toBeNull();
    expect(step.root.querySelector('[data-field="stock-kg"]')).toBeNull();
    expect(step.root.querySelector('[data-action="stock-buy"]')).toBeNull();
    expect(step.root.querySelector('[data-info="stock-buy-reason"]')).toBeNull();
    expect(step.root.querySelector('[data-info="paid-from"]')).toBeNull();
  });
});

describe('ChargeStep has no delivery wait (#2143)', () => {
  function orderedState() {
    const state = makeState();
    state.tickCount = 280;
    state.cash = 100_000;
    state.finances.cash = 100_000;
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    dispatchChargeAction(state, { id: hole.id, x: 10, z: 10 }, { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    return state;
  }

  it('has no in-transit banner with an order outstanding on an empty warehouse', () => {
    const { step } = makeStep();
    step.update(orderedState(), 'sunny');
    expect(step.root.querySelector('[data-info="delivery-transit"]')).toBeNull();
  });

  it('has no delivery hint when the pattern would be bought with cash', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-info="delivery-hint"]')).toBeNull();
  });

  it('shows no arrival or transit wording anywhere in the step', () => {
    const { step } = makeStep();
    step.update(orderedState(), 'sunny');
    const text = step.root.textContent ?? '';
    expect(text).not.toMatch(/arrive|arrival|in transit|on the way|on their way/i);
    expect(text).not.toContain('Day 29, 08:00');
  });
});

describe('ChargeStep — hole diameter (#1934)', () => {
  it('capacity line names the narrowest hole\'s bore and the selected explosive\'s kg per metre', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.127);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.165);
    step.update(state, 'sunny');

    const line = () => step.root.querySelector('[data-info="hole-capacity"]')!.textContent;
    expect(line()).toBe(t('ui.blast_workshop.charge.hole_capacity', {
      diameter: 127, kgPerMetre: +chargeKgPerMetre(0.127, 'boomite').toFixed(2), explosive: t(getExplosive('boomite')!.nameKey),
    }));

    card(step, 'krackle').click(); // denser: more kg in each metre
    step.update(state, 'sunny');
    expect(line()).toBe(t('ui.blast_workshop.charge.hole_capacity', {
      diameter: 127, kgPerMetre: +chargeKgPerMetre(0.127, 'krackle').toFixed(2), explosive: t(getExplosive('krackle')!.nameKey),
    }));
  });

  it('each card\'s kg per metre scales with the narrowest hole', () => {
    const perMetre = (s: ChargeStep, id: string) => card(s, id).querySelector('[data-role="explosive-per-metre"]')!.textContent ?? '';
    const { step } = makeStep();
    const narrow = makeState();
    addHole(holeCounter, narrow.drillHoles, 10, 10, 8, 0.089);
    step.update(narrow, 'sunny');

    const { step: wideStep } = makeStep();
    const wide = makeState();
    addHole(holeCounter, wide.drillHoles, 10, 10, 8, 0.127);
    wideStep.update(wide, 'sunny');

    expect(perMetre(step, 'boomite')).toContain(`${+chargeKgPerMetre(0.089, 'boomite').toFixed(1)} kg/m`);
    expect(perMetre(wideStep, 'boomite')).toContain(`${+chargeKgPerMetre(0.127, 'boomite').toFixed(1)} kg/m`);
    expect(perMetre(wideStep, 'boomite')).not.toBe(perMetre(step, 'boomite'));
  });

  it('Charge All fills each hole to its own bore: the readout spans the narrow and the wide hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.165);
    step.update(state, 'sunny');
    card(step, 'boomite').click();
    step.update(state, 'sunny');

    const narrowKg = fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.089, 'boomite');
    const wideKg = fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.165, 'boomite');
    expect(wideKg).toBeGreaterThan(narrowKg);
    expect(perHoleText(step)).toBe(`${narrowKg}–${wideKg} kg`);

    (step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).click();
    // One command for the pattern: the core fills each hole to its own depth and bore.
    expect(gameConsole.mock.calls[0]![0]).toBe(`charge hole:* explosive:boomite stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
  });
});

// ── Initial explosive follows pattern charge, then Boomite (#2016, #2153) ────
// Until the player clicks a card: pattern explosive (if allowed) > boomite > first allowed.
// A card click wins for the session; the rule re-applies only if the pick becomes disallowed.

describe('ChargeStep initial explosive (#2016)', () => {
  function chargeAllBtn(step: ChargeStep): HTMLButtonElement {
    return step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
  }
  function selectedIds(step: ChargeStep): string[] {
    return Array.from(step.root.querySelectorAll('[data-action="select-explosive"]'))
      .filter(c => (c as HTMLElement).dataset['selected'] === 'true')
      .map(c => (c as HTMLElement).dataset['explosive']!);
  }

  it('preselects Boomite when nothing is picked', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
    expect(card(step, 'boomite').dataset['selected']).toBe('true');
    expect(card(step, 'krackle').dataset['selected']).toBe('false');
  });

  it('the pattern charge explosive is preselected', () => {
    const { step } = makeStep();
    const state = makeState();
    state.patternCharge = { explosiveId: 'krackle', amountKg: 4, stemmingM: 2 };
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);
  });

  it('Charge All sends the preselected pattern explosive', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    state.patternCharge = { explosiveId: 'krackle', amountKg: 4, stemmingM: 2 };
    step.update(state, 'sunny');
    chargeAllBtn(step).click();
    expect(gameConsole.mock.calls[0]![0]).toContain('explosive:krackle');
  });

  it('a pattern explosive the level does not allow falls through to Boomite', () => {
    const { step } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = 'dusty_hollow'; // pop_rock, boomite, krackle
    state.patternCharge = { explosiveId: 'dynatomics', amountKg: 4, stemmingM: 2 };
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
  });

  it('keeps the player\'s card pick when the pattern charge then changes', () => {
    const { step } = makeStep();
    const state = makeState();
    step.update(state, 'sunny');
    card(step, 'krackle').click();
    state.patternCharge = { explosiveId: 'boomite', amountKg: 4, stemmingM: 2 };
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['krackle']);
  });

  it('re-applies the rule when the player\'s pick becomes disallowed', () => {
    const { step } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = null;
    step.update(state, 'sunny');
    card(step, 'dynatomics').click();
    expect(selectedIds(step)).toEqual(['dynatomics']);
    state.campaign.activeLevelId = 'dusty_hollow';
    step.update(state, 'sunny');
    expect(selectedIds(step)).toEqual(['boomite']);
  });

  it('fills with the preselected explosive: the readout and the Charge All line show its fill of the hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    state.campaign.activeLevelId = 'dusty_hollow';
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    state.patternCharge = { explosiveId: 'pop_rock', amountKg: null, stemmingM: 2 };
    step.update(state, 'sunny');

    const kg = fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.089, 'pop_rock');
    expect(kg).toBeLessThan(fillChargeKg(8, CHARGE_DEFAULT_STEMMING_M, 0.089, 'boomite'));
    expect(selectedIds(step)).toEqual(['pop_rock']);
    expect(perHoleText(step)).toBe(`${kg} kg`);
    expect(chargeAllBtn(step).textContent).toContain(`${kg} kg`);
    chargeAllBtn(step).click();
    expect(gameConsole.mock.calls[0]![0]).toBe(`charge hole:* explosive:pop_rock stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
  });
});

describe('ChargeStep — drain reason while it rains (#1957)', () => {
  const drainAll = (step: ChargeStep) => step.root.querySelector('[data-action="drain-holes"]') as HTMLButtonElement;
  const drainRow = (step: ChargeStep, id: string) =>
    step.root.querySelector(`[data-hole="${id}"] [data-action="drain-hole"]`) as HTMLButtonElement;
  const RAIN_LINE = '[data-role="drain-rain-reason"]';

  function chargedWetState(explosiveId: string, weather: 'light_rain' | 'sunny', porosity = 0.03) {
    const state = makeState();
    state.cash = 1000;
    const h = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    const c = createCharge(explosiveId, 5, 2, h.depth);
    if ('charge' in c) state.chargesByHole[h.id] = c.charge;
    state.holeWater[h.id] = { level: 0.9, porosity };
    state.weather.current = weather;
    return { state, h };
  }

  it('drainRainReasonText is the localized rain reason', () => {
    expect(drainRainReasonText()).toBe(t('ui.blast_workshop.charge.drain_rain_reason'));
    expect(drainRainReasonText()).not.toBe('');
  });

  it('shows the rain reason line beside an enabled drain-all when a wet hole is rain-exposed', () => {
    const { step } = makeStep();
    const { state } = chargedWetState('boomite', 'light_rain');
    step.update(state, 'light_rain');

    expect(drainAll(step).disabled).toBe(false);
    const line = step.root.querySelector(RAIN_LINE);
    expect(line).not.toBeNull();
    expect(line!.textContent).toBe(drainRainReasonText());
  });

  it('the per-hole drain button carries the rain text as title and the row is marked rainExposed', () => {
    const { step } = makeStep();
    const { state, h } = chargedWetState('boomite', 'light_rain');
    step.update(state, 'light_rain');

    expect(drainRow(step, h.id).disabled).toBe(false);
    expect(drainRow(step, h.id).title).toBe(drainRainReasonText());
    expect((step.root.querySelector(`[data-hole="${h.id}"]`) as HTMLElement).dataset['rainExposed']).toBe('true');
  });

  it('shows no rain line when sunny', () => {
    const { step } = makeStep();
    const { state, h } = chargedWetState('boomite', 'sunny');
    step.update(state, 'sunny');

    expect(drainAll(step).disabled).toBe(false);
    expect(step.root.querySelector(RAIN_LINE)).toBeNull();
    expect(drainRow(step, h.id).title).not.toBe(drainRainReasonText());
  });

  it('shows no rain line for a water-resistant charge in rain', () => {
    const { step } = makeStep();
    const { state } = chargedWetState('krackle', 'light_rain');
    step.update(state, 'light_rain');
    expect(step.root.querySelector(RAIN_LINE)).toBeNull();
  });

  it('shows no rain line for a tubed hole in rain', () => {
    const { step } = makeStep();
    const { state, h } = chargedWetState('boomite', 'light_rain');
    state.tubingState.installedHoles.add(h.id);
    step.update(state, 'light_rain');
    expect(step.root.querySelector(RAIN_LINE)).toBeNull();
  });

  it('a porous untubed block keeps the porous reason, not the rain reason', () => {
    const { step } = makeStep();
    const { state } = chargedWetState('boomite', 'light_rain', 0.35);
    step.update(state, 'light_rain');

    expect(drainAll(step).disabled).toBe(true);
    expect(step.root.textContent).toContain(t('ui.blast_workshop.charge.drain_porous_reason'));
    expect(step.root.querySelector(RAIN_LINE)).toBeNull();
  });

  it('repaints the rain line when the weather clears', () => {
    const { step } = makeStep();
    const { state } = chargedWetState('boomite', 'light_rain');
    step.update(state, 'light_rain');
    expect(step.root.querySelector(RAIN_LINE)).not.toBeNull();
    state.weather.current = 'sunny';
    step.update(state, 'sunny');
    expect(step.root.querySelector(RAIN_LINE)).toBeNull();
  });
});

// ── Warnings only when they matter (#2149) ──────────────────────────────────

describe('ChargeStep — drain and tubing warnings only when they matter (#2149)', () => {
  const drainAll = (step: ChargeStep) => step.root.querySelector('[data-action="drain-holes"]') as HTMLButtonElement;
  const sectionHeader = (step: ChargeStep): HTMLElement =>
    Array.from(step.root.querySelectorAll<HTMLElement>('.bsx-section'))
      .find(h => h.textContent?.includes(t('ui.blast_workshop.charge.tubing_section')))!;
  /** The element holding the tubing card: the sibling right after the Tubing section header. */
  const tubingBlock = (step: ChargeStep): HTMLElement => sectionHeader(step).nextElementSibling as HTMLElement;
  const tubingReasons = (step: ChargeStep) => tubingBlock(step).querySelectorAll('.bsx-reason');
  const installBtn = (step: ChargeStep) => step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement;

  /** Two untubed dry holes and no tubes in stock: a shortage that only matters when water threatens. */
  function shortStockState(weather = pinnedDryCycle()) {
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    state.tubingState.inventory = 0;
    state.weather = weather;
    return state;
  }

  afterEach(() => setLocale('en'));

  describe('drain section', () => {
    it('C1: shows no warning element beside the drain button when no hole is wet', () => {
      const { step } = makeStep();
      const state = shortStockState();
      step.update(state, 'sunny');

      expect(drainAll(step)).not.toBeNull();
      expect(drainAll(step).disabled).toBe(true);
      expect(drainAll(step).parentElement!.querySelectorAll('.bsx-reason')).toHaveLength(0);
    });

    it('C1: stays free of warnings while rain is due and the holes are still dry', () => {
      const { step } = makeStep();
      const state = shortStockState(pinnedCycle('heavy_rain'));
      step.update(state, 'heavy_rain');

      expect(drainAll(step).disabled).toBe(true);
      expect(drainAll(step).parentElement!.querySelectorAll('.bsx-reason')).toHaveLength(0);
    });

    it('C1: the warning is gone again once the water has been drained away', () => {
      const { step } = makeStep();
      const state = shortStockState();
      state.cash = 1000;
      const holes = state.drillHoles.map(h => h.id);
      setHoleWater(state, holes, 0.9, 0.35);
      step.update(state, 'sunny');
      expect(drainAll(step).parentElement!.querySelectorAll('.bsx-reason').length).toBeGreaterThan(0);

      for (const id of holes) state.holeWater[id]!.level = 0;
      step.update(state, 'sunny');

      expect(drainAll(step).parentElement!.querySelectorAll('.bsx-reason')).toHaveLength(0);
    });

    it('C2: a wet untubed hole in porous rock still shows the porous warning', () => {
      const { step } = makeStep();
      const state = shortStockState();
      state.cash = 1000;
      setHoleWater(state, [state.drillHoles[0]!.id], 0.9, 0.35);
      step.update(state, 'sunny');

      const reasons = drainAll(step).parentElement!.querySelectorAll('.bsx-reason');
      expect(drainAll(step).disabled).toBe(true);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]!.textContent).toBe(t('ui.blast_workshop.charge.drain_porous_reason'));
    });

    it('C2: the porous warning also shows in the rain', () => {
      const { step } = makeStep();
      const state = shortStockState(pinnedCycle('storm'));
      state.cash = 1000;
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.35);
      step.update(state, 'storm');

      expect(drainAll(step).parentElement!.textContent).toContain(t('ui.blast_workshop.charge.drain_porous_reason'));
    });
  });

  describe('tubing card', () => {
    it('C3: no stock-shortage warning for dry holes, dry ground and no rain due; card and controls stay', () => {
      const { step } = makeStep();
      const state = shortStockState();
      step.update(state, 'sunny');

      expect(installBtn(step)).not.toBeNull();
      expect(step.root.querySelector('[data-action="tubing-buy"]')).not.toBeNull();
      expect(tubingReasons(step)).toHaveLength(0);
      expect(tubingBlock(step).textContent).not.toContain(t('ui.blast_workshop.charge.tubing_reason', { stock: 0, need: 2 }));
    });

    it('C3: no warning when rain is due only after the 24 tick lookahead', () => {
      const { step } = makeStep();
      const state = shortStockState(rainAfterCycle(26, 'desert'));
      expect(state.mineType).toBe('desert');
      step.update(state, 'sunny');

      expect(installBtn(step)).not.toBeNull();
      expect(tubingReasons(step)).toHaveLength(0);
    });

    it.each(['light_rain', 'heavy_rain', 'storm'] as const)('C3: warns while it is raining now (%s), even over dry holes', weather => {
      const { step } = makeStep();
      const state = shortStockState(pinnedCycle(weather));
      step.update(state, weather);

      expect(tubingReasons(step)).toHaveLength(1);
      expect(installBtn(step).disabled).toBe(true);
    });

    it('C3: warns when the forecast has rain at tick 24 of the next 24', () => {
      const { step } = makeStep();
      const state = shortStockState(rainAfterCycle(24, 'desert'));
      step.update(state, 'sunny');

      expect(tubingReasons(step)).toHaveLength(1);
    });

    it('C3: warns when the forecast has rain soon', () => {
      const { step } = makeStep();
      const state = shortStockState(rainAfterCycle(3, 'desert'));
      step.update(state, 'sunny');

      expect(tubingReasons(step)).toHaveLength(1);
    });

    it('C3/C4: warns for a wet untubed hole under a dry sky with no rain due', () => {
      const { step } = makeStep();
      const state = shortStockState();
      setHoleWater(state, [state.drillHoles[0]!.id], 0.9, 0.03);
      step.update(state, 'sunny');

      expect(tubingReasons(step)).toHaveLength(1);
      expect(installBtn(step).disabled).toBe(true);
    });

    it('C3: a wet hole that is already tubed does not raise the warning', () => {
      const { step } = makeStep();
      const state = shortStockState();
      const [wetHole] = state.drillHoles;
      setHoleWater(state, [wetHole!.id], 0.9, 0.03);
      state.tubingState.installedHoles.add(wetHole!.id);
      step.update(state, 'sunny');

      expect(installBtn(step)).not.toBeNull();
      expect(tubingReasons(step)).toHaveLength(0);
    });

    it('C3: no warning when stock covers every untubed hole, rain or not', () => {
      const { step } = makeStep();
      const state = shortStockState(pinnedCycle('storm'));
      state.tubingState.inventory = 2;
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.03);
      step.update(state, 'storm');

      expect(installBtn(step).disabled).toBe(false);
      expect(tubingReasons(step)).toHaveLength(0);
    });

    it('C4: wet untubed holes and short stock show the warning with the stock and need', () => {
      const { step } = makeStep();
      const state = shortStockState();
      state.tubingState.inventory = 1;
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.03);
      step.update(state, 'sunny');

      const reasons = tubingReasons(step);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]!.textContent).toBe(t('ui.blast_workshop.charge.tubing_reason', { stock: 1, need: 2 }));
    });

    it('the warning appears when rain turns up on the same panel and goes when it clears', () => {
      const { step } = makeStep();
      const state = shortStockState();
      step.update(state, 'sunny');
      expect(tubingReasons(step)).toHaveLength(0);

      state.weather = pinnedCycle('heavy_rain');
      step.update(state, 'heavy_rain');
      expect(tubingReasons(step)).toHaveLength(1);

      state.weather = pinnedDryCycle();
      step.update(state, 'sunny');
      expect(tubingReasons(step)).toHaveLength(0);
    });

    it('the warning appears when the forecast changes to show rain ahead, with the current sky unchanged', () => {
      const { step } = makeStep();
      const state = shortStockState();
      step.update(state, 'sunny');
      expect(tubingReasons(step)).toHaveLength(0);

      state.weather = rainAfterCycle(8, 'desert');
      step.update(state, 'sunny');

      expect(tubingReasons(step)).toHaveLength(1);
    });

    it('the warning appears when a hole turns wet on the same panel', () => {
      const { step } = makeStep();
      const state = shortStockState();
      step.update(state, 'sunny');
      expect(tubingReasons(step)).toHaveLength(0);

      setHoleWater(state, [state.drillHoles[1]!.id], 0.9, 0.03);
      step.update(state, 'sunny');

      expect(tubingReasons(step)).toHaveLength(1);
    });
  });

  describe('C5: hole counts read singular for 1 (en and fr)', () => {
    const oneHoleState = (weather = pinnedDryCycle()) => {
      const state = makeState();
      addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
      state.tubingState.inventory = 0;
      state.weather = weather;
      return state;
    };
    const twoHoleState = (weather = pinnedDryCycle()) => {
      const state = oneHoleState(weather);
      addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
      return state;
    };

    it('en: one wet untubed hole reads "1 hole", not "1 holes"', () => {
      const { step } = makeStep();
      const state = oneHoleState();
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.03);
      step.update(state, 'sunny');

      const text = tubingBlock(step).textContent ?? '';
      expect(text).toMatch(/\b1 hole\b/);
      expect(text).not.toMatch(/\b1 holes\b/);
    });

    it('en: two wet untubed holes read "2 holes"', () => {
      const { step } = makeStep();
      const state = twoHoleState();
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.03);
      step.update(state, 'sunny');

      expect(tubingBlock(step).textContent).toMatch(/\b2 holes\b/);
    });

    it('en: one untubed dry hole (tubing ahead) reads "1 hole", not "1 holes"', () => {
      const { step } = makeStep();
      const state = oneHoleState();
      step.update(state, 'sunny');

      const text = tubingBlock(step).textContent ?? '';
      expect(text).toMatch(/\b1 hole\b/);
      expect(text).not.toMatch(/\b1 holes\b/);
    });

    it('en: two untubed dry holes (tubing ahead) read "2 holes"', () => {
      const { step } = makeStep();
      step.update(twoHoleState(), 'sunny');

      expect(tubingBlock(step).textContent).toMatch(/\b2 holes\b/);
    });

    it('en: the stock-shortage reason never says "1 holes"', () => {
      const { step } = makeStep();
      const state = oneHoleState();
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.03);
      step.update(state, 'sunny');

      const reasons = tubingReasons(step);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]!.textContent).not.toMatch(/\b1 holes\b/);
    });

    it('fr: one wet untubed hole reads "1 trou", not "1 trous"', () => {
      setLocale('fr');
      const { step } = makeStep();
      const state = oneHoleState();
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.03);
      step.update(state, 'sunny');

      const text = tubingBlock(step).textContent ?? '';
      expect(text).toMatch(/\b1 trou\b/);
      expect(text).not.toMatch(/\b1 trous\b/);
    });

    it('fr: two wet untubed holes read "2 trous"', () => {
      setLocale('fr');
      const { step } = makeStep();
      const state = twoHoleState();
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.03);
      step.update(state, 'sunny');

      expect(tubingBlock(step).textContent).toMatch(/\b2 trous\b/);
    });

    it('fr: one untubed dry hole (tubing ahead) reads "1 trou", not "1 trous"', () => {
      setLocale('fr');
      const { step } = makeStep();
      step.update(oneHoleState(), 'sunny');

      const text = tubingBlock(step).textContent ?? '';
      expect(text).toMatch(/\b1 trou\b/);
      expect(text).not.toMatch(/\b1 trous\b/);
    });

    it('fr: the stock-shortage reason never says "1 trous"', () => {
      setLocale('fr');
      const { step } = makeStep();
      const state = oneHoleState();
      setHoleWater(state, state.drillHoles.map(h => h.id), 0.9, 0.03);
      step.update(state, 'sunny');

      const reasons = tubingReasons(step);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]!.textContent).not.toMatch(/\b1 trous\b/);
    });
  });
});

// ── Projected plan kg against the permit (#2167) ────────────────────────────

describe('ChargeStep — projected plan kg against the permit (#2167)', () => {
  // 12 m holes of 89 mm: each takes (12 - stemming) x 2 kg of boomite when filled. Grade 0 allows 40 kg.
  const DIAMETER_M = 0.089;
  const kgEl = (step: ChargeStep) => step.root.querySelector('[data-role="permit-kg"]') as HTMLElement | null;
  const warnEl = (step: ChargeStep) => step.root.querySelector('[data-role="permit-kg-warning"]') as HTMLElement | null;
  const chargeAllBtn = (step: ChargeStep) => step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;

  /** Step the stemming to `m`, then let the panel refresh from the state. */
  function setStemming(step: ChargeStep, state: ReturnType<typeof makeState>, m: number): void {
    stepStemmingTo(step, m);
    step.update(state, 'sunny');
  }

  /** Grade-0 state (40 kg allowed) holding `drilled` deep drilled holes and `planned` ordered ones. */
  function stateWith(drilled: number, planned = 0, progression = true) {
    const state = makeState();
    if (progression) state.grade = createGradeState();
    for (let i = 0; i < drilled; i++) addHole(holeCounter, state.drillHoles, 10 + (i % 5) * 4, 10 + Math.floor(i / 5) * 4, 12, DIAMETER_M);
    for (let i = 0; i < planned; i++) addHole(holeCounter, state.plannedDrillHoles, 60 + (i % 5) * 4, 60 + Math.floor(i / 5) * 4, 12, DIAMETER_M);
    return state;
  }

  it('shows used / limit kg as the holes filled to the stemming when within the permit', () => {
    const { step } = makeStep();
    const state = stateWith(8);
    step.update(state, 'sunny');
    setStemming(step, state, 10); // 2 m of boomite: 4 kg a hole
    expect(kgEl(step)!.textContent).toBe(permitPreview(state.grade, { holes: [], charges: { all: { amountKg: 8 * fillChargeKg(12, 10, DIAMETER_M, 'boomite') } } }, 0)!.kgText);
    expect(kgEl(step)!.textContent).toContain('32 / 40');
  });

  it('opens at the stemming that keeps the filled pattern within the permit', () => {
    const { step } = makeStep();
    const state = stateWith(8);
    step.update(state, 'sunny');
    // 8 holes x (12 - 9.5) m x 2 kg/m = 40 kg: the least stemming the permit allows.
    expect(stemmingText(step)).toBe('9.5 m');
    expect(kgEl(step)!.textContent).toContain('40 / 40');
    expect(warnEl(step)?.textContent ?? '').toBe('');
  });

  it('follows the stemming stepper', () => {
    const { step } = makeStep();
    const state = stateWith(8);
    step.update(state, 'sunny');
    setStemming(step, state, 10.5);
    expect(kgEl(step)!.textContent).toContain('24 / 40');
    setStemming(step, state, 10);
    expect(kgEl(step)!.textContent).toContain('32 / 40');
  });

  it('follows the explosive: a denser one fills the same holes with more kg', () => {
    const { step } = makeStep();
    const state = stateWith(8);
    step.update(state, 'sunny');
    setStemming(step, state, 10);
    card(step, 'krackle').click();
    step.update(state, 'sunny');
    const kg = Math.round(8 * fillChargeKg(12, 10, DIAMETER_M, 'krackle') * 10) / 10;
    expect(kg).toBeGreaterThan(32);
    expect(kgEl(step)!.textContent).toContain(`${kg} / 40`);
  });

  it('within the limit: no warning', () => {
    const { step } = makeStep();
    const state = stateWith(8);
    step.update(state, 'sunny');
    setStemming(step, state, 10);
    expect(warnEl(step)?.textContent ?? '').toBe('');
  });

  it('exactly at the kg limit: no warning', () => {
    const { step } = makeStep();
    const state = stateWith(8);
    step.update(state, 'sunny');
    setStemming(step, state, 9.5);
    expect(kgEl(step)!.textContent).toContain('40 / 40');
    expect(warnEl(step)?.textContent ?? '').toBe('');
  });

  it('over the kg limit: shows the projected total and the warning with its consequence', () => {
    const { step } = makeStep();
    const state = stateWith(9);
    step.update(state, 'sunny');
    setStemming(step, state, 9.5); // 9 x 5 kg
    expect(kgEl(step)!.textContent).toContain('45 / 40');
    const warning = chargeKgLimitWarning(state.grade, 45, state.tickCount)!;
    expect(warning).toBeTruthy();
    expect(warnEl(step)).not.toBeNull();
    expect(warnEl(step)!.textContent).toContain(warning);
    const consequence = permitPreview(state.grade, { holes: [], charges: { all: { amountKg: 45 } } }, state.tickCount)!.consequenceText;
    expect(consequence.length).toBeGreaterThan(0);
    expect(warnEl(step)!.textContent).toContain(consequence);
  });

  it('the warning clears when more stemming brings the plan back within the limit', () => {
    const { step } = makeStep();
    const state = stateWith(9);
    step.update(state, 'sunny');
    setStemming(step, state, 9.5);
    expect(warnEl(step)!.textContent).not.toBe('');
    setStemming(step, state, 10);
    expect(kgEl(step)!.textContent).toContain('36 / 40');
    expect(warnEl(step)?.textContent ?? '').toBe('');
  });

  it('counts the strikes live at the current tick in the consequence', () => {
    const { step } = makeStep();
    const state = stateWith(9);
    state.grade!.strikeTicks = [900, 1500];
    state.tickCount = 2000;
    step.update(state, 'sunny');
    setStemming(step, state, 9.5);
    expect(warnEl(step)!.textContent).toContain(chargeKgLimitWarning(state.grade, 45, 2000)!);
    expect(warnEl(step)!.textContent).not.toContain(chargeKgLimitWarning(createGradeState(), 45, 2000)!);
  });

  it('projects what Charge All produces: drilled holes only, not ordered ones', () => {
    const { step } = makeStep();
    const state = stateWith(4, 6);
    step.update(state, 'sunny');
    setStemming(step, state, 9.5);
    expect(kgEl(step)!.textContent).toContain('20 / 40');
    expect(warnEl(step)?.textContent ?? '').toBe('');
  });

  it('with no holes it shows nothing to warn about', () => {
    const { step } = makeStep();
    const state = stateWith(0);
    step.update(state, 'sunny');
    expect(warnEl(step)?.textContent ?? '').toBe('');
  });

  it('no grade: no warning even for a huge plan, and no used / limit readout', () => {
    const { step } = makeStep();
    const state = stateWith(15, 0, false);
    step.update(state, 'sunny');
    // No permit: the panel keeps the default stemming and fills 15 deep holes (285 kg).
    expect(stemmingText(step)).toBe(`${CHARGE_DEFAULT_STEMMING_M.toFixed(1)} m`);
    expect(warnEl(step)?.textContent ?? '').toBe('');
    expect(kgEl(step)?.textContent ?? '').toBe('');
  });

  it('over the permit, Charge All stays enabled and still dispatches the charge', () => {
    const { step, gameConsole } = makeStep();
    const state = stateWith(9);
    step.update(state, 'sunny');
    setStemming(step, state, 9.5);
    expect(warnEl(step)!.textContent).not.toBe('');
    expect(chargeAllBtn(step).disabled).toBe(false);
    chargeAllBtn(step).click();
    expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('charge hole:* '));
    expect(gameConsole.mock.calls[0]![0]).toBe('charge hole:* explosive:boomite stemming:9.5m');
  });
});

describe('ChargeStep — stemming field explains itself (#2168)', () => {
  afterEach(() => setLocale('en'));

  it('the stemming label carries the stemming explanation', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    const field = step.root.querySelector('[data-field="stemming"]') as HTMLElement;
    const holder = field.querySelector<HTMLElement>('[data-explain]');
    expect(holder).not.toBeNull();
    expect(holder!.textContent).toBe(t('ui.blast_workshop.charge.stemming'));
    expect(holder!.dataset['explain']).toBe(stemmingExplain());
    expect(holder!.dataset['explain']!.length).toBeGreaterThan(0);
  });

  it('the per-hole field explains the fill, not the stemming', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    const perHoleField = step.root.querySelector('[data-role="charge-per-hole"]')!.parentElement as HTMLElement;
    const explains = [...perHoleField.querySelectorAll<HTMLElement>('[data-explain]')].map(e => e.dataset['explain']);
    expect(explains).toContain(t('ui.blast_workshop.charge.per_hole_explain'));
    expect(explains).not.toContain(stemmingExplain());
  });

  it('the per-hole explanation follows a language switch after refreshLocale', () => {
    const { step } = makeStep();
    const state = makeState();
    step.update(state, 'sunny');
    setLocale('fr');
    step.refreshLocale();
    step.update(state, 'sunny');
    const perHoleField = step.root.querySelector('[data-role="charge-per-hole"]')!.parentElement as HTMLElement;
    expect(perHoleField.querySelector<HTMLElement>('[data-explain]')!.dataset['explain']).toBe(t('ui.blast_workshop.charge.per_hole_explain'));
  });

  it('the explanation follows a language switch after refreshLocale', () => {
    const { step } = makeStep();
    const state = makeState();
    step.update(state, 'sunny');
    setLocale('fr');
    step.refreshLocale();
    step.update(state, 'sunny');
    const holder = step.root.querySelector<HTMLElement>('[data-field="stemming"] [data-explain]')!;
    expect(holder.dataset['explain']).toBe(stemmingExplain());
  });
});


// ── explosive cards and hole rows read the blast model (#2203) ───────────────

describe('ChargeStep — explosive cards, powder factor and band mix (#2203)', () => {
  const BAND_MIX = '[data-role="explosive-band-mix"]';
  const HOLE_PF = '[data-role="hole-powder-factor"]';
  const HOLE_MIX = '[data-role="hole-band-mix"]';
  const HOLE_REC = '[data-role="hole-recommended"]';

  function rockGrid(): VoxelGrid {
    const grid = new VoxelGrid(40, 40);
    const voxel = { composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
    for (let z = 3; z <= 34; z++)
      for (let y = 0; y <= 12; y++)
        for (let x = 3; x <= 34; x++) grid.setVoxel(x, y, z, voxel);
    return grid;
  }

  /** Two 10 m holes 2 m apart on rock, the first one charged with 6 kg of boomite (a partial charge, as a script orders it). */
  function patternState() {
    const state = makeState();
    const h1 = addHole(holeCounter, state.drillHoles, 10, 10, 10, 0.089);
    const h2 = addHole(holeCounter, state.drillHoles, 12, 10, 10, 0.089);
    state.chargesByHole[h1.id] = { explosiveId: 'boomite', amountKg: 6, stemmingM: CHARGE_DEFAULT_STEMMING_M };
    return { state, h1, h2 };
  }

  const text = (root: ParentNode, selector: string): string => root.querySelector(selector)?.textContent?.trim() ?? '';
  const cards = (step: ChargeStep): HTMLElement[] => Array.from(step.root.querySelectorAll('[data-action="select-explosive"]'));
  const row = (step: ChargeStep, id: string): HTMLElement => step.root.querySelector(`[data-hole="${id}"]`) as HTMLElement;
  const showsNumber = (shown: string, value: number): boolean => [1, 2, 3].some(d => shown.includes(value.toFixed(d)));

  describe('explosive cards', () => {
    it('never label the energy MJ/kg, and still show the energy figure', () => {
      const { step } = makeStep();
      step.update(makeState(), 'sunny');
      expect(cards(step).length).toBeGreaterThan(0);
      for (const c of cards(step)) {
        const explosive = getExplosive(c.dataset['explosive']!)!;
        expect(c.textContent, explosive.id).not.toContain('MJ/kg');
        expect(c.textContent, explosive.id).toContain(String(explosive.energyPerKg));
      }
    });

    it('keep the price, what one metre of the hole holds (kg and energy) and the water badge', () => {
      const { step } = makeStep();
      const state = makeState();
      addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
      wetAllHoles(state);
      step.update(state, 'heavy_rain');
      for (const c of cards(step)) {
        const explosive = getExplosive(c.dataset['explosive']!)!;
        const kgPerMetre = chargeKgPerMetre(0.089, explosive.id);
        // Energy per metre in the card's own units: its energy per kg times the kg a metre holds.
        const energyPerMetre = Math.round(kgPerMetre * explosive.energyPerKg);
        expect(c.textContent, explosive.id).toContain(`$${explosive.costPerKg.toFixed(2)} / kg`);
        const perMetre = c.querySelector<HTMLElement>('[data-role="explosive-per-metre"]')!;
        expect(perMetre.textContent, explosive.id).toBe(t('ui.blast_workshop.charge.per_metre_card', {
          kg: +kgPerMetre.toFixed(1), energy: formatMoney(energyPerMetre),
        }));
        // Its explanation names the density that sets those kilograms.
        expect(perMetre.dataset['explain'], explosive.id).toBe(t('ui.blast_workshop.charge.per_metre_explain', { density: explosive.density, diameter: 89 }));
      }
      expect(card(step, 'krackle').textContent).not.toContain('WATER-SENSITIVE');
      expect(card(step, 'boomite').textContent).toContain('WATER-SENSITIVE');
    });

    it('a denser, stronger explosive shows more kg and more energy in each metre', () => {
      const { step } = makeStep();
      const state = makeState();
      addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
      step.update(state, 'sunny');
      const figures = (id: string) => {
        const shown = card(step, id).querySelector('[data-role="explosive-per-metre"]')!.textContent!;
        const [kg, energy] = shown.match(/[\d.,]+/g)!.map(n => Number(n.replace(/,/g, '')));
        return { kg: kg!, energy: energy! };
      };
      expect(figures('dynatomics').kg).toBeGreaterThan(figures('pop_rock').kg);
      expect(figures('dynatomics').energy).toBeGreaterThan(figures('pop_rock').energy);
    });

    it('show no band mix without a grid, and still render', () => {
      const { step } = makeStep();
      const { state } = patternState();
      step.update(state, 'sunny');
      expect(cards(step).length).toBeGreaterThan(0);
      for (const c of cards(step)) expect(text(c, BAND_MIX), c.dataset['explosive']).toBe('');
    });

    it('show no band mix when the grid provider has no grid, and still render', () => {
      const { step } = makeStep();
      step.setGridProvider(() => null);
      const { state } = patternState();
      step.update(state, 'sunny');
      expect(cards(step).length).toBeGreaterThan(0);
      for (const c of cards(step)) expect(text(c, BAND_MIX), c.dataset['explosive']).toBe('');
    });

    it('show no band mix when no hole is drilled', () => {
      const { step } = makeStep();
      step.setGridProvider(() => rockGrid());
      step.update(makeState(), 'sunny');
      expect(cards(step).length).toBeGreaterThan(0);
      for (const c of cards(step)) expect(text(c, BAND_MIX), c.dataset['explosive']).toBe('');
    });

    it('each show the band mix its explosive would give the pattern', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state } = patternState();
      step.update(state, 'sunny');
      expect(cards(step).length).toBeGreaterThan(0);
      for (const c of cards(step)) {
        const mix = c.querySelector(BAND_MIX);
        expect(mix, c.dataset['explosive']).not.toBeNull();
        expect(mix!.textContent!.trim().length + mix!.children.length, c.dataset['explosive']).toBeGreaterThan(0);
      }
    });

    it('differ between a weak and a strong explosive filled to the same stemming', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state } = patternState();
      step.update(state, 'sunny');
      const weak = card(step, 'pop_rock').querySelector(BAND_MIX)!;
      const strong = card(step, 'dynatomics').querySelector(BAND_MIX)!;
      expect(weak.innerHTML).not.toBe(strong.innerHTML);
    });

    it('follow the chosen stemming', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state } = patternState();
      step.update(state, 'sunny');
      card(step, 'krackle').click();
      const before = card(step, 'krackle').querySelector(BAND_MIX)!.innerHTML;
      stepStemmingTo(step, 6); // far less krackle in each hole
      step.update(state, 'sunny');
      const after = card(step, 'krackle').querySelector(BAND_MIX)!.innerHTML;
      expect(after).not.toBe(before);
    });

    it('need no software tier', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state } = patternState();
      expect(state.softwareTier).toBe(0);
      step.update(state, 'sunny');
      expect(card(step, 'boomite').querySelector(BAND_MIX)).not.toBeNull();
    });
  });

  describe('hole rows', () => {
    it('show the powder factor of a charged hole: kilograms over spacing squared times depth', () => {
      const { step } = makeStep();
      const { state, h1 } = patternState();
      step.update(state, 'sunny');
      // 6 kg, nearest hole 2 m away, 10 m deep: 6 / (2 x 2 x 10)
      expect(showsNumber(text(row(step, h1.id), HOLE_PF), 0.15)).toBe(true);
    });

    it('show no powder factor and no band mix on an uncharged hole', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state, h2 } = patternState();
      step.update(state, 'sunny');
      expect(text(row(step, h2.id), HOLE_PF)).toBe('');
      expect(text(row(step, h2.id), HOLE_MIX)).toBe('');
    });

    it('show the band mix of a charged hole once a grid is set', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state, h1 } = patternState();
      step.update(state, 'sunny');
      const mix = row(step, h1.id).querySelector(HOLE_MIX);
      expect(mix).not.toBeNull();
      expect(mix!.textContent!.trim().length + mix!.children.length).toBeGreaterThan(0);
    });

    it('show no band mix without a grid, but keep the powder factor', () => {
      const { step } = makeStep();
      const { state, h1 } = patternState();
      step.update(state, 'sunny');
      expect(text(row(step, h1.id), HOLE_MIX)).toBe('');
      expect(text(row(step, h1.id), HOLE_PF)).not.toBe('');
    });

    it('show a recommended range on every hole once a grid is set', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state, h1, h2 } = patternState();
      step.update(state, 'sunny');
      expect(row(step, h1.id).querySelector(HOLE_REC)).not.toBeNull();
      expect(row(step, h2.id).querySelector(HOLE_REC)).not.toBeNull();
    });

    it('the recommended range shown is the model\'s for the selected explosive', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state, h1 } = patternState();
      step.update(state, 'sunny');
      const range = recommendedPowderFactors(state.drillHoles, grid, 'boomite')[h1.id];
      const shown = text(row(step, h1.id), HOLE_REC);
      expect(range).not.toBeUndefined();
      // Exact text, null included: the row says what the model says, whichever way it answers.
      expect(shown).toBe(recommendedRangeText(range ?? null));
    });

    it('the recommended range does not move with the panel\'s stemming: the sweep chooses the stemming itself', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state, h1 } = patternState();
      step.update(state, 'sunny');
      const before = text(row(step, h1.id), HOLE_REC);
      expect(before).not.toBe(recommendedRangeText(null));
      stepStemmingTo(step, 5);
      step.update(state, 'sunny');
      expect(text(row(step, h1.id), HOLE_REC)).toBe(before);
    });

    it('the recommended range follows the selected explosive', () => {
      const { step } = makeStep();
      const grid = rockGrid();
      step.setGridProvider(() => grid);
      const { state, h1 } = patternState();
      step.update(state, 'sunny');
      const boomite = text(row(step, h1.id), HOLE_REC);
      card(step, 'dynatomics').click();
      step.update(state, 'sunny');
      const range = recommendedPowderFactors(state.drillHoles, grid, 'dynatomics')[h1.id];
      expect(text(row(step, h1.id), HOLE_REC)).toBe(recommendedRangeText(range ?? null));
      expect(text(row(step, h1.id), HOLE_REC)).not.toBe(boomite);
    });

    it('pick up a charge that lands after the first render', () => {
      const { step } = makeStep();
      const { state, h2 } = patternState();
      step.update(state, 'sunny');
      expect(text(row(step, h2.id), HOLE_PF)).toBe('');
      state.chargesByHole[h2.id] = { explosiveId: 'boomite', amountKg: 4, stemmingM: CHARGE_DEFAULT_STEMMING_M };
      step.update(state, 'sunny');
      // 4 kg over 2 x 2 x 10
      expect(showsNumber(text(row(step, h2.id), HOLE_PF), 0.1)).toBe(true);
    });

    it('a lone hole is read at the default grid spacing', () => {
      const { step } = makeStep();
      const state = makeState();
      const h = addHole(holeCounter, state.drillHoles, 10, 10, 10, 0.089);
      state.chargesByHole[h.id] = { explosiveId: 'boomite', amountKg: 8, stemmingM: CHARGE_DEFAULT_STEMMING_M };
      step.update(state, 'sunny');
      // 8 kg over 4 x 4 x 10
      expect(showsNumber(text(row(step, h.id), HOLE_PF), 0.05)).toBe(true);
    });
  });
});


// ── tier-4 charge optimizer (#2204) ──────────────────────────────────────────

describe('ChargeStep — charge optimizer (#2204)', () => {
  const OPTIMIZE = '[data-action="optimize-charges"]';
  const LOCKED = '[data-role="optimizer-locked"]';
  const PROPOSAL = '[data-role="charge-proposal"]';
  const APPLY_ALL = '[data-action="apply-proposal"]';
  const APPLY_HOLE = '[data-action="apply-proposal-hole"]';
  const PROPOSAL_ROW = '[data-role="proposal-hole"]';

  afterEach(() => setLocale('en'));

  function optGrid(): VoxelGrid {
    const grid = new VoxelGrid(40, 40);
    const voxel = { composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
    for (let z = 3; z <= 34; z++)
      for (let y = 0; y <= 12; y++)
        for (let x = 3; x <= 34; x++) grid.setVoxel(x, y, z, voxel);
    return grid;
  }

  /** Three drilled, uncharged 10 m holes on rock, software tier as given, mine grade 0 (40 kg permit). */
  function optState(tier: number) {
    const state = makeState();
    state.softwareTier = tier;
    state.grade = createGradeState();
    const holes = [10, 12, 14].map(x => addHole(holeCounter, state.drillHoles, x, 10, 10, 0.089));
    return { state, holes };
  }

  const optBtn = (step: ChargeStep): HTMLButtonElement | null => step.root.querySelector(OPTIMIZE);
  const proposalRows = (step: ChargeStep): HTMLElement[] => Array.from(step.root.querySelectorAll<HTMLElement>(`${PROPOSAL} ${PROPOSAL_ROW}`));
  const rowFor = (step: ChargeStep, id: string): HTMLElement | null => step.root.querySelector(`${PROPOSAL} ${PROPOSAL_ROW}[data-hole="${id}"]`);

  function openProposal(tier = 4) {
    const { step, gameConsole } = makeStep();
    step.setGridProvider(() => optGrid());
    const { state, holes } = optState(tier);
    step.update(state, 'sunny');
    optBtn(step)!.click();
    step.update(state, 'sunny');
    return { step, gameConsole, state, holes };
  }

  /** A proposal is applied as fill commands: explosive and stemming, no amount (the hole is filled up to it). */
  function parseCharge(cmd: string) {
    const m = /^charge hole:(\S+) explosive:(\S+) stemming:([\d.]+)m$/.exec(cmd);
    expect(m, cmd).not.toBeNull();
    return { hole: m![1]!, explosive: m![2]!, stemmingM: parseFloat(m![3]!) };
  }

  /** Kg the command orders: the hole filled with the explosive up to the stemming. */
  const filledKg = (holes: ReturnType<typeof optState>['holes'], c: ReturnType<typeof parseCharge>): number => {
    const hole = holes.find(h => h.id === c.hole)!;
    return fillChargeKg(hole.depth, c.stemmingM, hole.diameter, c.explosive);
  };

  describe('gate', () => {
    it('shows the Optimize charges button at tier 4 with drilled holes and a grid', () => {
      const { step } = makeStep();
      step.setGridProvider(() => optGrid());
      step.update(optState(4).state, 'sunny');
      expect(optBtn(step)).not.toBeNull();
      expect(optBtn(step)!.textContent).toContain('Optimize charges');
      expect(step.root.querySelector(LOCKED)).toBeNull();
    });

    it('shows the button above tier 4 as well', () => {
      const { step } = makeStep();
      step.setGridProvider(() => optGrid());
      step.update(optState(5).state, 'sunny');
      expect(optBtn(step)).not.toBeNull();
    });

    it.each([0, 1, 2, 3])('below tier 4 (tier %i) shows a locked hint naming the Charge Optimizer and no button', (tier) => {
      const { step } = makeStep();
      step.setGridProvider(() => optGrid());
      step.update(optState(tier).state, 'sunny');
      expect(optBtn(step)).toBeNull();
      const hint = step.root.querySelector(LOCKED);
      expect(hint).not.toBeNull();
      expect(hint!.textContent).toContain('Charge Optimizer');
    });

    it('shows no button without drilled holes', () => {
      const { step } = makeStep();
      step.setGridProvider(() => optGrid());
      const state = makeState();
      state.softwareTier = 4;
      step.update(state, 'sunny');
      expect(optBtn(step)).toBeNull();
    });

    it('shows no button without a grid', () => {
      const { step } = makeStep();
      step.update(optState(4).state, 'sunny');
      expect(optBtn(step)).toBeNull();
    });

    it('shows no button when the grid provider has no grid', () => {
      const { step } = makeStep();
      step.setGridProvider(() => null);
      step.update(optState(4).state, 'sunny');
      expect(optBtn(step)).toBeNull();
    });

    it('shows the proposal block only after the button is clicked', () => {
      const { step, gameConsole } = makeStep();
      step.setGridProvider(() => optGrid());
      const { state } = optState(4);
      step.update(state, 'sunny');
      expect(step.root.querySelector(PROPOSAL)).toBeNull();
      optBtn(step)!.click();
      step.update(state, 'sunny');
      expect(step.root.querySelector(PROPOSAL)).not.toBeNull();
      expect(gameConsole).not.toHaveBeenCalled();
    });

    it('the locked hint is translated', () => {
      const { step } = makeStep();
      step.setGridProvider(() => optGrid());
      const { state } = optState(2);
      step.update(state, 'sunny');
      const en = step.root.querySelector(LOCKED)!.textContent;
      setLocale('fr');
      step.refreshLocale();
      step.update(state, 'sunny');
      const fr = step.root.querySelector(LOCKED)!.textContent;
      expect(fr!.length).toBeGreaterThan(0);
      expect(fr).not.toBe(en);
    });

    it('the button label is translated', () => {
      const { step } = makeStep();
      step.setGridProvider(() => optGrid());
      const { state } = optState(4);
      step.update(state, 'sunny');
      const en = optBtn(step)!.textContent;
      setLocale('fr');
      step.refreshLocale();
      step.update(state, 'sunny');
      expect(optBtn(step)!.textContent).not.toBe(en);
    });
  });

  describe('proposal', () => {
    it('lists one row per proposed hole, keyed by data-hole', () => {
      const { step, holes } = openProposal();
      const ids = proposalRows(step).map(r => r.dataset['hole']).sort();
      expect(ids).toEqual(holes.map(h => h.id).sort());
    });

    it('shows the band mix, the cost and the permit kg used', () => {
      const { step } = openProposal();
      const block = step.root.querySelector(PROPOSAL)!;
      for (const role of ['proposal-band-mix', 'proposal-cost', 'proposal-permit-kg']) {
        const el = block.querySelector(`[data-role="${role}"]`);
        expect(el, role).not.toBeNull();
        expect((el!.textContent ?? '').trim().length + el!.children.length, role).toBeGreaterThan(0);
      }
    });

    it('shows the permit limit of the mine grade', () => {
      const { step } = openProposal();
      const text = step.root.querySelector(`${PROPOSAL} [data-role="proposal-permit-kg"]`)!.textContent!;
      expect(text).toContain(String(permitLimitsFor(0).maxChargeKg));
    });

    it('each row has its own Apply button', () => {
      const { step } = openProposal();
      for (const r of proposalRows(step)) expect(r.querySelector(APPLY_HOLE), r.dataset['hole']).not.toBeNull();
    });

    it('sends no command by merely showing the proposal', () => {
      const { gameConsole } = openProposal();
      expect(gameConsole).not.toHaveBeenCalled();
    });

    it('a repeat update does not send anything either', () => {
      const { step, gameConsole, state } = openProposal();
      step.update(state, 'sunny');
      step.update(state, 'sunny');
      expect(gameConsole).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('Apply all sends one charge command per proposed hole with explosive and stemming, in one click', () => {
      const { step, gameConsole, holes } = openProposal();
      const rows = proposalRows(step).map(r => r.dataset['hole']!).sort();
      (step.root.querySelector(APPLY_ALL) as HTMLButtonElement).click();
      const cmds = gameConsole.mock.calls.map(c => parseCharge(c[0] as string));
      expect(cmds.map(c => c.hole).sort()).toEqual(rows);
      for (const c of cmds) {
        expect(getExplosive(c.explosive), c.hole).toBeDefined();
        expect(filledKg(holes, c), c.hole).toBeGreaterThan(0);
      }
    });

    it('every command fills its hole up to a stemming that throws no rock', () => {
      const { step, gameConsole, holes } = openProposal();
      (step.root.querySelector(APPLY_ALL) as HTMLButtonElement).click();
      expect(gameConsole.mock.calls.length).toBeGreaterThan(0);
      for (const call of gameConsole.mock.calls) {
        const c = parseCharge(call[0] as string);
        const range = stemmingSweepRangeM(holes.find(h => h.id === c.hole)!.depth)!;
        // Swept stemmings are rounded to the 0.1 m the panel steps in.
        expect(c.stemmingM, c.hole).toBeGreaterThanOrEqual(range.lo - 0.05);
        expect(c.stemmingM, c.hole).toBeLessThanOrEqual(range.hi + 0.05);
      }
    });

    it('each row names the kg its hole will hold: the fill its command orders', () => {
      const { step, gameConsole, holes } = openProposal();
      const rows = proposalRows(step);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        (r.querySelector(APPLY_HOLE) as HTMLButtonElement).click();
        const c = parseCharge(gameConsole.mock.calls[gameConsole.mock.calls.length - 1]![0] as string);
        expect(c.hole).toBe(r.dataset['hole']);
        expect(r.textContent, c.hole).toContain(`${filledKg(holes, c)} kg`);
        expect(r.textContent, c.hole).toContain(`${c.stemmingM} m`);
      }
    });

    it('the commands total within the permit kg limit of the grade', () => {
      const { step, gameConsole, holes } = openProposal();
      (step.root.querySelector(APPLY_ALL) as HTMLButtonElement).click();
      const total = gameConsole.mock.calls.reduce((sum, c) => sum + filledKg(holes, parseCharge(c[0] as string)), 0);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(permitLimitsFor(0).maxChargeKg + 1e-9);
    });

    it('a row Apply sends one command for that hole only', () => {
      const { step, gameConsole, holes } = openProposal();
      const target = holes[1]!;
      (rowFor(step, target.id)!.querySelector(APPLY_HOLE) as HTMLButtonElement).click();
      expect(gameConsole).toHaveBeenCalledTimes(1);
      expect(parseCharge(gameConsole.mock.calls[0]![0] as string).hole).toBe(target.id);
    });

    it('the row Apply sends the explosive and stemming its row proposes, the same as Apply all does for that hole', () => {
      const first = openProposal();
      const target = first.holes[2]!;
      (rowFor(first.step, target.id)!.querySelector(APPLY_HOLE) as HTMLButtonElement).click();
      const single = parseCharge(first.gameConsole.mock.calls[0]![0] as string);

      const second = openProposal();
      (second.step.root.querySelector(APPLY_ALL) as HTMLButtonElement).click();
      // Each openProposal numbers its holes afresh from the shared counter: compare the same hole by position.
      const twin = second.holes[2]!;
      const all = second.gameConsole.mock.calls.map(c => parseCharge(c[0] as string)).find(c => c.hole === twin.id)!;
      expect({ ...single, hole: twin.id }).toEqual(all);
    });

    it('proposes no water-sensitive explosive for a wet hole', () => {
      const { step, gameConsole } = makeStep();
      step.setGridProvider(() => optGrid());
      const { state, holes } = optState(4);
      setHoleWater(state, [holes[0]!.id]);
      step.update(state, 'sunny');
      optBtn(step)!.click();
      step.update(state, 'sunny');
      (step.root.querySelector(APPLY_ALL) as HTMLButtonElement).click();
      const wet = gameConsole.mock.calls.map(c => parseCharge(c[0] as string)).filter(c => c.hole === holes[0]!.id);
      for (const c of wet) expect(getExplosive(c.explosive)!.waterSensitive).toBe(false);
    });
  });
});

describe('ChargeStep — water block leads while water matters (#2268)', () => {
  const water = (step: ChargeStep) => step.root.querySelector('[data-role="water-section"]') as HTMLElement;
  const first = (step: ChargeStep) => step.root.firstElementChild;
  const last = (step: ChargeStep) => step.root.lastElementChild;
  const chargeAll = (step: ChargeStep) => step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;

  /** Two dry untubed holes under a pinned dry sky: water does not matter. */
  function dryState() {
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.089);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.089);
    state.weather = pinnedDryCycle();
    return state;
  }

  describe('C1: a wet hole puts the block first', () => {
    it('is the root first child, before the product list, when a hole is wet', () => {
      const { step } = makeStep();
      const state = dryState();
      setHoleWater(state, [state.drillHoles[0]!.id]);
      step.update(state, 'sunny');

      expect(water(step)).not.toBeNull();
      expect(first(step)).toBe(water(step));
      expect(step.root.firstElementChild).not.toBe(step.root.querySelector('.bsx-section'));
    });

    it('still holds the drain button and the tubing card', () => {
      const { step } = makeStep();
      const state = dryState();
      wetAllHoles(state);
      step.update(state, 'sunny');

      expect(water(step).querySelector('[data-action="drain-holes"]')).not.toBeNull();
      expect(water(step).querySelector('[data-action="tubing-buy"]')).not.toBeNull();
      expect(water(step).querySelector('[data-action="tubing-install"]')).not.toBeNull();
    });

    it('is first even when the only wet hole is tubed (wet is wet)', () => {
      const { step } = makeStep();
      const state = dryState();
      const [h1] = state.drillHoles;
      setHoleWater(state, [h1!.id]);
      state.tubingState.installedHoles.add(h1!.id);
      step.update(state, 'sunny');

      expect(first(step)).toBe(water(step));
    });

    it('precedes the explosive product cards in document order', () => {
      const { step } = makeStep();
      const state = dryState();
      wetAllHoles(state);
      step.update(state, 'sunny');

      const pos = water(step).compareDocumentPosition(card(step, 'boomite'));
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('C2: rain due within a day with an untubed hole puts the block first', () => {
    it('is first on dry holes when rain is forecast and a hole is untubed', () => {
      const { step } = makeStep();
      const state = dryState();
      state.weather = rainAfterCycle(8, 'desert');
      step.update(state, 'sunny');

      expect(first(step)).toBe(water(step));
    });

    it('is first when rain is due and only some holes are tubed', () => {
      const { step } = makeStep();
      const state = dryState();
      state.weather = rainAfterCycle(8, 'desert');
      state.tubingState.installedHoles.add(state.drillHoles[0]!.id);
      step.update(state, 'sunny');

      expect(first(step)).toBe(water(step));
    });

    it('is first while it is raining now on dry untubed holes', () => {
      const { step } = makeStep();
      const state = dryState();
      state.weather = pinnedCycle('heavy_rain');
      step.update(state, 'heavy_rain');

      expect(first(step)).toBe(water(step));
    });

    it('is last when rain is due but every hole is tubed', () => {
      const { step } = makeStep();
      const state = dryState();
      state.weather = rainAfterCycle(8, 'desert');
      for (const h of state.drillHoles) state.tubingState.installedHoles.add(h.id);
      step.update(state, 'sunny');

      expect(last(step)).toBe(water(step));
    });

    it('is last when rain is due but there are no holes', () => {
      const { step } = makeStep();
      const state = makeState();
      state.weather = rainAfterCycle(8, 'desert');
      step.update(state, 'sunny');

      expect(last(step)).toBe(water(step));
    });
  });

  describe('C3: dry holes in dry weather leave the block last', () => {
    it('is the root last child, after the hole list', () => {
      const { step } = makeStep();
      step.update(dryState(), 'sunny');

      expect(last(step)).toBe(water(step));
      expect(first(step)).not.toBe(water(step));
      const holeRow = step.root.querySelector('[data-hole]') as HTMLElement;
      expect(holeRow).not.toBeNull();
      expect(holeRow.compareDocumentPosition(water(step)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is last with no holes in dry weather', () => {
      const { step } = makeStep();
      const state = makeState();
      state.weather = pinnedDryCycle();
      step.update(state, 'sunny');

      expect(last(step)).toBe(water(step));
    });

    it('is last when rain is further off than a day', () => {
      const { step } = makeStep();
      const state = dryState();
      state.weather = dryForCycle(48, 'desert');
      step.update(state, 'sunny');

      expect(last(step)).toBe(water(step));
    });

    it('is last when every dry hole is tubed', () => {
      const { step } = makeStep();
      const state = dryState();
      for (const h of state.drillHoles) state.tubingState.installedHoles.add(h.id);
      step.update(state, 'sunny');

      expect(last(step)).toBe(water(step));
    });
  });

  describe('C4: the block moves on the next update', () => {
    it('moves first when a hole turns wet, and back last when it is drained', () => {
      const { step } = makeStep();
      const state = dryState();
      step.update(state, 'sunny');
      expect(last(step)).toBe(water(step));

      setHoleWater(state, [state.drillHoles[1]!.id]);
      step.update(state, 'sunny');
      expect(first(step)).toBe(water(step));

      delete state.holeWater[state.drillHoles[1]!.id];
      step.update(state, 'sunny');
      expect(last(step)).toBe(water(step));
      expect(first(step)).not.toBe(water(step));
    });

    it('moves first when rain turns up and back last when it clears', () => {
      const { step } = makeStep();
      const state = dryState();
      step.update(state, 'sunny');
      expect(last(step)).toBe(water(step));

      state.weather = rainAfterCycle(8, 'desert');
      step.update(state, 'sunny');
      expect(first(step)).toBe(water(step));

      state.weather = pinnedDryCycle();
      step.update(state, 'sunny');
      expect(last(step)).toBe(water(step));
    });

    it('moves last once every untubed hole is tubed while only rain made it matter', () => {
      const { step } = makeStep();
      const state = dryState();
      state.weather = rainAfterCycle(8, 'desert');
      step.update(state, 'sunny');
      expect(first(step)).toBe(water(step));

      for (const h of state.drillHoles) state.tubingState.installedHoles.add(h.id);
      step.update(state, 'sunny');
      expect(last(step)).toBe(water(step));
    });

    it('moves last when the last wet hole is tubed and dried, in dry weather', () => {
      const { step } = makeStep();
      const state = dryState();
      const [h1, h2] = state.drillHoles;
      setHoleWater(state, [h1!.id]);
      step.update(state, 'sunny');
      expect(first(step)).toBe(water(step));

      delete state.holeWater[h1!.id];
      state.tubingState.installedHoles.add(h1!.id);
      state.tubingState.installedHoles.add(h2!.id);
      step.update(state, 'sunny');
      expect(last(step)).toBe(water(step));
    });

    it('stays one element in the root across moves (no duplicate block)', () => {
      const { step } = makeStep();
      const state = dryState();
      step.update(state, 'sunny');
      wetAllHoles(state);
      step.update(state, 'sunny');
      state.holeWater = {};
      step.update(state, 'sunny');
      wetAllHoles(state);
      step.update(state, 'sunny');

      expect(step.root.querySelectorAll('[data-role="water-section"]')).toHaveLength(1);
      expect(step.root.querySelectorAll('[data-action="drain-holes"]')).toHaveLength(1);
    });
  });

  describe('C5: hooks and the fit line stay put', () => {
    it('keeps the fit line immediately after charge-all with the block first', () => {
      const { step } = makeStep();
      const state = dryState();
      wetAllHoles(state);
      step.update(state, 'sunny');

      expect(first(step)).toBe(water(step));
      expect(chargeAll(step).nextElementSibling?.querySelectorAll('.bsx-reason') ?? []).toHaveLength(0);
      expect(chargeAll(step).nextElementSibling?.textContent ?? '').toBe('');
    });

    it('keeps the fit line immediately after charge-all with the block last', () => {
      const { step } = makeStep();
      const state = makeState();
      addHole(holeCounter, state.drillHoles, 13, 10, 4, 0.089);
      state.weather = pinnedDryCycle();
      step.update(state, 'sunny');
      stepStemmingTo(step, 4);
      step.update(state, 'sunny');

      expect(last(step)).toBe(water(step));
      expect(chargeAll(step).disabled).toBe(true);
      expect(chargeAll(step).nextElementSibling?.textContent ?? '').toContain(t('ui.blast_workshop.charge.no_room_reason', { depth: 4, stemming: 4 }));
    });

    it('keeps the drain-holes, tubing-buy and tubing-install hooks working while the block leads', () => {
      const { step, gameConsole } = makeStep();
      const state = dryState();
      const [h1, h2] = state.drillHoles;
      state.cash = 1000;
      state.tubingState.inventory = 5;
      wetAllHoles(state);
      step.update(state, 'sunny');
      expect(first(step)).toBe(water(step));

      (step.root.querySelector('[data-action="drain-holes"]') as HTMLButtonElement).click();
      expect(gameConsole).toHaveBeenCalledWith('drain_hole hole:*');
      (step.root.querySelector('[data-action="tubing-install"]') as HTMLButtonElement).click();
      expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h1!.id}`);
      expect(gameConsole).toHaveBeenCalledWith(`install_tubing hole:${h2!.id}`);
      expect(step.root.querySelector('[data-action="tubing-buy"]')).not.toBeNull();
    });

    it('revealWater still works with the block first (no throw)', () => {
      const { step } = makeStep();
      const state = dryState();
      wetAllHoles(state);
      step.update(state, 'sunny');

      expect(() => step.revealWater()).not.toThrow();
    });
  });
});
