// BlastSimulator2026 — VehiclePanel unit tests (issue #411)
// Covers: localized tier-specific vehicle names (t(def.nameKey), not raw role
// ids) and the per-tier buy button selector (Tier 1/2/3, each individually
// affordability-gated). Mirrors the jsdom harness used by EmployeePanel.test.ts.

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { VehiclePanel } from '../../../src/ui/VehiclePanel.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, getVehicleDefByTier, getAllVehicleRoles } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { t } from '../../../src/core/i18n/I18n.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeState(cash = 200_000): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = cash;
  return s;
}

function setupPanel(): { container: HTMLDivElement; panel: VehiclePanel } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new VehiclePanel(container);
  return { container, panel };
}

const SEED = 42;

// Default volume sits under OVERSIZED_FRAGMENT_THRESHOLD (0.5 m³, see
// BoulderFragmentation.ts) so these haul-button fixtures stay haulable and
// eligible for findReachableGroundFragment (#484 excludes oversized ones).
function makeFragment(id: number, x: number, z: number, mass = 1000): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
  };
}

/** A flat, fully walkable size×size NavGrid — GameState.navGrid is null until
 *  a world is built via `new_game`, so the panel's own tests build one directly. */
function makeFlatNavGrid(size: number): NavGrid {
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'walkable' as const, moveCost: 1.0, benchLevel: 0, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
}

/** A debris_hauler with a licensed driver boarded, on a flat NavGrid. */
function makeDrivenHaulerState(): { state: GameState; vehicleId: number } {
  const state = makeState();
  state.navGrid = makeFlatNavGrid(20);
  const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng);
  assignSkill(state.employees, employee.id, 'driving.truck', 1);
  vehicle.driverId = employee.id;
  return { state, vehicleId: vehicle.id };
}

/** A rock_fragmenter with a licensed driver boarded, on a flat NavGrid. */
function makeDrivenFragmenterState(): { state: GameState; vehicleId: number } {
  const state = makeState();
  state.navGrid = makeFlatNavGrid(20);
  const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', 0, 0);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng);
  assignSkill(state.employees, employee.id, 'driving.excavator', 1);
  vehicle.driverId = employee.id;
  return { state, vehicleId: vehicle.id };
}

// Oversized boulder — volume must exceed OVERSIZED_FRAGMENT_THRESHOLD (0.5 m³,
// see BoulderFragmentation.ts) so it is eligible for
// findReachableOversizedFragment (#484's break-eligibility gate).
function makeOversizedFragment(id: number, x: number, z: number, mass = 5000): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 1.0,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
  };
}

// ── Buy section — per-tier buttons ──────────────────────────────────────────

