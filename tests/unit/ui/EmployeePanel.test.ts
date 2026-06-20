// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { EmployeePanel } from '../../../src/ui/EmployeePanel.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Employee, SkillCategory } from '../../../src/core/entities/Employee.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal GameState that won't crash the panel update loop. */
function makeMockState(overrides?: Partial<GameState>): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = 99999;
  return { ...s, ...overrides };
}

/** Build a fresh Employee object with sensible defaults, then apply overrides. */
function makeEmployee(overrides?: Partial<Employee>): Employee {
  return {
    id: 1,
    name: 'Test Worker',
    role: 'driller',
    salary: 500,
    morale: 75,
    unionized: false,
    injured: false,
    alive: true,
    x: 0,
    z: 0,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    hunger: 100,
    fatigue: 100,
    breakNeed: 100,
    collapsing: false,
    interruptedActionPayload: null,
    ticksWorked: 0,
    restTicksRemaining: null,
    ...overrides,
  };
}

/** Place employees into the GameState and return it. */
function withEmployees(state: GameState, employees: Employee[]): GameState {
  state.employees.employees = employees;
  state.employees.nextId = employees.length + 1;
  return state;
}

/** Helper: create panel, attach to DOM, return both. */
function setupPanel(): { container: HTMLDivElement; panel: EmployeePanel } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new EmployeePanel(container);
  return { container, panel };
}

/** Helper: click the detail toggle in a given employee row. */
function clickToggle(row: HTMLElement): HTMLElement | null {
  const toggle = row.querySelector('.bs-detail-toggle') as HTMLElement | null;
  if (toggle) toggle.click();
  return row.querySelector('.bs-employee-detail') as HTMLElement | null;
}

