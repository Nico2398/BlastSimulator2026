// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { FireStep } from '../../../../../src/ui/panels/blastSteps/Fire.js';
import { wetAllHoles } from '../../../../helpers/holeWater.js';
import { readFileSync } from 'node:fs';
import { t, setLocale } from '../../../../../src/core/i18n/I18n.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../../src/core/mining/ChargePlan.js';
import { addReachBuildings, addReachPattern } from '../../../../helpers/blastReachFixture.js';
import { createGradeState } from '../../../../../src/core/economy/MineGrade.js';
import { permitPreview } from '../../../../../src/ui/panels/permitPreview.js';
import { purchaseVehicle } from '../../../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../../../src/core/world/VoxelGrid.js';
import type { Employee } from '../../../../../src/core/entities/Employee.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';

const holeCounter = { nextHoleId: 1 };

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

/** A flat, fully walkable NavGrid so evacuation has a safe destination for a driven vehicle. */
function withNavGrid(state: GameState, size = 80): void {
  const vg = new VoxelGrid(size, size);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      vg.setVoxel(x, 0, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
    }
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
}

function makeStep(): { step: FireStep; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new FireStep(container);
  return { step, container };
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
    taskQueue: [], locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
  };
  state.employees.employees.push(emp);
  return emp;
}

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('FireStep', () => {
  it('shows the no-plan empty state when there are no holes', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    expect(step.root.textContent).toContain('Drill a plan first');
  });

  it('shows the danger zone as clear when a plan exists but nobody is nearby', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('Danger zone is clear');
  });

  it('lists an employee standing inside the computed danger zone, tagged IN ZONE', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    addEmployee(state, 22, 22); // well within the 15m-padded box around (20,20)
    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('Walt Diggins');
    expect(step.root.textContent).toContain('IN ZONE');
  });

  it('does not list a dead employee, even if their last position was inside the zone', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    const emp = addEmployee(state, 22, 22);
    emp.alive = false;
    step.update(state, 'sunny');

    expect(step.root.textContent).not.toContain('Walt Diggins');
  });

  it('lists a driver-equipped vehicle inside the zone, tagged IN ZONE', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 21, 21);
    vehicle.occupantIds = [1]; // driver aboard — not stranded
    withNavGrid(state);

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('IN ZONE');
  });

  it('shows the distinct stranded tag for a driverless vehicle, while a driver-equipped one still shows IN ZONE (#947)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    const { vehicle: driven } = purchaseVehicle(state.vehicles, 'debris_hauler', 21, 21);
    driven.occupantIds = [1];
    withNavGrid(state);
    const { vehicle: driverless } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    driverless.occupantIds = [];

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('IN ZONE');
    expect(step.root.textContent).toContain('STRANDED - NO DRIVER'); // ui.blast_workshop.fire.tag_stranded
  });

  it('checklist shows the stranded-count message when the zone holds only a driverless vehicle (#947)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    vehicle.occupantIds = [];

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('stranded with no driver');
  });

  it('checklist shows the stranded-count message for a mix of an employee and a driverless vehicle (#947)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    addEmployee(state, 22, 22);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 23, 23);
    vehicle.occupantIds = [];

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('stranded with no driver');
  });

    it('does not list an employee standing outside the padded box', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    addEmployee(state, 100, 100); // far outside the 15m margin
    step.update(state, 'sunny');

    expect(step.root.textContent).not.toContain('Walt Diggins');
    expect(step.root.textContent).toContain('Danger zone is clear');
  });

      it('pre-flight checklist warns about holes holding water, and clears once they are dry', () => {
    const { step } = makeStep();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    const charge = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in charge) state.chargesByHole[hole.id] = charge.charge;
    state.holeWater[hole.id] = { level: 0.8, porosity: 0.03 };

    wetAllHoles(state);
    step.update(state, 'heavy_rain');
    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_wet', { count: 1, percent: 10 }));

    state.holeWater = {};
    step.update(state, 'sunny');
    expect(step.root.textContent).toContain('dry or tubed');
  });

  it('treats missing weather as dry (no crash)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);

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
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
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
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    for (let i = 0; i < 20; i++) addEmployee(state, 21, 21);
    for (let i = 0; i < 20; i++) purchaseVehicle(state.vehicles, 'debris_hauler', 22, 22);
    step.update(state, 'sunny');

    const wrapper = findZoneListWrapper(step.root);
    expect(wrapper).not.toBeUndefined();
    expect(wrapper!.children.length).toBe(40);
  });

  it('keeps the pre-flight checklist reachable as a sibling, outside the bounded wrapper, with no Horn button (#1362)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    for (let i = 0; i < 20; i++) addEmployee(state, 21, 21);
    for (let i = 0; i < 20; i++) purchaseVehicle(state.vehicles, 'debris_hauler', 22, 22);
    step.update(state, 'sunny');

    const wrapper = findZoneListWrapper(step.root)!;
    expect(wrapper).not.toBeUndefined();

    expect(step.root.querySelector('[data-action="sound-horn"]')).toBeNull();

    expect(step.root.textContent).toContain('Pre-Flight');
  });
});

