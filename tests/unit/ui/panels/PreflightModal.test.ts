// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreflightModal } from '../../../../src/ui/panels/PreflightModal.js';
import { wetAllHoles } from '../../../helpers/holeWater.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { addHole } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { readFileSync } from 'node:fs';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import { addChargedPattern, addDrilledPattern, addWeakChargedPattern, makeBarrenSurvey, makeCoverageSurvey, makeOreGrid } from '../../../helpers/oreSurveyFixture.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { dispatchChargeAction } from '../../../../src/core/mining/ChargeOrder.js';
import { formatGameDuration } from '../../../../src/ui/formatGameDuration.js';
import { addReachBuildings, addReachPattern } from '../../../helpers/blastReachFixture.js';
import { createGradeState } from '../../../../src/core/economy/MineGrade.js';

const holeCounter = { nextHoleId: 1 };

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeModal(): { modal: PreflightModal; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modal = new PreflightModal(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  modal.setGameConsole(gameConsole);
  return { modal, container, gameConsole };
}

function chargedPlan(): GameState {
  const state = makeState();
  const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
  const chargeResult = createCharge('boomite', 5, 2, hole.depth);
  if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;
  return state;
}

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('PreflightModal', () => {
  it('is hidden until show() is called', () => {
    const { modal } = makeModal();
    expect(modal.visible).toBe(false);
    expect(modal.root.style.display).toBe('none');
  });

  it('show() makes it visible; update() then populates real plan stats', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');

    expect(modal.visible).toBe(true);
    expect(modal.root.textContent).toContain('5.0 kg'); // charge weight
    expect(modal.root.textContent).toContain('$60'); // 5kg x $12/kg boomite
  });

  it('does no work while closed — update() does not throw and stays hidden', () => {
    const { modal } = makeModal();
    expect(() => modal.update(chargedPlan(), 'sunny')).not.toThrow();
    expect(modal.visible).toBe(false);
  });

  it('Cancel hides the modal without dispatching anything', () => {
    const { modal, gameConsole } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');

    (modal.root.querySelector('[data-action="preflight-cancel"]') as HTMLButtonElement).click();

    expect(modal.visible).toBe(false);
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('Detonate dispatches `blast detonate` (arm the sequence), not a bare blast (#1362)', () => {
    const { modal, gameConsole } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');

    (modal.root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith('blast detonate');
  });

  it('shows the "no preview" hint when state.lastBlastPreview is null', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');

    expect(modal.root.textContent).toContain('Run Analysis in the Preview step');
  });

  it('shows real predicted numbers, and marks locked tiers, once a preview has run', () => {
    const { modal } = makeModal();
    modal.show();
    const state = chargedPlan();
    state.softwareTier = 1;
    state.lastBlastPreview = {
      tier: 1, energy: { affectedVoxels: 314, minEnergy: 1, maxEnergy: 9 },
      fragments: null, projections: null, vibrations: null,
    };
    modal.update(state, 'sunny');

    expect(modal.root.textContent).toContain('314 voxels');
    expect(modal.root.textContent).toContain('fragments — T2');
    expect(modal.root.textContent).toContain('projections — T3');
  });

  it('warns about holes that hold water, and shows the ok line once they are dry', () => {
    const { modal } = makeModal();
    modal.show();
    const state = chargedPlan();

    wetAllHoles(state);
    modal.update(state, 'sunny');
    expect(modal.root.textContent).toContain('1 holes are full of water');

    state.holeWater = {};
    modal.update(state, 'sunny');
    expect(modal.root.textContent).toContain('All holes are dry or tubed');
  });

  it('warns when an employee is still inside the computed danger zone', () => {
    const { modal } = makeModal();
    modal.show();
    const state = chargedPlan();
    state.employees.employees.push({
      id: 1, name: 'Oz Trill', role: 'driller', salary: 500, morale: 60,
      unionized: false, injured: false, alive: true, x: 11, z: 11,
      qualifications: [], trainingState: null, activeActionId: null,
      fatigue: 0, collapsing: false, interruptedActionPayload: null,
      ticksWorked: 0, restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
      activeTaskSkill: null, destinationX: null, destinationZ: null,
      moveConsecutiveFailures: 0, isMoveStuck: false,
      pendingRestDuration: null, pendingRestNeedKey: null, pendingTaskDuration: null,
      pendingActionType: null, pendingActionPayload: null, pendingDriverVehicleId: null,
      taskQueue: [], locomotion: { kind: 'on_foot' },
      itinerary: null, vehicleWaitingTicks: 0,
    });

    modal.update(state, 'sunny');

    expect(modal.root.textContent).toContain('1 workers or vehicles are still inside the danger zone');
  });

  it('shows a protected-position warning when a hole sits on a building footprint', () => {
    const { modal } = makeModal();
    modal.show();
    const state = chargedPlan();
    placeBuilding(state.buildings, 'explosive_warehouse', 9, 9, 32, 32);

    modal.update(state, 'sunny');

    expect(modal.root.textContent).toContain('sit directly on a building');
  });

  it('refreshLocale() does not throw', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');
    expect(() => modal.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the modal from the DOM', () => {
    const { modal, container } = makeModal();
    modal.dispose();
    expect(container.contains(modal.root)).toBe(false);
  });
});

// ── #1346: ordered-but-undrilled holes are cancelled by the blast — warn ─────

describe('PreflightModal — undrilled-holes warning (#1346)', () => {
  const KEY = 'ui.blast_workshop.preflight.warn_undrilled';
  const readLocale = (l: string): Record<string, string> =>
    JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8'));

  function withPlanned(n: number): GameState {
    const state = chargedPlan();
    for (let i = 0; i < n; i++) {
      const h = addHole(holeCounter, [], 20 + i, 20, 8, 0.15);
      state.plannedDrillHoles.push(h);
    }
    return state;
  }

  const warnText = (n: number): string =>
    readLocale('en')[KEY]!.replace('{count}', String(n));

  it('en.json and fr.json both define the key, with different text', () => {
    const en = readLocale('en')[KEY];
    const fr = readLocale('fr')[KEY];
    expect(en).toBeTruthy();
    expect(fr).toBeTruthy();
    expect(en).not.toBe(fr);
    expect(en).toContain('{count}');
    expect(fr).toContain('{count}');
  });

  it('en.json and fr.json define mining.blast.cancelled_drill_orders, with different text', () => {
    const k = 'mining.blast.cancelled_drill_orders';
    expect(readLocale('en')[k]).toBeTruthy();
    expect(readLocale('fr')[k]).toBeTruthy();
    expect(readLocale('en')[k]).not.toBe(readLocale('fr')[k]);
  });

  it('shows a warning with the count when holes are still ordered', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(withPlanned(3), 'sunny');
    expect(modal.root.textContent).toContain(warnText(3));
  });

  it('shows no warning when nothing is ordered', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');
    expect(modal.root.textContent).not.toContain(warnText(0));
    expect(modal.root.textContent).not.toContain(KEY);
    const tpl = readLocale('en')[KEY]!.split('{count}')[1]!;
    expect(tpl.length).toBeGreaterThan(0);
    expect(modal.root.textContent).not.toContain(tpl);
  });

  it('is non-blocking: DETONATE stays enabled', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(withPlanned(2), 'sunny');
    expect(modal.root.textContent).toContain(warnText(2));
    const btn = modal.root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('updates when the count changes and disappears when it reaches zero', () => {
    const { modal } = makeModal();
    modal.show();
    const state = withPlanned(3);
    modal.update(state, 'sunny');
    expect(modal.root.textContent).toContain(warnText(3));

    state.plannedDrillHoles.pop();
    modal.update(state, 'sunny');
    expect(modal.root.textContent).toContain(warnText(2));
    expect(modal.root.textContent).not.toContain(warnText(3));

    state.plannedDrillHoles = [];
    modal.update(state, 'sunny');
    const tpl = readLocale('en')[KEY]!.split('{count}')[1]!;
    expect(modal.root.textContent).not.toContain(tpl);
  });
});

// ── #1362: waiting body while a detonation is armed ──────────────────────────

describe('PreflightModal — armed detonation waiting body (#1362)', () => {
  const FIRE_ANYWAY = '[data-action="preflight-fire-anyway"]';
  const CANCEL_DET = '[data-action="preflight-cancel-detonation"]';
  const NEW_KEYS = [
    'ui.blast_workshop.preflight.detonating_title',
    'ui.blast_workshop.preflight.detonating_remaining',
    'ui.blast_workshop.preflight.stranded_names',
    'ui.blast_workshop.preflight.fire_anyway',
    'ui.blast_workshop.preflight.cancel_detonation',
    'mining.blast.detonation_armed',
    'mining.blast.detonation_cancelled',
    'mining.blast.detonation_auto_fired',
    'mining.blast.detonation_stranded',
  ];
  const readLocale = (l: string): Record<string, string> =>
    JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8'));

  function armedState(opts: { stranded?: boolean; workerAt?: [number, number] } = {}): { state: GameState; empId: number } {
    const state = chargedPlan(); // hole at (10,10): danger zone (-5,-5)-(25,25)
    const [x, z] = opts.workerAt ?? [11, 11];
    state.employees.employees.push({
      id: 7, name: 'Oz Trill', role: 'driller', salary: 500, morale: 60,
      unionized: false, injured: false, alive: true, x, z,
      qualifications: [], trainingState: null, activeActionId: null,
      fatigue: 0, collapsing: false, interruptedActionPayload: null,
      ticksWorked: 0, restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
      activeTaskSkill: null, destinationX: null, destinationZ: null,
      moveConsecutiveFailures: 0, isMoveStuck: false,
      pendingRestDuration: null, pendingRestNeedKey: null, pendingTaskDuration: null,
      pendingActionType: null, pendingActionPayload: null, pendingDriverVehicleId: null,
      taskQueue: [], locomotion: { kind: 'on_foot' },
      itinerary: null, vehicleWaitingTicks: 0,
    });
    state.pendingDetonation = {
      armedTick: 0, strandedEmployeeIds: opts.stranded ? [7] : [], strandedVehicleIds: [], lastEvacuationTick: 0,
    };
    return { state, empId: 7 };
  }

  it('en.json and fr.json define every new key, with different text', () => {
    for (const key of NEW_KEYS) {
      const en = readLocale('en')[key];
      const fr = readLocale('fr')[key];
      expect(en, `en ${key}`).toBeTruthy();
      expect(fr, `fr ${key}`).toBeTruthy();
      expect(en, key).not.toBe(fr);
    }
  });

  it('shows no waiting controls while nothing is armed', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');
    expect(modal.root.querySelector(FIRE_ANYWAY)).toBeNull();
    expect(modal.root.querySelector(CANCEL_DET)).toBeNull();
  });

  it('shows the waiting title, the remaining count and both Blast anyway / Cancel blast buttons while evacuating', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(armedState().state, 'sunny');

    expect(modal.root.textContent).toContain(t('ui.blast_workshop.preflight.detonating_title'));
    expect(modal.root.querySelector(FIRE_ANYWAY)).not.toBeNull();
    expect(modal.root.querySelector(CANCEL_DET)).not.toBeNull();
    expect((modal.root.querySelector(FIRE_ANYWAY) as HTMLButtonElement).disabled).toBe(false);
    expect((modal.root.querySelector(CANCEL_DET) as HTMLButtonElement).disabled).toBe(false);
    expect(modal.root.textContent).toContain(t('ui.blast_workshop.preflight.detonating_remaining', { count: 1, remaining: 1 }));
  });

  it('names the stranded occupant and still offers both buttons', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(armedState({ stranded: true }).state, 'sunny');

    expect(modal.root.textContent).toContain('Oz Trill');
    expect(modal.root.querySelector(FIRE_ANYWAY)).not.toBeNull();
    expect(modal.root.querySelector(CANCEL_DET)).not.toBeNull();
  });

  it('does not show stranded names while merely evacuating', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(armedState({ stranded: false }).state, 'sunny');
    expect(modal.root.textContent).not.toContain('Oz Trill');
  });

  it('offers both buttons even when the zone is already clear (always both)', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(armedState({ workerAt: [200, 200] }).state, 'sunny');
    expect(modal.root.querySelector(FIRE_ANYWAY)).not.toBeNull();
    expect(modal.root.querySelector(CANCEL_DET)).not.toBeNull();
  });

  it('Blast anyway dispatches a plain `blast`', () => {
    const { modal, gameConsole } = makeModal();
    modal.show();
    modal.update(armedState().state, 'sunny');

    (modal.root.querySelector(FIRE_ANYWAY) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith('blast');
  });

  it('Cancel blast dispatches `blast cancel`, never `blast`', () => {
    const { modal, gameConsole } = makeModal();
    modal.show();
    modal.update(armedState().state, 'sunny');

    (modal.root.querySelector(CANCEL_DET) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith('blast cancel');
  });

  it('closes once the armed detonation is gone (fired or cancelled)', () => {
    const { modal } = makeModal();
    modal.show();
    const { state } = armedState();
    modal.update(state, 'sunny');
    expect(modal.visible).toBe(true);

    state.pendingDetonation = null;
    modal.update(state, 'sunny');

    expect(modal.visible).toBe(false);
  });

  it('the waiting body never replaces the pre-flight Cancel button, which still dispatches nothing', () => {
    const { modal, gameConsole } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');
    (modal.root.querySelector('[data-action="preflight-cancel"]') as HTMLButtonElement).click();
    expect(gameConsole).not.toHaveBeenCalled();
  });
});

