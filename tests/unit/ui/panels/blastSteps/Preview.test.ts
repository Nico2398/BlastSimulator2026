// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreviewStep } from '../../../../../src/ui/panels/blastSteps/Preview.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../../src/core/mining/ChargePlan.js';
import { SOFTWARE_TIER_COSTS } from '../../../../../src/core/mining/Software.js';
import { t } from '../../../../../src/core/i18n/I18n.js';
import { chargeKgPerMetre } from '../../../../../src/core/mining/HoleDiameter.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';
import { makePreviewSummary, PREVIEW_FIGURES } from '../../../../helpers/blastPreviewFixture.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';

const holeCounter = { nextHoleId: 1 };

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeStep(): { step: PreviewStep; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new PreviewStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, container, gameConsole };
}

function chargedPlan(): GameState {
  const state = makeState();
  const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
  const charge = createCharge('boomite', 5, 2, hole.depth);
  if ('charge' in charge) state.chargesByHole[hole.id] = charge.charge;
  return state;
}

function tierRow(step: PreviewStep, n: number): HTMLElement {
  return step.root.querySelector(`[data-tier="${n}"]`) as HTMLElement;
}

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('PreviewStep', () => {
  it('renders 4 tier rows, all locked (no checkmark, no buy button) at tier 0 except T1 which is buyable', () => {
    const { step } = makeStep();
    step.update(makeState());

    expect(tierRow(step, 1).querySelector('[data-action="buy-tier"]')).not.toBeNull();
    expect(tierRow(step, 2).querySelector('[data-action="buy-tier"]')).toBeNull();
    expect(tierRow(step, 2).querySelector('bs-icon[name="check"]')).toBeNull();
  });

  it('shows a checkmark for an owned tier and a buy button only for the next one', () => {
    const { step } = makeStep();
    const state = makeState();
    state.softwareTier = 2;
    step.update(state);

    expect(tierRow(step, 1).querySelector('bs-icon[name="check"]')).not.toBeNull();
    expect(tierRow(step, 2).querySelector('bs-icon[name="check"]')).not.toBeNull();
    expect(tierRow(step, 3).querySelector('[data-action="buy-tier"]')).not.toBeNull();
    expect(tierRow(step, 4).querySelector('[data-action="buy-tier"]')).toBeNull();
    expect(tierRow(step, 4).querySelector('bs-icon[name="check"]')).toBeNull();
  });

  it('the buy button shows the real SOFTWARE_TIER_COSTS price, not a stale one', () => {
    const { step } = makeStep();
    step.update(makeState());

    const buyBtn = tierRow(step, 1).querySelector('[data-action="buy-tier"]') as HTMLButtonElement;
    expect(buyBtn.textContent).toContain(`$${SOFTWARE_TIER_COSTS[1]}`);
  });

  it('buying a tier dispatches buy_software with no args', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState());

    (tierRow(step, 1).querySelector('[data-action="buy-tier"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('buy_software');
  });

  it('disables the buy button when cash is short', () => {
    const { step } = makeStep();
    const state = makeState();
    state.cash = 0;
    step.update(state);

    const buyBtn = tierRow(step, 1).querySelector('[data-action="buy-tier"]') as HTMLButtonElement;
    expect(buyBtn.disabled).toBe(true);
  });

  it('shows the "drill a plan first" reason and disables Run Analysis when there are no holes', () => {
    const { step } = makeStep();
    step.update(makeState());

    const runBtn = step.root.querySelector('[data-action="run-analysis"]') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(step.root.textContent).toContain('Drill and charge a plan first');
  });

  it('disables Run Analysis with a different reason when holes exist but the plan is incomplete', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15); // drilled, not charged
    step.update(state);

    const runBtn = step.root.querySelector('[data-action="run-analysis"]') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(step.root.textContent).toContain('Finish charging every hole first');
  });

  it('enables Run Analysis once the plan is complete, and it dispatches blast_preview', () => {
    const { step, gameConsole } = makeStep();
    step.update(chargedPlan());

    const runBtn = step.root.querySelector('[data-action="run-analysis"]') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
    runBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('blast_preview');
  });

  it('shows "run analysis to see predictions" when a plan exists but has not been analyzed yet', () => {
    const { step } = makeStep();
    step.update(chargedPlan());

    expect(step.root.textContent).toContain('Run analysis to see predictions');
  });

  it('renders real predicted values once state.lastBlastPreview is populated, respecting the tier lock', () => {
    const { step } = makeStep();
    const state = chargedPlan();
    state.softwareTier = 1;
    state.lastBlastPreview = makePreviewSummary(1);
    step.update(state);

    expect(step.root.textContent).toContain('55 cm');
    expect(step.root.textContent).toContain(String(PREVIEW_FIGURES.oversized));
    // T2/T3 rows are locked — real forecast/vibration data must not leak through as text.
    expect(step.root.textContent).toContain('Requires blasting software T2');
    expect(step.root.textContent).toContain('Requires blasting software T3');
  });

  it('dispose() removes the step from the DOM', () => {
    const { step, container } = makeStep();
    step.dispose();
    expect(container.contains(step.root)).toBe(false);
  });

  it('refreshLocale() does not throw and keeps rendering', () => {
    const { step } = makeStep();
    step.update(makeState());
    expect(() => step.refreshLocale()).not.toThrow();
    step.update(makeState());
    expect(tierRow(step, 1)).not.toBeNull();
  });
});

