// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlastFooter } from '../../../../src/ui/panels/blastFooter.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { addHole } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { readFileSync } from 'node:fs';
import { t } from '../../../../src/core/i18n/I18n.js';
import { addChargedPattern, makeCoverageSurvey, makeOreGrid } from '../../../helpers/oreSurveyFixture.js';
import { Random } from '../../../../src/core/math/Random.js';

const holeCounter = { nextHoleId: 1 };

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeFooter(): { footer: BlastFooter; container: HTMLElement; fireRequested: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const footer = new BlastFooter(container);
  const fireRequested = vi.fn();
  footer.setFireRequestedHandler(fireRequested);
  return { footer, container, fireRequested };
}

function chargeHole(state: ReturnType<typeof makeState>) {
  const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
  const chargeResult = createCharge('boomite', 5, 2, hole.depth);
  if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;
  return hole;
}

beforeEach(() => {
  holeCounter.nextHoleId = 1;
  document.body.innerHTML = '';
  setLocale('en');
});

describe('BlastFooter', () => {
  it('shows $0 cost/value/margin and a disabled FIRE button for an empty plan', () => {
    const { footer } = makeFooter();
    footer.update(makeState());

    expect(footer.root.textContent).toContain('$0');
    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(true);
  });

  it('sums plan cost from every charged hole\'s explosive cost', () => {
    const { footer } = makeFooter();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth); // boomite: $12/kg
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;

    footer.update(state);

    // 5kg × $12/kg = $60
    expect(footer.root.textContent).toContain('$60');
  });

  it('FIRE stays disabled with a reason when holes are drilled but not fully charged (default en locale)', () => {
    const { footer } = makeFooter();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);

    footer.update(state);

    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(true);
    expect(footer.root.textContent).toContain('Missing charge');
  });

  // #633: BlastPlan.ts's ValidationError.issue must be a translation key, and
  // blastFooter must resolve it through t() at display time — not bake English
  // prose into the fire-blocked reason line regardless of active locale.
  it('FIRE-blocked reason line is translated under the fr locale, not left in English', () => {
    setLocale('fr');
    const { footer } = makeFooter();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 10, 8, 0.15);

    footer.update(state);

    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(true);
    expect(footer.root.textContent).toContain('Charge manquante');
    expect(footer.root.textContent).not.toContain('Missing charge');
  });

  it('FIRE enables once every hole is charged', () => {
    const { footer } = makeFooter();
    const state = makeState();
    chargeHole(state);

    footer.update(state);

    const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
    expect(fireBtn.disabled).toBe(false);
  });

  it('clicking FIRE while disabled does not request a preflight confirm', () => {
    const { footer, fireRequested } = makeFooter();
    footer.update(makeState());

    (footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement).click();

    expect(fireRequested).not.toHaveBeenCalled();
  });

  it('clicking FIRE while enabled requests a preflight confirm, without dispatching blast itself', () => {
    const { footer, fireRequested } = makeFooter();
    const state = makeState();
    chargeHole(state);
    footer.update(state);

    (footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement).click();

    expect(fireRequested).toHaveBeenCalledTimes(1);
  });

  it('dispose() removes the footer from the DOM', () => {
    const { footer, container } = makeFooter();
    footer.dispose();
    expect(container.contains(footer.root)).toBe(false);
  });

  // #1362: the tutorial refusal is gone. DETONATE arms the evacuation sequence
  // and fires once clear, so FIRE stays enabled on an occupied zone, in the
  // tutorial too. A stale `tutorialActive` argument must change nothing.
  describe('occupied zone never disables FIRE (#1362)', () => {
    type LegacyUpdate = { update(state: unknown, tutorialActive: boolean): void };

    it('keeps FIRE enabled in the tutorial with an occupied danger zone, with no zone-occupied reason', () => {
      const { footer } = makeFooter();
      const state = makeState();
      chargeHole(state);
      hireEmployee(state.employees, 'driller', new Random(1), 10, 10);

      (footer as unknown as LegacyUpdate).update(state, true);

      const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
      expect(fireBtn.disabled).toBe(false);
      expect(footer.root.textContent).not.toContain('still in the blast zone');
      expect(footer.root.textContent).not.toContain('Evacuate before firing');
    });

    it('keeps FIRE enabled outside the tutorial even with an occupied danger zone', () => {
      const { footer } = makeFooter();
      const state = makeState();
      chargeHole(state);
      hireEmployee(state.employees, 'driller', new Random(1), 10, 10);

      footer.update(state);

      const fireBtn = footer.root.querySelector('#bs-blast-fire') as HTMLButtonElement;
      expect(fireBtn.disabled).toBe(false);
      expect(footer.root.textContent).not.toContain('still in the blast zone');
    });

    it('en.json and fr.json no longer define fire_reason_zone_occupied', () => {
      for (const l of ['en', 'fr']) {
        const loc = JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8')) as Record<string, string>;
        expect(loc['ui.blast_workshop.footer.fire_reason_zone_occupied']).toBeUndefined();
      }
    });
  });
});

describe('BlastFooter cost net of stock (#1685)', () => {
  it('shows only the cash part of a charge partly drawn from stock', () => {
    const { footer } = makeFooter();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    state.chargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2, fromStockKg: 3 };
    footer.update(state);
    // 2 kg x $12 cash
    expect(footer.root.textContent).toContain('$24');
    expect(footer.root.textContent).not.toContain('$60');
  });

  it('shows $0 cost for a pattern fully covered by stock', () => {
    const { footer } = makeFooter();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    state.chargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2, fromStockKg: 5 };
    footer.update(state);
    expect(footer.root.textContent).toContain('$0');
    expect(footer.root.textContent).not.toContain('$60');
  });
});

