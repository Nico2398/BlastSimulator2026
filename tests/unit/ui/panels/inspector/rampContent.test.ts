// @vitest-environment jsdom
// Ramp inspector content (#1769): width, depth, length and the Widen action with its cost.
import { describe, it, expect } from 'vitest';
import { rampContent, widenState, type WidenState } from '../../../../../src/ui/panels/inspector/rampContent.js';
import type { InspectorLinks, InspectorView } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { BuiltRamp, GameState, PlannedRamp } from '../../../../../src/core/state/GameState.js';
import { computeRampCost } from '../../../../../src/core/mining/Ramp.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';
import { setLocale, t } from '../../../../../src/core/i18n/I18n.js';

const links = { select: () => {}, run: () => {}, confirm: () => {} } as InspectorLinks;

function rampOf(width: 3 | 5 | 7): BuiltRamp {
  const def = { originX: 10, originZ: 5, direction: 'south' as const, length: 12, targetDepth: 6, width };
  return { id: 1, def, width, footprint: { minX: 10 - Math.floor(width / 2), maxX: 10 + Math.floor(width / 2), minZ: 5, maxZ: 16 } };
}

function stateWith(ramp: BuiltRamp, cash = 1_000_000, planned: PlannedRamp[] = []): GameState {
  setLocale('en');
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.builtRamps.push(ramp);
  s.nextBuiltRampId = 2;
  s.plannedRamps = planned;
  s.cash = cash;
  return s;
}

function plannedWiden(ramp: BuiltRamp): PlannedRamp {
  return { id: 5, def: ramp.def, footprint: ramp.footprint, segments: [], widenOf: ramp.id };
}

function viewOf(s: GameState, id = 1): InspectorView {
  return rampContent.view({ kind: 'ramp', id }, s, links)!;
}

describe('widenState', () => {
  it('prices the next width step from the ramp length', () => {
    const r = rampOf(3);
    const w: WidenState = widenState(r, [], 1_000_000);
    expect(w.cost).toBe(computeRampCost(12, 2));
    expect(w.disabledReason).toBeNull();
  });

  it('is unavailable at maximum width', () => {
    expect(widenState(rampOf(7), [], 1_000_000)).toEqual({ cost: null, disabledReason: null });
  });

  it('is disabled with a reason when cash is short', () => {
    const w = widenState(rampOf(3), [], 10);
    expect(w.cost).toBe(computeRampCost(12, 2));
    expect(w.disabledReason).toBeTruthy();
  });

  it('is disabled with a reason while a widen order is in flight', () => {
    const r = rampOf(3);
    const w = widenState(r, [plannedWiden(r)], 1_000_000);
    expect(w.disabledReason).toBeTruthy();
  });

  it('ignores widen orders for another ramp', () => {
    const r = rampOf(3);
    const other = { ...plannedWiden(r), widenOf: 2 };
    expect(widenState(r, [other], 1_000_000).disabledReason).toBeNull();
  });

  it('affords exactly at cash equal to cost', () => {
    const cost = computeRampCost(12, 2);
    expect(widenState(rampOf(3), [], cost).disabledReason).toBeNull();
  });

  it('prices a 5 to 7 step as two voxels as well', () => {
    expect(widenState(rampOf(5), [], 1e6).cost).toBe(computeRampCost(12, 2));
  });
});

describe('ramp inspector', () => {
  it('returns null for an unknown ramp', () => {
    expect(rampContent.view({ kind: 'ramp', id: 99 }, stateWith(rampOf(3)), links)).toBeNull();
  });

  it('shows width, depth and length', () => {
    const view = viewOf(stateWith(rampOf(5)));
    const root = document.createElement('div');
    root.append(...view.sections);
    const text = root.textContent ?? '';
    expect(text).toContain('5');
    expect(text).toContain('6');
    expect(text).toContain('12');
  });

  it('offers Widen labelled with its cost', () => {
    const view = viewOf(stateWith(rampOf(3)));
    expect(view.actions.map(a => a.action)).toEqual(['widen']);
    expect(view.actions[0]!.label).toBe(`Widen · $${formatMoney(computeRampCost(12, 2))}`);
    expect(view.actions[0]!.disabled).toBeFalsy();
  });

  it('disables Widen with a reason when cash is short', () => {
    const a = viewOf(stateWith(rampOf(3), 10)).actions[0]!;
    expect(a.disabled).toBe(true);
    expect(a.title).toBeTruthy();
  });

  it('disables Widen while already being widened', () => {
    const r = rampOf(3);
    const a = viewOf(stateWith(r, 1e6, [plannedWiden(r)])).actions[0]!;
    expect(a.disabled).toBe(true);
    expect(a.title).toBeTruthy();
  });

  it('offers no action at maximum width', () => {
    expect(viewOf(stateWith(rampOf(7))).actions).toEqual([]);
  });

  it('signature changes with width, affordability and widening', () => {
    const r = rampOf(3);
    const base = viewOf(stateWith(r)).signature;
    expect(viewOf(stateWith(rampOf(5))).signature).not.toBe(base);
    expect(viewOf(stateWith(r, 10)).signature).not.toBe(base);
    expect(viewOf(stateWith(r, 1e6, [plannedWiden(r)])).signature).not.toBe(base);
  });
});

describe('multi-leg ramp inspector (#1939)', () => {
  function multiRamp(): BuiltRamp {
    const def = {
      originX: 20, originZ: 10, direction: 'south' as const, length: 22, targetDepth: 6, width: 3 as const,
      legs: [{ direction: 'south' as const, length: 12 }, { direction: 'east' as const, length: 10 }],
    };
    return { id: 1, def, width: 3, footprint: { minX: 19, maxX: 29, minZ: 10, maxZ: 23 } };
  }
  function textOf(ramp: BuiltRamp): string {
    const root = document.createElement('div');
    root.append(...viewOf(stateWith(ramp)).sections);
    return root.textContent ?? '';
  }

  it('shows a Legs row with the leg count and each leg length', () => {
    setLocale('en');
    const text = textOf(multiRamp());
    expect(text).toContain(t('inspector.ramp.legs'));
    expect(text).toContain('2');
    expect(text).toContain('12');
    expect(text).toContain('10');
  });

  it('shows the total length and the grade of the path', () => {
    setLocale('en');
    const text = textOf(multiRamp());
    expect(text).toContain('22');
    expect(text).toContain(t('inspector.ramp.grade'));
    expect(text).toContain(String(Math.round((Math.atan(6 / 22) * 180) / Math.PI)));
  });

  it('shows the ordered grade when one was chosen', () => {
    setLocale('en');
    const ramp = multiRamp();
    ramp.def = { ...ramp.def, gradeDegrees: 25 };
    expect(textOf(ramp)).toContain('25');
  });

  it('a straight ramp shows no Legs row', () => {
    setLocale('en');
    expect(textOf(rampOf(3))).not.toContain(t('inspector.ramp.legs'));
  });

  it('does not offer a usable Widen action', () => {
    const widen = viewOf(stateWith(multiRamp())).actions.find(a => a.action === 'widen');
    expect(widen === undefined || widen.disabled === true).toBe(true);
    if (widen) expect(widen.title).toBeTruthy();
  });
});
