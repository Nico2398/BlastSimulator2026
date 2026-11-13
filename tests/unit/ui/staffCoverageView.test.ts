// @vitest-environment jsdom
// Staff coverage tiles (#2242): have vs need for every qualification the site depends on.
import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { coverageHave, coverageNeed, staffCoverageSection, syncStaffCoverage, coverageSignature } from '../../../src/ui/staffCoverageView.js';
import { staffCoverage } from '../../../src/core/entities/StaffCoverage.js';

function stateWithFleet(): GameState {
  setLocale('en');
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = 10_000_000;
  purchaseVehicle(s.vehicles, 'debris_hauler', 0, 0, 1);
  purchaseVehicle(s.vehicles, 'debris_hauler', 1, 0, 1);
  purchaseVehicle(s.vehicles, 'drill_rig', 2, 0, 1);
  return s;
}

describe('staffCoverageSection', () => {
  it('is absent when nothing needs a qualification', () => {
    setLocale('en');
    expect(staffCoverageSection(createGame({ seed: 42, mineType: 'desert' }))).toBeNull();
  });

  it('draws one tile per licence the fleet needs, its status on the tile', () => {
    const s = stateWithFleet();
    const section = staffCoverageSection(s)!;
    const tiles = Array.from(section.querySelectorAll<HTMLElement>('[data-coverage-skill]'));
    expect(tiles.map(x => x.dataset['coverageSkill']).sort()).toEqual(['driving.drill_rig', 'driving.truck']);
    for (const tile of tiles) expect(tile.dataset['status']).toBe('missing');
    expect(section.textContent).toContain(t('skill.driving.truck'));
    expect(section.textContent).toContain(t('ui.coverage.gaps', { count: 2 }));
  });

  it('a hired driller with a drill rig licence covers the rig', () => {
    const s = stateWithFleet();
    hireEmployee(s.employees, 'driller', new Random(1), 0, 0, 0);
    const rig = staffCoverageSection(s)!.querySelector<HTMLElement>('[data-coverage-skill="driving.drill_rig"]')!;
    expect(rig.dataset['status']).toBe('ok');
  });

  it('needs a driver per vehicle, and one hand for orders alone', () => {
    const [truck] = staffCoverage([{ type: 'debris_hauler', tier: 1 }, { type: 'debris_hauler', tier: 1 }], [], []);
    expect(coverageNeed(truck!)).toBe(2);
    expect(coverageHave(truck!)).toBe(0);
    const [geo] = staffCoverage([], [], [{ requiredSkill: 'geology', status: 'queued', holderId: null }]);
    expect(coverageNeed(geo!)).toBe(1);
  });
});

describe('syncStaffCoverage', () => {
  it('swaps the section in place when a figure moves, and leaves it alone otherwise', () => {
    const s = stateWithFleet();
    const body = document.createElement('div');
    const kpis = document.createElement('div');
    kpis.className = 'bs-crew-kpis';
    body.append(kpis, staffCoverageSection(s)!, document.createElement('section'));
    const before = body.querySelector('.bs-staff-coverage');
    let sig = syncStaffCoverage(body, s, coverageSignature(s));
    expect(body.querySelector('.bs-staff-coverage')).toBe(before);
    hireEmployee(s.employees, 'driller', new Random(1), 0, 0, 0);
    sig = syncStaffCoverage(body, s, sig);
    expect(body.querySelector('.bs-staff-coverage')).not.toBe(before);
    expect(body.children[1]!.classList.contains('bs-staff-coverage')).toBe(true);
    expect(sig).toBe(coverageSignature(s));
  });
});
