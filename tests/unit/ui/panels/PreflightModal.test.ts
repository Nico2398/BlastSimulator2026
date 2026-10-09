// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreflightModal } from '../../../../src/ui/panels/PreflightModal.js';
import { wetAllHoles } from '../../../helpers/holeWater.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { addHole } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { readFileSync } from 'node:fs';
import { t } from '../../../../src/core/i18n/I18n.js';
import type { GameState } from '../../../../src/core/state/GameState.js';

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

  it('shows the waiting title, the remaining count and both Fire anyway / Cancel buttons while evacuating', () => {
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

  it('Fire anyway dispatches a plain `blast`', () => {
    const { modal, gameConsole } = makeModal();
    modal.show();
    modal.update(armedState().state, 'sunny');

    (modal.root.querySelector(FIRE_ANYWAY) as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith('blast');
  });

  it('Cancel detonation dispatches `blast cancel`, never `blast`', () => {
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
