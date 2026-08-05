// BlastSimulator2026 — FleetPanel Break button tests (issue #484)
// The only UI control that can trigger `vehicle break` — without it, an
// oversized boulder a debris_hauler refused can never be broken up except
// via the console. Split from FleetPanel.test.ts to keep both files under
// the ~300-line convention, mirroring FleetPanel.test.ts's own Haul-button
// coverage. Ported from VehiclePanel.break.test.ts onto FleetPanel — the P6
// redesign's replacement for VehiclePanel.ts — when the two merged (#484):
// same fixtures and cases, targeting FleetPanel's actual DOM/class structure.

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { FleetPanel } from '../../../../src/ui/panels/FleetPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { addBlastFragments } from '../../../../src/core/economy/Logistics.js';
import { NavGrid } from '../../../../src/core/nav/NavGrid.js';
import type { FragmentData } from '../../../../src/core/mining/BlastExecution.js';
import type { CommandResult } from '../../../../src/console/ConsoleRunner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeState(cash = 200_000): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = cash;
  return s;
}

function setupPanel(): { panel: FleetPanel } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new FleetPanel(container);
  return { panel };
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

describe('FleetPanel — Break button (#484)', () => {
  it('renders the Break button for a rock_fragmenter with a driver and a reachable oversized fragment', () => {
    const { panel } = setupPanel();
    const { state } = makeDrivenFragmenterState();
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 3, 3)]);

    panel.update(state);

    expect(panel.root.querySelector('.bs-vehicle-break-btn')).not.toBeNull();
  });

  it('does not render the Break button when no reachable oversized fragment exists', () => {
    const { panel } = setupPanel();
    const { state } = makeDrivenFragmenterState();
    // No fragments at all — nothing to break.

    panel.update(state);

    expect(panel.root.querySelector('.bs-vehicle-break-btn')).toBeNull();
  });

  it('does not render the Break button when the vehicle is already breaking (breakPhase !== null)', () => {
    const { panel } = setupPanel();
    const { state, vehicleId } = makeDrivenFragmenterState();
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 3, 3)]);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    vehicle.breakPhase = 'to_boulder';

    panel.update(state);

    expect(panel.root.querySelector('.bs-vehicle-break-btn')).toBeNull();
  });

  it('does not render the Break button when the vehicle has no driver', () => {
    const { panel } = setupPanel();
    const state = makeState();
    state.navGrid = makeFlatNavGrid(20);
    purchaseVehicle(state.vehicles, 'rock_fragmenter', 0, 0);
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 3, 3)]);

    panel.update(state);

    expect(panel.root.querySelector('.bs-vehicle-break-btn')).toBeNull();
  });

  it('clicking the Break button dispatches "vehicle break <vehicleId> fragment:<resolvedFragmentId>"', () => {
    const { panel } = setupPanel();
    const { state, vehicleId } = makeDrivenFragmenterState();
    addBlastFragments(state.logistics, [makeOversizedFragment(9, 3, 3)]);
    panel.update(state);

    const commands: string[] = [];
    panel.setGameConsole((cmd: string): CommandResult => {
      commands.push(cmd);
      return { success: true, output: '' };
    });

    const btn = panel.root.querySelector('.bs-vehicle-break-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();

    // Mirrors the Haul button's dispatch mechanism: a direct gameConsole(cmd)
    // call, not a DOM CustomEvent.
    expect(commands).toContain(`vehicle break ${vehicleId} fragment:9`);
  });
});
