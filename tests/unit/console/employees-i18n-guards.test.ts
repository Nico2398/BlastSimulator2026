// BlastSimulator2026 — employees.ts i18n guards (#883)
//
// employees.ts's own hardcoded guard/usage/rejection/success strings — the
// hire usage and success messages, the raise usage/success messages, the
// employee_not_found rejection shared across raise/assign_skill/dispatch/
// train, the fire usage/success messages, assign_skill's usage/dead/success
// messages, dispatch's usage/not_available/injured/in_training/
// target_unqualified/no_skill_holder/no_eligible/success messages, train's
// usage/no_school/building_no_teach/no_building_on_site/already_master/
// insufficient_funds/success messages, cancel's usage/not_cancellable/
// action_not_found/refund_suffix/success messages, and the default-
// subcommand usage string — all route through t() (see src/core/i18n/I18n.ts
// and src/core/i18n/locales/{en,fr}.json). Every test below pins the exact
// English literal and additionally proves the output changes under locale
// 'fr', so a hardcoded string that merely matches en.json cannot pass.
//
// employeeCommand's hire guard reuses the pre-existing shared
// console.insufficient_funds key — already covered end-to-end (English
// literal + refusal semantics) by insufficient-funds-guards.test.ts's
// "employee hire — insufficient funds guard" describe block, so no
// duplicate coverage is added here.
//
// dispatch_no_skill_holder and dispatch_no_eligible are currently
// unreachable through employeeCommand('dispatch', ...): the call site always
// sets targetEmployeeId, so dispatchPendingAction (TaskDispatch.ts) can only
// ever return reason 'target-not-found' (pre-filtered by employeeCommand's
// own `!emp` check above it) or 'target-unqualified' — never
// 'roster-unqualified', which is the only reason that falls through to the
// no_skill_holder/no_eligible branch. Both are tested via a direct t() call
// instead, proving the i18n layer itself is correct.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { employeeCommand } from '../../../src/console/commands/employees.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { hireEmployee, assignSkill, HIRING_COSTS, type EmployeeRole } from '../../../src/core/entities/Employee.js';
import { placeBuilding, type BuildingType, type BuildingTier } from '../../../src/core/entities/Building.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { Random } from '../../../src/core/math/Random.js';
import * as EmployeeTrainingModule from '../../../src/core/entities/EmployeeTraining.js';

function makeCtx(cash = 1_000_000): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter(), landscape: null, playableArea: null };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  ctx.state!.cash = cash;
  ctx.state!.finances.cash = cash;
  return ctx;
}

/** Hires directly through the core function — bypasses cash and the console layer entirely. */
function hireTestEmployee(ctx: GameContext, role: EmployeeRole = 'driller') {
  const { employee } = hireEmployee(ctx.state!.employees, role, new Random(1));
  // Deterministic across every test — a random 30% unionized roll would
  // otherwise make fireEmployee's own unrelated union guard flaky here.
  employee.unionized = false;
  return employee;
}

/** Place a building directly through core placeBuilding — bypasses cash and the build console command. */
function placeTestBuilding(ctx: GameContext, type: BuildingType = 'management_office', tier: BuildingTier = 1): number {
  const grid = ctx.grid!;
  const result = placeBuilding(ctx.state!.buildings, type, 0, 0, grid.sizeX, grid.sizeZ, tier, grid.minX, grid.minZ);
  if (!result.success) throw new Error(`setup: failed to place test building — ${result.error}`);
  return result.building!.id;
}

afterEach(() => setLocale('en'));

// ── table-driven: static/simple keys reachable directly through the command ──

