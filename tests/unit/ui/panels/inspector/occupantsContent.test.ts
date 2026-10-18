// @vitest-environment jsdom
// Inspector people and activity sections (#1760): residents, school trainees and courses, research queue.
import { describe, it, expect, vi } from 'vitest';
import { residentsSection, schoolSection } from '../../../../../src/ui/panels/inspector/occupantsContent.js';
import { researchSection } from '../../../../../src/ui/panels/inspector/researchContent.js';
import type { InspectorLinks } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../../src/core/entities/Employee.js';
import { getBuildingDef, type Building, type BuildingType } from '../../../../../src/core/entities/Building.js';
import { getLivingQuartersWellbeingMultiplier } from '../../../../../src/core/entities/BuildingWellbeing.js';
import { courseTerms, trainableSkills } from '../../../../../src/core/entities/EmployeeTraining.js';
import { t, setLocale } from '../../../../../src/core/i18n/I18n.js';

function makeEmployee(id: number, name: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id, name, role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true, x: 5, z: 5,
    qualifications: [], trainingState: null, pendingTrainingState: null, activeActionId: null, fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null, restNeedKey: null,
    taskTicksRemaining: null, activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false, pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null, pendingActionPayload: null,
    pendingDriverVehicleId: null, taskQueue: [], locomotion: { kind: 'on_foot' }, itinerary: null,
    vehicleWaitingTicks: 0, hiredAtTick: 0,
    ...overrides,
  } as Employee;
}

function makeBuilding(type: BuildingType, overrides: Partial<Building> = {}): Building {
  return { id: 3, type, tier: 1, x: 17, z: 23, hp: 100, active: true, occupantIds: [], ...overrides };
}

function makeState(buildings: Building[], employees: Employee[] = []): GameState {
  setLocale('en');
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.tickCount = 100;
  s.buildings.buildings = buildings;
  s.employees.employees = employees;
  return s;
}

function mkLinks(): { links: InspectorLinks; select: ReturnType<typeof vi.fn> } {
  const select = vi.fn();
  return { links: { select, run: () => {}, confirm: () => {} } as unknown as InspectorLinks, select };
}

const mount = (section: HTMLElement): HTMLElement => {
  const root = document.createElement('div');
  root.append(section);
  return root;
};
const links_ = (root: HTMLElement, id?: number): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(`[data-select-kind="employee"]${id === undefined ? '' : `[data-select-id="${id}"]`}`)];
const noRawKeys = (root: HTMLElement): void => expect(root.textContent).not.toMatch(/(^|\s)inspector\.[a-z_.]+/);

const course = (buildingId: number, ticksRemaining: number, skill = 'blasting', grantsLevel: 1 | 2 | 3 = 1) =>
  ({ buildingId, skill: skill as never, ticksRemaining, fee: 500, grantsLevel });