// ── #1362: DETONATE sounds the horn itself; the Fire step has no Horn button ─

describe('FireStep — no Horn button (#1362)', () => {
  it.each([
    ['no plan', (_s: GameState) => undefined],
    ['clear zone', (s: GameState) => { addHole(holeCounter, s.drillHoles, 20, 20, 8, 0.15); }],
    ['occupied zone', (s: GameState) => { addHole(holeCounter, s.drillHoles, 20, 20, 8, 0.15); addEmployee(s, 22, 22); }],
  ])('renders no sound-horn control with %s', (_label, setup) => {
    const { step } = makeStep();
    const state = makeState();
    setup(state);
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-action="sound-horn"]')).toBeNull();
  });

  it('en.json and fr.json no longer define the horn button and note keys', () => {
    for (const l of ['en', 'fr']) {
      const loc = JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8')) as Record<string, string>;
      expect(loc['ui.blast_workshop.fire.sound_horn']).toBeUndefined();
      expect(loc['ui.blast_workshop.fire.sound_horn_note']).toBeUndefined();
    }
  });
});

// #1925: "Within permit" checklist row, progression sites only; never blocks.
describe('FireStep — within-permit checklist (#1925)', () => {
  function permitState(holes: number, kgPerHole: number, progression = true): GameState {
    const state = makeState();
    if (progression) state.grade = createGradeState();
    for (let i = 0; i < holes; i++) {
      const hole = addHole(holeCounter, state.drillHoles, 20 + i * 3, 20, 8, 0.15);
      const r = createCharge('krackle', kgPerHole, 2, hole.depth);
      if ('charge' in r) state.chargesByHole[hole.id] = r.charge;
    }
    expect(Object.keys(state.chargesByHole)).toHaveLength(holes);
    return state;
  }
  const row = (s: FireStep) => s.root.querySelector('[data-role="permit-check"]') as HTMLElement | null;

  it('shows a Within permit row as ok within the limit', () => {
    const { step } = makeStep();
    step.update(permitState(9, 4), 'sunny');
    expect(row(step)).not.toBeNull();
    expect(row(step)!.dataset['ok']).toBe('true');
    expect(row(step)!.textContent).toContain('36 / 40 kg');
  });

  it('shows the row as a warning when over the limit', () => {
    const { step } = makeStep();
    step.update(permitState(9, 5), 'sunny');
    expect(row(step)).not.toBeNull();
    expect(row(step)!.dataset['ok']).toBe('false');
  });

  it('is absent on a non-progression site', () => {
    const { step } = makeStep();
    step.update(permitState(9, 5, false), 'sunny');
    expect(row(step)).toBeNull();
    expect(step.root.textContent).not.toContain('permit');
  });

  it('is absent without a plan', () => {
    const { step } = makeStep();
    const state = makeState();
    state.grade = createGradeState();
    step.update(state, 'sunny');
    expect(row(step)).toBeNull();
  });

  it('the over-limit row states the consequence (#2166)', () => {
    const { step } = makeStep();
    const state = permitState(9, 5);
    step.update(state, 'sunny');
    const p = permitPreview(state.grade, { holes: state.drillHoles, charges: state.chargesByHole }, state.tickCount)!;
    expect(p.consequenceText.length).toBeGreaterThan(0);
    expect(row(step)!.textContent).toBe(t('ui.blast_workshop.fire.check_permit_over', { kg: p.kgText, holes: p.holesText, consequence: p.consequenceText }));
    expect(row(step)!.textContent).toContain(p.consequenceText);
  });

  it('within the limit the row carries no consequence (#2166)', () => {
    const { step } = makeStep();
    const state = permitState(9, 4);
    step.update(state, 'sunny');
    expect(row(step)!.dataset['ok']).toBe('true');
    expect(row(step)!.textContent).toBe(t('ui.blast_workshop.fire.check_permit_ok', {
      kg: permitPreview(state.grade, { holes: state.drillHoles, charges: state.chargesByHole }, state.tickCount)!.kgText,
      holes: permitPreview(state.grade, { holes: state.drillHoles, charges: state.chargesByHole }, state.tickCount)!.holesText,
    }));
  });

  it('never renders the raw overshoot', () => {
    const { step } = makeStep();
    step.update(permitState(12, 5), 'sunny');
    expect(step.root.textContent!.toLowerCase()).not.toContain('overshoot');
  });

  it('en and fr define the over-permit row with kg, holes and the consequence', () => {
    for (const l of ['en', 'fr']) {
      const loc = JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8')) as Record<string, string>;
      const text = loc['ui.blast_workshop.fire.check_permit_over']!;
      for (const param of ['{kg}', '{holes}', '{consequence}']) expect(text).toContain(param);
    }
  });
});

