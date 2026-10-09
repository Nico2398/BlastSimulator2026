// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlastFooter } from '../../../../src/ui/panels/blastFooter.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { addHole } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { readFileSync } from 'node:fs';
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
