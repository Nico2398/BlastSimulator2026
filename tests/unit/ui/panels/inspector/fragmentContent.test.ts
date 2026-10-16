// @vitest-environment jsdom
// Fragment inspector content (#1769): mass, rock, ore per kg, barren note, location links.
import { describe, it, expect, vi } from 'vitest';
import { fragmentContent } from '../../../../../src/ui/panels/inspector/fragmentContent.js';
import type { InspectorLinks, InspectorView } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';
import type { FragmentData } from '../../../../../src/core/mining/BlastExecution.js';
import type { TrackedFragment } from '../../../../../src/core/economy/Logistics.js';
import type { Vehicle } from '../../../../../src/core/entities/Vehicle.js';
import type { Building } from '../../../../../src/core/entities/Building.js';
import { fragmentOreKg } from '../../../../../src/core/economy/FragmentOre.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';
import { t, setLocale } from '../../../../../src/core/i18n/I18n.js';

function frag(id: number, mass: number, oreDensities: Record<string, number>): FragmentData {
  return {
    id, position: { x: 0, y: 0, z: 0 }, volume: mass / 2500, mass, rockId: 'sandite', oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: id, origin: { x: 0, y: 0, z: 0 },
  };
}

function tracked(f: FragmentData, state: TrackedFragment['state'], vehicleId: string | null = null, warehouseId: number | null = null): TrackedFragment {
  return { fragment: f, state, vehicleId, warehouseId };
}

function makeState(fragments: TrackedFragment[], withVehicle = true): GameState {
  setLocale('en');
  const s = createGame({ seed: 42, mineType: 'desert' });
  const v: Vehicle = { id: 3, type: 'debris_hauler', tier: 1, x: 5, z: 5, hp: 100, cargo: [], occupantIds: [] };
  s.vehicles.vehicles = withVehicle ? [v] : [];
  const wh: Building = { id: 7, type: 'freight_warehouse', tier: 1, x: 60, z: 4, hp: 100, active: true, occupantIds: [] };
  s.buildings.buildings = [wh];
  s.logistics.fragments = fragments;
  return s;
}

function makeLinks() {
  const select = vi.fn();
  return { links: { select, run: vi.fn(), confirm: vi.fn() } as InspectorLinks, select };
}

function viewOf(s: GameState, id: number, links: InspectorLinks = makeLinks().links): InspectorView {
  return fragmentContent.view({ kind: 'fragment', id }, s, links)!;
}

function mount(view: InspectorView): HTMLElement {
  const root = document.createElement('div');
  root.append(...view.sections);
  document.body.append(root);
  return root;
}