describe('employees.ts — English literal + fr divergence (table-driven)', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'hire usage (invalid role)',
      englishLiteral: 'Usage: employee hire role:(driller|blaster|driver|surveyor|manager)',
      run: (ctx) => employeeCommand(ctx, ['hire'], {}),
    },
    {
      name: 'raise usage (invalid id)',
      englishLiteral: 'Usage: employee raise <id> amount:500',
      run: (ctx) => employeeCommand(ctx, ['raise'], {}),
    },
    {
      name: 'fire usage (invalid id)',
      englishLiteral: 'Usage: employee fire <id>',
      run: (ctx) => employeeCommand(ctx, ['fire'], {}),
    },
    {
      name: 'assign_skill usage (invalid id)',
      englishLiteral: 'Usage: employee assign_skill <id> skill:<category> level:1-5',
      run: (ctx) => employeeCommand(ctx, ['assign_skill'], {}),
    },
    {
      name: 'dispatch usage (invalid id)',
      englishLiteral: 'Usage: employee dispatch <id> x:<X> z:<Z> [skill:<category>]',
      run: (ctx) => employeeCommand(ctx, ['dispatch'], {}),
    },
    {
      name: 'train usage (invalid id)',
      englishLiteral: 'Usage: employee train <id> skill:<category> [building:<id>]',
      run: (ctx) => employeeCommand(ctx, ['train'], {}),
    },
    {
      name: 'cancel usage (invalid id)',
      englishLiteral: 'Usage: employee cancel <action-id>',
      run: (ctx) => employeeCommand(ctx, ['cancel'], {}),
    },
    {
      name: 'default/no-subcommand usage',
      englishLiteral: 'Usage: employee (list|hire|raise|fire|assign_skill|dispatch|train|cancel)',
      run: (ctx) => employeeCommand(ctx, ['bogus'], {}),
    },
  ];

  for (const { name, englishLiteral, run } of cases) {
    it(`${name} — matches the exact English literal by default`, () => {
      const ctx = makeCtx();
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeCtx();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(englishLiteral);
    });
  }
});

// ── employees.employee_not_found — shared across 4 call sites ────────────

describe('employees.ts — employee_not_found (shared across raise/assign_skill/dispatch/train)', () => {
  const NOT_FOUND_ID = 999999;
  const NOT_FOUND_EN = `Employee #${NOT_FOUND_ID} not found.`;

  const cases: Array<{
    name: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    { name: 'raise', run: (ctx) => employeeCommand(ctx, ['raise', String(NOT_FOUND_ID)], { amount: '500' }) },
    { name: 'assign_skill', run: (ctx) => employeeCommand(ctx, ['assign_skill', String(NOT_FOUND_ID)], { skill: 'geology', level: '1' }) },
    { name: 'dispatch', run: (ctx) => employeeCommand(ctx, ['dispatch', String(NOT_FOUND_ID)], { x: '1', z: '1' }) },
    { name: 'train', run: (ctx) => employeeCommand(ctx, ['train', String(NOT_FOUND_ID)], { skill: 'geology' }) },
  ];

  for (const { name, run } of cases) {
    it(`${name} — resolves to the exact English literal by default`, () => {
      const ctx = makeCtx();
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(NOT_FOUND_EN);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeCtx();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(NOT_FOUND_EN);
    });
  }
});

// ── hire_success ──────────────────────────────────────────────────────────

describe('employees.ts — hire success message', () => {
  it('matches the exact English literal, embedding the real generated name/role/cost', () => {
    const ctx = makeCtx();
    const result = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(result.success).toBe(true);
    const emp = ctx.state!.employees.employees[0]!;
    expect(result.output).toBe(`Hired ${emp.name} (driller). Cost: $${HIRING_COSTS.driller}`);
    expect(result.output).toContain('driller');
    expect(result.output).toContain(String(HIRING_COSTS.driller));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(result.success).toBe(true);
    const emp = ctx.state!.employees.employees[0]!;
    expect(result.output).not.toBe(`Hired ${emp.name} (driller). Cost: $${HIRING_COSTS.driller}`);
  });
});

// ── raise_success ─────────────────────────────────────────────────────────

describe('employees.ts — raise success message', () => {
  it('matches the exact English literal, embedding the real amount and id', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    const result = employeeCommand(ctx, ['raise', String(emp.id)], { amount: '500' });
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Raise of $500 given to employee #${emp.id}.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    setLocale('fr');
    const result = employeeCommand(ctx, ['raise', String(emp.id)], { amount: '500' });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Raise of $500 given to employee #${emp.id}.`);
  });
});

// ── fire_success ──────────────────────────────────────────────────────────

