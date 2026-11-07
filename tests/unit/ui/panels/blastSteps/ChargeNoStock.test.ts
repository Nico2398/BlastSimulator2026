// @vitest-environment jsdom
// BlastSimulator2026 — Charge step: explosives are bought at loading, there is no stock UI (#2153)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargeStep } from '../../../../../src/ui/panels/blastSteps/Charge.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { getExplosive } from '../../../../../src/core/world/ExplosiveCatalog.js';
import { placeBuilding } from '../../../../../src/core/entities/Building.js';
import { CHARGE_DEFAULT_AMOUNT_KG } from '../../../../../src/core/config/balance.js';
import { storageContents } from '../../../../../src/ui/panels/inspector/storageContent.js';
import type { Building } from '../../../../../src/core/entities/Building.js';

const holeCounter = { nextHoleId: 1 };

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeStep(): { step: ChargeStep; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new ChargeStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, gameConsole };
}

function card(step: ChargeStep, explosiveId: string): HTMLButtonElement {
  return step.root.querySelector(`[data-explosive="${explosiveId}"]`) as HTMLButtonElement;
}

const STOCK_HOOKS = [
  '[data-stock]',
  '[data-field="stock-kg"]',
  '[data-action="stock-buy"]',
  '[data-info="stock-buy-reason"]',
  '[data-info="paid-from"]',
];

function withWarehouse(state: ReturnType<typeof makeState>): void {
  expect(placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1).success).toBe(true);
}

function patternState(holes = 3, withWh = false) {
  const state = makeState();
  for (let i = 0; i < holes; i++) addHole(holeCounter, state.drillHoles, 10 + 3 * i, 10, 8, 0.089);
  if (withWh) withWarehouse(state);
  return state;
}

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('ChargeStep has no stock section (#2153)', () => {
  it.each(STOCK_HOOKS)('renders nothing for %s with no warehouse', (selector) => {
    const { step } = makeStep();
    step.update(patternState(3), 'sunny');
    expect(step.root.querySelector(selector)).toBeNull();
  });

  it.each(STOCK_HOOKS)('renders nothing for %s even with an Explosive Warehouse standing', (selector) => {
    const { step } = makeStep();
    step.update(patternState(3, true), 'sunny');
    expect(step.root.querySelector(selector)).toBeNull();
  });

  it('shows no stock, stepper, paid-from or warehouse-stock wording', () => {
    const { step } = makeStep();
    step.update(patternState(3, true), 'sunny');
    const text = step.root.textContent ?? '';
    expect(text).not.toMatch(/from stock/i);
    expect(text).not.toMatch(/kg in stock/i);
    expect(text).not.toMatch(/into stock/i);
    expect(text).not.toMatch(/warehouse stock/i);
    expect(text).not.toMatch(/Build an Explosive Warehouse/i);
  });

  it('has no stock block after a repaint with another explosive selected', () => {
    const { step } = makeStep();
    const state = patternState(2, true);
    step.update(state, 'sunny');
    card(step, 'krackle').click();
    step.update(state, 'sunny');
    for (const selector of STOCK_HOOKS) expect(step.root.querySelector(selector), selector).toBeNull();
  });
});

describe('ChargeStep prices the whole pattern at list price (#2153)', () => {
  it('the Charge All button shows the full list price of the pattern', () => {
    const { step } = makeStep();
    step.update(patternState(3), 'sunny');
    const btn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    const full = 3 * CHARGE_DEFAULT_AMOUNT_KG * getExplosive('boomite')!.costPerKg;
    expect(btn.textContent).toContain(`$${full}`);
  });

  it('a standing warehouse does not discount the pattern', () => {
    const plain = makeStep();
    plain.step.update(patternState(3), 'sunny');
    const walled = makeStep();
    walled.step.update(patternState(3, true), 'sunny');
    const btn = (s: ChargeStep) => (s.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).textContent;
    expect(btn(walled.step)).toBe(btn(plain.step));
    expect(btn(walled.step)).not.toContain('$0');
  });

  it('the price follows the selected explosive', () => {
    const { step } = makeStep();
    step.update(patternState(2), 'sunny');
    card(step, 'krackle').click();
    step.update(patternState(2), 'sunny');
    const btn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    const full = 2 * CHARGE_DEFAULT_AMOUNT_KG * getExplosive('krackle')!.costPerKg;
    expect(btn.textContent).toContain(`$${full}`);
  });

  it('preselects Boomite, the default explosive, whatever a warehouse holds', () => {
    const { step } = makeStep();
    step.update(patternState(2, true), 'sunny');
    expect(card(step, 'boomite').dataset['selected']).toBe('true');
  });

  it('Charge All sends a single charge command and never a buy command', () => {
    const { step, gameConsole } = makeStep();
    step.update(patternState(3, true), 'sunny');
    (step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).click();
    expect(gameConsole).toHaveBeenCalledTimes(1);
    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain('charge hole:*');
    expect(cmd).toContain('explosive:boomite');
    expect(cmd).not.toContain('buy ');
  });

  it('no console call is made for a stock purchase on update', () => {
    const { step, gameConsole } = makeStep();
    step.update(patternState(3, true), 'sunny');
    expect(gameConsole).not.toHaveBeenCalled();
  });
});

describe('warehouse inspector shows no stock (#2153)', () => {
  function warehouse(): Building {
    return { id: 3, type: 'explosive_warehouse', tier: 1, x: 17, z: 23, hp: 100, active: true, occupantIds: [] } as Building;
  }

  it('an explosive warehouse yields no stock rows, gauge or stock hook even if a legacy field were present', () => {
    const state = makeState();
    const b = Object.assign(warehouse(), { storedExplosives: { boomite: 120, krackle: 40 } });
    state.buildings.buildings = [b];
    const section = storageContents(b, state);
    if (section === null) return; // a warehouse with nothing to show has no section at all
    const root = document.createElement('div');
    root.append(section.section);
    expect(root.querySelector('[data-live^="stock-row"]')).toBeNull();
    expect(root.querySelector('[data-info="warehouse-stock"]')).toBeNull();
    expect(root.querySelector('[data-live="gauge"]')).toBeNull();
  });

  it('the same holds for a bare warehouse', () => {
    const state = makeState();
    const b = warehouse();
    state.buildings.buildings = [b];
    const section = storageContents(b, state);
    if (section === null) return;
    const root = document.createElement('div');
    root.append(section.section);
    expect(root.querySelector('[data-live^="stock-row"]')).toBeNull();
    expect(root.querySelector('[data-info="warehouse-stock"]')).toBeNull();
  });
});
