// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ToolRail } from '../../../../src/ui/shell/ToolRail.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { createGradeState } from '../../../../src/core/economy/MineGrade.js';
import { t } from '../../../../src/core/i18n/I18n.js';

function mount(): { container: HTMLDivElement; rail: ToolRail; selected: string[] } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const selected: string[] = [];
  const rail = new ToolRail(container, (panel) => { selected.push(panel); });
  return { container, rail, selected };
}

describe('ToolRail — shady reveal (redesign P9)', () => {
  it('the shady entry is present but hidden before any corruption exists', () => {
    const { container, rail } = mount();
    const btn = container.querySelector<HTMLButtonElement>('button[data-panel="shady"]')!;
    expect(btn).not.toBeNull();
    expect(btn.style.display).toBe('none');
    rail.dispose();
  });

  it('carries no label — the design calls for an unlabeled icon', () => {
    const { container, rail } = mount();
    const btn = container.querySelector<HTMLButtonElement>('button[data-panel="shady"]')!;
    expect(btn.querySelector('span')).toBeNull();
    rail.dispose();
  });

  it('reveals once corruption.level > 0', () => {
    const { container, rail } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.corruption.level = 1;
    rail.update(state);
    const btn = container.querySelector<HTMLButtonElement>('button[data-panel="shady"]')!;
    expect(btn.style.display).toBe('flex');
    rail.dispose();
  });

  it('reveals once mafia is unlocked even if level somehow reads 0', () => {
    const { container, rail } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.corruption.mafiaUnlocked = true;
    rail.update(state);
    const btn = container.querySelector<HTMLButtonElement>('button[data-panel="shady"]')!;
    expect(btn.style.display).toBe('flex');
    rail.dispose();
  });

  it('stays revealed and does not re-hide if corruption level somehow returns to 0', () => {
    const { container, rail } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.corruption.level = 1;
    rail.update(state);
    state.corruption.level = 0;
    rail.update(state);
    const btn = container.querySelector<HTMLButtonElement>('button[data-panel="shady"]')!;
    expect(btn.style.display).toBe('flex');
    rail.dispose();
  });

  it('clicking the revealed shady button routes to onSelect with "shady"', () => {
    const { container, rail, selected } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.corruption.level = 1;
    rail.update(state);
    container.querySelector<HTMLButtonElement>('button[data-panel="shady"]')!.click();
    expect(selected).toEqual(['shady']);
    rail.dispose();
  });

  it('every other rail entry is unaffected by update()', () => {
    const { container, rail } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    rail.update(state);
    const blastBtn = container.querySelector<HTMLButtonElement>('button[data-panel="blast"]')!;
    expect(blastBtn.style.display).not.toBe('none');
    rail.dispose();
  });
});

describe('ToolRail — permits entry (#1924)', () => {
  it('is present but hidden on a state without a grade ladder', () => {
    const { container, rail } = mount();
    const btn = container.querySelector<HTMLButtonElement>('button[data-panel="permits"]');
    expect(btn).not.toBeNull();
    expect(btn!.style.display).toBe('none');
    rail.update(createGame({ seed: 1, mineType: 'desert' }));
    expect(btn!.style.display).toBe('none');
    rail.dispose();
  });

  it('is revealed once the state carries a grade, and labelled Permits', () => {
    const { container, rail } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.grade = createGradeState();
    rail.update(state);
    const btn = container.querySelector<HTMLButtonElement>('button[data-panel="permits"]')!;
    expect(btn.style.display).toBe('flex');
    expect(btn.textContent).toContain(t('shell.rail.permits'));
    expect(t('shell.rail.permits')).toBe('Permits');
    rail.dispose();
  });

  it('never re-hides once revealed', () => {
    const { container, rail } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.grade = createGradeState();
    rail.update(state);
    delete state.grade;
    rail.update(state);
    expect(container.querySelector<HTMLButtonElement>('button[data-panel="permits"]')!.style.display).toBe('flex');
    rail.dispose();
  });

  it('click navigates to permits', () => {
    const { container, rail, selected } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.grade = createGradeState();
    rail.update(state);
    container.querySelector<HTMLButtonElement>('button[data-panel="permits"]')!.click();
    expect(selected).toContain('permits');
    rail.dispose();
  });

  it('the rail has ten entries', () => {
    const { container, rail } = mount();
    expect(container.querySelectorAll('button[data-panel]')).toHaveLength(10);
    rail.dispose();
  });
});
