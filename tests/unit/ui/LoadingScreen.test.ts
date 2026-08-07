// LoadingScreen — DOM tests (jsdom)
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LoadingScreen, nextPaint, type LoadingSiteInfo } from '../../../src/ui/LoadingScreen.js';
import { LOADING_QUIPS, QuipBag, LOADING_TIPS, TipBag } from '../../../src/ui/loadingQuips.js';
import { t, setLocale, getLocale } from '../../../src/core/i18n/I18n.js';

/** Fixture site info for the eyebrow/subtitle/briefing block tests (#493). */
const FIXTURE_SITE_INFO: LoadingSiteInfo = {
  siteNumber: 2,
  biomeCategoryKey: 'ui.portfolio.biome.mountain',
  difficulty: 2,
  descriptionKey: 'loading.sandbox_subtitle',
  briefing: [
    { labelKey: 'loading.brief.starting_cash', value: '$75,000' },
    { labelKey: 'loading.brief.target', value: '$250,000' },
    { labelKey: 'loading.brief.explosives', value: 'Boomite' },
  ],
};

describe('LoadingScreen', () => {
  let container: HTMLElement;
  let screen: LoadingScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    // jsdom has no rAF driver of its own that advances on a timer, so give it
    // one — every paint-ordering assertion below depends on it firing.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    screen = new LoadingScreen(container);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('starts hidden', () => {
    expect(screen.visible).toBe(false);
    expect(document.getElementById('bs-loading-screen')).toBeTruthy();
  });

  it('mirrors visibility onto the DOM node for harness-side asserts', () => {
    const overlay = document.getElementById('bs-loading-screen') as unknown as { visible: boolean };
    expect(overlay.visible).toBe(false);
    screen.show();
    expect(overlay.visible).toBe(true);
    screen.hide();
    expect(overlay.visible).toBe(false);
  });

  it('show puts it on screen at zero progress', () => {
    screen.show();
    expect(screen.visible).toBe(true);
    expect(screen.progress).toBe(0);
  });

  it('setPhase updates the caption and the bar', () => {
    screen.show();
    screen.setPhase('Bribing the geological survey', 0.5);
    expect(screen.phaseText).toBe('Bribing the geological survey');
    expect(screen.progress).toBeCloseTo(0.5, 2);
  });

  it('shows a satirical line rather than naming the work being done', () => {
    screen.show();
    expect(LOADING_QUIPS).toContain(screen.phaseText);
  });

  it('clamps progress to 0..1 rather than emitting a nonsense bar width', () => {
    screen.show();
    screen.setPhase('x', 5);
    expect(screen.progress).toBe(1);
    screen.setPhase('x', -3);
    expect(screen.progress).toBe(0);
  });

  describe('runPhases', () => {
    it('runs every phase in order and finishes hidden', async () => {
      const order: string[] = [];
      await screen.runPhases([
        { run: () => order.push('a') },
        { run: () => order.push('b') },
      ]);
      expect(order).toEqual(['a', 'b']);
      expect(screen.visible).toBe(false);
    });

    it('is on screen, with the phase caption set, BEFORE that phase blocks', async () => {
      // The whole point of the component. If a phase ran before a frame was
      // presented the player would see a freeze and then the finished level,
      // with the overlay never actually visible.
      const seen: { visible: boolean; caption: string; progress: number }[] = [];
      await screen.runPhases([
        { run: () => seen.push({ visible: screen.visible, caption: screen.phaseText, progress: screen.progress }) },
        { run: () => seen.push({ visible: screen.visible, caption: screen.phaseText, progress: screen.progress }) },
      ]);

      expect(seen).toHaveLength(2);
      for (const s of seen) expect(s.visible).toBe(true);
      expect(seen[0]!.caption).not.toBe(seen[1]!.caption); // a fresh quip per phase
      expect(seen[1]!.progress).toBeGreaterThan(seen[0]!.progress);
    });

    it('waits for a presented frame between phases, not merely a microtask', async () => {
      // nextPaint resolves on the SECOND rAF, because a callback on the first
      // still runs before its own paint.
      let frames = 0;
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        frames++;
        return setTimeout(() => cb(0), 0) as unknown as number;
      });
      await nextPaint();
      expect(frames).toBe(2);
    });

    it('hides even when a phase throws, so a failed load cannot strand the player', async () => {
      await expect(screen.runPhases([
        { run: () => { throw new Error('generation blew up'); } },
      ])).rejects.toThrow('generation blew up');
      expect(screen.visible).toBe(false);
    });

    it('reaches full progress before hiding', async () => {
      let atEnd = -1;
      await screen.runPhases([
        { run: () => {} },
        { run: () => { /* last phase */ } },
      ]).then(() => { atEnd = screen.progress; });
      // Progress is read after hide(); the bar keeps its final width.
      expect(atEnd).toBe(1);
    });

    it('copes with an empty phase list', async () => {
      await screen.runPhases([]);
      expect(screen.visible).toBe(false);
    });

    it('sits above the main menu and the sandbox panel', () => {
      const overlay = document.getElementById('bs-loading-screen')!;
      const z = Number(overlay.style.zIndex);
      expect(z).toBeGreaterThan(9999);  // main menu
      expect(z).toBeGreaterThan(10000); // sandbox panel
    });
  });

  it('dispose removes it from the document', () => {
    screen.dispose();
    expect(document.getElementById('bs-loading-screen')).toBeNull();
  });
});