describe('VehiclePanel — tier buy buttons (#411)', () => {
  it('renders 3 tier buttons (1, 2, 3) for every vehicle role', () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    for (const role of getAllVehicleRoles()) {
      const buttons = container.querySelectorAll(`[data-vtype="${role}"][data-tier]`);
      expect(buttons.length, `role ${role} should have 3 tier buttons`).toBe(3);
      const tiers = Array.from(buttons)
        .map(b => (b as HTMLElement).dataset['tier'])
        .sort();
      expect(tiers).toEqual(['1', '2', '3']);
    }
  });

  it("tier-2 button label includes the localized tier-2 name (t(def.nameKey))", () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    const btn2 = container.querySelector('[data-vtype="debris_hauler"][data-tier="2"]') as HTMLElement | null;
    expect(btn2).not.toBeNull();
    expect(btn2!.textContent).toContain(t('vehicle.debris_hauler.tier2'));
  });

  it('tier-3 button label includes that tier\'s cost, not the tier-1 cost', () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    const tier1Cost = getVehicleDefByTier('debris_hauler', 1).purchaseCost;
    const tier3Cost = getVehicleDefByTier('debris_hauler', 3).purchaseCost;
    expect(tier3Cost).not.toBe(tier1Cost);

    const btn3 = container.querySelector('[data-vtype="debris_hauler"][data-tier="3"]') as HTMLElement;
    expect(btn3.textContent).toContain(String(tier3Cost));
  });

  it('clicking a tier button dispatches "vehicle buy <role> tier:<n>"', () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    const commands: string[] = [];
    panel.setGameConsole((cmd: string): CommandResult => {
      commands.push(cmd);
      return { success: true, output: '' };
    });

    const btn = container.querySelector('[data-vtype="drill_rig"][data-tier="2"]') as HTMLButtonElement;
    btn.click();

    expect(commands).toContain('vehicle buy drill_rig tier:2');
  });

  it('clicking the tier-1 button dispatches tier:1 explicitly', () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    const commands: string[] = [];
    panel.setGameConsole((cmd: string): CommandResult => {
      commands.push(cmd);
      return { success: true, output: '' };
    });

    const btn = container.querySelector('[data-vtype="rock_digger"][data-tier="1"]') as HTMLButtonElement;
    btn.click();

    expect(commands).toContain('vehicle buy rock_digger tier:1');
  });

  it('disables only the tier buttons whose cost exceeds current cash', () => {
    const { container, panel } = setupPanel();
    const tier1Cost = getVehicleDefByTier('debris_hauler', 1).purchaseCost;
    const tier2Cost = getVehicleDefByTier('debris_hauler', 2).purchaseCost;
    expect(tier2Cost).toBeGreaterThan(tier1Cost); // sanity: tiers strictly cost more

    panel.update(makeState(tier1Cost)); // exactly enough for tier 1, not tier 2/3

    const btn1 = container.querySelector('[data-vtype="debris_hauler"][data-tier="1"]') as HTMLButtonElement;
    const btn2 = container.querySelector('[data-vtype="debris_hauler"][data-tier="2"]') as HTMLButtonElement;
    const btn3 = container.querySelector('[data-vtype="debris_hauler"][data-tier="3"]') as HTMLButtonElement;

    expect(btn1.disabled).toBe(false);
    expect(btn2.disabled).toBe(true);
    expect(btn3.disabled).toBe(true);
  });

  it('re-enables a tier button once a later update() reflects enough cash', () => {
    const { container, panel } = setupPanel();
    const tier2Cost = getVehicleDefByTier('debris_hauler', 2).purchaseCost;

    panel.update(makeState(0));
    let btn2 = container.querySelector('[data-vtype="debris_hauler"][data-tier="2"]') as HTMLButtonElement;
    expect(btn2.disabled).toBe(true);

    panel.update(makeState(tier2Cost));
    btn2 = container.querySelector('[data-vtype="debris_hauler"][data-tier="2"]') as HTMLButtonElement;
    expect(btn2.disabled).toBe(false);
  });
});

// ── Owned vehicle rows — localized display name ─────────────────────────────

describe('VehiclePanel — owned vehicle rows show localized tier name (#411)', () => {
  it("shows t(getVehicleDefByTier(v.type, v.tier).nameKey) for a tier-2 vehicle", () => {
    const { container, panel } = setupPanel();
    const state = makeState();
    purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5, 2);

    panel.update(state);

    const row = container.querySelector('.bs-vehicle-row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain(t('vehicle.debris_hauler.tier2'));
  });

  it("shows t(getVehicleDefByTier(v.type, v.tier).nameKey) for a tier-3 vehicle, not the raw role id", () => {
    const { container, panel } = setupPanel();
    const state = makeState();
    purchaseVehicle(state.vehicles, 'rock_digger', 0, 0, 3);

    panel.update(state);

    const row = container.querySelector('.bs-vehicle-row') as HTMLElement;
    expect(row.textContent).toContain(t('vehicle.rock_digger.tier3'));
  });

  it('reflects each vehicle\'s own tier when multiple vehicles of the same role are owned', () => {
    const { container, panel } = setupPanel();
    const state = makeState();
    purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0, 1);
    purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2, 3);

    panel.update(state);

    const rows = container.querySelectorAll('.bs-vehicle-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(t('vehicle.debris_hauler.tier1'));
    expect(rows[1]!.textContent).toContain(t('vehicle.debris_hauler.tier3'));
  });
});

// ── Haul button (#466) ───────────────────────────────────────────────────────
// The only UI control that can trigger `vehicle haul` — without it, a player
// can never complete the tutorial's "Deliver Contract" step (issue #466).

