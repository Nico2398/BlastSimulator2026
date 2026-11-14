// BlastSimulator2026 — Console: `employee cancel <id> [all]` (#2265)
//
// `employee cancel <id>` cancels one order, except that a ramp segment always
// cancels with its ramp. `employee cancel <id> all` cancels the order together
// with its linked actions and reports the count and the refund.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';
import enLocale from '../../../src/core/i18n/locales/en.json';
import frLocale from '../../../src/core/i18n/locales/fr.json';

const RAMP = 'build_ramp path:15,15;15,27;25,27 depth:6 width:3';

function start(): { run: (cmd: string) => { success: boolean; output: string }; state: GameState } {
  const { runner, ctx } = createRunner();
  expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  return { run: cmd => runner.run(cmd), state: ctx.state! };
}

const ofType = (state: GameState, type: PendingAction['type']): PendingAction[] => state.pendingActions.filter(a => a.type === type);

/** Orders a drill pattern of `cols` holes and returns once every hole is drilled. */
function drilledHoles(cols: number): ReturnType<typeof start> {
  const g = start();
  expect(g.run(`drill_plan grid rows:1 cols:${cols} spacing:4 depth:8 start:14,14`).success).toBe(true);
  for (let i = 0; i < 3000 && g.state.plannedDrillHoles.length > 0; i++) g.run('tick 1');
  expect(g.state.plannedDrillHoles).toHaveLength(0);
  expect(g.state.drillHoles).toHaveLength(cols);
  return g;
}

describe('employee cancel <id> all (#2265)', () => {
  beforeEach(() => setLocale('en'));

  it('on a ramp segment cancels every segment, refunds their sum and reports the count and refund', () => {
    const { run, state } = start();
    const cashBeforeOrder = state.cash;
    expect(run(RAMP).success).toBe(true);
    const actions = ofType(state, 'dig_ramp_segment');
    const count = actions.length;
    expect(count).toBeGreaterThan(1);
    const refund = actions.reduce((sum, a) => sum + (a.payload['segmentCost'] as number), 0);
    const cashBeforeCancel = state.cash;

    const result = run(`employee cancel ${actions[count - 1]!.id} all`);

    expect(result.success).toBe(true);
    expect(result.output).toBe(t('employees.cancel_all_success', {
      count, refundSuffix: t('employees.cancel_refund_suffix', { amount: formatMoney(refund) }),
    }));
    expect(state.cash - cashBeforeCancel).toBeCloseTo(refund, 6);
    expect(state.cash).toBeCloseTo(cashBeforeOrder, 6);
    expect(ofType(state, 'dig_ramp_segment')).toHaveLength(0);
    expect(state.plannedRamps).toHaveLength(0);
    expect(state.ghostPreviews).toHaveLength(0);
  });

  it('on a drill_hole cancels every outstanding hole order; no refund suffix when nothing was charged', () => {
    const { run, state } = start();
    expect(run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:14,14').success).toBe(true);
    const drills = ofType(state, 'drill_hole');
    expect(drills).toHaveLength(6);
    const cash = state.cash;

    const result = run(`employee cancel ${drills[2]!.id} all`);

    expect(result.success).toBe(true);
    expect(result.output).toBe(t('employees.cancel_all_success', { count: 6, refundSuffix: '' }));
    expect(ofType(state, 'drill_hole')).toHaveLength(0);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.cash).toBe(cash);
  });

  it('on a charge_hole cancels every outstanding charge order and leaves the drilled holes', () => {
    const { run, state } = drilledHoles(3);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    const charges = ofType(state, 'charge_hole');
    expect(charges.length).toBeGreaterThan(1);

    const result = run(`employee cancel ${charges[0]!.id} all`);

    expect(result.success).toBe(true);
    expect(result.output).toBe(t('employees.cancel_all_success', { count: charges.length, refundSuffix: '' }));
    expect(ofType(state, 'charge_hole')).toHaveLength(0);
    expect(state.drillHoles).toHaveLength(3);
  });

  it('on a single-action order cancels just that one', () => {
    const { run, state } = start();
    expect(run('employee hire role:surveyor').success).toBe(true);
    expect(run('survey seismic x:5 z:5').success).toBe(true);
    expect(run('survey seismic x:9 z:9').success).toBe(true);
    const [first, second] = ofType(state, 'survey');
    expect(second).toBeDefined();
    const cash = state.cash;

    const result = run(`employee cancel ${first!.id} all`);

    expect(result.success).toBe(true);
    expect(result.output).toBe(t('employees.cancel_all_success', {
      count: 1, refundSuffix: t('employees.cancel_refund_suffix', { amount: formatMoney(state.cash - cash) }),
    }));
    expect(state.cash).toBeGreaterThan(cash);
    expect(ofType(state, 'survey').map(a => a.id)).toEqual([second!.id]);
  });

  it('fails with the not-found message for an unknown id and changes nothing', () => {
    const { run, state } = start();
    expect(run('drill_plan grid rows:1 cols:2 spacing:4 depth:8 start:14,14').success).toBe(true);
    const before = state.pendingActions.length;

    const result = run('employee cancel 99999 all');

    expect(result).toEqual({ success: false, output: t('employees.cancel_action_not_found', { id: 99999 }) });
    expect(state.pendingActions).toHaveLength(before);
  });

  it('refuses an engine-owned rest action', () => {
    const { run, state } = start();
    state.pendingActions.push({
      id: 7777, type: 'rest', requiredSkill: null, requiredVehicleRole: null, targetX: 1, targetZ: 1, targetY: 0,
      payload: {}, targetEmployeeId: 1, status: 'assigned', holderId: 1, queuedAtTick: 0,
    });

    const result = run('employee cancel 7777 all');

    expect(result).toEqual({ success: false, output: t('employees.cancel_not_cancellable', { id: 7777 }) });
    expect(state.pendingActions.map(a => a.id)).toContain(7777);
  });
});