describe('employees.ts — fire success message', () => {
  it('matches the exact English literal, embedding the real id', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    const result = employeeCommand(ctx, ['fire', String(emp.id)], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Employee #${emp.id} fired.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    setLocale('fr');
    const result = employeeCommand(ctx, ['fire', String(emp.id)], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Employee #${emp.id} fired.`);
  });
});

// ── assign_skill_dead ─────────────────────────────────────────────────────

describe('employees.ts — assign_skill on a dead employee', () => {
  const EN = (id: number) => `Employee #${id} is dead and cannot be assigned a skill.`;

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    emp.alive = false;
    const result = employeeCommand(ctx, ['assign_skill', String(emp.id)], { skill: 'geology', level: '1' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN(emp.id));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    emp.alive = false;
    setLocale('fr');
    const result = employeeCommand(ctx, ['assign_skill', String(emp.id)], { skill: 'geology', level: '1' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN(emp.id));
  });
});

// ── assign_skill_success ─────────────────────────────────────────────────

describe('employees.ts — assign_skill success message', () => {
  it('matches the exact English literal, embedding the real skill/level/id', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    const result = employeeCommand(ctx, ['assign_skill', String(emp.id)], { skill: 'geology', level: '3' });
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Employee #${emp.id} assigned skill: geology (level 3).`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    setLocale('fr');
    const result = employeeCommand(ctx, ['assign_skill', String(emp.id)], { skill: 'geology', level: '3' });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Employee #${emp.id} assigned skill: geology (level 3).`);
  });
});

// ── dispatch_not_available ───────────────────────────────────────────────

describe('employees.ts — dispatch on a dead (unavailable) employee', () => {
  const EN = (id: number) => `Employee #${id} is not available.`;

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    emp.alive = false;
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN(emp.id));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    emp.alive = false;
    setLocale('fr');
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN(emp.id));
  });
});

// ── dispatch_injured ──────────────────────────────────────────────────────

describe('employees.ts — dispatch on an injured employee', () => {
  const EN = (id: number) => `Employee #${id} is injured and cannot be dispatched.`;

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    emp.injured = true;
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN(emp.id));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    emp.injured = true;
    setLocale('fr');
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN(emp.id));
  });
});

// ── dispatch_in_training ─────────────────────────────────────────────────

describe('employees.ts — dispatch on an employee currently in training', () => {
  const EN = (id: number) => `Employee #${id} is in training and cannot be dispatched.`;

  function putInTraining(ctx: GameContext, empId: number): void {
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    emp.trainingState = { buildingId: 1, skill: 'geology', ticksRemaining: 10, fee: 100 };
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    putInTraining(ctx, emp.id);
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN(emp.id));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    putInTraining(ctx, emp.id);
    setLocale('fr');
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN(emp.id));
  });
});

// ── dispatch_target_unqualified ──────────────────────────────────────────

describe('employees.ts — dispatch targeting a skill the employee does not hold', () => {
  // driller's only starting qualification is 'blasting' (ROLE_STARTING_QUALIFICATION) —
  // asking it to dispatch with skill:geology always misses.
  function expectedEn(id: number, name: string): string {
    return `Employee #${id} (${name}) does not hold skill: geology.`;
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx, 'driller');
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1', skill: 'geology' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(expectedEn(emp.id, emp.name));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx, 'driller');
    setLocale('fr');
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1', skill: 'geology' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(expectedEn(emp.id, emp.name));
  });
});

// ── dispatch_success ──────────────────────────────────────────────────────

describe('employees.ts — dispatch success message', () => {
  it('matches the exact English literal, embedding the real id/x/z/actionId', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    const expectedActionId = ctx.state!.nextPendingActionId;
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '5', z: '7' });
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Employee #${emp.id} dispatched to work at (5, 7). Action ID: ${expectedActionId}.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    const expectedActionId = ctx.state!.nextPendingActionId;
    setLocale('fr');
    const result = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '5', z: '7' });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Employee #${emp.id} dispatched to work at (5, 7). Action ID: ${expectedActionId}.`);
  });
});

// ── dispatch_no_skill_holder / dispatch_no_eligible — direct t() calls ───
// See file-header comment: both are unreachable through employeeCommand
// itself, so these test the i18n layer's own keys directly.

