// @vitest-environment jsdom
// FireStep zone rows follow vehicleEvacuationVerdict (#2100): a driverless
// vehicle is STRANDED only when nobody can move it; otherwise it is tagged as
// one a driver will fetch, and the pre-flight stranded count follows suit.
import { describe, it, expect, beforeEach } from 'vitest';
import { FireStep } from '../../../../../src/ui/panels/blastSteps/Fire.js';
import { t } from '../../../../../src/core/i18n/I18n.js';
import { createGame, type GameState } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { NavGrid } from '../../../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../../../src/core/world/VoxelGrid.js';
import { hireEmployee, assignSkill } from '../../../../../src/core/entities/Employee.js';
import { purchaseVehicle, type Vehicle } from '../../../../../src/core/entities/Vehicle.js';
import { Random } from '../../../../../src/core/math/Random.js';

const holeCounter = { nextHoleId: 1 };
const GRID_SIZE = 90;

const TAG_IN_ZONE = 'ui.blast_workshop.fire.tag_in_zone';
const TAG_STRANDED = 'ui.blast_workshop.fire.tag_stranded';
const TAG_FETCHED = 'ui.blast_workshop.fire.tag_fetched';

function walkableGrid(size: number): NavGrid {
  const vg = new VoxelGrid(size, size);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      vg.setVoxel(x, 0, z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }
  }
  return NavGrid.buildNavGrid(vg, [], []);
}

/** A game with a one-hole plan at (20,20) and a walkable map, so a safe destination exists. */
function makeState(withNavGrid = true): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
  state.navGrid = withNavGrid ? walkableGrid(GRID_SIZE) : null;
  return state;
}

function makeStep(): FireStep {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new FireStep(container);
}

/** Text of the zone-list row for `vehicle` (the smallest element holding its "#id" sub-label and a tag). */
function vehicleRow(step: FireStep, vehicle: Vehicle): string {
  const marker = `#${vehicle.id}`;
  const candidates = Array.from(step.root.querySelectorAll<HTMLElement>('div'))
    .filter(d => (d.textContent ?? '').includes(marker) && /ZONE|STRANDED/.test(d.textContent ?? ''));
  expect(candidates.length).toBeGreaterThan(0);
  candidates.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length);
  return candidates[0]!.textContent ?? '';
}

function addDriverlessDigger(state: GameState, x = 22, z = 22): Vehicle {
  const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', x, z);
  vehicle.occupantIds = [];
  return vehicle;
}

function addLicensedEmployee(state: GameState, x: number, z: number) {
  const { employee } = hireEmployee(state.employees, 'driller', new Random(7), x, z);
  assignSkill(state.employees, employee.id, 'driving.excavator', 1);
  return employee;
}

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('FireStep vehicle row tags follow the evacuation verdict (C6)', () => {
  it('driver_aboard keeps the plain in-zone tag', () => {
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    const driver = addLicensedEmployee(state, 22, 22);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const step = makeStep();

    step.update(state, 'sunny');

    const row = vehicleRow(step, vehicle);
    expect(row).toContain(t(TAG_IN_ZONE));
    expect(row).not.toContain(t(TAG_STRANDED));
    expect(row).not.toContain(t(TAG_FETCHED));
  });

  it('will_be_fetched (free licensed driver outside the zone) shows the fetched tag, not the stranded one', () => {
    const state = makeState();
    const vehicle = addDriverlessDigger(state);
    addLicensedEmployee(state, 70, 70);
    const step = makeStep();

    step.update(state, 'sunny');

    const row = vehicleRow(step, vehicle);
    expect(row).toContain(t(TAG_FETCHED));
    expect(row).not.toContain(t(TAG_STRANDED));
  });

  it('will_be_fetched (licensed driver standing in the zone) shows the fetched tag', () => {
    const state = makeState();
    const vehicle = addDriverlessDigger(state);
    addLicensedEmployee(state, 24, 24);
    const step = makeStep();

    step.update(state, 'sunny');

    const row = vehicleRow(step, vehicle);
    expect(row).toContain(t(TAG_FETCHED));
    expect(row).not.toContain(t(TAG_STRANDED));
  });

  it('will_be_fetched (licensed driver resting outside) shows the fetched tag', () => {
    const state = makeState();
    const vehicle = addDriverlessDigger(state);
    addLicensedEmployee(state, 70, 70).restTicksRemaining = 30;
    const step = makeStep();

    step.update(state, 'sunny');

    const row = vehicleRow(step, vehicle);
    expect(row).toContain(t(TAG_FETCHED));
    expect(row).not.toContain(t(TAG_STRANDED));
  });

  it('stranded (nobody licensed anywhere) shows the stranded tag', () => {
    const state = makeState();
    const vehicle = addDriverlessDigger(state);
    hireEmployee(state.employees, 'driller', new Random(7), 70, 70); // unlicensed for the excavator
    const step = makeStep();

    step.update(state, 'sunny');

    const row = vehicleRow(step, vehicle);
    expect(row).toContain(t(TAG_STRANDED));
    expect(row).not.toContain(t(TAG_FETCHED));
  });

  it('stranded when a licensed driver exists but the map has no navGrid to reach it', () => {
    const state = makeState(false);
    const vehicle = addDriverlessDigger(state);
    addLicensedEmployee(state, 70, 70);
    const step = makeStep();

    step.update(state, 'sunny');

    const row = vehicleRow(step, vehicle);
    expect(row).toContain(t(TAG_STRANDED));
    expect(row).not.toContain(t(TAG_FETCHED));
  });

  it('tags each vehicle by its own verdict in one zone', () => {
    const state = makeState();
    const fetched = addDriverlessDigger(state, 22, 22);
    const stranded = purchaseVehicle(state.vehicles, 'debris_hauler', 25, 25).vehicle; // no hauler licence held by anyone
    stranded.occupantIds = [];
    addLicensedEmployee(state, 70, 70);
    const step = makeStep();

    step.update(state, 'sunny');

    expect(vehicleRow(step, fetched)).toContain(t(TAG_FETCHED));
    expect(vehicleRow(step, stranded)).toContain(t(TAG_STRANDED));
  });
});

describe('FireStep pre-flight stranded count follows the verdict (C6)', () => {
  it('a zone holding only a will_be_fetched vehicle uses the plain occupied message', () => {
    const state = makeState();
    addDriverlessDigger(state);
    addLicensedEmployee(state, 70, 70);
    const step = makeStep();

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_zone_occupied', { count: 1 }));
    expect(step.root.textContent).not.toContain('stranded with no driver');
  });

  it('a zone holding only a stranded vehicle reports it in the stranded message', () => {
    const state = makeState();
    addDriverlessDigger(state);
    const step = makeStep();

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_zone_occupied_stranded', { count: 1, strandedCount: 1 }));
  });

  it('counts only the stranded verdicts when fetched and stranded vehicles share the zone', () => {
    const state = makeState();
    addDriverlessDigger(state, 22, 22);
    const orphan = purchaseVehicle(state.vehicles, 'debris_hauler', 25, 25).vehicle;
    orphan.occupantIds = [];
    addLicensedEmployee(state, 70, 70);
    const step = makeStep();

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_zone_occupied_stranded', { count: 2, strandedCount: 1 }));
  });

  it('a driven vehicle with a safe destination adds no stranded count', () => {
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    const driver = addLicensedEmployee(state, 70, 70);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const step = makeStep();

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_zone_occupied', { count: 1 }));
    expect(step.root.textContent).not.toContain('stranded with no driver');
  });
});
