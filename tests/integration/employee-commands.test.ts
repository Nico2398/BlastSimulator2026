// BlastSimulator2026 — Integration tests for employee and set_policy commands (task 3.15)

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand, needsCommand } from '../../src/console/commands/entities.js';
import { setPolicyCommand } from '../../src/console/commands/policy.js';
import { drillPlanCommand, type MiningContext } from '../../src/console/commands/mining.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { killEmployee } from '../../src/core/entities/Employee.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/** Hire one employee and return their numeric ID (always 1 on a fresh state). */
function hireOne(ctx: GameContext, role = 'blaster'): number {
  const result = employeeCommand(ctx, ['hire'], { role });
  if (!result.success) throw new Error(`Setup: hire failed — ${result.output}`);
  return ctx.state!.employees.employees[0]!.id;
}

// ── employee assign_skill ───────────────────────────────────────────────────

describe('Console — employee assign_skill', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx);
  });

  it('assigns a skill to an existing employee and reports success', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'blasting', level: '3' },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Employee #${empId} assigned skill: blasting (level 3).`);
  });

  it('persists the qualification on the employee record', () => {
    employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'geology', level: '2' },
    );

    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    const qual = emp.qualifications.find(q => q.category === 'geology');
    expect(qual).toBeDefined();
    expect(qual!.proficiencyLevel).toBe(2);
  });

  it('replaces an existing qualification for the same category', () => {
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'driving.truck', level: '1' });
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'driving.truck', level: '4' });

    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    const quals = emp.qualifications.filter(q => q.category === 'driving.truck');
    expect(quals).toHaveLength(1);
    expect(quals[0]!.proficiencyLevel).toBe(4);
  });

  it('reports employee not found when the ID does not exist', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', '999'],
      { skill: 'blasting', level: '1' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe('Employee #999 not found.');
  });

  it('rejects the call when skill argument is missing', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { level: '2' }, // no skill
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('rejects the call when level argument is missing', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'blasting' }, // no level
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('rejects a level below the valid range (0)', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'management', level: '0' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('rejects a level above the valid range (6)', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'management', level: '6' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('rejects a non-numeric level', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'blasting', level: 'high' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('accepts all valid skill categories without error', () => {
    const categories = [
      'driving.truck',
      'driving.excavator',
      'driving.drill_rig',
      'blasting',
      'management',
      'geology',
    ] as const;

    for (const category of categories) {
      const result = employeeCommand(
        ctx,
        ['assign_skill', String(empId)],
        { skill: category, level: '1' },
      );
      expect(result.success, `category "${category}" should be accepted`).toBe(true);
    }
  });

  // ── #675: assign_skill against a dead employee ────────────────────────────

  it('refuses to assign a skill to a dead employee', () => {
    killEmployee(ctx.state!.employees, empId);

    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'blasting', level: '3' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(`Employee #${empId} is dead and cannot be assigned a skill.`);
  });

  it('does not append a qualification when the refused call targets a dead employee', () => {
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    const before = emp.qualifications.length;

    killEmployee(ctx.state!.employees, empId);
    // 'geology' is not the blaster's starting qualification, so a missing
    // guard would grow the array rather than merely overwrite a value.
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'geology', level: '3' });

    expect(emp.qualifications.length).toBe(before);
  });
});

// ── set_policy command ──────────────────────────────────────────────────────