describe('BlastFooter ore estimate coverage (#1960)', () => {
  /** The value span sitting under the stat label with the given key. */
  function statValue(root: HTMLElement, labelKey: string): HTMLElement {
    const label = [...root.querySelectorAll('span')].find(s => s.textContent === t(labelKey));
    if (!label) throw new Error(`no stat label ${labelKey}`);
    return label.nextElementSibling as HTMLElement;
  }
  const value = (root: HTMLElement) => statValue(root, 'ui.blast_workshop.footer.est_ore_value');
  const margin = (root: HTMLElement) => statValue(root, 'ui.blast_workshop.footer.margin');

  function setup(survey: 'none' | 'half' | 'full' | 'stale') {
    const { footer } = makeFooter();
    footer.setGridProvider(() => grid);
    const grid = makeOreGrid();
    const state = makeState();
    addChargedPattern(state, holeCounter);
    if (survey === 'half') state.surveyResults.push(makeCoverageSurvey(0, 20));
    if (survey === 'full') state.surveyResults.push(makeCoverageSurvey(0, 39));
    if (survey === 'stale') state.surveyResults.push({ ...makeCoverageSurvey(0, 39), stale: true });
    footer.update(state);
    return { footer, state };
  }

  it('without a survey the est. ore value reads "No survey", not $0', () => {
    const { footer } = setup('none');
    expect(value(footer.root).textContent).toBe(t('ui.blast_workshop.footer.est_ore_unknown'));
    expect(value(footer.root).textContent).toBe('No survey');
    expect(value(footer.root).textContent).not.toContain('$');
  });

  it('without a survey the margin shows no dollar figure and is not red', () => {
    const { footer } = setup('none');
    expect(margin(footer.root).textContent).toBe(t('ui.blast_workshop.footer.margin_unknown'));
    expect(margin(footer.root).textContent).not.toContain('$');
    expect(margin(footer.root).style.color).not.toContain('critical');
    expect(margin(footer.root).style.color).not.toContain('red');
  });

  it('without a survey a hint points at the Survey panel', () => {
    const { footer } = setup('none');
    const hint = t('ui.blast_workshop.footer.survey_hint', { survey: t('ui.survey.title') });
    expect(hint).toContain('Survey');
    expect(footer.root.textContent).toContain(hint);
  });

  it('a stale-only survey reads as no survey', () => {
    const { footer } = setup('stale');
    expect(value(footer.root).textContent).toBe('No survey');
    expect(footer.root.textContent).toContain(t('ui.blast_workshop.footer.survey_hint', { survey: t('ui.survey.title') }));
  });

  it('a plan with no grid available reads "No survey"', () => {
    const { footer } = makeFooter();
    const state = makeState();
    addChargedPattern(state, holeCounter);
    footer.update(state);
    expect(value(footer.root).textContent).toBe('No survey');
  });

  it('partial coverage shows the dollar value and the surveyed share', () => {
    const { footer } = setup('half');
    const text = value(footer.root).textContent ?? '';
    expect(text).toMatch(/\$/);
    expect(text).not.toBe('No survey');
    expect(footer.root.textContent).toMatch(/\b\d{1,2}% surveyed/);
    expect(footer.root.textContent).not.toContain(t('ui.blast_workshop.footer.survey_hint', { survey: t('ui.survey.title') }));
  });

  it('partial coverage share matches the i18n template', () => {
    const { footer } = setup('half');
    const m = /(\d{1,2})% surveyed/.exec(footer.root.textContent ?? '');
    expect(m).not.toBeNull();
    const pct = Number(m![1]);
    expect(pct).toBeGreaterThanOrEqual(1);
    expect(pct).toBeLessThanOrEqual(99);
    expect(footer.root.textContent).toContain(t('ui.blast_workshop.footer.coverage_share', { percent: pct }));
  });

  it('partial coverage shows a margin figure', () => {
    const { footer } = setup('half');
    expect(margin(footer.root).textContent).toMatch(/\$/);
  });

  it('full coverage shows the dollar value with no share suffix and no hint', () => {
    const { footer } = setup('full');
    expect(value(footer.root).textContent).toMatch(/^\$[\d,.]+/);
    expect(footer.root.textContent).not.toContain('surveyed');
    expect(footer.root.textContent).not.toContain('No survey');
    expect(footer.root.textContent).not.toContain(t('ui.blast_workshop.footer.survey_hint', { survey: t('ui.survey.title') }));
    expect(margin(footer.root).textContent).toMatch(/\$/);
  });

  it('plan cost and FIRE enablement do not depend on survey coverage', () => {
    const none = setup('none');
    const full = setup('full');
    const costOf = (f: BlastFooter) => statValue(f.root, 'ui.blast_workshop.footer.plan_cost').textContent;
    expect(costOf(none.footer)).toBe(costOf(full.footer));
    const fire = (f: BlastFooter) => (f.root.querySelector('[data-action="execute"]') as HTMLButtonElement).disabled;
    expect(fire(none.footer)).toBe(false);
    expect(fire(full.footer)).toBe(false);
  });

  it('moves from "No survey" to a value when a survey lands', () => {
    const { footer, state } = setup('none');
    expect(value(footer.root).textContent).toBe('No survey');
    state.surveyResults.push(makeCoverageSurvey(0, 39));
    footer.update(state);
    expect(value(footer.root).textContent).toMatch(/^\$/);
  });

  it('reads "No survey" in French as the fr key, not English', () => {
    setLocale('fr');
    const { footer } = setup('none');
    expect(value(footer.root).textContent).toBe(t('ui.blast_workshop.footer.est_ore_unknown'));
    expect(value(footer.root).textContent).not.toBe('No survey');
  });
});