// ── #2021: buildings inside the blast area are listed in the checklist ──────

describe('FireStep — buildings in blast reach (#2021)', () => {
  it('lists a row per building at risk', () => {
    const { step } = makeStep();
    const state = makeState();
    addReachPattern(state, holeCounter);
    addReachBuildings(state);
    step.update(state, 'sunny');
    const text = step.root.textContent ?? '';
    expect(text).toContain('Management Office is inside the blast area and will be destroyed.');
    expect(text).toContain('Freight Warehouse is inside the blast area and will be destroyed.');
    expect(text).toContain('Blasting Academy is inside the blast area and will be destroyed.');
    expect(text).not.toContain('Living Quarters is inside the blast area');
  });

  it('shows no building row when nothing is in reach', () => {
    const { step } = makeStep();
    const state = makeState();
    addReachPattern(state, holeCounter);
    step.update(state, 'sunny');
    expect(step.root.textContent).not.toContain('inside the blast area');
  });

  it('shows no building row when there are no holes', () => {
    const { step } = makeStep();
    const state = makeState();
    addReachBuildings(state);
    step.update(state, 'sunny');
    expect(step.root.textContent).not.toContain('inside the blast area');
  });
});

describe('FireStep rain warning (#1957)', () => {
  const RAIN_ROW = '[data-role="rain-risk-check"]';

  function chargedState(explosiveId: string, holes = 2): GameState {
    const state = makeState();
    for (let i = 0; i < holes; i++) {
      const hole = addHole(holeCounter, state.drillHoles, 20 + i * 3, 20, 8, 0.15);
      const c = createCharge(explosiveId, 5, 2, hole.depth);
      if ('charge' in c) state.chargesByHole[hole.id] = c.charge;
    }
    return state;
  }

  it('rain + untubed sensitive charge + dry holes: warns with the rain-risk row instead of the dry check', () => {
    const { step } = makeStep();
    const state = chargedState('boomite', 2);
    state.weather.current = 'light_rain';
    step.update(state, 'light_rain');

    const row = step.root.querySelector(RAIN_ROW);
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(t('ui.blast_workshop.fire.check_rain_risk', { count: 2 }));
    expect(step.root.textContent).not.toContain(t('ui.blast_workshop.fire.check_dry', { count: 2 }));
  });

  it('counts only the exposed holes', () => {
    const { step } = makeStep();
    const state = chargedState('boomite', 3);
    state.tubingState.installedHoles = new Set([state.drillHoles[0]!.id]);
    state.weather.current = 'storm';
    step.update(state, 'storm');
    expect(step.root.querySelector(RAIN_ROW)!.textContent).toContain(t('ui.blast_workshop.fire.check_rain_risk', { count: 2 }));
  });

  it('wet holes still show the wet check, not the rain-risk row', () => {
    const { step } = makeStep();
    const state = chargedState('boomite', 2);
    state.weather.current = 'light_rain';
    wetAllHoles(state);
    step.update(state, 'light_rain');

    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_wet', { count: 2, percent: 10 }));
    expect(step.root.querySelector(RAIN_ROW)).toBeNull();
  });

  it('a tubed charge in rain still reads dry', () => {
    const { step } = makeStep();
    const state = chargedState('boomite', 2);
    state.tubingState.installedHoles = new Set(state.drillHoles.map(h => h.id));
    state.weather.current = 'light_rain';
    step.update(state, 'light_rain');

    expect(step.root.querySelector(RAIN_ROW)).toBeNull();
    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_dry', { count: 2 }));
  });

  it('a water-resistant charge in rain still reads dry', () => {
    const { step } = makeStep();
    const state = chargedState('krackle', 2);
    state.weather.current = 'heavy_rain';
    step.update(state, 'heavy_rain');

    expect(step.root.querySelector(RAIN_ROW)).toBeNull();
    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_dry', { count: 2 }));
  });

  it('sunny weather with sensitive charges reads dry, no rain row', () => {
    const { step } = makeStep();
    const state = chargedState('boomite', 2);
    step.update(state, 'sunny');
    expect(step.root.querySelector(RAIN_ROW)).toBeNull();
    expect(step.root.textContent).toContain(t('ui.blast_workshop.fire.check_dry', { count: 2 }));
  });

  it('the warning appears when rain starts and goes away when it stops (repaints)', () => {
    const { step } = makeStep();
    const state = chargedState('boomite', 1);
    step.update(state, 'sunny');
    expect(step.root.querySelector(RAIN_ROW)).toBeNull();
    state.weather.current = 'light_rain';
    step.update(state, 'light_rain');
    expect(step.root.querySelector(RAIN_ROW)).not.toBeNull();
    state.weather.current = 'sunny';
    step.update(state, 'sunny');
    expect(step.root.querySelector(RAIN_ROW)).toBeNull();
  });

  it('en.json and fr.json define the rain-risk line with different text', () => {
    const read = (l: string): Record<string, string> => JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8'));
    const key = 'ui.blast_workshop.fire.check_rain_risk';
    expect(read('en')[key]).toBeTruthy();
    expect(read('fr')[key]).toBeTruthy();
    expect(read('en')[key]).not.toBe(read('fr')[key]);
  });
});