// ── Eyebrow / subtitle / briefing block (#493) ──

describe('LoadingScreen — site info blocks', () => {
  let container: HTMLElement;
  let screen: LoadingScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    screen = new LoadingScreen(container);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('show(siteInfo) populates eyebrowText, subtitleText, and briefingRows', () => {
    screen.show(FIXTURE_SITE_INFO);

    // Eyebrow carries the biome and the site number — the exact separator is
    // an implementation choice, but both pieces of information must appear.
    expect(screen.eyebrowText).toContain(t('ui.portfolio.biome.mountain'));
    expect(screen.eyebrowText).toContain('2');

    expect(screen.subtitleText).toBe(t('loading.sandbox_subtitle'));

    expect(screen.briefingRows).toEqual([
      { label: t('loading.brief.starting_cash'), value: '$75,000' },
      { label: t('loading.brief.target'), value: '$250,000' },
      { label: t('loading.brief.explosives'), value: 'Boomite' },
    ]);
  });

  it('show() with no siteInfo leaves eyebrow/subtitle/briefing empty', () => {
    screen.show();
    expect(screen.eyebrowText).toBe('');
    expect(screen.subtitleText).toBe('');
    expect(screen.briefingRows).toEqual([]);

    // Every existing assertion about the base phase/progress machinery still
    // holds when no site info is supplied.
    expect(screen.visible).toBe(true);
    expect(screen.progress).toBe(0);
    expect(LOADING_QUIPS).toContain(screen.phaseText);
  });

  it('runPhases([...]) with no siteInfo also leaves eyebrow/subtitle/briefing empty', async () => {
    let seenDuringPhase: { eyebrow: string; subtitle: string; rows: unknown[] } | null = null;
    await screen.runPhases([
      {
        run: () => {
          seenDuringPhase = {
            eyebrow: screen.eyebrowText,
            subtitle: screen.subtitleText,
            rows: screen.briefingRows,
          };
        },
      },
    ]);
    expect(seenDuringPhase).toEqual({ eyebrow: '', subtitle: '', rows: [] });
  });

  it('runPhases([...]) with siteInfo populates eyebrow/subtitle/briefing for the whole run', async () => {
    let seenDuringPhase: { eyebrow: string; rows: unknown[] } | null = null;
    await screen.runPhases(
      [{ run: () => { seenDuringPhase = { eyebrow: screen.eyebrowText, rows: screen.briefingRows }; } }],
      FIXTURE_SITE_INFO,
    );
    expect(seenDuringPhase).not.toBeNull();
    expect(seenDuringPhase!.eyebrow).toContain('2');
    expect(seenDuringPhase!.rows).toHaveLength(3);
  });
});

// ── Segment marks / stage row (#493) ──