describe('PreflightModal — waiting block hooks for the tutorial (#1591)', () => {
  const WAITING = '[data-role="preflight-waiting"]';

  function occupied(stranded: boolean): GameState {
    const state = chargedPlan();
    state.employees.employees.push({
      id: 7, name: 'Oz Trill', role: 'driller', salary: 500, morale: 60,
      unionized: false, injured: false, alive: true, x: 11, z: 11,
      qualifications: [], trainingState: null, activeActionId: null,
      fatigue: 0, collapsing: false, interruptedActionPayload: null,
      ticksWorked: 0, restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
      activeTaskSkill: null, destinationX: null, destinationZ: null,
      moveConsecutiveFailures: 0, isMoveStuck: false,
      pendingRestDuration: null, pendingRestNeedKey: null, pendingTaskDuration: null,
      pendingActionType: null, pendingActionPayload: null, pendingDriverVehicleId: null,
      taskQueue: [], locomotion: { kind: 'on_foot' },
      itinerary: null, vehicleWaitingTicks: 0,
    });
    state.pendingDetonation = {
      armedTick: 0, strandedEmployeeIds: stranded ? [7] : [], strandedVehicleIds: [], lastEvacuationTick: 0,
    };
    return state;
  }

  it('is absent when idle', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');
    const el = modal.root.querySelector(WAITING) as HTMLElement | null;
    // Either not in the DOM, or present but hidden and empty.
    expect(el === null || (el.style.display === 'none' && el.dataset['phase'] === undefined)).toBe(true);
  });

  it('carries data-phase="evacuating" while the zone is clearing', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(occupied(false), 'sunny');
    const el = modal.root.querySelector(WAITING) as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.dataset['phase']).toBe('evacuating');
  });

  it('carries data-phase="stranded" when an occupant cannot leave', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(occupied(true), 'sunny');
    const el = modal.root.querySelector(WAITING) as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.dataset['phase']).toBe('stranded');
  });
});

