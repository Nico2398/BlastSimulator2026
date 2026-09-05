// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FireStep } from '../../../../../src/ui/panels/blastSteps/Fire.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../../src/core/mining/DrillPlan.js';
import { purchaseVehicle } from '../../../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../../../src/core/entities/Employee.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeStep(): { step: FireStep; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new FireStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, container, gameConsole };
}

function addEmployee(state: GameState, x: number, z: number): Employee {
  const emp: Employee = {
    id: state.employees.nextId++, name: 'Walt Diggins', role: 'driller', salary: 500,
    morale: 60, unionized: false, injured: false, alive: true, x, z,
    qualifications: [], trainingState: null, activeActionId: null,
    fatigue: 0, collapsing: false, interruptedActionPayload: null,
    ticksWorked: 0, restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null, pendingTaskDuration: null,
    pendingActionType: null, pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [],
  };
  state.employees.employees.push(emp);
  return emp;
}

beforeEach(() => resetHoleIds());

describe('FireStep', () => {
  it('shows the no-plan empty state and disables Sound the Horn when there are no holes', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    expect(step.root.textContent).toContain('Drill a plan first');
    const hornBtn = step.root.querySelector('[data-action="sound-horn"]') as HTMLButtonElement;
    expect(hornBtn.disabled).toBe(true);
  });

  it('shows the danger zone as clear when a plan exists but nobody is nearby', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('Danger zone is clear');
    const hornBtn = step.root.querySelector('[data-action="sound-horn"]') as HTMLButtonElement;
    expect(hornBtn.disabled).toBe(true);
  });

  it('lists an employee standing inside the computed danger zone, tagged IN ZONE', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    addEmployee(state, 22, 22); // well within the 15m-padded box around (20,20)
    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('Walt Diggins');
    expect(step.root.textContent).toContain('IN ZONE');
    const hornBtn = step.root.querySelector('[data-action="sound-horn"]') as HTMLButtonElement;
    expect(hornBtn.disabled).toBe(false);
  });

  it('does not list a dead employee, even if their last position was inside the zone', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    const emp = addEmployee(state, 22, 22);
    emp.alive = false;
    step.update(state, 'sunny');

    expect(step.root.textContent).not.toContain('Walt Diggins');
  });

  it('lists a driver-equipped vehicle inside the zone, tagged IN ZONE', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 21, 21);
    vehicle.driverId = 1; // driver aboard — not stranded

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('IN ZONE');
  });

  it('shows the distinct stranded tag for a driverless vehicle, while a driver-equipped one still shows IN ZONE (#947)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    const { vehicle: driven } = purchaseVehicle(state.vehicles, 'debris_hauler', 21, 21);
    driven.driverId = 1;
    const { vehicle: driverless } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    driverless.driverId = null;

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('IN ZONE');
    expect(step.root.textContent).toContain('STRANDED - NO DRIVER'); // ui.blast_workshop.fire.tag_stranded
  });

  it('checklist shows the stranded-count message when the zone holds only a driverless vehicle (#947)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    vehicle.driverId = null;

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('stranded with no driver');
  });

  it('checklist shows the stranded-count message for a mix of an employee and a driverless vehicle (#947)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    addEmployee(state, 22, 22);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 23, 23);
    vehicle.driverId = null;

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('stranded with no driver');
  });

  it('keeps Sound the Horn clickable when the only occupant is a stranded driverless vehicle (#947)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    vehicle.driverId = null;

    step.update(state, 'sunny');

    const hornBtn = step.root.querySelector('[data-action="sound-horn"]') as HTMLButtonElement;
    expect(hornBtn.disabled).toBe(false);
  });

  it('does not list an employee standing outside the padded box', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    addEmployee(state, 100, 100); // far outside the 15m margin
    step.update(state, 'sunny');

    expect(step.root.textContent).not.toContain('Walt Diggins');
    expect(step.root.textContent).toContain('Danger zone is clear');
  });

  it('Sound the Horn dispatches zone clear with the real computed bounds', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    addEmployee(state, 22, 22);
    step.update(state, 'sunny');

    (step.root.querySelector('[data-action="sound-horn"]') as HTMLButtonElement).click();

    // Single hole at (20,20), 15m margin → box (5,5)-(35,35)
    expect(gameConsole).toHaveBeenCalledWith('zone clear x1:5 y1:5 x2:35 y2:35');
  });

  it('Sound the Horn is a no-op (no dispatch) when there is no plan', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState(), 'sunny');

    (step.root.querySelector('[data-action="sound-horn"]') as HTMLButtonElement).click();

    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('pre-flight checklist warns about wet holes while raining, and clears once dry', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);

    step.update(state, 'heavy_rain');
    expect(step.root.textContent).toContain('holes are full of water');

    step.update(state, 'sunny');
    expect(step.root.textContent).toContain('dry or tubed');
  });

  it('treats missing weather as dry (no crash)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);

    expect(() => step.update(state, undefined)).not.toThrow();
    expect(step.root.textContent).toContain('dry or tubed');
  });

  it('dispose() removes the step from the DOM', () => {
    const { step, container } = makeStep();
    step.dispose();
    expect(container.contains(step.root)).toBe(false);
  });

  it('refreshLocale() does not throw and keeps rendering', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    step.update(state, 'sunny');
    expect(() => step.refreshLocale()).not.toThrow();
    step.update(state, 'sunny');
    expect(step.root.textContent).toContain('Danger zone is clear');
  });
});