describe('LoadingScreen — segment marks and stage row', () => {
  let container: HTMLElement;
  let screen: LoadingScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    screen = new LoadingScreen(container);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders one segment per phase — proven through the stage total, since there is no public marks-count accessor', async () => {
    const n = 5;
    let lastTotalSeen = -1;
    await screen.runPhases(Array.from({ length: n }, (_, i) => ({
      run: () => {
        // stage_meta is "Stage {current} of {total}" — decoding `total` back
        // out of it is how this proves the mark count without a new getter.
        for (let total = 1; total <= n + 2; total++) {
          if (screen.stageMetaText === t('loading.stage_meta', { current: i + 1, total })) {
            lastTotalSeen = total;
          }
        }
      },
    })));
    expect(lastTotalSeen).toBe(n);
  });

  it('stageLabelText/stageMetaText update in lockstep with progress on each phase', async () => {
    const n = 3;
    const seen: { current: number; label: string; meta: string; progress: number }[] = [];
    await screen.runPhases(Array.from({ length: n }, (_, i) => ({
      run: () => {
        seen.push({
          current: i + 1,
          label: screen.stageLabelText,
          meta: screen.stageMetaText,
          progress: screen.progress,
        });
      },
    })));

    expect(seen).toHaveLength(n);
    for (const s of seen) {
      expect(s.label).toBe(t('loading.stage_label', { current: s.current, total: n }));
      expect(s.meta).toBe(t('loading.stage_meta', { current: s.current, total: n }));
    }
    // Monotonically increasing progress across stages.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.progress).toBeGreaterThan(seen[i - 1]!.progress);
    // Final phase reports current === total.
    expect(seen[n - 1]!.label).toBe(t('loading.stage_label', { current: n, total: n }));
  });

  it('show() populates the stage row immediately, before any phase runs (#493)', () => {
    expect(screen.stageLabelText).toBe('');
    expect(screen.stageMetaText).toBe('');
    screen.show();
    // No phase count is known yet at show()-time — the debug-preview path
    // never calls runPhases() at all — so the row must not stay blank the
    // way it did before this fix, but it also must not read "0 / 0" as if
    // there were zero total stages.
    expect(screen.stageLabelText.length).toBeGreaterThan(0);
    expect(screen.stageMetaText.length).toBeGreaterThan(0);
    expect(screen.stageLabelText).not.toContain('0');
    expect(screen.stageMetaText).not.toContain('0');
  });
});

// ── Tip block (#493) ──

describe('LoadingScreen — tip block', () => {
  let container: HTMLElement;
  let screen: LoadingScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    screen = new LoadingScreen(container);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows a non-empty tip after show() with no siteInfo', () => {
    screen.show();
    expect(screen.tipText.length).toBeGreaterThan(0);
    expect(LOADING_TIPS).toContain(screen.tipText);
  });

  it('shows a non-empty tip after show(siteInfo)', () => {
    screen.show(FIXTURE_SITE_INFO);
    expect(screen.tipText.length).toBeGreaterThan(0);
    expect(LOADING_TIPS).toContain(screen.tipText);
  });

  it('nextTip() draws a different tip than the current one', () => {
    screen.show();
    const first = screen.tipText;
    const second = screen.nextTip();
    expect(second).not.toBe(first);
    expect(screen.tipText).toBe(second);
    expect(LOADING_TIPS).toContain(second);
  });

  it('clicking #bs-loading-tip-next changes tipText the same way nextTip() does', () => {
    screen.show();
    const before = screen.tipText;
    const btn = document.getElementById('bs-loading-tip-next') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    const after = screen.tipText;
    expect(after).not.toBe(before);
    expect(LOADING_TIPS).toContain(after);
  });

  it('clicking NEXT mid-phase does not disturb visible, progress, or phaseText', async () => {
    let before: { visible: boolean; progress: number; phaseText: string } | null = null;
    let after: { visible: boolean; progress: number; phaseText: string } | null = null;
    await screen.runPhases([
      {
        run: () => {
          before = { visible: screen.visible, progress: screen.progress, phaseText: screen.phaseText };
          const btn = document.getElementById('bs-loading-tip-next') as HTMLButtonElement;
          btn.click();
          after = { visible: screen.visible, progress: screen.progress, phaseText: screen.phaseText };
        },
      },
      { run: () => {} },
    ]);
    expect(before).not.toBeNull();
    expect(after).toEqual(before);
  });

  it('TIP badge and NEXT button retranslate on locale switch across shows (#493)', () => {
    const original = getLocale();
    try {
      screen.show();
      expect(screen.tipLabelText).toBe(t('loading.tip_label'));
      expect(screen.tipNextText).toBe(t('loading.tip_next'));

      setLocale('fr');
      screen.show();
      expect(screen.tipLabelText).toBe(t('loading.tip_label'));
      expect(screen.tipNextText).toBe(t('loading.tip_next'));
      expect(screen.tipLabelText).toBe('ASTUCE');
      expect(screen.tipNextText).toBe('SUIVANT');

      setLocale('en');
      screen.show();
      expect(screen.tipLabelText).toBe('TIP');
      expect(screen.tipNextText).toBe('NEXT');
    } finally {
      setLocale(original);
    }
  });
});

