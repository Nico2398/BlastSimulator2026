// BlastSimulator2026 — VehiclePanel Break button tests (issue #484)
// The only UI control that can trigger `vehicle break` — without it, an
// oversized boulder a debris_hauler refused can never be broken up except
// via the console. Split from VehiclePanel.test.ts to keep both files under
// the ~300-line convention; mirrors VehiclePanel.test.ts's Haul button (#466)
// block for the break workflow instead of the haul one.

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { VehiclePanel } from '../../../src/ui/VehiclePanel.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
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

/** A flat, fully walkable size×size NavGrid — GameState.navGrid is null until
 *  a world is built via `new_game`, so the panel's own tests build one directly. */
function makeFlatNavGrid(size: number): NavGrid {
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'walkable' as const, moveCost: 1.0, benchLevel: 0, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
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

// ── Break button (#484) ──────────────────────────────────────────────────────

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