describe('PreflightModal cost net of stock (#1685)', () => {
  function stockedPlan(fromStockKg: number): GameState {
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    state.chargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2, fromStockKg };
    return state;
  }

  it('shows only the cash part of a partly stock-drawn charge', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(stockedPlan(3), 'sunny');
    expect(modal.root.textContent).toContain('$24'); // 2 kg x $12
    expect(modal.root.textContent).not.toContain('$60');
  });

  it('shows $0 cost when stock covered the whole pattern', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(stockedPlan(5), 'sunny');
    expect(modal.root.textContent).toContain('$0');
    expect(modal.root.textContent).not.toContain('$60');
  });
});

// ── #1749: player-facing buttons are named "Blast" ───────────────────────────

describe('PreflightModal — button names (#1749)', () => {
  afterEach(() => { setLocale('en'); });

  const buttonText = (root: HTMLElement, action: string): string =>
    (root.querySelector(`[data-action="${action}"]`) as HTMLElement).textContent!.trim();

  const cases: Array<['en' | 'fr', string, string, string]> = [
    ['en', 'Blast', 'Blast anyway', 'Cancel blast'],
    ['fr', 'Blast', 'Blast quand même', 'Annuler le blast'],
  ];

  it.each(cases)('[%s] the pre-flight confirm button reads "%s"', (locale, detonate) => {
    setLocale(locale);
    const { modal } = makeModal();
    modal.show();
    modal.update(chargedPlan(), 'sunny');
    expect(buttonText(modal.root, 'preflight-detonate')).toBe(detonate);
  });

  it.each(cases)('[%s] the waiting buttons read "%s" / "%s"', (locale, _d, fireAnyway, cancel) => {
    setLocale(locale);
    const { modal } = makeModal();
    modal.show();
    const state = chargedPlan();
    state.pendingDetonation = { armedTick: 0, strandedEmployeeIds: [], strandedVehicleIds: [], lastEvacuationTick: 0 };
    modal.update(state, 'sunny');
    expect(buttonText(modal.root, 'preflight-fire-anyway')).toBe(fireAnyway);
    expect(buttonText(modal.root, 'preflight-cancel-detonation')).toBe(cancel);
  });
});