describe('employee cancel <id> (#2265)', () => {
  beforeEach(() => setLocale('en'));

  it('keeps cancelling one drill_hole only', () => {
    const { run, state } = start();
    expect(run('drill_plan grid rows:1 cols:3 spacing:4 depth:8 start:14,14').success).toBe(true);
    const [first, ...rest] = ofType(state, 'drill_hole');

    const result = run(`employee cancel ${first!.id}`);

    expect(result.success).toBe(true);
    expect(result.output).toBe(t('employees.cancel_success', { id: first!.id, actionType: 'drill_hole', refundSuffix: '' }));
    expect(ofType(state, 'drill_hole').map(a => a.id)).toEqual(rest.map(a => a.id));
    expect(state.plannedDrillHoles).toHaveLength(2);
  });

  it('keeps cancelling one charge_hole only', () => {
    const { run, state } = drilledHoles(3);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    const [first, ...rest] = ofType(state, 'charge_hole');
    expect(rest.length).toBeGreaterThan(0);

    expect(run(`employee cancel ${first!.id}`).success).toBe(true);

    expect(ofType(state, 'charge_hole').map(a => a.id)).toEqual(rest.map(a => a.id));
  });

  it('on a ramp segment cancels the whole ramp, never leaving a gap', () => {
    const { run, state } = start();
    expect(run(RAMP).success).toBe(true);
    const actions = ofType(state, 'dig_ramp_segment');

    const result = run(`employee cancel ${actions[3]!.id}`);

    expect(result.success).toBe(true);
    expect(ofType(state, 'dig_ramp_segment')).toHaveLength(0);
    expect(state.plannedRamps).toHaveLength(0);
  });

  it('build_ramp cancel still cancels the ramp and reports the refund of every segment', () => {
    const { run, state } = start();
    expect(run(RAMP).success).toBe(true);
    const rampId = state.plannedRamps[0]!.id;
    const refund = ofType(state, 'dig_ramp_segment').reduce((sum, a) => sum + (a.payload['segmentCost'] as number), 0);
    const cash = state.cash;

    const result = run(`build_ramp cancel id:${rampId}`);

    expect(result.success).toBe(true);
    expect(result.output).toContain(formatMoney(refund));
    expect(state.cash - cash).toBeCloseTo(refund, 6);
    expect(state.plannedRamps).toHaveLength(0);
  });

  it('prints the usage line without an id', () => {
    const { run } = start();
    expect(run('employee cancel')).toEqual({ success: false, output: t('employees.cancel_usage') });
  });
});

describe('employees.cancel_all_success i18n (#2265)', () => {
  it('exists in en and fr with {count} and {refundSuffix} placeholders, translated differently', () => {
    const en = (enLocale as Record<string, string>)['employees.cancel_all_success'];
    const fr = (frLocale as Record<string, string>)['employees.cancel_all_success'];
    expect(en).toBeDefined();
    expect(fr).toBeDefined();
    for (const text of [en!, fr!]) {
      expect(text).toContain('{count}');
      expect(text).toContain('{refundSuffix}');
    }
    expect(fr).not.toBe(en);
  });
});
