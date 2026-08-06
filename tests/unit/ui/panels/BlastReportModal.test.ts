// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { BlastReportModal } from '../../../../src/ui/panels/BlastReportModal.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { resetHoleIds } from '../../../../src/core/mining/DrillPlan.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { BlastReport } from '../../../../src/core/mining/BlastExecution.js';

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeModal(): { modal: BlastReportModal; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modal = new BlastReportModal(container);
  return { modal, container };
}

function makeReport(overrides: Partial<BlastReport> = {}): BlastReport {
  return {
    tick: 100, rating: 'good', clearedVoxels: 1842, crackedVoxels: 610,
    fragmentCount: 47, oversizedFragments: 0, totalRockVolume: 1240,
    projectionCount: 0, maxProjectionDistanceM: 0, totalOreValue: 16020,
    spent: 960, destroyedBuildings: [],
    ...overrides,
  };
}

beforeEach(() => resetHoleIds());

describe('BlastReportModal', () => {
  it('is hidden until a blast report appears', () => {
    const { modal } = makeModal();
    expect(modal.visible).toBe(false);
  });

  it('stays hidden when update() runs with no lastBlastReport', () => {
    const { modal } = makeModal();
    modal.update(makeState());
    expect(modal.visible).toBe(false);
  });

  it('auto-shows and renders real stats the first time a report appears', () => {
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();

    modal.update(state);

    expect(modal.visible).toBe(true);
    expect(modal.root.textContent).toContain('1842');
    expect(modal.root.textContent).toContain('610');
    expect(modal.root.textContent).toContain('47');
    expect(modal.root.textContent).toContain('$960');
    expect(modal.root.textContent).toContain('$16,020');
    expect(modal.root.textContent).toContain('Good');
  });

  it('Close hides the modal', () => {
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    modal.update(state);

    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    expect(modal.visible).toBe(false);
  });

  it('does not reopen on the next tick for the same report once closed', () => {
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    modal.update(state);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    modal.update(state); // same tick, same report object

    expect(modal.visible).toBe(false);
  });

  it('opens again for a genuinely new report (different tick)', () => {
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ tick: 100 });
    modal.update(state);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    state.lastBlastReport = makeReport({ tick: 200 });
    modal.update(state);

    expect(modal.visible).toBe(true);
  });

  it('opens again for a second blast fired on the same tick', () => {
    // Nothing forces the clock to advance between two plans — a player (or a
    // scripted sequence) can drill/charge/sequence/fire twice with no tick
    // command in between, so both reports land on the same state.tickCount.
    // Gating on tick equality alone made the second report never reopen; the
    // fix compares report identity instead (buildBlastReport in mining.ts
    // always returns a fresh object, so two distinct blasts are always two
    // distinct references even when their tick matches). Issue #479.
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ tick: 100, fragmentCount: 47 });
    modal.update(state);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();
    expect(modal.visible).toBe(false);

    state.lastBlastReport = makeReport({ tick: 100, fragmentCount: 12 });
    modal.update(state);

    expect(modal.visible).toBe(true);
    expect(modal.root.textContent).toContain('12');
  });

  it('shows the ore report card with real percentage and breakdown when a survey estimate exists', () => {
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    state.lastOreReport = {
      oreYields: { craktonite: 3900, rustite: 1320 },
      totalYieldKg: 5220, estimatedYieldKg: 6100, yieldRatio: 5220 / 6100,
      hasTreranium: false, absurdiumFraction: 0,
    };

    modal.update(state);

    expect(modal.root.textContent).toContain('86%');
    expect(modal.root.textContent).toContain('5220 kg');
    expect(modal.root.textContent).toContain('6100 kg');
  });

  it('omits the ore report card when there was no survey estimate to compare against', () => {
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    state.lastOreReport = {
      oreYields: {}, totalYieldKg: 0, estimatedYieldKg: 0, yieldRatio: 1,
      hasTreranium: false, absurdiumFraction: 0,
    };

    modal.update(state);

    expect(modal.root.textContent).not.toContain('Ore Report');
  });

  it('shows one card per destroyed building', () => {
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({
      destroyedBuildings: [{ buildingId: 3, type: 'freight_warehouse', x: 5, z: 5 }],
    });

    modal.update(state);

    expect(modal.root.textContent).toContain('Freight Warehouse #3');
    expect(modal.root.textContent).toContain('was destroyed');
  });

  it('shows the oversized-fragments hint, naming the real rock_fragmenter vehicle, only when there are any', () => {
    const { modal: modalA } = makeModal();
    const stateA = makeState();
    stateA.lastBlastReport = makeReport({ oversizedFragments: 0 });
    modalA.update(stateA);
    expect(modalA.root.textContent).not.toContain('too large for standard haulers');

    const { modal: modalB } = makeModal();
    const stateB = makeState();
    stateB.lastBlastReport = makeReport({ oversizedFragments: 6 });
    modalB.update(stateB);
    expect(modalB.root.textContent).toContain('6 fragments are too large for standard haulers');
    expect(modalB.root.textContent).toContain('Rock Fragmenter');
  });

  it('refreshLocale() does not throw', () => {
    const { modal } = makeModal();
    expect(() => modal.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the modal from the DOM', () => {
    const { modal, container } = makeModal();
    modal.dispose();
    expect(container.contains(modal.root)).toBe(false);
  });
});