describe('residentsSection', () => {
  it.each(['management_office', 'blasting_academy', 'research_center', 'freight_warehouse'] as BuildingType[])(
    'returns null for %s', type => {
      const b = makeBuilding(type);
      expect(residentsSection(b, makeState([b]), mkLinks().links)).toBeNull();
    });

  it('shows beds used and total and a name link per resident', () => {
    const emps = [makeEmployee(1, 'Ann Rest', { restTicksRemaining: 40 }), makeEmployee(2, 'Bob Sleep', { restTicksRemaining: 12 })];
    const b = makeBuilding('living_quarters', { occupantIds: [1, 2] });
    const s = makeState([b], emps);
    const sec = residentsSection(b, s, mkLinks().links)!;
    const root = mount(sec.section);
    const cap = getBuildingDef('living_quarters', 1).capacity;
    expect(root.textContent).toContain(String(cap));
    expect(links_(root, 1)[0]!.textContent).toContain('Ann Rest');
    expect(links_(root, 2)[0]!.textContent).toContain('Bob Sleep');
    expect(links_(root)).toHaveLength(2);
    noRawKeys(root);
  });

  it('shows the rest time left in the resident row and a neutral row without it', () => {
    const emps = [makeEmployee(1, 'Ann Rest', { restTicksRemaining: 40 }), makeEmployee(2, 'Bob Idle', { restTicksRemaining: null })];
    const b = makeBuilding('living_quarters', { occupantIds: [1, 2] });
    const root = mount(residentsSection(b, makeState([b], emps), mkLinks().links)!.section);
    expect(root.textContent).toContain('40');
    expect(links_(root, 2)[0]!.textContent).toContain('Bob Idle');
    expect(root.textContent!.match(/40/g)).toHaveLength(1);
  });

  it('shows the site-wide housing multiplier', () => {
    const emps = [makeEmployee(1, 'Ann Rest', { restTicksRemaining: 5 })];
    const b = makeBuilding('living_quarters', { tier: 2, occupantIds: [1] });
    const s = makeState([b], emps);
    const mult = getLivingQuartersWellbeingMultiplier(s.buildings, s.employees.employees.filter(e => e.alive).length);
    const root = mount(residentsSection(b, s, mkLinks().links)!.section);
    expect(root.textContent).toContain(mult.toFixed(2));
  });

  it('warns about overcapacity only when the crew outnumbers the beds', () => {
    const beds = getBuildingDef('living_quarters', 1).capacity;
    const crew = (n: number): Employee[] => Array.from({ length: n }, (_, i) => makeEmployee(i + 1, `Crew ${i + 1}`));
    const b = makeBuilding('living_quarters');
    const fit = mount(residentsSection(b, makeState([b], crew(beds)), mkLinks().links)!.section);
    const over = mount(residentsSection(b, makeState([b], crew(beds + 1)), mkLinks().links)!.section);
    expect(over.textContent).not.toBe(fit.textContent);
    expect(over.querySelector('[data-live="overcapacity"]')).not.toBeNull();
    expect(fit.querySelector('[data-live="overcapacity"]')).toBeNull();
  });

  it('shows an empty line when nobody lives there', () => {
    const b = makeBuilding('living_quarters');
    const root = mount(residentsSection(b, makeState([b]), mkLinks().links)!.section);
    expect(links_(root)).toHaveLength(0);
    noRawKeys(root);
  });

  it('clicking a name link selects that employee', () => {
    const b = makeBuilding('living_quarters', { occupantIds: [7] });
    const { links, select } = mkLinks();
    const root = mount(residentsSection(b, makeState([b], [makeEmployee(7, 'Ann Rest', { restTicksRemaining: 9 })]), links)!.section);
    links_(root, 7)[0]!.click();
    expect(select).toHaveBeenCalledWith('employee', 7);
  });

  it('sync updates the rest countdown in place; the row set names the residents', () => {
    const e = makeEmployee(1, 'Ann Rest', { restTicksRemaining: 40 });
    const b = makeBuilding('living_quarters', { occupantIds: [1] });
    const s = makeState([b], [e]);
    const sec = residentsSection(b, s, mkLinks().links)!;
    const root = mount(sec.section);
    const link = links_(root, 1)[0]!;
    const sig = sec.rowSignature;
    const before = root.textContent;
    e.restTicksRemaining = 11;
    sec.sync(root);
    expect(links_(root, 1)[0]).toBe(link);
    expect(root.textContent).not.toBe(before);
    expect(sec.rowSignature).toBe(sig);
    b.occupantIds = [1, 2];
    s.employees.employees.push(makeEmployee(2, 'Bob Sleep'));
    expect(residentsSection(b, s, mkLinks().links)!.rowSignature).not.toBe(sig);
  });
});

