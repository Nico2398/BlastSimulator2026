// @vitest-environment jsdom
// Inspector storage contents section (#1757): freight warehouse, spoil heap.
import { describe, it, expect } from 'vitest';
import { storageContents } from '../../../../../src/ui/panels/inspector/storageContent.js';
import type { InspectorSection } from '../../../../../src/ui/panels/inspector/inspectorWidgets.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';
import { getBuildingDef, type Building, type BuildingType } from '../../../../../src/core/entities/Building.js';
import { addBlastFragments, pickupFragment, deliverToDepot } from '../../../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../../../src/core/mining/BlastExecution.js';
import { t } from '../../../../../src/core/i18n/I18n.js';

const fmt = (kg: number): string => `${Math.round(kg).toLocaleString('en-US')} kg`;

function makeBuilding(type: BuildingType, overrides: Partial<Building> = {}): Building {
  return { id: 3, type, tier: 1, x: 17, z: 23, hp: 100, active: true, occupantIds: [], ...overrides };
}

function stateWith(b: Building): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.tickCount = 100;
  s.buildings.buildings = [b];
  return s;
}

function frag(id: number, mass: number, oreDensities: Record<string, number>): FragmentData {
  return {
    id, position: { x: 17, y: 0, z: 23 }, volume: mass / 2500, mass, rockId: 'sandite', oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: id, origin: { x: 17, y: 0, z: 23 },
  };
}

/** Store a fragment in warehouse 3, or leave it in transit to it. */
function load(s: GameState, f: FragmentData, store: boolean): void {
  const cap = getBuildingDef('freight_warehouse', 1).capacity;
  const sites = [{ id: 3, x: 17, z: 23, capacityKg: cap }];
  addBlastFragments(s.logistics, [f]);
  expect(pickupFragment(s.logistics, f.id, 'v1', sites, 17, 23)).toBe(true);
  if (store) expect(deliverToDepot(s.logistics, f.id, s.collectedOre, sites, 17, 23)).toBe(true);
}

function mount(b: Building, s: GameState): { c: InspectorSection; root: HTMLElement } {
  const c = storageContents(b, s);
  if (!c) throw new Error('expected a storage section');
  const root = document.createElement('div');
  root.append(c.section);
  return { c, root };
}

const live = (root: HTMLElement, key: string): HTMLElement | null => root.querySelector(`[data-live="${key}"]`);
const liveAll = (root: HTMLElement, prefix: string): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(`[data-live^="${prefix}"]`)];

describe('storageContents: non-storage buildings', () => {
  it.each(['management_office', 'living_quarters', 'research_center', 'blast_workshop'] as BuildingType[])(
    'returns null for %s',
    type => {
      const b = makeBuilding(type);
      expect(storageContents(b, stateWith(b))).toBeNull();
    },
  );
});