describe('PreflightModal ore estimate coverage (#1960)', () => {
  function statText(modal: PreflightModal, labelKey: string): string {
    const label = [...modal.root.querySelectorAll('*')]
      .find(n => n.children.length === 0 && n.textContent === t(labelKey));
    if (!label) throw new Error(`no stat ${labelKey}`);
    return label.nextElementSibling?.textContent ?? label.parentElement?.textContent ?? '';
  }

  function estValueText(modal: PreflightModal): string {
    return statText(modal, 'ui.blast_workshop.preflight.stat_value');
  }

  function open(survey: 'none' | 'half' | 'full' | 'stale'): PreflightModal {
    setLocale('en');
    const { modal } = makeModal();
    const grid = makeOreGrid();
    modal.setGridProvider(() => grid);
    const state = makeState();
    addChargedPattern(state, holeCounter);
    if (survey === 'half') state.surveyResults.push(makeCoverageSurvey(0, 20, 1, 0, 20));
    if (survey === 'full') state.surveyResults.push(makeCoverageSurvey(0, 39));
    if (survey === 'stale') state.surveyResults.push({ ...makeCoverageSurvey(0, 39), stale: true });
    modal.show();
    modal.update(state, 'sunny');
    return modal;
  }

  it('without a survey the est. value reads "No survey", not $0', () => {
    const modal = open('none');
    expect(estValueText(modal)).toContain('No survey');
    expect(estValueText(modal)).not.toMatch(/\$/);
  });

  it('a stale-only survey reads as "No survey"', () => {
    expect(estValueText(open('stale'))).toContain('No survey');
  });

  it('partial coverage shows the dollar value and "N% surveyed"', () => {
    const text = estValueText(open('half'));
    expect(text).toMatch(/\$/);
    expect(text).toMatch(/\b\d{1,2}% surveyed/);
    expect(text).not.toContain('No survey');
  });

  it('full coverage shows the dollar value alone', () => {
    const text = estValueText(open('full'));
    expect(text).toMatch(/\$[\d,.]+/);
    expect(text).not.toContain('surveyed');
    expect(text).not.toContain('No survey');
  });

  it('plan cost is unchanged by coverage and Detonate stays enabled', () => {
    const costs = (['none', 'half', 'full'] as const).map(s => {
      const modal = open(s);
      expect((modal.root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement).disabled).toBe(false);
      return statText(modal, 'ui.blast_workshop.preflight.stat_cost');
    });
    expect(costs[0]).toMatch(/^\$/);
    expect(new Set(costs).size).toBe(1);
  });
});

