// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createModifierChips, mountModifierChips } from '../../../src/ui/shell/ModifierChips.js';
import { addModifier, type ActiveModifier } from '../../../src/core/events/ActiveModifiers.js';
import { mod } from '../../helpers/eventEffectWorld.js';
import { formatGameClock } from '../../../src/ui/formatGameClock.js';
import { t } from '../../../src/core/i18n/I18n.js';

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

  describe('explanations (#2169)', () => {
    it('every live chip is explainable: data-explain, tabindex 0, bsx-explainable', () => {
      const c = document.createElement('div');
      createModifierChips(c)(ledger({ kind: 'work_stoppage', endTick: 48 }, { kind: 'blast_ban', endTick: 30 }), 6);
      const chips = Array.from(c.querySelectorAll<HTMLElement>('.bs-modifier-chip'));
      expect(chips).toHaveLength(2);
      for (const chip of chips) {
        expect((chip.dataset['explain'] ?? '').trim().length).toBeGreaterThan(5);
        expect(chip.tabIndex).toBe(0);
        expect(chip.classList.contains('bsx-explainable')).toBe(true);
      }
    });

    it('a timed modifier explains until when, as the game clock', () => {
      const c = document.createElement('div');
      createModifierChips(c)(ledger({ kind: 'work_stoppage', endTick: 77 }), 6);
      expect(c.querySelector<HTMLElement>('.bs-modifier-chip')!.dataset['explain']).toContain(formatGameClock(77));
    });

    it('chips of different modifiers carry different explanations', () => {
      const c = document.createElement('div');
      createModifierChips(c)(ledger({ kind: 'work_stoppage', endTick: 48 }, { kind: 'blast_ban', endTick: 48 }), 6);
      const [a, b] = Array.from(c.querySelectorAll<HTMLElement>('.bs-modifier-chip'));
      expect(a!.dataset['explain']).not.toBe(b!.dataset['explain']);
    });

    it('a permanent modifier explains that it is permanent', () => {
      const c = document.createElement('div');
      createModifierChips(c)(ledger({ kind: 'salary_factor', magnitude: 1.1, endTick: null }), 999);
      expect(c.querySelector<HTMLElement>('.bs-modifier-chip')!.dataset['explain']).toMatch(/permanent/i);
    });

    it('a role-limited modifier names the role in its explanation', () => {
      const c = document.createElement('div');
      createModifierChips(c)(ledger({ kind: 'work_stoppage', role: 'driller', endTick: 48 }), 6);
      expect(c.querySelector<HTMLElement>('.bs-modifier-chip')!.dataset['explain']).toContain(t('role.driller'));
    });

    it('a lapsed modifier stays hidden', () => {
      const c = document.createElement('div');
      const update = createModifierChips(c);
      update(ledger({ kind: 'work_stoppage', endTick: 10 }, { kind: 'blast_ban', endTick: 90 }), 10);
      const chips = c.querySelectorAll('.bs-modifier-chip');
      expect(chips).toHaveLength(1);
    });

    it('the mounted strip stays click-through while its chips receive pointer events', () => {
      const parent = document.createElement('div');
      const mounted = mountModifierChips(parent);
      mounted.update(ledger({ kind: 'work_stoppage', endTick: 48 }), 6);
      const strip = parent.querySelector<HTMLElement>('#bs-modifier-chips')!;
      expect(strip.style.pointerEvents).toBe('none');
      const chip = strip.querySelector<HTMLElement>('.bs-modifier-chip')!;
      expect(chip.style.pointerEvents).toBe('auto');
      mounted.dispose();
    });
  });
});
