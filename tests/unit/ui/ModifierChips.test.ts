// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createModifierChips } from '../../../src/ui/shell/ModifierChips.js';
import { addModifier, type ActiveModifier } from '../../../src/core/events/ActiveModifiers.js';
import { mod } from '../../helpers/eventEffectWorld.js';

function ledger(...ms: Array<Parameters<typeof mod>[0]>): ActiveModifier[] {
  const list: ActiveModifier[] = [];
  ms.forEach((m, i) => addModifier(list, mod(m), i + 1));
  return list;
}

describe('ModifierChips', () => {
  it('renders nothing for an empty ledger', () => {
    const c = document.createElement('div');
    createModifierChips(c)([], 0);
    expect(c.querySelectorAll('.bs-modifier-chip')).toHaveLength(0);
  });

  it('renders one chip per live modifier with a label and remaining time', () => {
    const c = document.createElement('div');
    const update = createModifierChips(c);
    update(ledger({ kind: 'work_stoppage', endTick: 48 }, { kind: 'blast_ban', endTick: 30 }), 6);
    const chips = c.querySelectorAll('.bs-modifier-chip');
    expect(chips).toHaveLength(2);
    for (const chip of Array.from(chips)) {
      expect(chip.textContent ?? '').toMatch(/\d/);
      expect((chip.textContent ?? '').trim().length).toBeGreaterThan(2);
    }
  });

  it('updates the remaining time as ticks pass', () => {
    const c = document.createElement('div');
    const update = createModifierChips(c);
    const list = ledger({ kind: 'work_stoppage', endTick: 48 });
    update(list, 0);
    const first = c.querySelector('.bs-modifier-chip')!.textContent;
    update(list, 30);
    expect(c.querySelector('.bs-modifier-chip')!.textContent).not.toBe(first);
  });

  it('removes the chip at expiry', () => {
    const c = document.createElement('div');
    const update = createModifierChips(c);
    const list = ledger({ kind: 'work_stoppage', endTick: 10 });
    update(list, 5);
    expect(c.querySelectorAll('.bs-modifier-chip')).toHaveLength(1);
    update(list, 10);
    expect(c.querySelectorAll('.bs-modifier-chip')).toHaveLength(0);
  });

  it('shows a permanent modifier without a countdown', () => {
    const c = document.createElement('div');
    createModifierChips(c)(ledger({ kind: 'salary_factor', magnitude: 1.1, endTick: null }), 999);
    expect(c.querySelectorAll('.bs-modifier-chip')).toHaveLength(1);
  });
});
