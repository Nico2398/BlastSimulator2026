/** Inspector residents and school-trainee sections for buildings. */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { getBuildingPeopleCapacity, type Building } from '../../../core/entities/Building.js';
import { getBedCapacity, getLivingQuartersWellbeingMultiplier } from '../../../core/entities/BuildingWellbeing.js';
import { getLivingEmployees } from '../../../core/entities/Employee.js';
import {
  availableTrainingOffers, isTrainingBuilding, schoolCourses, schoolTrainees,
  type SchoolCourse, type SchoolTrainee,
} from '../../../core/entities/EmployeeTraining.js';
import type { GameState } from '../../../core/state/GameState.js';
import { el } from '../../dom.js';
import type { InspectorLinks } from './InspectorContent.js';
import { entityLink, markLive, sectionOf, setLive } from './inspectorWidgets.js';

/** A building section plus its live-sync hook. */
interface OccupantsSection {
  readonly section: HTMLElement;
  /** Names the row set: when it changes the section must be rebuilt, not synced in place. */
  readonly rowSignature: string;
  readonly sync: (root: HTMLElement) => void;
}

const timeLeft = (ticks: number): string => t('ui.modifier.remaining', { hours: ticks });

const small = (node: HTMLElement): HTMLElement => {
  node.style.fontSize = '11px';
  return node;
};

/** A text line rewritten in place under `data-live` = key. */
function liveLine(key: string, text: string): HTMLElement {
  return markLive(small(el('div', { text, className: 'bsx-mono' })), key);
}

/** A row of a name link plus a live value node tagged `key`. */
function personRow(name: string, id: number, key: string, text: string | null, links: InspectorLinks): HTMLElement {
  const row = el('div', { className: 'bsx-mono' });
  row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:11px';
  row.append(entityLink(name, 'employee', id, links));
  if (text !== null) row.append(markLive(el('span', { text }), key));
  return row;
}

// ── Living quarters ──

interface Resident { id: number; name: string; rest: number | null }

function residentsOf(b: Building, state: GameState): Resident[] {
  const out: Resident[] = [];
  for (const id of b.occupantIds) {
    const e = state.employees.employees.find(x => x.id === id);
    if (e) out.push({ id, name: e.name, rest: e.restTicksRemaining });
  }
  return out;
}

const restText = (rest: number): string => t('inspector.resident_rest', { time: timeLeft(rest) });

const housingText = (state: GameState): string =>
  t('inspector.housing_effect', { mult: getLivingQuartersWellbeingMultiplier(state.buildings, getLivingEmployees(state.employees.employees).length).toFixed(2) });

const isOvercrowded = (state: GameState): boolean =>
  getLivingEmployees(state.employees.employees).length > getBedCapacity(state.buildings);

const bedsText = (b: Building): string =>
  t('inspector.beds', { used: b.occupantIds.length, total: getBuildingPeopleCapacity(b.type, b.tier) });

/** Who lives or is inside the building, or null when it has no residents. */
export function residentsSection(b: Building, state: GameState, links: InspectorLinks): OccupantsSection | null {
  if (b.type !== 'living_quarters') return null;
  const residents = residentsOf(b, state);
  const over = isOvercrowded(state);
  const rows: HTMLElement[] = [liveLine('beds', bedsText(b))];
  if (residents.length === 0) rows.push(small(el('div', { text: t('inspector.no_residents') })));
  for (const r of residents) rows.push(personRow(r.name, r.id, `rest-${r.id}`, r.rest === null ? null : restText(r.rest), links));
  rows.push(liveLine('housing', housingText(state)));
  if (over) rows.push(markLive(small(el('div', { text: t('inspector.overcapacity_warning') })), 'overcapacity'));
  const section = sectionOf(t('inspector.section.residents'), rows);
  return {
    section,
    rowSignature: `lq:${residents.map(r => `${r.id}${r.rest === null ? '-' : '+'}`).join(',')}:${over ? 'over' : 'ok'}`,
    sync(root) {
      setLive(root, 'beds', bedsText(b));
      setLive(root, 'housing', housingText(state));
      for (const r of residentsOf(b, state)) if (r.rest !== null) setLive(root, `rest-${r.id}`, restText(r.rest));
    },
  };
}

// ── Schools ──

const traineeText = (r: SchoolTrainee): string =>
  t('inspector.trainee_row', { skill: t(`skill.${r.skill}`), level: r.grantsLevel ?? 1, time: timeLeft(r.ticksRemaining) });

const seatsText = (b: Building, trainees: readonly SchoolTrainee[]): string =>
  t('inspector.seats', { used: trainees.length, total: getBuildingPeopleCapacity(b.type, b.tier) });

function courseRow(c: SchoolCourse): HTMLElement {
  const text = t('inspector.course_row', { skill: t(`skill.${c.skill}`), level: c.level, fee: formatMoney(c.fee), hours: c.ticks });
  const row = small(el('div', { text, className: 'bsx-mono' }));
  row.dataset['course'] = c.skill;
  if (c.supersededBy) {
    row.dataset['courseSuperseded'] = String(c.supersededBy.id);
    row.append(` · ${t('inspector.course_superseded', { school: t(`building.${c.supersededBy.type}.t${c.supersededBy.tier}.name`) })}`);
  }
  return row;
}

function group(name: string, label: string | null, rows: HTMLElement[]): HTMLElement {
  const box = el('div');
  box.dataset['group'] = name;
  box.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  if (label !== null) box.append(small(el('div', { text: label })));
  box.append(...rows);
  return box;
}

/** Courses and enrolled trainees of a school, or null when the building teaches nothing. */
export function schoolSection(b: Building, state: GameState, links: InspectorLinks): OccupantsSection | null {
  if (!isTrainingBuilding(b.type)) return null;
  const trainees = schoolTrainees(state.employees.employees, b.id);
  const courses = schoolCourses(b, availableTrainingOffers(state.buildings.buildings));
  const inside = trainees.filter(r => r.phase === 'inside');
  const walking = trainees.filter(r => r.phase === 'walking_in');
  const rowOf = (r: SchoolTrainee): HTMLElement => personRow(r.name, r.employeeId, `trainee-${r.employeeId}`, traineeText(r), links);
  const rows: HTMLElement[] = [liveLine('seats', seatsText(b, trainees))];
  if (trainees.length === 0) rows.push(small(el('div', { text: t('inspector.no_trainees') })));
  rows.push(group('trainees', null, inside.map(rowOf)));
  if (walking.length > 0) rows.push(group('walking_in', t('inspector.walking_in'), walking.map(rowOf)));
  rows.push(group('courses', t('inspector.section.courses'), courses.map(courseRow)));
  const section = sectionOf(t('inspector.section.trainees'), rows);
  return {
    section,
    rowSignature: `school:${trainees.map(r => `${r.employeeId}${r.phase === 'inside' ? 'i' : 'w'}`).join(',')}:${courses.map(c => c.supersededBy?.id ?? '-').join(',')}`,
    sync(root) {
      const now = schoolTrainees(state.employees.employees, b.id);
      setLive(root, 'seats', seatsText(b, now));
      for (const r of now) setLive(root, `trainee-${r.employeeId}`, traineeText(r));
    },
  };
}