describe('employees.ts — dispatch_no_skill_holder / dispatch_no_eligible (direct t() — see file header)', () => {
  it('dispatch_no_skill_holder — English literal', () => {
    setLocale('en');
    expect(t('employees.dispatch_no_skill_holder', { skill: 'blasting' }))
      .toBe('No employee on the roster holds skill: blasting.');
  });

  it('dispatch_no_skill_holder — differs under locale fr', () => {
    setLocale('fr');
    expect(t('employees.dispatch_no_skill_holder', { skill: 'blasting' }))
      .not.toBe('No employee on the roster holds skill: blasting.');
  });

  it('dispatch_no_eligible — English literal', () => {
    setLocale('en');
    expect(t('employees.dispatch_no_eligible'))
      .toBe('Dispatch rejected: no eligible employee on the roster.');
  });

  it('dispatch_no_eligible — differs under locale fr', () => {
    setLocale('fr');
    expect(t('employees.dispatch_no_eligible'))
      .not.toBe('Dispatch rejected: no eligible employee on the roster.');
  });
});

// ── train_no_school ───────────────────────────────────────────────────────
// Every VALID_SKILL_CATEGORIES entry in employees.ts today has a school in
// TRAINING_BUILDING_SKILLS (balance.ts), so this branch is only reachable by
// mocking schoolFor to return null for an otherwise-valid category — same
// technique campaign-i18n-guards.test.ts uses on BiomeCatalogModule.getBiome
// to reach its "unknown biome" branch.

describe('employees.ts — train_no_school (schoolFor mocked to null)', () => {
  const EN = 'No building teaches geology.';

  afterEach(() => { vi.restoreAllMocks(); });

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    vi.spyOn(EmployeeTrainingModule, 'schoolFor').mockReturnValue(null);
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'geology' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    vi.spyOn(EmployeeTrainingModule, 'schoolFor').mockReturnValue(null);
    setLocale('fr');
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'geology' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN);
  });
});

// ── train_building_no_teach ───────────────────────────────────────────────

describe('employees.ts — train_building_no_teach (named building: does not teach the skill)', () => {
  function expectedEn(buildingId: number): string {
    return `Building #${buildingId} does not teach management.`;
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    // geology_lab teaches geology, not management.
    const buildingId = placeTestBuilding(ctx, 'geology_lab', 1);
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management', building: String(buildingId) });
    expect(result.success).toBe(false);
    expect(result.output).toBe(expectedEn(buildingId));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    const buildingId = placeTestBuilding(ctx, 'geology_lab', 1);
    setLocale('fr');
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management', building: String(buildingId) });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(expectedEn(buildingId));
  });
});

// ── train_no_building_on_site ─────────────────────────────────────────────

describe('employees.ts — train_no_building_on_site (school exists in the catalog, none built)', () => {
  const EN = 'No management_office on site. Build one to train management.';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    setLocale('fr');
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN);
  });
});

// ── train_already_master ──────────────────────────────────────────────────

describe('employees.ts — train_already_master', () => {
  function expectedEn(name: string): string {
    return `${name} is already a Master of management.`;
  }

  function setupMasteredEmployee(ctx: GameContext) {
    const emp = hireTestEmployee(ctx);
    placeTestBuilding(ctx, 'management_office', 1);
    assignSkill(ctx.state!.employees, emp.id, 'management', 5);
    return emp;
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const emp = setupMasteredEmployee(ctx);
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(expectedEn(emp.name));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = setupMasteredEmployee(ctx);
    setLocale('fr');
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(expectedEn(emp.name));
  });
});

// ── train_insufficient_funds ──────────────────────────────────────────────

describe('employees.ts — train_insufficient_funds', () => {
  const EN = 'Insufficient funds: course costs $2500.';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx(0);
    const emp = hireTestEmployee(ctx);
    placeTestBuilding(ctx, 'management_office', 1);
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx(0);
    const emp = hireTestEmployee(ctx);
    placeTestBuilding(ctx, 'management_office', 1);
    setLocale('fr');
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN);
  });
});

// ── train_success ──────────────────────────────────────────────────────────