describe('schoolSection', () => {
  it.each(['living_quarters', 'research_center', 'freight_warehouse'] as BuildingType[])(
    'returns null for %s', type => {
      const b = makeBuilding(type);
      expect(schoolSection(b, makeState([b]), mkLinks().links)).toBeNull();
    });

  it.each(['driving_center', 'blasting_academy', 'management_office', 'geology_lab'] as BuildingType[])(
    'builds for school %s', type => {
      const b = makeBuilding(type);
      const sec = schoolSection(b, makeState([b]), mkLinks().links);
      expect(trainableSkills(type).length).toBeGreaterThan(0);
      expect(sec).not.toBeNull();
    });

  it('shows seats used and total counting inside plus walking in', () => {
    const b = makeBuilding('blasting_academy', { occupantIds: [1] });
    const emps = [
      makeEmployee(1, 'Ann Inside', { trainingState: course(3, 40) }),
      makeEmployee(2, 'Bob Walking', { pendingTrainingState: course(3, 90) }),
    ];
    const root = mount(schoolSection(b, makeState([b], emps), mkLinks().links)!.section);
    const seats = getBuildingDef('blasting_academy', 1).capacity;
    expect(root.textContent).toContain(String(seats));
    expect(root.querySelector('[data-live="seats"]')!.textContent).toContain('2');
  });

  it('lists trainees with a link, skill, level and time left; walking-in ones in their own group', () => {
    const b = makeBuilding('blasting_academy', { occupantIds: [1] });
    const emps = [
      makeEmployee(1, 'Ann Inside', { trainingState: course(3, 40, 'blasting', 2) }),
      makeEmployee(2, 'Bob Walking', { pendingTrainingState: course(3, 90) }),
      makeEmployee(3, 'Other School', { trainingState: course(8, 10) }),
    ];
    const root = mount(schoolSection(b, makeState([b], emps), mkLinks().links)!.section);
    expect(links_(root, 1)).toHaveLength(1);
    expect(links_(root, 2)).toHaveLength(1);
    expect(links_(root, 3)).toHaveLength(0);
    const inside = root.querySelector('[data-group="trainees"]')!;
    const walking = root.querySelector('[data-group="walking_in"]')!;
    expect(inside.querySelector('[data-select-id="1"]')).not.toBeNull();
    expect(inside.querySelector('[data-select-id="2"]')).toBeNull();
    expect(walking.querySelector('[data-select-id="2"]')).not.toBeNull();
    expect(inside.textContent).toContain('40');
    expect(inside.textContent).toContain('2');
    noRawKeys(root);
  });

  it('shows the courses with level, fee and duration from courseTerms', () => {
    const b = makeBuilding('geology_lab', { tier: 2 });
    const root = mount(schoolSection(b, makeState([b]), mkLinks().links)!.section);
    const terms = courseTerms(2);
    expect(root.querySelectorAll('[data-course]')).toHaveLength(trainableSkills('geology_lab').length);
    const text = root.querySelector('[data-course]')!.textContent!;
    expect(text).toContain('2');
    expect(text.replace(/[ ,.  ]/g, '')).toContain(String(terms.fee));
    noRawKeys(root);
  });

  it('marks a course superseded when a higher-tier school on site is the offer', () => {
    const low = makeBuilding('blasting_academy', { id: 3, tier: 1 });
    const high = makeBuilding('blasting_academy', { id: 4, tier: 3 });
    const s = makeState([low, high]);
    const lowRoot = mount(schoolSection(low, s, mkLinks().links)!.section);
    const highRoot = mount(schoolSection(high, s, mkLinks().links)!.section);
    expect(lowRoot.querySelector('[data-course-superseded]')).not.toBeNull();
    expect(highRoot.querySelector('[data-course-superseded]')).toBeNull();
  });

  it('shows an empty line when no one trains, and clicking a trainee link selects them', () => {
    const b = makeBuilding('blasting_academy');
    expect(links_(mount(schoolSection(b, makeState([b]), mkLinks().links)!.section))).toHaveLength(0);
    const b2 = makeBuilding('blasting_academy', { occupantIds: [1] });
    const { links, select } = mkLinks();
    const root = mount(schoolSection(b2, makeState([b2], [makeEmployee(1, 'Ann Inside', { trainingState: course(3, 40) })]), links)!.section);
    links_(root, 1)[0]!.click();
    expect(select).toHaveBeenCalledWith('employee', 1);
  });

  it('sync counts the time left down in place; a finished trainee changes the row signature', () => {
    const e = makeEmployee(1, 'Ann Inside', { trainingState: course(3, 40) });
    const b = makeBuilding('blasting_academy', { occupantIds: [1] });
    const s = makeState([b], [e]);
    const sec = schoolSection(b, s, mkLinks().links)!;
    const root = mount(sec.section);
    const link = links_(root, 1)[0]!;
    const before = root.textContent;
    e.trainingState = course(3, 7);
    sec.sync(root);
    expect(links_(root, 1)[0]).toBe(link);
    expect(root.textContent).not.toBe(before);
    expect(root.textContent).toContain('7');
    e.trainingState = null;
    b.occupantIds = [];
    expect(schoolSection(b, s, mkLinks().links)!.rowSignature).not.toBe(sec.rowSignature);
  });
});