describe('VehiclePanel — Haul button (#466)', () => {
  it('renders the Haul button for a debris_hauler with a driver and a reachable on-ground fragment', () => {
    const { container, panel } = setupPanel();
    const { state } = makeDrivenHaulerState();
    addBlastFragments(state.logistics, [makeFragment(1, 3, 3)]);

    panel.update(state);

    expect(container.querySelector('.bs-vehicle-haul-btn')).not.toBeNull();
  });

  it('does not render the Haul button when no reachable on-ground fragment exists', () => {
    const { container, panel } = setupPanel();
    const { state } = makeDrivenHaulerState();
    // No fragments at all — nothing to haul.

    panel.update(state);

    expect(container.querySelector('.bs-vehicle-haul-btn')).toBeNull();
  });

  it('does not render the Haul button when the vehicle is already hauling (haulingPhase !== null)', () => {
    const { container, panel } = setupPanel();
    const { state, vehicleId } = makeDrivenHaulerState();
    addBlastFragments(state.logistics, [makeFragment(1, 3, 3)]);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    vehicle.haulingPhase = 'to_fragment';

    panel.update(state);

    expect(container.querySelector('.bs-vehicle-haul-btn')).toBeNull();
  });

  it('does not render the Haul button when the vehicle has no driver', () => {
    const { container, panel } = setupPanel();
    const state = makeState();
    state.navGrid = makeFlatNavGrid(20);
    purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 3, 3)]);

    panel.update(state);

    expect(container.querySelector('.bs-vehicle-haul-btn')).toBeNull();
  });

  it('clicking the Haul button dispatches "vehicle haul <vehicleId> fragment:<resolvedFragmentId>"', () => {
    const { container, panel } = setupPanel();
    const { state, vehicleId } = makeDrivenHaulerState();
    addBlastFragments(state.logistics, [makeFragment(7, 3, 3)]);
    panel.update(state);

    const commands: string[] = [];
    panel.setGameConsole((cmd: string): CommandResult => {
      commands.push(cmd);
      return { success: true, output: '' };
    });

    const btn = container.querySelector('.bs-vehicle-haul-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();

    // Mirrors the driver-assign button's dispatch mechanism: a direct
    // gameConsole(cmd) call, not a DOM CustomEvent.
    expect(commands).toContain(`vehicle haul ${vehicleId} fragment:7`);
  });
});

// ── Break button (#484) ──────────────────────────────────────────────────────
// The only UI control that can trigger `vehicle break` — without it, an
// oversized boulder a debris_hauler refused can never be broken up except
// via the console (issue #484).

describe('VehiclePanel — Break button (#484)', () => {
  it('renders the Break button for a rock_fragmenter with a driver and a reachable oversized fragment', () => {
    const { container, panel } = setupPanel();
    const { state } = makeDrivenFragmenterState();
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 3, 3)]);

    panel.update(state);

    expect(container.querySelector('.bs-vehicle-break-btn')).not.toBeNull();
  });

  it('does not render the Break button when no reachable oversized fragment exists', () => {
    const { container, panel } = setupPanel();
    const { state } = makeDrivenFragmenterState();
    // No fragments at all — nothing to break.

    panel.update(state);

    expect(container.querySelector('.bs-vehicle-break-btn')).toBeNull();
  });

  it('does not render the Break button when the vehicle is already breaking (breakPhase !== null)', () => {
    const { container, panel } = setupPanel();
    const { state, vehicleId } = makeDrivenFragmenterState();
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 3, 3)]);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    vehicle.breakPhase = 'to_boulder';

    panel.update(state);

    expect(container.querySelector('.bs-vehicle-break-btn')).toBeNull();
  });

  it('does not render the Break button when the vehicle has no driver', () => {
    const { container, panel } = setupPanel();
    const state = makeState();
    state.navGrid = makeFlatNavGrid(20);
    purchaseVehicle(state.vehicles, 'rock_fragmenter', 0, 0);
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 3, 3)]);

    panel.update(state);

    expect(container.querySelector('.bs-vehicle-break-btn')).toBeNull();
  });

  it('clicking the Break button dispatches "vehicle break <vehicleId> fragment:<resolvedFragmentId>"', () => {
    const { container, panel } = setupPanel();
    const { state, vehicleId } = makeDrivenFragmenterState();
    addBlastFragments(state.logistics, [makeOversizedFragment(9, 3, 3)]);
    panel.update(state);

    const commands: string[] = [];
    panel.setGameConsole((cmd: string): CommandResult => {
      commands.push(cmd);
      return { success: true, output: '' };
    });

    const btn = container.querySelector('.bs-vehicle-break-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();

    // Mirrors the Haul button's dispatch mechanism: a direct gameConsole(cmd)
    // call, not a DOM CustomEvent.
    expect(commands).toContain(`vehicle break ${vehicleId} fragment:9`);
  });
});
