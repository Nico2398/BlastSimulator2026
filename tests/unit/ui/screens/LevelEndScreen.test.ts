// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { LevelEndScreen } from '../../../../src/ui/screens/LevelEndScreen.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { LevelStats } from '../../../../src/core/campaign/SuccessTracker.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';

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

  it('stays hidden for a non-completed levelEndReason', () => {
    const { screen } = mount();
    const state = stateAtLevelEnd(THREE_STAR);
    state.levelEndReason = 'bankruptcy';
    screen.update(state);
    expect(screen.visible).toBe(false);
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
});
