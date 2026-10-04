// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { LevelEndScreen } from '../../../../src/ui/screens/LevelEndScreen.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { LevelStats } from '../../../../src/core/campaign/SuccessTracker.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';
import { TICKS_PER_DAY } from '../../../../src/core/config/balance.js';

function mount(): { container: HTMLDivElement; screen: LevelEndScreen } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, screen: new LevelEndScreen(container) };
}

function stateAtLevelEnd(overrides: Partial<LevelStats> = {}, levelId = 'dusty_hollow'): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.campaign.activeLevelId = levelId;
  s.levelEnded = true;
  s.levelEndReason = 'completed';
  Object.assign(s.levelStats, overrides);
  return s;
}

type DefeatReason = 'bankruptcy' | 'arrest' | 'ecological_shutdown' | 'worker_revolt';

function stateAtDefeat(reason: DefeatReason, levelId = 'dusty_hollow'): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.campaign.activeLevelId = levelId;
  s.levelEnded = true;
  s.levelEndReason = reason;
  return s;
}

// dusty_hollow's unlockThreshold is 80000; treranium_depths is the last level.
const THREE_STAR: Partial<LevelStats> = { totalWealth: 100000, casualties: 0, bestEcology: 75 };
const ONE_STAR: Partial<LevelStats> = { totalWealth: 1000, casualties: 2, bestEcology: 10 };