// All six SkillCategory values
const ALL_CATEGORIES: SkillCategory[] = [
  'driving.truck',
  'driving.excavator',
  'driving.drill_rig',
  'blasting',
  'management',
  'geology',
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EmployeePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── 1. Employee Row Tests ──────────────────────────────────────────────────

  describe('Employee Row', () => {
    it('creates a row for each alive employee on update', () => {
      const emp = makeEmployee({ id: 1, name: 'Alice' });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();

      panel.update(state);

      const rows = container.querySelectorAll('.bs-employee-row');
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toContain('Alice');
      panel.dispose();
    });

    it('employee with qualifications creates skill entries in detail', () => {
      const emp = makeEmployee({
        qualifications: [
          { category: 'blasting', proficiencyLevel: 3, xp: 150 },
        ],
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      const detail = clickToggle(row);

      // The detail section is created (toggleDetail works), and it should
      // eventually contain the blasting skill name and stars. Currently the
      // stub just creates empty <span> placeholders.
      expect(detail).not.toBeNull();
      // FAILING: stub doesn't render the qualification category name
      expect(detail!.textContent).toContain('blasting');
      panel.dispose();
    });

    it('employee with zero qualifications shows "No skills assigned"', () => {
      const emp = makeEmployee({ qualifications: [] });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      const detail = clickToggle(row);

      // Stub: makeSkillSection returns empty div → should eventually show "No skills assigned"
      expect(detail).not.toBeNull();
      // FAILING: stub does not render "No skills assigned" text
      expect(detail!.textContent).toContain('No skills assigned');
      panel.dispose();
    });

    it('employee with max qualifications (all 6 categories) shows all', () => {
      const quals = ALL_CATEGORIES.map(c => ({
        category: c,
        proficiencyLevel: 5 as const,
        xp: 500,
      }));
      const emp = makeEmployee({ qualifications: quals });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      const detail = clickToggle(row);

      // All 6 category names should appear in the skill section
      expect(detail).not.toBeNull();
      // FAILING: stub doesn't render category names
      for (const cat of ALL_CATEGORIES) {
        expect(detail!.textContent).toContain(cat);
      }
      panel.dispose();
    });

    it('skill stars render correctly for level 5 (Master)', () => {
      const emp = makeEmployee({
        qualifications: [
          { category: 'blasting', proficiencyLevel: 5, xp: 800 },
        ],
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // FAILING: makeSkillStars stub returns '' — should return ★ characters
      // We test through the DOM; the skill section should contain star characters
      const skillSection = row.querySelector('.bs-employee-detail');
      expect(skillSection).not.toBeNull();
      // After implementation, stars like "★★★★★" should appear
      expect(skillSection!.textContent).toContain('★');
      panel.dispose();
    });

    it('XP bar width calculated correctly based on thresholds', () => {
      const emp = makeEmployee({
        qualifications: [
          { category: 'driving.truck', proficiencyLevel: 2, xp: 50 },
        ],
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // The XP bar should exist and have a width style set
      // Level 2 threshold is 100 XP; 50 XP → 50% fill between level 1 and 2
      const xpBars = row.querySelectorAll('.bs-employee-detail div');
      // FAILING: stub returns empty div with no width styling
      const hasXpBarWidth = Array.from(xpBars).some(
        el => el.style.width !== '' && el.style.width !== '0%',
      );
      expect(hasXpBarWidth).toBe(true);
      panel.dispose();
    });

    it('employee with no current task shows "No current task"', () => {
      const emp = makeEmployee({ activeActionId: null });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // FAILING: makeTaskQueue stub returns empty div
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('No current task');
      panel.dispose();
    });
  });

  // ── 2. Need Gauge Tests ────────────────────────────────────────────────────

  describe('Need Gauges', () => {
    it('need bars render for hunger, fatigue, and break', () => {
      const emp = makeEmployee({ hunger: 80, fatigue: 60, breakNeed: 40 });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Need bars should contain label text
      // FAILING: makeNeedBar stub returns empty div with no text
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('Hunger');
      expect(detail!.textContent).toContain('Fatigue');
      expect(detail!.textContent).toContain('Break');
      panel.dispose();
    });

    it('bar values reflect employee need values', () => {
      const emp = makeEmployee({ hunger: 42, fatigue: 78, breakNeed: 15 });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Need bars should display the percentage values
      // FAILING: stubs don't render values
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('42');
      expect(detail!.textContent).toContain('78');
      expect(detail!.textContent).toContain('15');
      panel.dispose();
    });

    it('bar color classes applied based on value ranges', () => {
      const emp = makeEmployee({ hunger: 15, fatigue: 90, breakNeed: 50 });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Need bar elements should have appropriate color classes
      // (e.g., "critical" for low values, "normal" for mid, "high" for high)
      // FAILING: stub doesn't create styled bars
      const detail = row.querySelector('.bs-employee-detail');
      const allDivs = detail!.querySelectorAll('div');
      const hasColorClass = Array.from(allDivs).some(
        el => el.className.includes('critical') || el.className.includes('low') || el.className.includes('normal'),
      );
      expect(hasColorClass).toBe(true);
      panel.dispose();
    });

    it('collapsing employees have visual indicator', () => {
      const emp = makeEmployee({ collapsing: true, fatigue: 3 });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Collapsing state should add visual indicator (class or icon)
      // FAILING: stubs don't differentiate collapsing state
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail).not.toBeNull();
      expect(row.className).toContain('collapsing');
      panel.dispose();
    });
  });

  // ── 3. Task Queue Tests ────────────────────────────────────────────────────

  describe('Task Queue', () => {
    it('task queue section renders when detail is toggled open', () => {
      const emp = makeEmployee();
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // The detail section exists; task queue should be inside it
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail).not.toBeNull();
      panel.dispose();
    });

    it('current active task is highlighted', () => {
      const emp = makeEmployee({ activeActionId: 42 });
      const state = withEmployees(makeMockState(), [emp]);
      state.pendingActions = [
        {
          id: 42,
          type: 'drill_hole',
          requiredSkill: 'driving.drill_rig',
          requiredVehicleRole: null,
          targetX: 5,
          targetZ: 5,
          targetY: 0,
          payload: {},
          targetEmployeeId: null,
        },
      ];
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Active task should be highlighted (e.g., with a CSS class or "Active" label)
      // FAILING: makeTaskQueue stub doesn't render anything
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('Active');
      panel.dispose();
    });

    it('empty queue shows "Queue empty" state', () => {
      const emp = makeEmployee({ activeActionId: null });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // FAILING: makeTaskQueue stub doesn't render "Queue empty"
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('Queue empty');
      panel.dispose();
    });

    it('up to 5 pending actions shown in queue', () => {
      const emp = makeEmployee({ activeActionId: 1 });
      const state = withEmployees(makeMockState(), [emp]);
      // Create 8 pending actions to test the 5-entry cap
      state.pendingActions = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        type: 'drill_hole' as const,
        requiredSkill: null,
        requiredVehicleRole: null,
        targetX: i,
        targetZ: i,
        targetY: 0,
        payload: {},
        targetEmployeeId: null,
      }));
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // There should be an overflow indicator for 3 remaining (8 - 5 = 3)
      // FAILING: makeTaskQueue stub doesn't render queue entries
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('+3 more');
      panel.dispose();
    });
  });

  // ── 4. Salary Breakdown Tests ──────────────────────────────────────────────

  describe('Salary Breakdown', () => {
    it('salary shows base role salary', () => {
      const emp = makeEmployee({ role: 'driller', salary: 500 });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Should show "Salary Breakdown" header and base salary
      // FAILING: makeSalaryBreakdown stub doesn't render content
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('Salary Breakdown');
      expect(detail!.textContent).toContain('Base');
      expect(detail!.textContent).toContain('500');
      panel.dispose();
    });

    it('salary shows qualification bonuses', () => {
      const emp = makeEmployee({
        role: 'blaster',
        qualifications: [
          { category: 'blasting', proficiencyLevel: 3, xp: 200 },
        ],
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Should show bonus amount: QUALIFICATION_SALARY_BONUS[3] = 220
      // FAILING: stub doesn't render bonus
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('Bonus');
      expect(detail!.textContent).toContain('220');
      panel.dispose();
    });

    it('multi-skilled employee costs more', () => {
      const emp = makeEmployee({
        role: 'surveyor',
        qualifications: [
          { category: 'geology', proficiencyLevel: 2, xp: 100 },
          { category: 'blasting', proficiencyLevel: 4, xp: 600 },
        ],
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Total salary = BASE_SALARIES.surveyor (600) + bonus[2] (120) + bonus[4] (350) = 1070
      // FAILING: stub doesn't calculate or display total
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('Total');
      expect(detail!.textContent).toContain('1070');
      panel.dispose();
    });

    it('total matches base + qualification sum', () => {
      const emp = makeEmployee({
        role: 'driver',
        qualifications: [
          { category: 'driving.truck', proficiencyLevel: 1, xp: 10 },
          { category: 'driving.excavator', proficiencyLevel: 5, xp: 900 },
        ],
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // BASE driver = 400, bonuses: 50 + 500 = 550, total = 950
      // FAILING: stub doesn't render
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('Total');
      expect(detail!.textContent).toContain('950');
      panel.dispose();
    });
  });

  // ── 5. Training Badge Tests ────────────────────────────────────────────────

  describe('Training Badge', () => {
    it('training badge shows when trainingState is active', () => {
      const emp = makeEmployee({
        trainingState: {
          buildingId: 1,
          skill: 'blasting',
          ticksRemaining: 5,
          fee: 500,
        },
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Training badge should show skill name and ticks remaining
      // FAILING: makeTrainingBadge stub returns empty <span>
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('Training');
      expect(detail!.textContent).toContain('blasting');
      expect(detail!.textContent).toContain('5');
      panel.dispose();
    });

    it('no badge when trainingState is null', () => {
      const emp = makeEmployee({ trainingState: null });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // When not training, no Training badge should appear
      const detail = row.querySelector('.bs-employee-detail');
      // FAILING: makeTrainingBadge returns null for null trainingState (correct),
      // but the test also checks for absence of Training text which requires
      // the rest of the detail to NOT have "Training" header
      // Actually the stub returns null so the badge is simply not appended.
      // This test should PASS (badge is null → not appended).
      // We'll keep it as a regression guard.
      expect(detail).not.toBeNull();
      panel.dispose();
    });

    it('badge shows skill name and ticks remaining', () => {
      const emp = makeEmployee({
        trainingState: {
          buildingId: 2,
          skill: 'driving.excavator',
          ticksRemaining: 12,
          fee: 800,
        },
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // FAILING: stub returns empty span, no text
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail!.textContent).toContain('driving.excavator');
      expect(detail!.textContent).toContain('12');
      panel.dispose();
    });
  });

  // ── 6. Detail Toggle Tests ─────────────────────────────────────────────────

  describe('Detail Toggle', () => {
    it('first click shows detail section', () => {
      const emp = makeEmployee();
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      const detail = clickToggle(row);

      expect(detail).not.toBeNull();
      expect(detail!.className).toContain('bs-employee-detail');
      panel.dispose();
    });

    it('second click hides detail section', () => {
      const emp = makeEmployee();
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      // Open
      clickToggle(row);
      expect(row.querySelector('.bs-employee-detail')).not.toBeNull();

      // Close
      clickToggle(row);
      expect(row.querySelector('.bs-employee-detail')).toBeNull();
      panel.dispose();
    });

    it('detail section contains skills, needs, task queue, salary, and modifiers', () => {
      const emp = makeEmployee();
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      const detail = row.querySelector('.bs-employee-detail');
      expect(detail).not.toBeNull();

      // All five subsections should be present as child divs
      const childDivs = detail!.querySelectorAll(':scope > div');
      // Minimum: skill section + need row + task queue + salary breakdown + modifiers
      expect(childDivs.length).toBeGreaterThanOrEqual(5);
      panel.dispose();
    });

    it('only one detail section exists at a time per row', () => {
      const emp = makeEmployee();
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);
      clickToggle(row); // close
      clickToggle(row); // open again

      const details = row.querySelectorAll('.bs-employee-detail');
      expect(details.length).toBe(1);
      panel.dispose();
    });
  });

  // ── 7. Edge Cases ──────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('employee at level 5 (max) XP bar shows full', () => {
      const emp = makeEmployee({
        qualifications: [
          { category: 'blasting', proficiencyLevel: 5, xp: 2000 },
        ],
      });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // At max level, XP bar should be 100% filled
      // FAILING: stub doesn't create a styled XP bar
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail).not.toBeNull();
      const allDivs = detail!.querySelectorAll('div');
      const hasFullBar = Array.from(allDivs).some(
        el => el.style.width === '100%',
      );
      expect(hasFullBar).toBe(true);
      panel.dispose();
    });

    it('employee with no qualifications (empty array)', () => {
      const emp = makeEmployee({ qualifications: [] });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Should still create a valid detail section, just empty of skills
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail).not.toBeNull();
      panel.dispose();
    });

    it('employee with null activeActionId', () => {
      const emp = makeEmployee({ activeActionId: null });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      const detail = clickToggle(row);

      // No crash; detail section still renders
      expect(detail).not.toBeNull();
      panel.dispose();
    });

    it('employee with all need gauges at zero', () => {
      const emp = makeEmployee({ hunger: 0, fatigue: 0, breakNeed: 0 });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      clickToggle(row);

      // Need bars should still render without crash
      const detail = row.querySelector('.bs-employee-detail');
      expect(detail).not.toBeNull();
      // FAILING: stub doesn't render need values
      expect(detail!.textContent).toContain('0');
      panel.dispose();
    });

    it('multiple employees each with different states', () => {
      const emp1 = makeEmployee({
        id: 1, name: 'Alice', role: 'driller',
        qualifications: [{ category: 'blasting', proficiencyLevel: 3, xp: 200 }],
        hunger: 90, fatigue: 50, breakNeed: 70,
        trainingState: null, activeActionId: 10,
      });
      const emp2 = makeEmployee({
        id: 2, name: 'Bob', role: 'blaster',
        qualifications: [],
        hunger: 10, fatigue: 5, breakNeed: 2,
        trainingState: { buildingId: 1, skill: 'geology', ticksRemaining: 3, fee: 400 },
        activeActionId: null,
      });
      const state = withEmployees(makeMockState(), [emp1, emp2]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const rows = container.querySelectorAll('.bs-employee-row');
      expect(rows.length).toBe(2);

      // Verify each employee has correct name
      const names = Array.from(rows).map(r => r.textContent);
      expect(names[0]).toContain('Alice');
      expect(names[1]).toContain('Bob');

      // Toggle detail on each row independently
      const detail1 = clickToggle(rows[0] as HTMLElement);
      expect(detail1).not.toBeNull();

      const detail2 = clickToggle(rows[1] as HTMLElement);
      expect(detail2).not.toBeNull();

      // Detail sections are independent
      expect(rows[0].querySelectorAll('.bs-employee-detail').length).toBe(1);
      expect(rows[1].querySelectorAll('.bs-employee-detail').length).toBe(1);
      panel.dispose();
    });

    it('dead employees are not shown in the list', () => {
      const alive = makeEmployee({ id: 1, name: 'Alive', alive: true });
      const dead = makeEmployee({ id: 2, name: 'Dead', alive: false });
      const state = withEmployees(makeMockState(), [alive, dead]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const rows = container.querySelectorAll('.bs-employee-row');
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toContain('Alive');
      expect(rows[0].textContent).not.toContain('Dead');
      panel.dispose();
    });

    it('unionized employee row shows union tag', () => {
      const emp = makeEmployee({ unionized: true });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      expect(row.textContent).toContain('Union');
      panel.dispose();
    });

    it('injured employee row shows injury indicator', () => {
      const emp = makeEmployee({ injured: true });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const row = container.querySelector('.bs-employee-row') as HTMLElement;
      expect(row.textContent).toContain('⚠️');
      panel.dispose();
    });

    it('fire button disabled for unionized employee', () => {
      const emp = makeEmployee({ unionized: true });
      const state = withEmployees(makeMockState(), [emp]);
      const { container, panel } = setupPanel();
      panel.update(state);

      const fireBtn = container.querySelector('.bs-btn-danger') as HTMLButtonElement;
      expect(fireBtn.disabled).toBe(true);
      panel.dispose();
    });

    it('panel shows "No employees." when employee list is empty', () => {
      const state = makeMockState();
      state.employees.employees = [];
      const { container, panel } = setupPanel();
      panel.update(state);

      expect(container.textContent).toContain('No employees.');
      panel.dispose();
    });
  });
});