describe('Console — set_policy', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('updates policy to shift_8h mode with default thresholds', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h' });

    expect(result.success).toBe(true);
    // Default thresholds from balance.ts: hunger=60 fatigue=60 social=60 (#867)
    expect(result.output).toBe('Policy updated: mode=shift_8h hunger=60 fatigue=60 social=60');
  });

  it('updates policy to shift_12h mode', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'shift_12h' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('mode=shift_12h');
  });

  it('updates policy to continuous mode', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'continuous' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('mode=continuous');
  });

  it('updates policy to custom mode', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'custom' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('mode=custom');
  });

  it('applies a hunger threshold override', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', hunger: '55' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('hunger=55');
    expect(ctx.state!.sitePolicy.hungerRestThreshold).toBe(55);
  });

  it('applies fatigue and social threshold overrides simultaneously', () => {
    const result = setPolicyCommand(ctx, [], {
      mode: 'continuous',
      fatigue: '30',
      social: '15',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('fatigue=30');
    expect(result.output).toContain('social=15');
    expect(ctx.state!.sitePolicy.fatigueRestThreshold).toBe(30);
    expect(ctx.state!.sitePolicy.socialBreakThreshold).toBe(15);
  });

  it('persists the chosen shift mode on the state', () => {
    setPolicyCommand(ctx, [], { mode: 'shift_12h' });

    expect(ctx.state!.sitePolicy.shiftMode).toBe('shift_12h');
  });

  it('rejects an invalid shift mode with a usage message', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'night_shift' });

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: set_policy mode:(shift_8h|shift_12h|continuous|custom) [hunger:N] [fatigue:N] [social:N]',
    );
  });

  it('rejects a missing mode with the same usage message', () => {
    const result = setPolicyCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: set_policy mode:(shift_8h|shift_12h|continuous|custom) [hunger:N] [fatigue:N] [social:N]',
    );
  });

  it('errors when no game is loaded', () => {
    const emptyCtx: GameContext = { state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter() };
    const result = setPolicyCommand(emptyCtx, [], { mode: 'shift_8h' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

// ── needs command ───────────────────────────────────────────────────────────

describe('Console — needs command', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('shows needs for a single employee', () => {
    hireOne(ctx);

    const result = needsCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('Employee Needs:');
    expect(result.output).toContain('hunger');
    expect(result.output).toContain('fatigue');
    expect(result.output).toContain('break:');
  });

  it('shows needs for multiple employees', () => {
    hireOne(ctx, 'driller');
    hireOne(ctx, 'blaster');
    hireOne(ctx, 'surveyor');

    const result = needsCommand(ctx, [], {});

    expect(result.success).toBe(true);
    // Each employee should produce a line with their gauge values
    const lines = result.output.split('\n').filter(l => l.includes('hunger'));
    expect(lines).toHaveLength(3);
  });

  it('displays correct gauge values', () => {
    const empId = hireOne(ctx);
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;

    // Set specific gauge values
    emp.hunger = 42;
    emp.fatigue = 58;
    emp.breakNeed = 73;

    const result = needsCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('hunger: 42');
    expect(result.output).toContain('fatigue: 58');
    expect(result.output).toContain('break: 73');
  });

  it('handles no employees', () => {
    const result = needsCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe('No employees.');
  });

  it('handles no game loaded', () => {
    const emptyCtx: GameContext = { state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter() };
    const result = needsCommand(emptyCtx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

// ── hire regression ─────────────────────────────────────────────────────────

describe('Console — employee hire (regression)', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('still hires a driller successfully', () => {
    const result = employeeCommand(ctx, ['hire'], { role: 'driller' });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/Hired .+ \(driller\)\. Cost: \$\d+/);
  });

  it('still hires a blaster and adds them to the employee list', () => {
    employeeCommand(ctx, ['hire'], { role: 'blaster' });

    expect(ctx.state!.employees.employees).toHaveLength(1);
    expect(ctx.state!.employees.employees[0]!.role).toBe('blaster');
  });

  it('still rejects an invalid role', () => {
    const result = employeeCommand(ctx, ['hire'], { role: 'ninja' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: employee hire role:');
  });

  it('gives two employees hired in the same tick different names (dedup fix)', () => {
    // Both hires run at tickCount:0 — before the fix, `new Random(state.seed +
    // state.tickCount)` re-seeded identically for both, so rng.pick() always
    // returned the same first/last name pair twice in a row.
    employeeCommand(ctx, ['hire'], { role: 'driller' });
    employeeCommand(ctx, ['hire'], { role: 'driller' });

    const [first, second] = ctx.state!.employees.employees;
    expect(first!.name).not.toBe(second!.name);
  });

  it('stamps hiredAtTick with the current tick', () => {
    ctx.state!.tickCount = 17;

    employeeCommand(ctx, ['hire'], { role: 'surveyor' });

    expect(ctx.state!.employees.employees[0]!.hiredAtTick).toBe(17);
  });
});

// ── employee dispatch ────────────────────────────────────────────────────────

describe('Console — employee dispatch', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx, 'driller');
  });

  it('pushes a generic-work PendingAction claimable by tickEmployees', () => {
    const result = employeeCommand(ctx, ['dispatch', String(empId)], { x: '10', z: '10' });

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Employee #${empId} dispatched to work at (10, 10). Action ID: 1.`);

    const action = ctx.state!.pendingActions.find(a => a.targetEmployeeId === empId);
    expect(action).toBeDefined();
    expect(action!.type).toBe('general_work');
    expect(action!.requiredSkill).toBeNull();
    expect(action!.targetX).toBe(10);
    expect(action!.targetZ).toBe(10);
  });

  it('pushes a matching GhostPreview so the renderer can show the pending marker (#406)', () => {
    const result = employeeCommand(ctx, ['dispatch', String(empId)], { x: '10', z: '10' });
    expect(result.success).toBe(true);

    const ghost = ctx.state!.ghostPreviews.find(g => g.id === 1);
    expect(ghost).toBeDefined();
    expect(ghost!.type).toBe('general_work');
    expect(ghost!.targetX).toBe(10);
    expect(ghost!.targetZ).toBe(10);
  });

  it('rejects dispatch when the employee is injured', () => {
    ctx.state!.employees.employees.find(e => e.id === empId)!.injured = true;

    const result = employeeCommand(ctx, ['dispatch', String(empId)], { x: '10', z: '10' });

    expect(result.success).toBe(false);
    expect(result.output).toBe(`Employee #${empId} is injured and cannot be dispatched.`);
  });

  it('rejects dispatch when the employee is in training', () => {
    ctx.state!.employees.employees.find(e => e.id === empId)!.trainingState = {
      buildingId: 1,
      skill: 'blasting',
      ticksRemaining: 5,
      fee: 100,
    };

    const result = employeeCommand(ctx, ['dispatch', String(empId)], { x: '10', z: '10' });

    expect(result.success).toBe(false);
    expect(result.output).toBe(`Employee #${empId} is in training and cannot be dispatched.`);
  });

  it('reports employee not found when the ID does not exist', () => {
    const result = employeeCommand(ctx, ['dispatch', '999'], { x: '10', z: '10' });

    expect(result.success).toBe(false);
    expect(result.output).toBe('Employee #999 not found.');
  });

  it('rejects the call when x/z coordinates are missing', () => {
    const result = employeeCommand(ctx, ['dispatch', String(empId)], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: employee dispatch <id> x:<X> z:<Z> [skill:<category>]');
  });

  it('reports the target is unqualified by name, not "no employee on the roster", ' +
     'when a different roster member holds the skill (#406)', () => {
    // Second employee holds 'geology' — the target (empId) does not.
    // hireOne always returns employees[0].id (the first ever hired), so grab
    // the newly hired employee's own id from the roster instead.
    employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    const otherId = ctx.state!.employees.employees.find(e => e.id !== empId)!.id;
    employeeCommand(ctx, ['assign_skill', String(otherId)], { skill: 'geology', level: '1' });
    const targetName = ctx.state!.employees.employees.find(e => e.id === empId)!.name;

    const result = employeeCommand(
      ctx,
      ['dispatch', String(empId)],
      { x: '10', z: '10', skill: 'geology' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(`Employee #${empId} (${targetName}) does not hold skill: geology.`);
    // Must not claim nobody on the roster qualifies — someone (otherId) does.
    expect(result.output).not.toContain('No employee on the roster holds skill');
  });
});

// ── employee cancel (#548) ──────────────────────────────────────────────────

describe('Console — employee cancel', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx, 'driller');
  });

  it('cancels a dispatched action: success output, action gone, holder idle', () => {
    const dispatchResult = employeeCommand(ctx, ['dispatch', String(empId)], { x: '10', z: '10' });
    expect(dispatchResult.success).toBe(true);
    const action = ctx.state!.pendingActions.find(a => a.targetEmployeeId === empId)!;
    expect(action).toBeDefined();

    const result = employeeCommand(ctx, ['cancel', String(action.id)], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.pendingActions.find(a => a.id === action.id)).toBeUndefined();
    expect(ctx.state!.ghostPreviews.find(g => g.id === action.id)).toBeUndefined();
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    expect(emp.activeActionId).toBeNull();
  });

  it('reports failure naming the id when the action does not exist', () => {
    const result = employeeCommand(ctx, ['cancel', '9999'], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('9999');
  });

  it('rejects the call with a usage message when no id is given', () => {
    const result = employeeCommand(ctx, ['cancel'], {});

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/usage/i);
  });

  it('rejects cancelling a type:"rest" action pushed directly into state, leaving state unaffected', () => {
    const restActionId = ctx.state!.nextPendingActionId++;
    ctx.state!.pendingActions.push({
      id: restActionId,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: {},
      targetEmployeeId: empId,
      status: 'assigned',
      holderId: empId,
    });
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    emp.activeActionId = restActionId;

    const result = employeeCommand(ctx, ['cancel', String(restActionId)], {});

    expect(result.success).toBe(false);
    const stored = ctx.state!.pendingActions.find(a => a.id === restActionId);
    expect(stored).toBeDefined();
    expect(emp.activeActionId).toBe(restActionId);
  });

  it('lets the freed employee be dispatched again after a cancel', () => {
    const firstDispatch = employeeCommand(ctx, ['dispatch', String(empId)], { x: '10', z: '10' });
    expect(firstDispatch.success).toBe(true);
    const firstAction = ctx.state!.pendingActions.find(a => a.targetEmployeeId === empId)!;

    employeeCommand(ctx, ['cancel', String(firstAction.id)], {});

    const secondDispatch = employeeCommand(ctx, ['dispatch', String(empId)], { x: '15', z: '15' });

    expect(secondDispatch.success).toBe(true);
    const secondAction = ctx.state!.pendingActions.find(a => a.targetEmployeeId === empId);
    expect(secondAction).toBeDefined();
    expect(secondAction!.targetX).toBe(15);
    expect(secondAction!.targetZ).toBe(15);
  });
});

// ── employee hire — spawn honours a negative world origin (#571) ──

describe('Console — employee hire — spawn position on a site grown into negative territory', () => {
  // Same root cause as the "vehicle buy" spawn regression (#571): #558's
  // full-disc survey claim (PlayableArea.claimArea) can grow the site
  // asymmetrically the moment ANY off-site action runs — drill_plan add
  // included — leaving state.world.minX/minZ nonzero. "employee hire"'s
  // spawn point must be `minX + sizeX / 2` (and `minZ + sizeZ / 2`), not the
  // un-offset `sizeX / 2` / `sizeZ / 2`.
  //
  // navGrid is nulled out after growing the site so the un-offset raw
  // (buggy) coordinate is asserted directly, isolating the offset bug from
  // NavGrid.findNearestReachableCell's separate reachability snapping (#437).
  function makeMiningCtx(): MiningContext {
    const ctx: MiningContext = { state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter() };
    newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
    return ctx;
  }

  it('spawns at minX + sizeX/2 (not sizeX/2) once the site has grown west/south', () => {
    const ctx = makeMiningCtx();
    // (-4, -4)'s chunk isn't edge-adjacent to the starting 32x32 site, so
    // PlayableArea.claimArea bridges it in, growing the site both west and
    // south in one call — the same asymmetric growth #558 introduced.
    const drillResult = drillPlanCommand(ctx, ['add'], { x: '-4', z: '-4' });
    expect(drillResult.success).toBe(true);

    const world = ctx.state!.world!;
    expect(world.minX).toBeLessThan(0);
    expect(world.minZ).toBeLessThan(0);

    // Isolate the offset formula from reachability snapping (see comment above).
    ctx.state!.navGrid = null;

    const result = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(result.success).toBe(true);

    const employee = ctx.state!.employees.employees.at(-1)!;
    // First hire: the `(employees.length % 5) * 2` stagger term is 0.
    expect(employee.x).toBe(world.minX + world.sizeX / 2);
    expect(employee.z).toBe(world.minZ + world.sizeZ / 2);
  });

  it('does NOT spawn at the un-offset grid-size midpoint once the site has grown west/south', () => {
    const ctx = makeMiningCtx();
    drillPlanCommand(ctx, ['add'], { x: '-4', z: '-4' });
    const world = ctx.state!.world!;
    ctx.state!.navGrid = null;

    employeeCommand(ctx, ['hire'], { role: 'driller' });

    const employee = ctx.state!.employees.employees.at(-1)!;
    // The buggy formula (sizeX/2, sizeZ/2) ignores minX/minZ entirely.
    expect(employee.x).not.toBe(world.sizeX / 2);
    expect(employee.z).not.toBe(world.sizeZ / 2);
  });
});
