// BlastSimulator2026 — Unit tests: placement cutoff confirm helpers (#1391)

import { describe, it, expect, vi, beforeEach } from 'vitest';

const computeMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/core/entities/Building.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/core/entities/Building.js')>()),
  computePlacementCutoff: computeMock,
}));

import {
  placementCutoffFor, cutoffLine, cutoffStateKey, buildPlacementCutoffConfirm,
} from '../../../src/ui/placementCutoffConfirm.js';
import { t } from '../../../src/core/i18n/I18n.js';
import type { GameState } from '../../../src/core/state/GameState.js';

const RECT = { minX: 1, minZ: 1, maxX: 3, maxZ: 3 };

function makeState(over: Record<string, unknown> = {}): GameState {
  return {
    navGrid: {},
    employees: { employees: [
      { alive: true, x: 1, z: 2 },
      { alive: false, x: 9, z: 9 },
    ] },
    drillHoles: [{ x: 4, z: 4 }],
    plannedDrillHoles: [{ x: 5, z: 5 }],
    pendingActions: [{ targetX: 7, targetZ: 8 }],
    ...over,
  } as unknown as GameState;
}

describe('placementCutoffFor', () => {
  beforeEach(() => computeMock.mockReset());

  it('returns null without a nav grid', () => {
    expect(placementCutoffFor(makeState({ navGrid: undefined }), RECT)).toBeNull();
    expect(computeMock).not.toHaveBeenCalled();
  });

  it('maps state to alive crew, all drill holes, and order targets', () => {
    computeMock.mockReturnValue(null);
    const state = makeState();
    const freed = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
    placementCutoffFor(state, RECT, freed);
    const [grid, crew, newRect, freedRect, targets] = computeMock.mock.calls[0];
    expect(grid).toBe(state.navGrid);
    expect(crew).toEqual([{ alive: true, x: 1, z: 2 }]);
    expect(newRect).toBe(RECT);
    expect(freedRect).toBe(freed);
    expect(targets.holes).toEqual([{ x: 4, z: 4 }, { x: 5, z: 5 }]);
    expect(targets.orders).toEqual([{ x: 7, z: 8 }]);
  });
});

describe('cutoffStateKey', () => {
  it('changes with crew position, holes and pending actions; ignores dead crew', () => {
    const base = cutoffStateKey(makeState());
    const moved = makeState({ employees: { employees: [{ alive: true, x: 4, z: 2 }] } });
    expect(cutoffStateKey(moved)).not.toBe(base);
    expect(cutoffStateKey(makeState({ drillHoles: [] }))).not.toBe(base);
    expect(cutoffStateKey(makeState({ pendingActions: [] }))).not.toBe(base);
    const deadMoved = makeState({ employees: { employees: [{ alive: true, x: 1, z: 2 }, { alive: false, x: 0, z: 0 }] } });
    expect(cutoffStateKey(deadMoved)).toBe(base);
  });
});

describe('cutoffLine', () => {
  it('drops zero parts', () => {
    const line = cutoffLine({ cells: 5, benches: 2, holes: 0, orders: 1 });
    expect(line).toContain(t('ui.build.cutoff_benches', { count: 2 }));
    expect(line).toContain(t('ui.build.cutoff_orders', { count: 1 }));
    expect(line).not.toContain(t('ui.build.cutoff_holes', { count: 0 }));
    expect(line).toBe(t('ui.build.cutoff_line', {
      parts: `${t('ui.build.cutoff_benches', { count: 2 })} / ${t('ui.build.cutoff_orders', { count: 1 })}`,
    }));
  });
});

describe('buildPlacementCutoffConfirm', () => {
  it('builds a warn modal embedding the cutoff line and wiring onConfirm', () => {
    const c = { cells: 4, benches: 1, holes: 1, orders: 0 };
    const onConfirm = vi.fn();
    const cfg = buildPlacementCutoffConfirm(c, onConfirm);
    expect(cfg.icon).toBe('warn');
    expect(cfg.title).toBe(t('ui.build.cutoff_confirm_title'));
    expect(cfg.confirmLabel).toBe(t('ui.build.cutoff_confirm_label'));
    expect(cfg.body).toContain(cutoffLine(c));
    cfg.onConfirm();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
