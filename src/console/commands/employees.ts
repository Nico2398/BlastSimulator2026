// BlastSimulator2026 — Console commands for employees
// Roster, hiring, pay, skills, and training.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  hireEmployee,
  giveRaise,
  fireEmployee,
  assignSkill,
  type EmployeeRole,
  type SkillCategory,
} from '../../core/entities/Employee.js';
import {
  enrolInTraining,
  planTraining,
  schoolFor,
  trainableSkills,
} from '../../core/entities/EmployeeTraining.js';
import { addExpense } from '../../core/economy/Finance.js';
import { Random } from '../../core/math/Random.js';
import { requireGame, NO_EMPLOYEES_MSG } from './commandUtils.js';

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
  const rng = new Random(state.seed + state.tickCount);

  switch (sub) {
    case 'list': {
      if (state.employees.employees.length === 0) {
        return { success: true, output: NO_EMPLOYEES_MSG };
      }
      const lines = ['Employees:'];
      for (const e of state.employees.employees) {
        const status = !e.alive ? 'DEAD' : e.injured ? 'INJURED' : 'OK';
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
      const empX = state.world ? state.world.sizeX / 2 + (state.employees.employees.length % 5) * 2 : 32;
      const empZ = state.world ? state.world.sizeZ / 2 : 32;
      const { employee, hiringCost } = hireEmployee(state.employees, role, rng, empX, empZ);
      state.cash -= hiringCost;
      addExpense(state.finances, hiringCost, 'salaries', `Hire ${role}: ${employee.name}`, state.tickCount);
      return { success: true, output: `Hired ${employee.name} (${role}). Cost: $${hiringCost}` };
    }
    case 'raise': {
      const id = parseInt(args[1] ?? named['id'] ?? '', 10);
      const amount = parseFloat(named['amount'] ?? '0');
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
      return { success: false, output: 'Usage: employee (list|hire|raise|fire|assign_skill|train)' };
  }
}