describe('employees.ts — train success message', () => {
  function expectedEn(name: string, buildingId: number): string {
    return `${name} enrolled at management_office #${buildingId}: management level 1 in 20 ticks ($2500).`;
  }

  it('matches the exact English literal, embedding the real name/buildingId', () => {
    const ctx = makeCtx(10_000);
    const emp = hireTestEmployee(ctx);
    const buildingId = placeTestBuilding(ctx, 'management_office', 1);
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management' });
    expect(result.success).toBe(true);
    expect(result.output).toBe(expectedEn(emp.name, buildingId));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx(10_000);
    const emp = hireTestEmployee(ctx);
    const buildingId = placeTestBuilding(ctx, 'management_office', 1);
    setLocale('fr');
    const result = employeeCommand(ctx, ['train', String(emp.id)], { skill: 'management' });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(expectedEn(emp.name, buildingId));
  });
});

// ── cancel_not_cancellable ────────────────────────────────────────────────

describe('employees.ts — cancel a rest action (not cancellable)', () => {
  function pushRestAction(ctx: GameContext): number {
    const id = ctx.state!.nextPendingActionId++;
    ctx.state!.pendingActions.push({
      id, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null,
    });
    return id;
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const id = pushRestAction(ctx);
    const result = employeeCommand(ctx, ['cancel', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(`Action #${id} cannot be cancelled.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const id = pushRestAction(ctx);
    setLocale('fr');
    const result = employeeCommand(ctx, ['cancel', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(`Action #${id} cannot be cancelled.`);
  });
});

// ── cancel_action_not_found ───────────────────────────────────────────────

describe('employees.ts — cancel an unknown action id', () => {
  const NOT_FOUND_ID = 999999;
  const EN = `Action #${NOT_FOUND_ID} not found.`;

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = employeeCommand(ctx, ['cancel', String(NOT_FOUND_ID)], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = employeeCommand(ctx, ['cancel', String(NOT_FOUND_ID)], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN);
  });
});

// ── cancel_success (both with and without the embedded refund suffix) ────

describe('employees.ts — cancel success message (no refund — general_work costs nothing at order time)', () => {
  it('matches the exact English literal — empty refund suffix', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    const dispatchResult = employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1' });
    expect(dispatchResult.success).toBe(true);
    const actionId = ctx.state!.pendingActions[ctx.state!.pendingActions.length - 1]!.id;

    const result = employeeCommand(ctx, ['cancel', String(actionId)], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Action #${actionId} (general_work) cancelled.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const emp = hireTestEmployee(ctx);
    employeeCommand(ctx, ['dispatch', String(emp.id)], { x: '1', z: '1' });
    const actionId = ctx.state!.pendingActions[ctx.state!.pendingActions.length - 1]!.id;

    setLocale('fr');
    const result = employeeCommand(ctx, ['cancel', String(actionId)], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Action #${actionId} (general_work) cancelled.`);
  });
});

describe('employees.ts — cancel success message (with refund — cancel_refund_suffix embedded)', () => {
  /**
   * Pushes a fake `place_building`-typed action carrying a `cost` payload —
   * `actionOrderCost` (TaskCancellation.ts) refunds `payload.cost` in full for
   * this action type, the simplest way to reach a non-zero refund without
   * driving the full buildCommand pipeline.
   */
  function pushRefundableAction(ctx: GameContext, cost: number): number {
    const id = ctx.state!.nextPendingActionId++;
    ctx.state!.pendingActions.push({
      id, type: 'place_building', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: { cost }, targetEmployeeId: null,
      status: 'queued', holderId: null,
    });
    return id;
  }

  it('matches the exact English literal, embedding the formatted refund amount', () => {
    const ctx = makeCtx();
    const actionId = pushRefundableAction(ctx, 5000);
    const result = employeeCommand(ctx, ['cancel', String(actionId)], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Action #${actionId} (place_building) cancelled. $${formatMoney(5000)} refunded.`);
    expect(result.output).toContain('5,000');
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const actionId = pushRefundableAction(ctx, 5000);
    setLocale('fr');
    const result = employeeCommand(ctx, ['cancel', String(actionId)], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Action #${actionId} (place_building) cancelled. $${formatMoney(5000)} refunded.`);
  });
});