// ── Scroll-bounded zone occupant list (#958) ─────────────────────────────────
//
// zoneListEl (one row per employee/vehicle in the blast danger zone,
// unbounded) is a plain flex column today with no overflow/max-height at
// all — a fully staffed roster+fleet caught in the zone buries Sound the
// Horn and the pre-flight checklist below the panel's fold. The fix bounds
// it to a scrollBoundedSection wrapper, leaving both a reachable sibling
// after it.

/** The bounded wrapper holding zone occupant rows: inline overflow-y:auto + numeric max-height, containing the IN ZONE tag. */
function findZoneListWrapper(root: HTMLElement): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('div')).find(d =>
    d.style.overflowY === 'auto'
    && /^\d+px$/.test(d.style.maxHeight)
    && (d.textContent ?? '').includes('IN ZONE'),
  );
}

describe('FireStep — scroll-bounded zone occupant list (#958)', () => {
  it('bounds the zone occupant list to a wrapper with inline overflow-y:auto and a numeric max-height, holding every occupant', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    for (let i = 0; i < 20; i++) addEmployee(state, 21, 21);
    for (let i = 0; i < 20; i++) purchaseVehicle(state.vehicles, 'debris_hauler', 22, 22);
    step.update(state, 'sunny');

    const wrapper = findZoneListWrapper(step.root);
    expect(wrapper).not.toBeUndefined();
    expect(wrapper!.children.length).toBe(40);
  });

  it('keeps Sound the Horn and the pre-flight checklist reachable as siblings, outside the bounded wrapper', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 20, 20, 8, 0.15);
    for (let i = 0; i < 20; i++) addEmployee(state, 21, 21);
    for (let i = 0; i < 20; i++) purchaseVehicle(state.vehicles, 'debris_hauler', 22, 22);
    step.update(state, 'sunny');

    const wrapper = findZoneListWrapper(step.root)!;
    expect(wrapper).not.toBeUndefined();

    const hornBtn = step.root.querySelector('[data-action="sound-horn"]');
    expect(hornBtn).not.toBeNull();
    expect(wrapper.contains(hornBtn)).toBe(false);
    expect(hornBtn instanceof HTMLButtonElement && hornBtn.disabled).toBe(false);

    expect(step.root.textContent).toContain('Pre-Flight');
  });
});