describe('PreviewStep — bore line (#1934)', () => {
  it('names each distinct hole diameter with its kg per metre', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.127);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.127);
    addHole(holeCounter, state.drillHoles, 16, 10, 8, 0.089);
    step.update(state);

    const text = step.root.querySelector('[data-info="plan-bore"]')!.textContent!;
    expect(text).toContain(t('ui.blast_workshop.preview.bore', { diameter: 89, kgPerMetre: +chargeKgPerMetre(0.089).toFixed(2) }));
    expect(text).toContain(t('ui.blast_workshop.preview.bore', { diameter: 127, kgPerMetre: +chargeKgPerMetre(0.127).toFixed(2) }));
    expect(text.indexOf('89 mm')).toBeLessThan(text.indexOf('127 mm'));
  });

  it('is empty without holes', () => {
    const { step } = makeStep();
    step.update(makeState());
    expect(step.root.querySelector('[data-info="plan-bore"]')!.textContent).toBe('');
  });
});

function textOf(step: PreviewStep): string { return step.root.textContent!; }

function withPreview(tier: number, ownedTier = tier): GameState {
  const state = chargedPlan();
  state.softwareTier = ownedTier;
  state.lastBlastPreview = makePreviewSummary(tier);
  return state;
}

/** Smallest element whose text matches `label` (no child element matches too). */
function labelEl(step: PreviewStep, label: RegExp): HTMLElement | null {
  const matches = [...step.root.querySelectorAll<HTMLElement>('*')]
    .filter(e => label.test(e.textContent ?? ''))
    .filter(e => ![...e.children].some(c => label.test(c.textContent ?? '')));
  return matches[0] ?? null;
}

/** The data-explain text on the stat row carrying `label`: on the label, an ancestor, or the row's own cells. */
function explainOf(step: PreviewStep, label: RegExp): string | undefined {
  const lab = labelEl(step, label);
  if (!lab) return undefined;
  const own = lab.closest<HTMLElement>('[data-explain]');
  if (own) return own.dataset['explain'];
  return lab.parentElement?.querySelector<HTMLElement>('[data-explain]')?.dataset['explain'];
}

const COUNT = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

