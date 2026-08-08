// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WorldMap } from '../../../../src/ui/screens/WorldMap.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import type { CampaignState } from '../../../../src/core/campaign/Campaign.js';

function mount(): { container: HTMLDivElement; map: WorldMap } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, map: new WorldMap(container) };
}

function makeCampaign(overrides: Partial<CampaignState['levels']> = {}): CampaignState {
  return {
    levels: {
      dusty_hollow: { levelId: 'dusty_hollow', unlocked: true, completed: true, cumulativeProfit: 160000, bestSessionProfit: 160000 }, // >= 80k threshold x2 -> 3 stars
      grumpstone_ridge: { levelId: 'grumpstone_ridge', unlocked: true, completed: false, cumulativeProfit: 0, bestSessionProfit: 0 },
      treranium_depths: { levelId: 'treranium_depths', unlocked: false, completed: false, cumulativeProfit: 0, bestSessionProfit: 0 },
      ...overrides,
    },
    activeLevelId: null,
    campaignComplete: false,
  };
}

describe('WorldMap', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('carries a stable root id and is hidden by default', () => {
    const { container, map } = mount();
    expect(container.querySelector('#bs-world-map')).not.toBeNull();
    expect(map.visible).toBe(false);
    map.dispose();
    container.remove();
  });

  it('show() renders all 3 real campaign levels, excluding the tutorial', () => {
    const { container, map } = mount();
    map.show(makeCampaign());
    const text = container.textContent ?? '';
    expect(text).toContain('Dusty Hollow');
    expect(text).toContain('Grumpstone Ridge');
    expect(text).toContain('Treranium Depths');
    expect(text).not.toContain('Tutorial Pit');
    expect(map.visible).toBe(true);
    map.dispose();
  });

  it('show() with a null campaign treats every real level per its tier default (tier 1 unlocked, rest locked)', () => {
    const { container, map } = mount();
    map.show(null);
    const text = container.textContent ?? '';
    expect(text).toContain('Dusty Hollow');
    expect(text).toContain(t('menu.level_start')); // dusty_hollow (tier 1) is unlocked by default
    map.dispose();
    container.remove();
  });

  it('shows a lock block with the real threshold and previous-level name for a locked level', () => {
    const { container, map } = mount();
    map.show(makeCampaign());
    const text = container.textContent ?? '';
    expect(text).toContain('250,000'); // grumpstone_ridge's unlockThreshold
    expect(text).toContain(t('level.grumpstone_ridge.name')); // the level treranium_depths is locked behind
    map.dispose();
  });

  it('locked-level requirement text in French does not leak the standalone English word "on"', () => {
    setLocale('fr');
    const { container, map } = mount();
    map.show(makeCampaign());
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bon\b/);
    map.dispose();
    container.remove();
  });

  it('renders 3 amber stars for a level completed at 2x its unlock threshold', () => {
    const { container, map } = mount();
    map.show(makeCampaign());
    const stars = container.querySelectorAll('#bs-world-map bs-icon[name="star"]');
    // 3 levels x 3 stars each = 9 star icons total across all cards.
    expect(stars.length).toBe(9);
    const earned = Array.from(stars).filter(s => (s as HTMLElement).style.color === 'var(--bsx-amber)');
    // dusty_hollow completed at 2x threshold -> 3 stars; the other two are not completed -> 0 stars each.
    expect(earned.length).toBe(3);
    map.dispose();
  });

  it('campaign star progress aggregates real per-level stars (3 earned out of 9 possible)', () => {
    const { container, map } = mount();
    map.show(makeCampaign());
    const text = container.textContent ?? '';
    expect(text).toContain('3 / 9');
    map.dispose();
  });

  it('shows REPLAY (not START LEVEL) for an already-completed, unlocked level', () => {
    const { container, map } = mount();
    map.show(makeCampaign());
    expect(container.textContent).toContain(t('menu.level_resume'));
    map.dispose();
  });

  it('clicking a level\'s start button routes to onStartLevel with that level\'s id', () => {
    const { container, map } = mount();
    const cb = vi.fn();
    map.setOnStartLevel(cb);
    map.show(makeCampaign());

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const startBtn = buttons.find(b => b.textContent === t('menu.level_start')); // grumpstone_ridge: unlocked, not completed
    startBtn!.click();
    expect(cb).toHaveBeenCalledWith('grumpstone_ridge');
    map.dispose();
  });

  it('clicking the back button routes to onBack', () => {
    const { container, map } = mount();
    const cb = vi.fn();
    map.setOnBack(cb);
    map.show(null);

    const backBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.includes(t('ui.portfolio.back')));
    backBtn!.click();
    expect(cb).toHaveBeenCalledOnce();
    map.dispose();
  });

  it('hide() hides the screen', () => {
    const { map } = mount();
    map.show(null);
    map.hide();
    expect(map.visible).toBe(false);
    map.dispose();
  });

  it('a locale refresh re-renders both static chrome and the rebuilt level cards', () => {
    const { container, map } = mount();
    map.show(makeCampaign());
    expect(container.textContent).toContain('THE PORTFOLIO');
    expect(container.textContent).toContain(t('menu.level_resume'));

    setLocale('fr');
    map.refreshLocale();

    expect(container.textContent).toContain('LE PORTEFEUILLE');
    expect(container.textContent).toContain(t('menu.level_resume'));
    map.dispose();
    container.remove();
  });

  it('refreshLocale() does not populate the card grid while hidden — only the static header chrome refreshes', () => {
    const { container, map } = mount();
    setLocale('fr');
    map.refreshLocale();
    // Static chrome (built once in the constructor) always refreshes via LocaleTextRegistry...
    expect(container.querySelector('#bs-world-map')!.textContent).toContain('LE PORTEFEUILLE');
    // ...but no level cards were ever built, since show() was never called.
    expect(container.textContent).not.toContain('Dusty Hollow');
    map.dispose();
    container.remove();
  });

  // Before `data-action`/`data-level`, the only way to reach one specific
  // level's button was its translated label or its position in the grid.
  describe('stable selectors', () => {
    it('every unlocked level exposes its own start button keyed by level id', () => {
      const { container, map } = mount();
      map.show(makeCampaign());

      for (const id of ['dusty_hollow', 'grumpstone_ridge']) {
        const btn = container.querySelector(`#bs-world-map [data-level="${id}"] [data-action="start-level"]`);
        expect(btn, `no start button for ${id}`).not.toBeNull();
      }
      // treranium_depths is locked — its card exists but carries no start button.
      expect(container.querySelector('#bs-world-map [data-level="treranium_depths"]')).not.toBeNull();
      expect(container.querySelector('#bs-world-map [data-level="treranium_depths"] [data-action="start-level"]')).toBeNull();
      map.dispose();
      container.remove();
    });

    it('clicking the selector-addressed start button routes to that exact level, not the first card', () => {
      const { container, map } = mount();
      const cb = vi.fn();
      map.setOnStartLevel(cb);
      map.show(makeCampaign());

      container.querySelector<HTMLButtonElement>('#bs-world-map [data-level="grumpstone_ridge"] [data-action="start-level"]')!.click();
      expect(cb).toHaveBeenCalledWith('grumpstone_ridge');

      container.querySelector<HTMLButtonElement>('#bs-world-map [data-level="dusty_hollow"] [data-action="start-level"]')!.click();
      expect(cb).toHaveBeenLastCalledWith('dusty_hollow');
      map.dispose();
      container.remove();
    });

    it('the start button keeps its selector after a locale refresh rebuilds the cards', () => {
      const { container, map } = mount();
      map.show(makeCampaign());
      setLocale('fr');
      map.refreshLocale();
      expect(container.querySelector('#bs-world-map [data-level="dusty_hollow"] [data-action="start-level"]')).not.toBeNull();
      map.dispose();
      container.remove();
    });
  });

  it('dispose removes the screen from the DOM', () => {
    const { container, map } = mount();
    map.dispose();
    expect(container.querySelector('#bs-world-map')).toBeNull();
    container.remove();
  });
});