describe('PreflightModal ore estimate: surveyed ground and nothing broken (#1967)', () => {
  function statText(modal: PreflightModal, labelKey: string): string {
    const label = [...modal.root.querySelectorAll('*')]
      .find(n => n.children.length === 0 && n.textContent === t(labelKey));
    if (!label) throw new Error(`no stat ${labelKey}`);
    return label.nextElementSibling?.textContent ?? label.parentElement?.textContent ?? '';
  }
  const estValueText = (modal: PreflightModal) => statText(modal, 'ui.blast_workshop.preflight.stat_value');
  const hint = () => t('ui.blast_workshop.footer.survey_hint', { survey: t('ui.survey.title') });

  function open(holes: 'drilled' | 'weak' | 'charged', survey: 'none' | 'full' | 'barren'): PreflightModal {
    setLocale('en');
    const { modal } = makeModal();
    const grid = makeOreGrid();
    modal.setGridProvider(() => grid);
    const state = makeState();
    if (holes === 'drilled') addDrilledPattern(state, holeCounter);
    if (holes === 'weak') addWeakChargedPattern(state, holeCounter);
    if (holes === 'charged') addChargedPattern(state, holeCounter);
    if (survey === 'full') state.surveyResults.push(makeCoverageSurvey(0, 39));
    if (survey === 'barren') state.surveyResults.push(makeBarrenSurvey());
    modal.show();
    modal.update(state, 'sunny');
    return modal;
  }

  it('surveyed but uncharged holes show a neutral dash, not "No survey"', () => {
    const modal = open('drilled', 'full');
    expect(estValueText(modal)).toBe('—');
    expect(modal.root.textContent).not.toContain('No survey');
    expect(modal.root.textContent).not.toContain(hint());
  });

  it('unsurveyed uncharged holes keep "No survey"', () => {
    expect(estValueText(open('drilled', 'none'))).toContain('No survey');
  });

  it('a charge that breaks nothing is neutral, surveyed or not', () => {
    for (const survey of ['full', 'none'] as const) {
      const modal = open('weak', survey);
      expect(estValueText(modal)).toBe('—');
      expect(modal.root.textContent).not.toContain('No survey');
      expect(modal.root.textContent).not.toContain(hint());
    }
  });

  it('a surveyed barren charged pattern reads $0 with no share', () => {
    const text = estValueText(open('charged', 'barren'));
    expect(text).toBe('$0');
    expect(text).not.toContain('surveyed');
    expect(text).not.toContain('No survey');
  });

  it('a charged pattern wholly inside a fresh disc reads the dollar value alone', () => {
    const text = estValueText(open('charged', 'full'));
    expect(text).toMatch(/^\$[\d,.]+$/);
    expect(text).not.toContain('surveyed');
  });
});