describe('researchSection', () => {
  const task = (tier: 2 | 3, ticks: number, cost: number, type: BuildingType = 'management_office') =>
    ({ targetType: type, targetTier: tier, ticksRemaining: ticks, cost, conditions: [] });

  it.each(['living_quarters', 'blasting_academy', 'freight_warehouse'] as BuildingType[])('returns null for %s', type => {
    const b = makeBuilding(type);
    expect(researchSection(b, makeState([b]))).toBeNull();
  });

  it('shows an idle line when the queue is empty', () => {
    const b = makeBuilding('research_center');
    const root = mount(researchSection(b, makeState([b]))!.section);
    expect(root.querySelector('[data-live="research-idle"]')).not.toBeNull();
    expect(root.querySelector('[data-live="research-running0"]')).toBeNull();
    noRawKeys(root);
  });

  it('shows the running task with its target tier name, percent and ticks left', () => {
    const b = makeBuilding('research_center');
    const s = makeState([b]);
    s.buildings.researchQueue = [task(2, 120, 5000)];
    const root = mount(researchSection(b, s)!.section);
    const running = root.querySelector('[data-live="research-running0"]')!;
    expect(running.textContent).toContain(t('building.management_office.t2.name'));
    expect(running.textContent).toContain('120');
    expect(running.textContent).toMatch(/\d+\s?%/);
    expect(root.querySelector('[data-live="research-idle"]')).toBeNull();
    noRawKeys(root);
  });

  it('lists pending tasks after the first with their cost', () => {
    const b = makeBuilding('research_center');
    const s = makeState([b]);
    s.buildings.researchQueue = [task(2, 120, 5000), task(3, 300, 7777, 'blasting_academy'), task(2, 200, 4321, 'geology_lab')];
    const root = mount(researchSection(b, s)!.section);
    const pending = [...root.querySelectorAll<HTMLElement>('[data-live^="research-pending"]')];
    expect(pending).toHaveLength(2);
    expect(pending[0]!.textContent).toContain(t('building.blasting_academy.t3.name'));
    expect(pending[0]!.textContent!.replace(/[ ,.  ]/g, '')).toContain('7777');
    expect(pending[1]!.textContent!.replace(/[ ,.  ]/g, '')).toContain('4321');
  });

  it('says paused while the centre is closed and the queue is not empty', () => {
    const b = makeBuilding('research_center');
    const s = makeState([b]);
    s.buildings.researchQueue = [task(2, 120, 5000)];
    const open = mount(researchSection(b, s)!.section);
    expect(open.querySelector('[data-live="research-paused"]')).toBeNull();
    b.outOfService = true;
    const closed = mount(researchSection(b, s)!.section);
    expect(closed.querySelector('[data-live="research-paused"]')).not.toBeNull();
    noRawKeys(closed);
  });

  it('shows no paused mark for a closed centre with an empty queue', () => {
    const b = makeBuilding('research_center', { active: false });
    const root = mount(researchSection(b, makeState([b]))!.section);
    expect(root.querySelector('[data-live="research-paused"]')).toBeNull();
  });

  it('sync updates ticks left in place; a queue change alters the row signature', () => {
    const b = makeBuilding('research_center');
    const s = makeState([b]);
    s.buildings.researchQueue = [task(2, 120, 5000)];
    const sec = researchSection(b, s)!;
    const root = mount(sec.section);
    const node = root.querySelector('[data-live="research-running0"]')!;
    const before = node.textContent;
    s.buildings.researchQueue[0]!.ticksRemaining = 33;
    sec.sync(root);
    expect(root.querySelector('[data-live="research-running0"]')).toBe(node);
    expect(node.textContent).not.toBe(before);
    expect(node.textContent).toContain('33');
    const sig = sec.rowSignature;
    s.buildings.researchQueue.push(task(3, 300, 900, 'blasting_academy'));
    expect(researchSection(b, s)!.rowSignature).not.toBe(sig);
  });
});