describe('PreviewStep — tier line-up (#2201)', () => {
  it.each<[number, RegExp]>([
    [1, /fragment distribution/i],
    [2, /projection risk/i],
    [3, /vibration model/i],
    [4, /charge optimizer/i],
  ])('tier row %i is named for what it unlocks', (n, name) => {
    const { step } = makeStep();
    step.update(makeState());
    expect(tierRow(step, n).textContent).toMatch(name);
  });

  it('no tier row is still called the energy heatmap: energy is free', () => {
    const { step } = makeStep();
    step.update(makeState());
    for (let n = 1; n <= 4; n++) expect(tierRow(step, n).textContent).not.toMatch(/heatmap/i);
  });

  it('keeps one buy button per next tier, T1 first, at the unchanged price', () => {
    const { step } = makeStep();
    const state = makeState();
    state.softwareTier = 3;
    step.update(state);
    const buy = tierRow(step, 4).querySelector('[data-action="buy-tier"]') as HTMLButtonElement;
    expect(buy).not.toBeNull();
    expect(buy.textContent).toContain(`$${formatMoney(SOFTWARE_TIER_COSTS[4]!)}`);
    expect(tierRow(step, 3).querySelector('bs-icon[name="check"]')).not.toBeNull();
  });
});

describe('PreviewStep — stat rows by tier (#2201)', () => {
  it('shows no energy rows at any tier', () => {
    for (const tier of [0, 1, 2, 3]) {
      const { step } = makeStep();
      step.update(withPreview(tier));
      expect(textOf(step), `tier ${tier}`).not.toMatch(/affected voxels/i);
      expect(textOf(step), `tier ${tier}`).not.toMatch(/energy range/i);
      expect(textOf(step), `tier ${tier}`).not.toContain(String(PREVIEW_FIGURES.affectedVoxels));
      expect(textOf(step), `tier ${tier}`).not.toContain('1.5–9.3');
    }
  });

  it('at tier 0 shows no tier-gated stat value', () => {
    const { step } = makeStep();
    step.update(withPreview(0));
    const text = textOf(step);
    expect(text).not.toContain('55 cm');
    expect(text).not.toContain(String(PREVIEW_FIGURES.oversized));
    expect(text).not.toContain('25%');
    expect(text).not.toContain(t('blast.rating.bad'));
    expect(text).not.toMatch(/14 m/);
    expect(text).not.toContain('3.21');
  });

  it('at tier 0 every stat row is locked, each naming the software tier that opens it', () => {
    const { step } = makeStep();
    step.update(withPreview(0));
    const text = textOf(step);
    expect(COUNT(text, /Requires blasting software T1/g)).toBeGreaterThanOrEqual(4);
    expect(COUNT(text, /Requires blasting software T2/g)).toBe(3);
    expect(COUNT(text, /Requires blasting software T3/g)).toBe(1);
    expect(text).not.toMatch(/Requires T\d/);
  });

  it('at tier 0 points to the free heatmap with an extra line', () => {
    const free = makeStep();
    free.step.update(withPreview(0));
    const owned = makeStep();
    owned.step.update(withPreview(1));
    expect(COUNT(textOf(free.step), /heatmap/gi)).toBeGreaterThan(COUNT(textOf(owned.step), /heatmap/gi));
  });

  it('a locked row reads "Requires blasting software T{n}: <what it shows>"', () => {
    const { step } = makeStep();
    step.update(withPreview(0));
    const text = textOf(step);
    for (const n of [1, 2, 3]) {
      expect(text, `T${n}`).toMatch(new RegExp(`Requires blasting software T${n}: \\S`));
    }
  });

  it('locked rows still render their labels', () => {
    const { step } = makeStep();
    step.update(withPreview(0));
    expect(labelEl(step, /predicted rating/i)).not.toBeNull();
    expect(labelEl(step, /thrown share/i)).not.toBeNull();
    expect(labelEl(step, /furthest throw/i)).not.toBeNull();
    expect(labelEl(step, /peak vibration/i)).not.toBeNull();
    expect(labelEl(step, /oversized/i)).not.toBeNull();
  });

  it('at tier 1 shows the fragment distribution and keeps T2 and T3 locked', () => {
    const { step } = makeStep();
    step.update(withPreview(1));
    const text = textOf(step);
    expect(text).toContain('55 cm');
    expect(text).toContain(String(PREVIEW_FIGURES.oversized));
    expect(text).toContain(String(PREVIEW_FIGURES.goodVolumeM3));
    expect(text).toContain(String(PREVIEW_FIGURES.finesVolumeM3));
    expect(text).toContain(String(PREVIEW_FIGURES.dustVolumeM3));
    expect(text).toContain(formatMoney(PREVIEW_FIGURES.dustLossValue));
    expect(text).not.toMatch(/Requires blasting software T1/);
    expect(COUNT(text, /Requires blasting software T2/g)).toBe(3);
    expect(COUNT(text, /Requires blasting software T3/g)).toBe(1);
    expect(text).not.toContain('25%');
    expect(text).not.toContain(t('blast.rating.bad'));
  });

  it('at tier 2 shows predicted rating, thrown share and furthest throw', () => {
    const { step } = makeStep();
    step.update(withPreview(2));
    const text = textOf(step);
    expect(text).toContain(t('blast.rating.bad'));
    expect(text).toContain('25%');
    expect(text).toMatch(/14(\.0)? m/);
    expect(text).not.toMatch(/Requires blasting software T2/);
    expect(COUNT(text, /Requires blasting software T3/g)).toBe(1);
    expect(text).not.toContain('3.21');
  });

  it('at tier 3 shows the peak vibration and nothing is locked', () => {
    const { step } = makeStep();
    step.update(withPreview(3));
    const text = textOf(step);
    expect(text).toContain('3.21');
    expect(text).not.toMatch(/Requires blasting software/);
  });

  it('tier 4 has no stat row: no row ever asks for T4', () => {
    for (const tier of [0, 3, 4]) {
      const { step } = makeStep();
      step.update(withPreview(Math.min(tier, 3), tier));
      expect(textOf(step), `tier ${tier}`).not.toMatch(/Requires blasting software T4/);
    }
  });

  it('a tier-4 owner sees the same unlocked stats as tier 3', () => {
    const { step } = makeStep();
    step.update(withPreview(4));
    const text = textOf(step);
    expect(text).toContain('3.21');
    expect(text).toContain('25%');
    expect(text).not.toMatch(/Requires blasting software/);
  });

  it('a preview from a lower tier than the one owned now does not leak a higher tier', () => {
    const { step } = makeStep();
    step.update(withPreview(1, 3));
    expect(textOf(step)).not.toContain('3.21');
  });
});