describe('PreflightModal delivery wait (#1966)', () => {
  function inTransitState(): GameState {
    const state = makeState();
    state.tickCount = 280;
    state.cash = 100_000;
    state.finances.cash = 100_000;
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    dispatchChargeAction(state, { id: hole.id, x: 10, z: 10 }, { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    return state;
  }

  afterEach(() => setLocale('en'));

  it('warns that explosives are on the way, with day, hour and duration and no tick', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(inTransitState(), 'sunny');

    const text = modal.root.textContent ?? '';
    expect(text).toContain('Day 29, 08:00');
    expect(text).toContain(formatGameDuration(400));
    expect(text).not.toContain('tick');
  });

  it('does not show the loading warning for a hole that is only waiting for delivery', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(inTransitState(), 'sunny');
    expect(modal.root.textContent).not.toContain(t('ui.blast_workshop.preflight.warn_charge_loading', { count: 1 }));
    expect(modal.root.textContent).not.toContain('still being charged');
  });

  it('keeps the loading warning for a hole that is really loading', () => {
    const { modal } = makeModal();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    state.plannedChargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    modal.show();
    modal.update(state, 'sunny');
    expect(modal.root.textContent).toContain(t('ui.blast_workshop.preflight.warn_charge_loading', { count: 1 }));
  });

  it('shows the French clock in French', () => {
    setLocale('fr');
    const { modal } = makeModal();
    modal.show();
    modal.update(inTransitState(), 'sunny');
    expect(modal.root.textContent).toContain('Jour 29, 08h00');
  });
});

// #1925: permit fee, strikes and over-limit warning on progression sites.
describe('PreflightModal — permit lines (#1925)', () => {
  function permitState(holes: number, kgPerHole: number, progression = true): GameState {
    const state = makeState();
    if (progression) state.grade = createGradeState();
    for (let i = 0; i < holes; i++) {
      const hole = addHole(holeCounter, state.drillHoles, 10 + i * 3, 10, 8, 0.15);
      const r = createCharge('krackle', kgPerHole, 2, hole.depth);
      if ('charge' in r) state.chargesByHole[hole.id] = r.charge;
    }
    expect(Object.keys(state.chargesByHole)).toHaveLength(holes);
    return state;
  }
  const q = (m: PreflightModal, role: string) => m.root.querySelector(`[data-role="${role}"]`) as HTMLElement | null;
  const detonate = (m: PreflightModal) => m.root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement;

  it('lists the notification fee on a progression site', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(permitState(9, 4), 'sunny');
    expect(q(modal, 'preflight-permit-fee')).not.toBeNull();
    expect(q(modal, 'preflight-permit-fee')!.textContent).toContain('250');
  });

  it('lists the strikes so far', () => {
    const { modal } = makeModal();
    const state = permitState(9, 4);
    state.grade!.strikeTicks = [state.tickCount];
    modal.show();
    modal.update(state, 'sunny');
    expect(q(modal, 'preflight-permit-strikes')).not.toBeNull();
    expect(q(modal, 'preflight-permit-strikes')!.textContent).toContain('1');
  });

  it('puts no over-limit warning in the list within the limit', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(permitState(9, 4), 'sunny');
    expect(q(modal, 'preflight-permit-warning')).toBeNull();
  });

  it('adds the over-limit warning to the warnings list when over', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(permitState(9, 5), 'sunny');
    const w = q(modal, 'preflight-permit-warning');
    expect(w).not.toBeNull();
    expect(w!.textContent!.length).toBeGreaterThan(0);
  });

  it('DETONATE stays enabled and fires while over the limit', () => {
    const { modal, gameConsole } = makeModal();
    modal.show();
    modal.update(permitState(9, 5), 'sunny');
    expect(detonate(modal).disabled).toBe(false);
    detonate(modal).click();
    expect(gameConsole).toHaveBeenCalledWith('blast detonate');
  });

  it('shows no permit fee, strikes or warning on a non-progression site', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(permitState(9, 5, false), 'sunny');
    expect(q(modal, 'preflight-permit-fee')).toBeNull();
    expect(q(modal, 'preflight-permit-strikes')).toBeNull();
    expect(q(modal, 'preflight-permit-warning')).toBeNull();
  });

  it('never renders an inspection chance or overshoot', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(permitState(12, 5), 'sunny');
    const text = modal.root.textContent!.toLowerCase();
    expect(text).not.toContain('chance');
    expect(text).not.toContain('overshoot');
  });
});