describe('fragment inspector', () => {
  it('returns null for an unknown fragment', () => {
    expect(fragmentContent.view({ kind: 'fragment', id: 99 }, makeState([]), makeLinks().links)).toBeNull();
  });

  it('has no actions', () => {
    const f = frag(5, 1000, { goldite: 0.2 });
    expect(viewOf(makeState([tracked(f, 'on_ground')]), 5).actions).toEqual([]);
  });

  it('shows mass, localized rock and one sorted row per ore of at least 0.5 kg', () => {
    const f = frag(5, 2000, { dirtite: 0.1, goldite: 0.3, traceite: 0.0001 });
    const s = makeState([tracked(f, 'on_ground')]);
    const root = mount(viewOf(s, 5));
    const section = root.querySelector('.bs-fragment-rock')!;
    expect(section.textContent).toContain(formatMoney(2000));
    expect(section.textContent).toContain(t('rock.sandite.name'));
    const rows = [...section.querySelectorAll<HTMLElement>('[data-fragment-ore]')];
    expect(rows.map(r => r.dataset['fragmentOre'])).toEqual(['goldite', 'dirtite']);
    const { byOre } = fragmentOreKg(f);
    expect(rows[0]!.textContent).toContain(t('ore.goldite.name'));
    expect(rows[0]!.textContent).toContain(formatMoney(byOre['goldite']!));
  });

  it('has no barren note for an ore-bearing fragment', () => {
    const f = frag(5, 2000, { goldite: 0.3 });
    const root = mount(viewOf(makeState([tracked(f, 'on_ground')]), 5));
    expect(root.querySelector('[data-fragment-barren]')).toBeNull();
  });

  it('notes a barren fragment and lists no ore rows', () => {
    const f = frag(6, 2000, {});
    const root = mount(viewOf(makeState([tracked(f, 'on_ground')]), 6));
    expect(root.querySelectorAll('[data-fragment-ore]').length).toBe(0);
    expect(root.querySelector('[data-fragment-barren]')).not.toBeNull();
  });

  it('says on the ground for a loose fragment', () => {
    const root = mount(viewOf(makeState([tracked(frag(5, 1000, { goldite: 0.2 }), 'on_ground')]), 5));
    const loc = root.querySelector('.bs-fragment-location')!;
    expect(loc.textContent).toContain('On the ground');
    expect(loc.querySelector('[data-select-kind]')).toBeNull();
  });

  it('links the carrying vehicle and the destination warehouse in transit', () => {
    const s = makeState([tracked(frag(5, 1000, { goldite: 0.2 }), 'in_transit', '3', 7)]);
    const { links, select } = makeLinks();
    const root = mount(viewOf(s, 5, links));
    const loc = root.querySelector('.bs-fragment-location')!;
    expect(loc.textContent).toContain('In transit on');
    expect(loc.textContent).toContain('Bound for');
    const vlink = loc.querySelector<HTMLElement>('[data-select-kind="vehicle"]')!;
    expect(vlink.dataset['selectId']).toBe('3');
    expect(loc.querySelector<HTMLElement>('[data-select-kind="building"]')!.dataset['selectId']).toBe('7');
    vlink.click();
    expect(select).toHaveBeenCalledWith('vehicle', 3);
  });

  it('falls back to plain text when the carrying vehicle is gone', () => {
    const s = makeState([tracked(frag(5, 1000, { goldite: 0.2 }), 'in_transit', '3', null)], false);
    const loc = mount(viewOf(s, 5)).querySelector('.bs-fragment-location')!;
    expect(loc.textContent).toContain('In transit on');
    expect(loc.querySelector('[data-select-kind="vehicle"]')).toBeNull();
    expect(loc.textContent).not.toContain('Bound for');
  });

  it('links the warehouse a stored fragment sits in', () => {
    const s = makeState([tracked(frag(5, 1000, { goldite: 0.2 }), 'stored', null, 7)]);
    const loc = mount(viewOf(s, 5)).querySelector('.bs-fragment-location')!;
    expect(loc.textContent).toContain('Stored in');
    expect(loc.querySelector<HTMLElement>('[data-select-kind="building"]')!.dataset['selectId']).toBe('7');
  });

  it('changes signature with state, vehicle and warehouse', () => {
    const f = frag(5, 1000, { goldite: 0.2 });
    const sig = (tf: TrackedFragment) => viewOf(makeState([tf]), 5).signature;
    const ground = sig(tracked(f, 'on_ground'));
    const transit = sig(tracked(f, 'in_transit', '3', 7));
    const otherVehicle = sig(tracked(f, 'in_transit', '4', 7));
    const otherWh = sig(tracked(f, 'in_transit', '3', 8));
    const stored = sig(tracked(f, 'stored', null, 7));
    expect(new Set([ground, transit, otherVehicle, otherWh, stored]).size).toBe(5);
  });

  it('titles with the fragment id and sync does not throw', () => {
    const view = viewOf(makeState([tracked(frag(5, 1000, { goldite: 0.2 }), 'on_ground')]), 5);
    expect(view.title).toBe(t('shell.hovertag.fragment', { id: 5 }));
    expect(() => view.sync(mount(view))).not.toThrow();
  });
});