// ── #2166: the wet row counts only holes that fizzle; zone rows state the consequence ──

describe('FireStep wet-hole row (#2166)', () => {
  const CHECK_WET = 'ui.blast_workshop.fire.check_wet';
  const CHECK_OK = 'ui.blast_workshop.fire.check_wet_resistant';
  const CHECK_DRY = 'ui.blast_workshop.fire.check_dry';

  beforeEach(() => { setLocale('en'); });

  /** One hole per entry, charged with that explosive (null = left uncharged). */
  function withCharges(explosives: (string | null)[]): GameState {
    const state = makeState();
    explosives.forEach((id, i) => {
      const hole = addHole(holeCounter, state.drillHoles, 20 + i * 3, 20, 8, 0.15);
      if (id === null) return;
      const c = createCharge(id, 5, 2, hole.depth);
      if ('charge' in c) state.chargesByHole[hole.id] = c.charge;
    });
    return state;
  }

  /** Icon on the checklist row whose text is exactly `text` ('check' = ticked, 'warn' = unticked); null when absent. */
  function rowIcon(step: FireStep, text: string): string | null {
    const span = [...step.root.querySelectorAll('span')].find(s => s.textContent === text);
    return span?.parentElement?.querySelector('bs-icon')?.getAttribute('name') ?? null;
  }

  function render(state: GameState): FireStep {
    const { step } = makeStep();
    step.update(state, 'sunny');
    return step;
  }

  it('wet holes with a water-sensitive charge warn with count and percent, unticked', () => {
    const s = withCharges(['boomite', 'boomite']);
    wetAllHoles(s);
    const step = render(s);
    const text = t(CHECK_WET, { count: 2, percent: 10 });
    expect(rowIcon(step, text)).toBe('warn');
    expect(step.root.textContent).not.toContain(t(CHECK_DRY, { count: 2 }));
  });

  it('every water-sensitive explosive in the catalog warns', () => {
    for (const id of ['pop_rock', 'boomite', 'big_bada_boom', 'obliviax']) {
      const s = withCharges([id]);
      wetAllHoles(s);
      expect(rowIcon(render(s), t(CHECK_WET, { count: 1, percent: 10 })), id).toBe('warn');
    }
  });

  it('counts only the wet holes holding a water-sensitive charge', () => {
    const s = withCharges(['boomite', 'krackle', 'boomite', null]);
    wetAllHoles(s);
    const step = render(s);
    expect(rowIcon(step, t(CHECK_WET, { count: 2, percent: 10 }))).toBe('warn');
    expect(step.root.textContent).not.toContain(t(CHECK_WET, { count: 4, percent: 10 }));
  });

  it('the warning text states the energy share and the two fixes', () => {
    const text = t(CHECK_WET, { count: 2, percent: 10 });
    expect(text).toMatch(/10\s?%/);
    expect(text).toMatch(/drain/i);
    expect(text).toMatch(/water-resistant/i);
  });

  it('wet holes holding only water-resistant charges tick the row with the wet count', () => {
    const s = withCharges(['krackle', 'dynatomics']);
    wetAllHoles(s);
    const step = render(s);
    expect(rowIcon(step, t(CHECK_OK, { count: 2 }))).toBe('check');
    expect(step.root.textContent).not.toContain(t(CHECK_WET, { count: 0, percent: 10 }));
    expect(step.root.textContent).not.toContain(t(CHECK_DRY, { count: 2 }));
  });

  it('every water-resistant explosive in the catalog ticks the row', () => {
    for (const id of ['krackle', 'shatternite', 'rumblox', 'dynatomics']) {
      const s = withCharges([id]);
      wetAllHoles(s);
      expect(rowIcon(render(s), t(CHECK_OK, { count: 1 })), id).toBe('check');
    }
  });

  it('wet uncharged holes tick the row; the count is every wet hole', () => {
    const s = withCharges([null, null, 'krackle']);
    wetAllHoles(s);
    expect(rowIcon(render(s), t(CHECK_OK, { count: 3 }))).toBe('check');
  });

  it('an unknown explosive does not fizzle', () => {
    const s = withCharges(['boomite']);
    const id = s.drillHoles[0]!.id;
    s.chargesByHole[id] = { ...s.chargesByHole[id]!, explosiveId: 'no_such_explosive' };
    wetAllHoles(s);
    const step = render(s);
    expect(step.root.textContent).not.toContain(t(CHECK_WET, { count: 1, percent: 10 }));
    expect(rowIcon(step, t(CHECK_OK, { count: 1 }))).toBe('check');
  });

  it('no wet holes and no rain: the unchanged all-dry row', () => {
    const step = render(withCharges(['boomite', 'krackle']));
    expect(rowIcon(step, t(CHECK_DRY, { count: 2 }))).toBe('check');
  });

  it('rain risk on dry sensitive holes is unchanged', () => {
    const s = withCharges(['boomite', 'boomite']);
    s.weather.current = 'light_rain';
    const { step } = makeStep();
    step.update(s, 'light_rain');
    expect(step.root.querySelector('[data-role="rain-risk-check"]')!.textContent).toContain(t('ui.blast_workshop.fire.check_rain_risk', { count: 2 }));
  });

  it('the row follows the water: draining the holes returns the dry row', () => {
    const { step } = makeStep();
    const s = withCharges(['boomite']);
    wetAllHoles(s);
    step.update(s, 'sunny');
    expect(rowIcon(step, t(CHECK_WET, { count: 1, percent: 10 }))).toBe('warn');
    s.holeWater = {};
    step.update(s, 'sunny');
    expect(rowIcon(step, t(CHECK_DRY, { count: 1 }))).toBe('check');
  });

  it('en and fr define the wet rows with their parameters, in different text', () => {
    const read = (l: string): Record<string, string> => JSON.parse(readFileSync(`src/core/i18n/locales/${l}.json`, 'utf8'));
    const en = read('en');
    const fr = read('fr');
    for (const loc of [en, fr]) {
      expect(loc[CHECK_WET]).toContain('{count}');
      expect(loc[CHECK_WET]).toContain('{percent}');
      expect(loc[CHECK_OK]).toContain('{count}');
    }
    expect(en[CHECK_WET]).not.toBe(fr[CHECK_WET]);
    expect(en[CHECK_OK]).not.toBe(fr[CHECK_OK]);
  });

  it('the occupied-zone rows state the consequence', () => {
    expect(t('ui.blast_workshop.fire.check_zone_occupied', { count: 2 })).toContain('injured');
    expect(t('ui.blast_workshop.fire.check_zone_occupied_stranded', { count: 2, strandedCount: 1 })).toContain('injured');
  });

  it('an occupied zone still renders its row with the count', () => {
    const s = withCharges(['boomite']);
    addEmployee(s, 22, 22);
    const step = render(s);
    expect(rowIcon(step, t('ui.blast_workshop.fire.check_zone_occupied', { count: 1 }))).toBe('warn');
  });
});
