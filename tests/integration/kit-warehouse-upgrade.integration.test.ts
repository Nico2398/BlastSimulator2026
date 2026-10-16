// BlastSimulator2026 — Integration: the opening kit's warehouse can be upgraded (#1830).
//
// The kit's spoil heap used to stand on the footprint a tier-2 warehouse needs,
// so `build upgrade 1` was refused with a bare "Space is occupied". The heap now
// keeps clear, and a refusal that still happens names whatever blocks it.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG } from '../../src/core/config/balance.js';
import { getDefSize, getBuildingDef } from '../../src/core/entities/Building.js';
import { t, setLocale } from '../../src/core/i18n/I18n.js';

const SEED = 42;
const MAX_RESEARCH_TICKS = 3000;
const MAX_REBUILD_TICKS = 3000;

function refresh(state: GameState): void {
  state.cash = Math.max(state.cash, 1_000_000);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickUntil(run: (c: string) => unknown, state: GameState, done: () => boolean, max: number): void {
  for (let n = 0; n < max && !done(); n++) { refresh(state); run('tick 1'); }
}

function startWithResearchedTier2() {
  setLocale('en');
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands difficulty:easy seed:${SEED}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  refresh(state);
  expect(run('build research_center at:20,48')).toMatchObject({ success: true });
  tickUntil(run, state, () => state.buildings.buildings.some(b => b.type === 'research_center' && b.active), 1500);
  expect(state.buildings.buildings.some(b => b.type === 'research_center' && b.active)).toBe(true);
  expect(run('research queue type:freight_warehouse tier:2')).toMatchObject({ success: true });
  tickUntil(run, state, () => state.buildings.researchQueue.length === 0, MAX_RESEARCH_TICKS);
  expect(state.buildings.researchQueue).toHaveLength(0);
  return { run, state };
}

describe('kit warehouse upgrade (#1830)', () => {
  it('upgrades the kit freight warehouse to tier 2 with the tier-2 capacity', () => {
    const { run, state } = startWithResearchedTier2();
    const kit = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    expect(kit.id).toBe(1);
    const result = run('build upgrade 1');
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    tickUntil(run, state, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2), MAX_REBUILD_TICKS);
    const upgraded = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    expect(upgraded.tier).toBe(2);
    expect(upgraded.capacity).toBe(FREIGHT_WAREHOUSE_CAPACITY_KG[2]);
    expect(FREIGHT_WAREHOUSE_CAPACITY_KG[2]).toBe(72_000);
  });

  it('refusal names the blocking building when something sits on the tier-2 footprint', () => {
    const { run, state } = startWithResearchedTier2();
    const kit = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    const t1 = getDefSize(getBuildingDef('freight_warehouse', 1));
    const t2 = getDefSize(getBuildingDef('freight_warehouse', 2));
    // Force a blocker on the cells only tier 2 covers, clear of tier 1.
    state.buildings.buildings = state.buildings.buildings.filter(b => b.id === kit.id || b.type === 'research_center');
    state.buildings.buildings.push({
      ...kit, id: 900, type: 'management_office', tier: 1,
      x: kit.x + t1.sizeX, z: kit.z,
    });
    expect(t2.sizeX).toBeGreaterThan(t1.sizeX);
    const result = run('build upgrade 1') as { success: boolean; output: string };
    expect(result.success).toBe(false);
    expect(result.output).toContain(t('building.management_office.name'));
  });

  it('refusal text is translated in french', () => {
    const { run, state } = startWithResearchedTier2();
    const kit = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    const t1 = getDefSize(getBuildingDef('freight_warehouse', 1));
    state.buildings.buildings = state.buildings.buildings.filter(b => b.id === kit.id || b.type === 'research_center');
    state.buildings.buildings.push({ ...kit, id: 900, type: 'management_office', tier: 1, x: kit.x + t1.sizeX, z: kit.z });
    setLocale('fr');
    try {
      const result = run('build upgrade 1') as { success: boolean; output: string };
      expect(result.success).toBe(false);
      expect(result.output).toContain('Bureau de Gestion');
    } finally {
      setLocale('en');
    }
  });
});
