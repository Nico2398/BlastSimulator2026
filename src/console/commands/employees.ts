// BlastSimulator2026 — Console commands for employees
// Roster, hiring, pay, skills, and training.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  hireEmployee,
  giveRaise,
  fireEmployee,
  assignSkill,
  HIRING_COSTS,
  type EmployeeRole,
  type SkillCategory,
} from '../../core/entities/Employee.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import {
  enrolInTraining,
  planTraining,
  schoolFor,
  trainableSkills,
} from '../../core/entities/EmployeeTraining.js';
import { addExpense } from '../../core/economy/Finance.js';
import { dispatchPendingAction } from '../../core/engine/TaskDispatch.js';
import { Random } from '../../core/math/Random.js';
import { requireGame, NO_EMPLOYEES_MSG } from './commandUtils.js';
import { NavGrid } from '../../core/nav/NavGrid.js';

const VALID_SKILL_CATEGORIES: SkillCategory[] = [
  'driving.truck', 'driving.excavator', 'driving.drill_rig',
  'blasting', 'management', 'geology',
];

export function employeeCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'list';

  switch (sub) {
    case 'list': {
      if (state.employees.employees.length === 0) {
        return { success: true, output: NO_EMPLOYEES_MSG };
      }
      const lines = ['Employees:'];
      for (const e of state.employees.employees) {
        // Collapsing is a distinct working state — the employee is alive and
        // uninjured but stopped, and until now only the roster panel showed it.
        const status = !e.alive ? 'DEAD' : e.injured ? 'INJURED' : e.collapsing ? 'COLLAPSING' : 'OK';
        const union = e.unionized ? ' [UNION]' : '';
        lines.push(`  [${e.id}] ${e.name} (${e.role}) $${e.salary}/cycle morale:${e.morale} ${status}${union}`);
      }
      return { success: true, output: lines.join('\n') };
    }
    case 'hire': {
      const role = (named['role'] ?? '') as EmployeeRole;
      const validRoles: EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];
      if (!validRoles.includes(role)) {
        return { success: false, output: `Usage: employee hire role:(${validRoles.join('|')})` };
      }
      // Affordability is checked here, not after hireEmployee, because
      // hireEmployee *mutates* — it pushes the employee and bumps nextId
      // before it can report a cost. Same predicate and same cost source as
      // the UI: CrewPanel disables the hire button on
      // `state.cash < HIRING_COSTS[role]`, and hireEmployee's returned
      // hiringCost is exactly `HIRING_COSTS[role]`.
      const hiringCost = HIRING_COSTS[role];
      if (state.cash < hiringCost) {
        return {
          success: false,
          output: `Insufficient funds: need $${formatMoney(hiringCost)}, have $${formatMoney(state.cash)}`,
        };
      }
      const rawEmpX = state.world ? state.world.sizeX / 2 + (state.employees.employees.length % 5) * 2 : 32;
      const rawEmpZ = state.world ? state.world.sizeZ / 2 : 32;
      // Same void/isolated-pocket hazard as vehicle purchase spawn (#437): a
      // blast can clear the grid centre where new hires spawn down to a
      // floorless column. A hire whose own start tile is impassable can never
      // path anywhere afterwards — findPath rejects an impassable start
      // outright — so snap to the nearest tile actually connected to the
      // map's main region before placing them.
      const { x: empX, z: empZ } = state.navGrid
        ? NavGrid.findNearestReachableCell(state.navGrid, 0, 0, rawEmpX, rawEmpZ)
        : { x: rawEmpX, z: rawEmpZ };
      // Seeded on nextId too, not just seed+tickCount: two hires dispatched in
      // the same tick would otherwise re-seed identically and always pick the
      // same name pair (this is what the design mock's own CREW fixture data
      // shows — two "Walt Diggins" hired the same day).
      const rng = new Random(state.seed + state.tickCount + state.employees.nextId);
      // Deducts the same `hiringCost` the guard above tested, so the checked
      // amount and the charged amount can never drift apart.
      const { employee } = hireEmployee(state.employees, role, rng, empX, empZ, state.tickCount);
      state.cash -= hiringCost;
      addExpense(state.finances, hiringCost, 'salaries', `Hire ${role}: ${employee.name}`, state.tickCount);
      return { success: true, output: `Hired ${employee.name} (${role}). Cost: $${hiringCost}` };
    }
    case 'raise': {
      const id = parseInt(args[1] ?? named['id'] ?? '', 10);
      const amount = parseFloat(named['amount'] ?? '0');
      // guard fix incoming (#534): non-numeric amount ("abc") parses to NaN,
      // and NaN <= 0 is false, so it slips past this check and poisons salary.
      if (isNaN(id) || amount <= 0) {
        return { success: false, output: 'Usage: employee raise <id> amount:500' };
      }
      if (!giveRaise(state.employees, id, amount)) {
        return { success: false, output: `Employee #${id} not found.` };
      }
      return { success: true, output: `Raise of $${amount} given to employee #${id}.` };
    }
    case 'fire': {
      const id = parseInt(args[1] ?? named['id'] ?? '', 10);
      if (isNaN(id)) return { success: false, output: 'Usage: employee fire <id>' };
      const result = fireEmployee(state.employees, id);
      if (!result.success) return { success: false, output: result.error! };
      return { success: true, output: `Employee #${id} fired.` };
    }
    case 'assign_skill': {
      const id = parseInt(args[1] ?? '', 10);
      const skillRaw = named['skill'] ?? '';
      const levelRaw = named['level'] ?? '';
      const level = parseInt(levelRaw, 10);
      const usageMsg = 'Usage: employee assign_skill <id> skill:<category> level:1-5';

      if (isNaN(id)) return { success: false, output: usageMsg };
      if (!VALID_SKILL_CATEGORIES.includes(skillRaw as SkillCategory)) return { success: false, output: usageMsg };
      if (isNaN(level) || level < 1 || level > 5) return { success: false, output: usageMsg };

      const emp = state.employees.employees.find(e => e.id === id);
      if (!emp) return { success: false, output: `Employee #${id} not found.` };

      assignSkill(state.employees, id, skillRaw as SkillCategory, level as 1 | 2 | 3 | 4 | 5);
      return { success: true, output: `Employee #${id} assigned skill: ${skillRaw} (level ${level}).` };
    }
    case 'dispatch': {
      // Pushes a generic work PendingAction targeting a specific employee —
      // the same pending-action pool tickEmployees() already claims idle
      // employees from (see GameLoop.ts). Exists so console/scenario driving
      // can put an employee to genuine, ticksWorked-incrementing work without
      // a full drill/haul pipeline: no console command currently creates one
      // (drill_plan and build both mutate state directly, and survey completes
      // synchronously), which left the Bunkhouse shift-cycle unreachable from
      // any player-facing flow.
      const id = parseInt(args[1] ?? named['id'] ?? '', 10);
      const usageMsg = 'Usage: employee dispatch <id> x:<X> z:<Z> [skill:<category>]';
      if (isNaN(id)) return { success: false, output: usageMsg };
      const x = parseFloat(named['x'] ?? '');
      const z = parseFloat(named['z'] ?? '');
      if (isNaN(x) || isNaN(z)) return { success: false, output: usageMsg };
      // Optional named skill param, threaded through to requiredSkill below.
      // Not validated against VALID_SKILL_CATEGORIES like assign_skill/train are:
      // an unrecognized category just matches no employee's qualifications, so
      // dispatchPendingAction rejects it below as "no one qualifies" rather than
      // as a usage error.
      const skillRaw = named['skill'];
      const requiredSkill: SkillCategory | null = skillRaw !== undefined ? (skillRaw as SkillCategory) : null;

      const emp = state.employees.employees.find(e => e.id === id);
      if (!emp) return { success: false, output: `Employee #${id} not found.` };
      if (!emp.alive) return { success: false, output: `Employee #${id} is not available.` };
      if (emp.injured) return { success: false, output: `Employee #${id} is injured and cannot be dispatched.` };
      if (emp.trainingState !== null) {
        return { success: false, output: `Employee #${id} is in training and cannot be dispatched.` };
      }

      const actionId = state.nextPendingActionId++;
      // dispatchPendingAction (TaskDispatch.ts) owns both the pendingActions
      // push and the mirrored ghostPreviews push, plus the qualification check
      // — since this call always sets targetEmployeeId, that check validates
      // employee #id specifically (not just "someone on the roster"), so a
      // targeted-but-unqualified dispatch rejects here instead of silently
      // queuing forever (idleMatch in GameLoop.ts can never match anyone else) (#406).
      const dispatch = dispatchPendingAction(state, {
        id: actionId,
        type: 'general_work',
        requiredSkill,
        requiredVehicleRole: null,
        targetX: x,
        targetZ: z,
        targetY: 0,
        payload: {},
        targetEmployeeId: id,
      });
      if (!dispatch.success) {
        // dispatch.reason (TaskDispatch.ts) distinguishes "nobody on the roster
        // holds this skill" from "this specific target doesn't, though someone
        // else might" — the two need different messages or the latter wrongly
        // reads as "nobody qualifies" (#406).
        const message = dispatch.reason === 'target-unqualified'
          ? `Employee #${id} (${emp.name}) does not hold skill: ${requiredSkill}.`
          : requiredSkill !== null
            ? `No employee on the roster holds skill: ${requiredSkill}.`
            : `Dispatch rejected: no eligible employee on the roster.`;
        return { success: false, output: message };
      }
      return {
        success: true,
        output: `Employee #${id} dispatched to work at (${x}, ${z}). Action ID: ${actionId}.`,
      };
    }
    case 'train': {
      const id = parseInt(args[1] ?? '', 10);
      const skillRaw = named['skill'] ?? '';
      const usageMsg = 'Usage: employee train <id> skill:<category> [building:<id>]';

      if (isNaN(id)) return { success: false, output: usageMsg };
      if (!VALID_SKILL_CATEGORIES.includes(skillRaw as SkillCategory)) {
        return { success: false, output: usageMsg };
      }
      const skill = skillRaw as SkillCategory;

      const emp = state.employees.employees.find(e => e.id === id);
      if (!emp) return { success: false, output: `Employee #${id} not found.` };

      // Pick the school: the one named, else any built one that teaches this skill.
      const schoolType = schoolFor(skill);
      if (!schoolType) return { success: false, output: `No building teaches ${skill}.` };

      const buildingRaw = named['building'];
      const candidates = state.buildings.buildings.filter(
        b => trainableSkills(b.type).includes(skill),
      );
      const building = buildingRaw !== undefined
        ? candidates.find(b => b.id === parseInt(buildingRaw, 10))
        // Highest tier first: a better school teaches faster.
        : [...candidates].sort((a, b) => b.tier - a.tier)[0];

      if (!building) {
        return {
          success: false,
          output: buildingRaw !== undefined
            ? `Building #${buildingRaw} does not teach ${skill}.`
            : `No ${schoolType} on site. Build one to train ${skill}.`,
        };
      }

      const plan = planTraining(emp, skill, building.tier);
      if (!plan) return { success: false, output: `${emp.name} is already a Master of ${skill}.` };
      if (state.cash < plan.fee) {
        return { success: false, output: `Insufficient funds: course costs $${plan.fee}.` };
      }

      const result = enrolInTraining(state.employees, id, building, skill);
      if (!result.success) return { success: false, output: result.error! };

      state.cash -= plan.fee;
      addExpense(state.finances, plan.fee, 'salaries', `Train ${emp.name}: ${skill}`, state.tickCount);
      return {
        success: true,
        output: `${emp.name} enrolled at ${building.type} #${building.id}: ${skill} `
          + `level ${plan.targetLevel} in ${plan.ticks} ticks ($${plan.fee}).`,
      };
    }
    default:
      return { success: false, output: 'Usage: employee (list|hire|raise|fire|assign_skill|dispatch|train)' };
  }
}