describe('PreviewStep — stat rows explain themselves (#2201)', () => {
  const LABELS: Array<[string, RegExp]> = [
    ['average fragment size', /(avg|average) fragment size/i],
    ['oversized count', /oversized/i],
    ['predicted rating', /predicted rating/i],
    ['thrown share', /thrown share/i],
    ['furthest throw', /furthest throw/i],
    ['peak vibration', /peak vibration/i],
  ];

  it.each(LABELS)('the %s row carries a data-explain text', (_name, label) => {
    const { step } = makeStep();
    step.update(withPreview(3));
    const explain = explainOf(step, label);
    expect(explain).toBeDefined();
    expect(explain!.length).toBeGreaterThan(20);
  });

  it('the explanations differ from row to row', () => {
    const { step } = makeStep();
    step.update(withPreview(3));
    const texts = LABELS.map(([, re]) => explainOf(step, re));
    expect(new Set(texts).size).toBe(LABELS.length);
  });

  it('the dust-loss and volume rows are explained too', () => {
    const { step } = makeStep();
    step.update(withPreview(3));
    expect(explainOf(step, /dust/i)).toBeDefined();
  });

  it('every explanation is real text, never a raw locale key', () => {
    const { step } = makeStep();
    step.update(withPreview(3));
    const explains = [...step.root.querySelectorAll<HTMLElement>('[data-explain]')].map(e => e.dataset['explain']!);
    expect(explains.length).toBeGreaterThanOrEqual(LABELS.length);
    for (const e of explains) expect(e).not.toMatch(/^ui\./);
  });
});