describe('LevelEndScreen', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('carries a stable root id and is hidden by default', () => {
    const { container, screen } = mount();
    expect(container.querySelector('#bs-level-end-screen')).not.toBeNull();
    expect(screen.visible).toBe(false);
    screen.dispose();
    container.remove();
  });

  it('stays hidden while levelEndReason is null', () => {
    const { screen } = mount();
    const state = stateAtLevelEnd(THREE_STAR);
    state.levelEndReason = null;
    state.levelEnded = false;
    screen.update(state);
    expect(screen.visible).toBe(false);
    screen.dispose();
  });

  it('shows the defeat layout, not the victory layout, for a loss reason', () => {
    const { container, screen } = mount();
    screen.update(stateAtDefeat('bankruptcy'));
    expect(screen.visible).toBe(true);
    // Victory-only copy must not appear on a defeat render.
    expect(container.querySelector('#bs-level-end-screen')!.textContent).not.toContain('TARGET REACHED');
    screen.dispose();
  });

  it('shows when levelEndReason becomes "completed"', () => {
    const { screen } = mount();
    screen.update(stateAtLevelEnd(THREE_STAR));
    expect(screen.visible).toBe(true);
    screen.dispose();
  });

  it('renders 3 earned stars for a profit+safety+ecology pass', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd(THREE_STAR));

    const stars = container.querySelectorAll('#bs-level-end-screen bs-icon[name="star"]');
    expect(stars.length).toBe(3);
    const earned = Array.from(stars).filter(s => (s as HTMLElement).style.color === 'var(--bsx-amber)');
    expect(earned.length).toBe(3);
    screen.dispose();
  });

  it('renders the minimum 1 earned star even when every criterion fails', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd(ONE_STAR));

    const stars = container.querySelectorAll('#bs-level-end-screen bs-icon[name="star"]');
    const earned = Array.from(stars).filter(s => (s as HTMLElement).style.color === 'var(--bsx-amber)');
    expect(earned.length).toBe(1);
    screen.dispose();
  });

  it('stat grid shows the real LevelStats figures', () => {
    const { container, screen } = mount();
    const state = stateAtLevelEnd({
      ...THREE_STAR,
      blastsPerformed: 6,
      uniqueOresExtracted: new Set(['rustite', 'dirtite']),
      casualties: 0,
    });
    screen.update(state);

    const text = container.querySelector('#bs-level-end-screen')!.textContent!;
    expect(text).toContain('100,000');
    expect(text).toContain('6'); // blasts
    expect(text).toContain('2'); // unique ore count
    screen.dispose();
  });

  it('the star-rating breakdown marks each criterion with check or x matching its real pass/fail', () => {
    const { container, screen } = mount();
    // Profit pass, safety fail, ecology pass.
    screen.update(stateAtLevelEnd({ totalWealth: 100000, casualties: 3, bestEcology: 75 }));

    const icons = container.querySelectorAll('#bs-level-end-screen bs-icon');
    const names = Array.from(icons).map(i => i.getAttribute('name'));
    // 3 stars (all named 'star') + 3 breakdown rows (check/x) — filter to just the breakdown ones.
    const breakdown = names.filter(n => n === 'check' || n === 'x');
    expect(breakdown).toEqual(['check', 'x', 'check']); // profit, safety, ecology
    screen.dispose();
  });

  it('safety-fail note names the real casualty count, not a misleading score bar', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd({ totalWealth: 100000, casualties: 3, bestEcology: 75 }));
    expect(container.querySelector('#bs-level-end-screen')!.textContent).toContain('3 casualties');
    screen.dispose();
  });

  it('hides the replay button once the player already has 3 stars', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd(THREE_STAR));
    const replay = Array.from(container.querySelectorAll('#bs-level-end-screen button'))
      .find(b => b.textContent?.includes('REPLAY'));
    expect((replay as HTMLElement).style.display).toBe('none');
    screen.dispose();
  });

  it('shows the replay button when stars are less than 3', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd(ONE_STAR));
    const replay = Array.from(container.querySelectorAll('#bs-level-end-screen button'))
      .find(b => b.textContent?.includes('REPLAY'));
    expect((replay as HTMLElement).style.display).not.toBe('none');
    screen.dispose();
  });

  it('continue button names the next level when one exists', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd(THREE_STAR, 'dusty_hollow'));
    const text = container.querySelector('#bs-level-end-screen')!.textContent!;
    expect(text).toContain('CONTINUE TO');
    screen.dispose();
  });

  it('shows BACK TO PORTFOLIO instead of CONTINUE on the last level', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd(THREE_STAR, 'treranium_depths'));
    const text = container.querySelector('#bs-level-end-screen')!.textContent!;
    expect(text).toContain('BACK TO PORTFOLIO');
    expect(text).not.toContain('CONTINUE TO');
    screen.dispose();
  });

  it('replay routes to onReplay with the level that just ended', () => {
    const { container, screen } = mount();
    let replayedId: string | null = null;
    screen.setOnReplay(id => { replayedId = id; });
    screen.update(stateAtLevelEnd(ONE_STAR, 'dusty_hollow'));

    const replay = Array.from(container.querySelectorAll('#bs-level-end-screen button'))
      .find(b => b.textContent?.includes('REPLAY')) as HTMLButtonElement;
    replay.click();
    expect(replayedId).toBe('dusty_hollow');
    screen.dispose();
  });

  it('continue routes to onContinue with the next level id', () => {
    const { container, screen } = mount();
    let nextId: string | null = null;
    screen.setOnContinue(id => { nextId = id; });
    screen.update(stateAtLevelEnd(THREE_STAR, 'dusty_hollow'));

    const continueBtn = Array.from(container.querySelectorAll('#bs-level-end-screen button'))
      .find(b => b.textContent?.includes('CONTINUE TO')) as HTMLButtonElement;
    continueBtn.click();
    expect(nextId).toBe('grumpstone_ridge');
    screen.dispose();
  });

  it('on the last level, the same button routes to onBackToPortfolio instead', () => {
    const { container, screen } = mount();
    let backCalled = false;
    screen.setOnBackToPortfolio(() => { backCalled = true; });
    screen.update(stateAtLevelEnd(THREE_STAR, 'treranium_depths'));

    const backBtn = Array.from(container.querySelectorAll('#bs-level-end-screen button'))
      .find(b => b.textContent?.includes('BACK TO PORTFOLIO')) as HTMLButtonElement;
    backBtn.click();
    expect(backCalled).toBe(true);
    screen.dispose();
  });

  it('does not rebuild on a second update() call for the same completed level (idempotent)', () => {
    const { container, screen } = mount();
    const state = stateAtLevelEnd(THREE_STAR);
    screen.update(state);
    const firstHeadline = container.querySelector('#bs-level-end-screen')!.textContent;

    // Mutate stats after the first render — a naive re-render would pick this up.
    state.levelStats.totalWealth = 999999;
    screen.update(state);
    expect(container.querySelector('#bs-level-end-screen')!.textContent).toBe(firstHeadline);
    screen.dispose();
  });

  it('resets and re-renders fresh when levelEndReason clears and a new level ends', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd(ONE_STAR, 'dusty_hollow'));
    expect(screen.visible).toBe(true);

    const midState = stateAtLevelEnd(ONE_STAR, 'dusty_hollow');
    midState.levelEndReason = null;
    midState.levelEnded = false;
    screen.update(midState);
    expect(screen.visible).toBe(false);

    screen.update(stateAtLevelEnd(THREE_STAR, 'grumpstone_ridge'));
    expect(screen.visible).toBe(true);
    const text = container.querySelector('#bs-level-end-screen')!.textContent!;
    expect(text).toContain('CONTINUE TO');
    screen.dispose();
  });

  it('a locale refresh re-renders dynamic content in the new language', () => {
    const { container, screen } = mount();
    screen.update(stateAtLevelEnd(THREE_STAR));
    expect(container.querySelector('#bs-level-end-screen')!.textContent).toContain('TARGET REACHED');

    setLocale('fr');
    screen.refreshLocale();

    expect(container.querySelector('#bs-level-end-screen')!.textContent).toContain('OBJECTIF ATTEINT');
    screen.dispose();
  });

  it('dispose removes the screen from the DOM', () => {
    const { container, screen } = mount();
    screen.dispose();
    expect(container.querySelector('#bs-level-end-screen')).toBeNull();
    container.remove();
  });

  // Both footers were reachable only by their translated label ('REPLAY',
  // 'CONTINUE TO …', 'RETRY …'), which no test in another locale can match.
  describe('stable selectors', () => {
    it('victory footer exposes replay and continue by data-action, wired to the real callbacks', () => {
      const { container, screen } = mount();
      let replayedId: string | null = null;
      let nextId: string | null = null;
      screen.setOnReplay(id => { replayedId = id; });
      screen.setOnContinue(id => { nextId = id; });
      screen.update(stateAtLevelEnd(ONE_STAR, 'dusty_hollow'));

      const replay = container.querySelector<HTMLButtonElement>('#bs-level-end-screen [data-action="replay"]');
      expect(replay).not.toBeNull();
      replay!.click();
      expect(replayedId).toBe('dusty_hollow');

      const cont = container.querySelector<HTMLButtonElement>('#bs-level-end-screen [data-action="continue"]');
      expect(cont).not.toBeNull();
      cont!.click();
      expect(nextId).toBe('grumpstone_ridge');
      screen.dispose();
      container.remove();
    });

    it('the continue button keeps its data-action after its label is cleared and rebuilt', () => {
      const { container, screen } = mount();
      // levelEndReason back to null is what resets the render gate between levels.
      const inPlay = createGame({ seed: 42, mineType: 'desert' });
      screen.update(stateAtLevelEnd(THREE_STAR, 'dusty_hollow'));
      // A defeat render clears the victory labels; switching back rebuilds them.
      screen.update(inPlay);
      screen.update(stateAtDefeat('bankruptcy'));
      screen.update(inPlay);
      screen.update(stateAtLevelEnd(THREE_STAR, 'dusty_hollow'));
      expect(container.querySelector('#bs-level-end-screen [data-action="continue"]')).not.toBeNull();
      screen.dispose();
      container.remove();
    });

    it('defeat footer exposes retry and back-to-portfolio by data-action', () => {
      const { container, screen } = mount();
      let replayedId: string | null = null;
      let backCalled = false;
      screen.setOnReplay(id => { replayedId = id; });
      screen.setOnBackToPortfolio(() => { backCalled = true; });
      screen.update(stateAtDefeat('bankruptcy', 'dusty_hollow'));

      const retry = container.querySelector<HTMLButtonElement>('#bs-level-end-screen [data-action="retry"]');
      expect(retry).not.toBeNull();
      retry!.click();
      expect(replayedId).toBe('dusty_hollow');

      const back = container.querySelector<HTMLButtonElement>('#bs-level-end-screen [data-action="back-to-portfolio"]');
      expect(back).not.toBeNull();
      back!.click();
      expect(backCalled).toBe(true);
      screen.dispose();
      container.remove();
    });

    it('the selectors resolve in French too, where every label differs', () => {
      const { container, screen } = mount();
      setLocale('fr');
      screen.update(stateAtLevelEnd(ONE_STAR, 'dusty_hollow'));
      expect(container.querySelector('#bs-level-end-screen [data-action="replay"]')).not.toBeNull();
      expect(container.querySelector('#bs-level-end-screen [data-action="continue"]')).not.toBeNull();
      screen.dispose();
      container.remove();
    });
  });

  describe('defeat variants', () => {
    it('each of the 4 loss reasons renders a distinct title', () => {
      const reasons: DefeatReason[] = ['bankruptcy', 'arrest', 'ecological_shutdown', 'worker_revolt'];
      const titles = new Set<string>();
      for (const reason of reasons) {
        const { container, screen } = mount();
        screen.update(stateAtDefeat(reason));
        titles.add(container.querySelector('#bs-level-end-screen')!.textContent!.slice(0, 40));
        screen.dispose();
        container.remove();
      }
      expect(titles.size).toBe(4);
    });

    it('bankruptcy: stat grid shows the real cash balance and the real salaries-paid total from the ledger', () => {
      const { container, screen } = mount();
      const state = stateAtDefeat('bankruptcy');
      state.cash = -12345;
      state.finances.transactions.push(
        { tick: 1, amount: 4000, type: 'expense', category: 'salaries', description: 'payroll' },
        { tick: 2, amount: 1500, type: 'expense', category: 'salaries', description: 'payroll' },
        { tick: 3, amount: 999, type: 'expense', category: 'fuel', description: 'diesel' }, // must not be summed in
      );
      screen.update(state);

      const text = container.querySelector('#bs-level-end-screen')!.textContent!;
      expect(text).toContain('12,345'); // final balance (negative)
      expect(text).toContain('5,500'); // salaries only: 4000 + 1500, excludes the fuel expense
      screen.dispose();
    });

    it('arrest: stat grid shows exposureRisk as a percentage and the real corruption attempt count', () => {
      const { container, screen } = mount();
      const state = stateAtDefeat('arrest');
      state.mafia.exposureRisk = 0.9;
      state.corruption.level = 4;
      state.corruption.attempts.push(
        { tick: 1, target: 'judge', cost: 50000, success: false },
        { tick: 2, target: 'inspector', cost: 8000, success: true },
      );
      screen.update(state);

      const text = container.querySelector('#bs-level-end-screen')!.textContent!;
      expect(text).toContain('90%');
      expect(text).toContain('2'); // arrangements made
      expect(text).toContain('4'); // corruption level
      screen.dispose();
    });

    it('ecological_shutdown: stat grid sums real fines-category transactions only', () => {
      const { container, screen } = mount();
      const state = stateAtDefeat('ecological_shutdown');
      state.scores.ecology = 0;
      state.finances.transactions.push(
        { tick: 1, amount: 20000, type: 'expense', category: 'fines', description: 'eco fine' },
        { tick: 2, amount: 5000, type: 'expense', category: 'fines', description: 'eco fine' },
        { tick: 3, amount: 999, type: 'expense', category: 'salaries', description: 'payroll' }, // must not be summed in
      );
      screen.update(state);

      const text = container.querySelector('#bs-level-end-screen')!.textContent!;
      expect(text).toContain('25,000'); // fines only: 20000 + 5000
      screen.dispose();
    });

    it('worker_revolt: stat grid shows the real site policy shift mode label', () => {
      const { container, screen } = mount();
      const state = stateAtDefeat('worker_revolt');
      state.scores.wellBeing = 0;
      state.sitePolicy.shiftMode = 'continuous';
      screen.update(state);

      const text = container.querySelector('#bs-level-end-screen')!.textContent!;
      expect(text).toContain('Continuous');
      screen.dispose();
    });

    it('worker_revolt body names the real day count dynamically, not a fixed mockup day', () => {
      const { container, screen } = mount();
      const state = stateAtDefeat('worker_revolt');
      state.tickCount = 5 * TICKS_PER_DAY; // day 6 (1-indexed, matching the victory recap's day formula)
      screen.update(state);

      expect(container.querySelector('#bs-level-end-screen')!.textContent).toContain('day 6');
      screen.dispose();
    });

    it('RETRY routes to onReplay with the level that just ended', () => {
      const { container, screen } = mount();
      let replayedId: string | null = null;
      screen.setOnReplay(id => { replayedId = id; });
      screen.update(stateAtDefeat('bankruptcy', 'grumpstone_ridge'));

      const retry = Array.from(container.querySelectorAll('#bs-level-end-screen button'))
        .find(b => b.textContent?.includes('RETRY')) as HTMLButtonElement;
      retry.click();
      expect(replayedId).toBe('grumpstone_ridge');
      screen.dispose();
    });

    it('BACK TO PORTFOLIO routes to onBackToPortfolio regardless of level position', () => {
      const { container, screen } = mount();
      let backCalled = false;
      screen.setOnBackToPortfolio(() => { backCalled = true; });
      // Not the last level — unlike the victory screen, defeat always offers a portfolio exit.
      screen.update(stateAtDefeat('arrest', 'dusty_hollow'));

      const back = Array.from(container.querySelectorAll('#bs-level-end-screen button'))
        .find(b => b.textContent?.includes('BACK TO PORTFOLIO')) as HTMLButtonElement;
      back.click();
      expect(backCalled).toBe(true);
      screen.dispose();
    });

    it('does not rebuild a defeat render on a second update() call for the same reason (idempotent)', () => {
      const { container, screen } = mount();
      const state = stateAtDefeat('ecological_shutdown');
      screen.update(state);
      const first = container.querySelector('#bs-level-end-screen')!.textContent;

      state.scores.ecology = 99; // a naive re-render would pick this up
      screen.update(state);
      expect(container.querySelector('#bs-level-end-screen')!.textContent).toBe(first);
      screen.dispose();
    });

    it('a locale refresh while a defeat screen is showing re-renders the title in the new language', () => {
      const { container, screen } = mount();
      screen.update(stateAtDefeat('bankruptcy'));
      expect(container.querySelector('#bs-level-end-screen')!.textContent).toContain('THE BANK HAS NOTICED');

      setLocale('fr');
      screen.refreshLocale();

      expect(container.querySelector('#bs-level-end-screen')!.textContent).toContain('LA BANQUE A REMARQUÉ');
      screen.dispose();
    });

    it('switching from a defeat reason to a fresh completed level shows the victory layout, not stale defeat content', () => {
      const { container, screen } = mount();
      screen.update(stateAtDefeat('worker_revolt', 'dusty_hollow'));
      expect(container.querySelector('#bs-level-end-screen')!.textContent).toContain('THE CREW HAS WALKED OUT');

      const midState = stateAtDefeat('worker_revolt', 'dusty_hollow');
      midState.levelEndReason = null;
      midState.levelEnded = false;
      screen.update(midState);
      expect(screen.visible).toBe(false);

      screen.update(stateAtLevelEnd(THREE_STAR, 'grumpstone_ridge'));
      const text = container.querySelector('#bs-level-end-screen')!.textContent!;
      expect(text).toContain('TARGET REACHED');
      expect(text).not.toContain('THE CREW HAS WALKED OUT');
      screen.dispose();
    });
  });

  describe('campaign finale (#1320)', () => {
    // A failing assertion skips screen.dispose(); clear leaked roots so one failure cannot cascade.
    afterEach(() => { document.body.innerHTML = ''; });

    function finale(levelId: string, complete: boolean): GameState {
      const s = stateAtLevelEnd(THREE_STAR, levelId);
      s.campaign.campaignComplete = complete;
      return s;
    }
    const rootText = (c: HTMLElement): string => c.querySelector('#bs-level-end-screen')!.textContent!;

    it('new i18n keys resolve to real text', () => {
      expect(t('ui.level_end.campaign_complete.headline')).not.toBe('ui.level_end.campaign_complete.headline');
      expect(t('ui.level_end.campaign_complete.body')).not.toBe('ui.level_end.campaign_complete.body');
    });

    it('victory on treranium_depths with campaignComplete shows headline and body', () => {
      const { container, screen } = mount();
      screen.update(finale('treranium_depths', true));
      const text = rootText(container);
      expect(text).toContain(t('ui.level_end.campaign_complete.headline'));
      expect(text).toContain(t('ui.level_end.campaign_complete.body'));
      expect(text).toContain('BACK TO PORTFOLIO');
      screen.dispose();
    });

    it('treranium_depths victory without campaignComplete shows no finale text', () => {
      const { container, screen } = mount();
      screen.update(finale('treranium_depths', false));
      expect(rootText(container)).not.toContain(t('ui.level_end.campaign_complete.headline'));
      screen.dispose();
    });

    it('shows the finale when the stored flag is false but all 3 real levels are completed', () => {
      const { container, screen } = mount();
      const s = finale('treranium_depths', false);
      for (const id of ['dusty_hollow', 'grumpstone_ridge', 'treranium_depths']) s.campaign.levels[id]!.completed = true;
      screen.update(s);
      expect(rootText(container)).toContain(t('ui.level_end.campaign_complete.headline'));
      screen.dispose();
    });

    it.each(['dusty_hollow', 'grumpstone_ridge', 'tutorial_pit'])('victory on %s shows no finale text', id => {
      const { container, screen } = mount();
      screen.update(finale(id, true));
      expect(rootText(container)).not.toContain(t('ui.level_end.campaign_complete.headline'));
      expect(rootText(container)).not.toContain(t('ui.level_end.campaign_complete.body'));
      screen.dispose();
    });

    it('finale text clears after a defeat render and after a non-final victory', () => {
      const { container, screen } = mount();
      screen.update(finale('treranium_depths', true));
      expect(rootText(container)).toContain(t('ui.level_end.campaign_complete.headline'));
      const mid = finale('treranium_depths', true);
      mid.levelEnded = false;
      mid.levelEndReason = null;
      screen.update(mid);
      const d = stateAtDefeat('bankruptcy', 'treranium_depths');
      d.campaign.campaignComplete = true;
      screen.update(d);
      expect(rootText(container)).not.toContain(t('ui.level_end.campaign_complete.headline'));
      screen.update(mid);
      screen.update(finale('dusty_hollow', false));
      expect(rootText(container)).not.toContain(t('ui.level_end.campaign_complete.headline'));
      expect(rootText(container)).not.toContain(t('ui.level_end.campaign_complete.body'));
      screen.dispose();
    });

    it('refreshLocale switches the finale text to French', () => {
      const { container, screen } = mount();
      screen.update(finale('treranium_depths', true));
      const enHeadline = t('ui.level_end.campaign_complete.headline');
      setLocale('fr');
      const frHeadline = t('ui.level_end.campaign_complete.headline');
      expect(frHeadline).not.toBe(enHeadline);
      screen.refreshLocale();
      expect(rootText(container)).toContain(frHeadline);
      expect(rootText(container)).toContain(t('ui.level_end.campaign_complete.body'));
      expect(rootText(container)).not.toContain(enHeadline);
      screen.dispose();
    });
  });

  describe('reset (#1322)', () => {
    // A failing assertion skips screen.dispose(); clear leaked roots so one failure cannot cascade.
    afterEach(() => { document.body.innerHTML = ''; });

    it('hides a visible screen', () => {
      const { screen } = mount();
      screen.update(stateAtLevelEnd(THREE_STAR));
      expect(screen.visible).toBe(true);
      screen.reset();
      expect(screen.visible).toBe(false);
      screen.dispose();
    });

    it('does not throw and stays hidden on a never-shown screen', () => {
      const { screen } = mount();
      expect(() => screen.reset()).not.toThrow();
      expect(screen.visible).toBe(false);
      screen.dispose();
    });

    it('re-renders and shows again for the same ended state after reset', () => {
      const { container, screen } = mount();
      const ended = stateAtLevelEnd(THREE_STAR);
      screen.update(ended);
      screen.reset();
      expect(screen.visible).toBe(false);
      screen.update(ended);
      expect(screen.visible).toBe(true);
      expect(container.querySelector('#bs-level-end-screen')!.textContent).toContain('TARGET REACHED');
      screen.dispose();
    });

    it('shows victory content, not stale defeat text, when a victory follows a reset defeat', () => {
      const { container, screen } = mount();
      screen.update(stateAtDefeat('bankruptcy'));
      expect(container.querySelector('#bs-level-end-screen')!.textContent).not.toContain('TARGET REACHED');
      screen.reset();
      screen.update(stateAtLevelEnd(THREE_STAR));
      expect(screen.visible).toBe(true);
      const text = container.querySelector('#bs-level-end-screen')!.textContent!;
      expect(text).toContain('TARGET REACHED');
      expect(text).toContain('100,000');
      screen.dispose();
    });
  });
});