describe('storageContents: freight warehouse', () => {
  const cap = getBuildingDef('freight_warehouse', 1).capacity;

  it('shows an empty state and a zero gauge when it holds nothing', () => {
    const b = makeBuilding('freight_warehouse');
    const { root } = mount(b, stateWith(b));
    expect(liveAll(root, 'ore-row-')).toHaveLength(0);
    expect(live(root, 'barren')).toBeNull();
    expect(live(root, 'gauge')!.textContent).toContain(cap.toLocaleString('en-US'));
    expect(root.textContent).not.toMatch(/\b(inspector|ui)\.[a-z_.]+/);
    expect(root.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('shows a localized row per ore, a barren row and the gauge', () => {
    const b = makeBuilding('freight_warehouse');
    const s = stateWith(b);
    load(s, frag(1, 200, { dirtite: 0.3, blingite: 0.1 }), true);
    load(s, frag(2, 100, { dirtite: 0.2 }), true);
    const { root } = mount(b, s);
    const dirt = live(root, 'ore-row-dirtite')!;
    const bling = live(root, 'ore-row-blingite')!;
    expect(dirt.parentElement!.textContent).toContain(t('ore.dirtite.name'));
    expect(bling.parentElement!.textContent).toContain(t('ore.blingite.name'));
    expect(dirt.textContent).toMatch(/\d+ kg$/);
    expect(live(root, 'barren')!.textContent).toMatch(/\d+ kg$/);
    expect(live(root, 'gauge')!.textContent).toContain('300');
    expect(live(root, 'gauge')!.textContent).toContain(cap.toLocaleString('en-US'));
  });

  it('per-ore rows plus barren add up to the stored kg', () => {
    const b = makeBuilding('freight_warehouse');
    const s = stateWith(b);
    load(s, frag(1, 1000, { dirtite: 0.3, blingite: 0.1 }), true);
    load(s, frag(2, 500, { dirtite: 0.2 }), true);
    const { root } = mount(b, s);
    const num = (el: HTMLElement | null): number => Number((el?.textContent ?? '0').replace(/[^0-9]/g, ''));
    const sum = liveAll(root, 'ore-row-').reduce((a, el) => a + num(el), 0) + num(live(root, 'barren'));
    expect(Math.abs(sum - 1500)).toBeLessThanOrEqual(liveAll(root, 'ore-row-').length + 1);
  });

  it('shows kg reserved by loads in transit, not counted as stored', () => {
    const b = makeBuilding('freight_warehouse');
    const s = stateWith(b);
    load(s, frag(1, 200, { dirtite: 0.3 }), true);
    load(s, frag(2, 150, { dirtite: 0.3 }), false);
    const { root } = mount(b, s);
    expect(live(root, 'reserved')!.textContent).toContain('150');
    expect(live(root, 'gauge')!.textContent).toContain('200');
    expect(live(root, 'gauge')!.textContent).not.toContain('350');
  });

  it('counts only its own fragments', () => {
    const b = makeBuilding('freight_warehouse');
    const s = stateWith(b);
    load(s, frag(1, 200, { dirtite: 0.3 }), true);
    addBlastFragments(s.logistics, [frag(2, 400, { blingite: 0.5 })]);
    const other = { id: 77, x: 40, z: 40, capacityKg: 1000 };
    expect(pickupFragment(s.logistics, 2, 'v2', [other], 40, 40)).toBe(true);
    expect(deliverToDepot(s.logistics, 2, s.collectedOre, [other], 40, 40)).toBe(true);
    const { root } = mount(b, s);
    expect(live(root, 'ore-row-blingite')).toBeNull();
    expect(live(root, 'ore-row-dirtite')).not.toBeNull();
  });

  it('syncs in place as loads arrive', () => {
    const b = makeBuilding('freight_warehouse');
    const s = stateWith(b);
    load(s, frag(1, 200, { dirtite: 0.3 }), true);
    const { c, root } = mount(b, s);
    const row = live(root, 'ore-row-dirtite')!;
    const gauge = live(root, 'gauge')!;
    const before = row.textContent;
    load(s, frag(2, 300, { dirtite: 0.3, blingite: 0.2 }), true);
    c.sync(root);
    expect(live(root, 'ore-row-dirtite')).toBe(row);
    expect(live(root, 'gauge')).toBe(gauge);
    expect(row.textContent).not.toBe(before);
    expect(live(root, 'ore-row-blingite')).not.toBeNull();
    expect(gauge.textContent).toContain('500');
  });

  it('does not render a stock hook', () => {
    const b = makeBuilding('freight_warehouse');
    const { root } = mount(b, stateWith(b));
    expect(root.querySelector('[data-info="warehouse-stock"]')).toBeNull();
    expect(live(root, 'radius')).toBeNull();
  });
});

describe('storageContents: spoil heap', () => {
  it('shows the spoil kg with a capacity gauge, the heap being finite (#1892)', () => {
    const b = makeBuilding('spoil_heap', { storedSpoilKg: 12345 });
    const { root } = mount(b, stateWith(b));
    expect(root.textContent).toContain(fmt(12345));
    expect(live(root, 'gauge')).not.toBeNull();
    expect(live(root, 'reserved')).toBeNull();
  });

  it('shows zero spoil on a fresh heap', () => {
    const b = makeBuilding('spoil_heap');
    const { root } = mount(b, stateWith(b));
    expect(root.textContent).toContain(fmt(0));
  });

  it('syncs the spoil kg in place', () => {
    const b = makeBuilding('spoil_heap', { storedSpoilKg: 1000 });
    const { c, root } = mount(b, stateWith(b));
    const before = root.innerHTML;
    b.storedSpoilKg = 2500;
    c.sync(root);
    expect(root.textContent).toContain(fmt(2500));
    expect(root.textContent).not.toContain(fmt(1000));
    expect(root.innerHTML).not.toBe(before);
  });
});