// ── #2021: buildings inside the blast area are warned about ─────────────────

describe('PreflightModal — buildings in blast reach (#2021)', () => {
  afterEach(() => setLocale('en'));

  function reachState(): GameState {
    const state = makeState();
    addReachPattern(state, holeCounter);
    addReachBuildings(state);
    return state;
  }

  it('lists a warning row per building at risk, and not the quarters', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(reachState(), 'sunny');
    const text = modal.root.textContent ?? '';
    expect(text).toContain('Management Office is inside the blast area and will be destroyed.');
    expect(text).toContain('Freight Warehouse is inside the blast area and will be destroyed.');
    expect(text).toContain('Explosive Warehouse (228 kg stocked) is inside the blast area');
    expect(text).not.toContain('Living Quarters is inside the blast area');
    expect(text.match(/is inside the blast area/g)).toHaveLength(3);
  });

  it('the stocked warehouse row names its kg and the secondary blast', () => {
    const { modal } = makeModal();
    modal.show();
    modal.update(reachState(), 'sunny');
    expect(modal.root.textContent).toContain('228 kg');
    expect(modal.root.textContent).toContain('secondary blast');
  });

  it('shows no building row when nothing is in reach', () => {
    const { modal } = makeModal();
    modal.show();
    const state = makeState();
    addReachPattern(state, holeCounter);
    modal.update(state, 'sunny');
    expect(modal.root.textContent).not.toContain('inside the blast area');
  });

  it('shows no building row when the only building is far from the holes', () => {
    const { modal } = makeModal();
    modal.show();
    const state = makeState();
    addReachPattern(state, holeCounter);
    placeBuilding(state.buildings, 'living_quarters', 30, 48, 64, 64);
    modal.update(state, 'sunny');
    expect(modal.root.textContent).not.toContain('inside the blast area');
  });

  it('is a warning, not a gate: Detonate stays enabled and dispatches', () => {
    const { modal, gameConsole } = makeModal();
    modal.show();
    modal.update(reachState(), 'sunny');
    const btn = modal.root.querySelector('[data-action="preflight-detonate"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(gameConsole).toHaveBeenCalledWith('blast detonate');
  });

  it('building rows come after the protected-holes row', () => {
    const { modal } = makeModal();
    modal.show();
    const state = reachState();
    placeBuilding(state.buildings, 'living_quarters', 12, 44, 64, 64); // on a hole footprint
    modal.update(state, 'sunny');
    const text = modal.root.textContent ?? '';
    const protectedAt = text.indexOf('sit directly on a building');
    expect(protectedAt).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('is inside the blast area')).toBeGreaterThan(protectedAt);
  });

  it('renders French rows under the fr locale', () => {
    const { modal } = makeModal();
    modal.show();
    setLocale('fr');
    modal.update(reachState(), 'sunny');
    const text = modal.root.textContent ?? '';
    expect(text).toContain('228');
    expect(text).not.toContain('is inside the blast area');
    expect(text).not.toContain('ui.blast_workshop.preflight.warn_building');
  });
});