describe('researchSection speed and parallel slots (#1936)', () => {
  const task = (type: BuildingType, ticks: number) =>
    ({ targetType: type, targetTier: 3 as const, ticksRemaining: ticks, cost: 12000, conditions: [] });
  const TYPES: BuildingType[] = ['driving_center', 'geology_lab', 'management_office', 'blasting_academy'];
  const setup = (tier: 1 | 2 | 3, n: number) => {
    const b = makeBuilding('research_center', { tier });
    const s = makeState([b]);
    s.buildings.researchQueue = TYPES.slice(0, n).map((ty) => task(ty, 50));
    return { b, s };
  };
  const live = (root: HTMLElement, k: string) => root.querySelector<HTMLElement>(`[data-live="${k}"]`);

  it('tier 3 with 4 queued: three running rows, one pending row', () => {
    const { b, s } = setup(3, 4);
    const root = mount(researchSection(b, s)!.section);
    expect(live(root, 'research-running0')).not.toBeNull();
    expect(live(root, 'research-running1')).not.toBeNull();
    expect(live(root, 'research-running2')).not.toBeNull();
    expect(live(root, 'research-running3')).toBeNull();
    expect(live(root, 'research-pending0')).not.toBeNull();
    expect(live(root, 'research-pending1')).toBeNull();
    expect(live(root, 'research-running')).toBeNull();
    expect(live(root, 'research-running1')!.textContent).toContain(t('building.geology_lab.t3.name'));
    expect(live(root, 'research-pending0')!.textContent).toContain(t('building.blasting_academy.t3.name'));
    noRawKeys(root);
  });

  it('tier 2 with 3 queued: two running rows, pending numbering restarts at 0', () => {
    const { b, s } = setup(2, 3);
    const root = mount(researchSection(b, s)!.section);
    expect(live(root, 'research-running0')).not.toBeNull();
    expect(live(root, 'research-running1')).not.toBeNull();
    expect(live(root, 'research-running2')).toBeNull();
    expect(live(root, 'research-pending0')!.textContent).toContain(t('building.management_office.t3.name'));
  });

  it('tier 1 with 2 queued: one running row (research-running0), one pending', () => {
    const { b, s } = setup(1, 2);
    const root = mount(researchSection(b, s)!.section);
    expect(live(root, 'research-running0')).not.toBeNull();
    expect(live(root, 'research-running1')).toBeNull();
    expect(live(root, 'research-pending0')).not.toBeNull();
  });

  it('fewer tasks than slots: only as many running rows as tasks, no pending', () => {
    const { b, s } = setup(3, 2);
    const root = mount(researchSection(b, s)!.section);
    expect(live(root, 'research-running1')).not.toBeNull();
    expect(live(root, 'research-running2')).toBeNull();
    expect(root.querySelector('[data-live^="research-pending"]')).toBeNull();
  });

  it('empty queue still shows the idle row', () => {
    const { b, s } = setup(3, 0);
    const root = mount(researchSection(b, s)!.section);
    expect(live(root, 'research-idle')).not.toBeNull();
    expect(root.querySelector('[data-live^="research-running"]')).toBeNull();
  });

  it('speed and slots line uses inspector.research_speed', () => {
    expect(t('inspector.research_speed', { speed: 2, slots: 3 })).not.toBe('inspector.research_speed');
    const { b, s } = setup(3, 1);
    const root = mount(researchSection(b, s)!.section);
    expect(root.textContent).toContain(t('inspector.research_speed', { speed: 2, slots: 3 }));
    const t2 = setup(2, 1);
    expect(mount(researchSection(t2.b, t2.s)!.section).textContent).toContain(t('inspector.research_speed', { speed: 1.5, slots: 2 }));
  });

  it('sync updates every running row in place with ceil of fractional ticks', () => {
    const { b, s } = setup(3, 2);
    const sec = researchSection(b, s)!;
    const root = mount(sec.section);
    const row1 = live(root, 'research-running1')!;
    s.buildings.researchQueue[1]!.ticksRemaining = 12.5;
    s.buildings.researchQueue[0]!.ticksRemaining = 7.2;
    sec.sync(root);
    expect(live(root, 'research-running1')).toBe(row1);
    expect(row1.textContent).toContain('13');
    expect(row1.textContent).not.toContain('12.5');
    expect(live(root, 'research-running0')!.textContent).toContain('8');
    expect(live(root, 'research-running0')!.textContent).not.toContain('7.2');
  });

  it('rowSignature changes with the active count even for the same queue', () => {
    const a = setup(1, 3);
    const c = setup(3, 3);
    expect(researchSection(a.b, a.s)!.rowSignature).not.toBe(researchSection(c.b, c.s)!.rowSignature);
  });

  it('rowSignature changes when a centre upgrade grows the active count', () => {
    const { b, s } = setup(1, 3);
    const before = researchSection(b, s)!.rowSignature;
    b.tier = 2;
    expect(researchSection(b, s)!.rowSignature).not.toBe(before);
  });
});