describe('nextPaint', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('resolves rather than hanging where requestAnimationFrame does not exist', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    await expect(nextPaint()).resolves.toBeUndefined();
  });
});

describe('QuipBag', () => {
  it('offers a decent spread of lines', () => {
    expect(LOADING_QUIPS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(LOADING_QUIPS).size).toBe(LOADING_QUIPS.length);
    for (const q of LOADING_QUIPS) expect(q.trim().length).toBeGreaterThan(0);
  });

  it('never repeats a line until every one has been used', () => {
    const bag = new QuipBag();
    const drawn = new Set<string>();
    for (let i = 0; i < LOADING_QUIPS.length; i++) {
      const q = bag.next();
      expect(drawn.has(q), `repeated "${q}" before the bag was empty`).toBe(false);
      drawn.add(q);
    }
    expect(drawn.size).toBe(LOADING_QUIPS.length);
  });

  it('refills once drained rather than running out', () => {
    const bag = new QuipBag();
    for (let i = 0; i < LOADING_QUIPS.length; i++) bag.next();
    expect(bag.remainingCount).toBe(0);
    expect(LOADING_QUIPS).toContain(bag.next());
  });

  it('draws in a different order for a different random source', () => {
    const seq = (r: () => number) => {
      const bag = new QuipBag(r);
      return Array.from({ length: 8 }, () => bag.next()).join('|');
    };
    expect(seq(() => 0)).not.toBe(seq(() => 0.999));
  });

  it('a degenerate random source still yields valid lines', () => {
    const bag = new QuipBag(() => 1);
    for (let i = 0; i < 5; i++) expect(LOADING_QUIPS).toContain(bag.next());
  });
});

// ── TipBag (#493) — same contract as QuipBag, for the loading screen's tip block ──

describe('TipBag', () => {
  it('offers a decent spread of lines', () => {
    expect(LOADING_TIPS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(LOADING_TIPS).size).toBe(LOADING_TIPS.length);
    for (const tip of LOADING_TIPS) expect(tip.trim().length).toBeGreaterThan(0);
  });

  it('never repeats a line until every one has been used', () => {
    expect(LOADING_TIPS.length).toBeGreaterThanOrEqual(12);
    const bag = new TipBag();
    const drawn = new Set<string>();
    for (let i = 0; i < LOADING_TIPS.length; i++) {
      const tip = bag.next();
      expect(drawn.has(tip), `repeated "${tip}" before the bag was empty`).toBe(false);
      drawn.add(tip);
    }
    expect(drawn.size).toBe(LOADING_TIPS.length);
  });

  it('refills once drained rather than running out', () => {
    expect(LOADING_TIPS.length).toBeGreaterThanOrEqual(12);
    const bag = new TipBag();
    for (let i = 0; i < LOADING_TIPS.length; i++) bag.next();
    expect(bag.remainingCount).toBe(0);
    expect(LOADING_TIPS).toContain(bag.next());
  });

  it('draws in a different order for a different random source', () => {
    expect(LOADING_TIPS.length).toBeGreaterThanOrEqual(12);
    const seq = (r: () => number) => {
      const bag = new TipBag(r);
      return Array.from({ length: 8 }, () => bag.next()).join('|');
    };
    expect(seq(() => 0)).not.toBe(seq(() => 0.999));
  });

  it('a degenerate random source still yields valid lines', () => {
    expect(LOADING_TIPS.length).toBeGreaterThanOrEqual(12);
    const bag = new TipBag(() => 1);
    for (let i = 0; i < 5; i++) expect(LOADING_TIPS).toContain(bag.next());
  });
});
