// BlastSimulator2026 — Each unqualified_task_error option does what its outcome text says (#1380)

import { describe, it, expect } from 'vitest';
import { UNQUALIFIED_TASK_EFFECTS } from '../../../src/core/events/UnqualifiedTaskEffects.js';
import { UNQUALIFIED_CONTRACTOR_FEE } from '../../../src/core/config/balance.js';
import { planTraining } from '../../../src/core/entities/EmployeeTraining.js';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { SURVEY_FEE, setupUnqualified, totalDebit } from '../../helpers/unqualifiedWorld.js';

const TICK = 40;

describe('UNQUALIFIED_TASK_EFFECTS registry', () => {
  it('has a handler for every effect tag the event options carry', () => {
    for (const tag of ['cancel_task', 'hire_contractor', 'train_employee']) {
      expect(typeof UNQUALIFIED_TASK_EFFECTS[tag]).toBe('function');
    }
  });
});

describe('cancel_task', () => {
  it('removes the blocked action and its ghost', () => {
    const s = setupUnqualified();
    expect(s.state.pendingActions.some(a => a.id === s.actionId)).toBe(true);
    UNQUALIFIED_TASK_EFFECTS['cancel_task']!([s.actionId], s.world, TICK);
    expect(s.state.pendingActions.find(a => a.id === s.actionId)).toBeUndefined();
    expect(s.state.ghostPreviews.find(g => g.id === s.actionId)).toBeUndefined();
  });

  it('refunds the order-time survey fee to state.cash and the ledger', () => {
    const s = setupUnqualified();
    const ledgerBefore = s.state.finances.cash;
    const outcome = UNQUALIFIED_TASK_EFFECTS['cancel_task']!([s.actionId], s.world, TICK);
    expect(s.state.cash).toBe(s.cashAfterOrder + SURVEY_FEE);
    expect(s.state.finances.cash).toBe(ledgerBefore + SURVEY_FEE);
    expect(s.state.finances.transactions.some(tx => tx.type === 'income' && tx.amount === SURVEY_FEE)).toBe(true);
    // The player is shown the refund as a chip, and it is never applied a second time by the caller.
    expect(outcome.cashSettled + outcome.cashChange).toBe(SURVEY_FEE);
    expect(s.state.cash + outcome.cashChange).toBe(s.cashAfterOrder + SURVEY_FEE);
  });

  it('uses the plain result text, not the fallback', () => {
    const s = setupUnqualified();
    expect(UNQUALIFIED_TASK_EFFECTS['cancel_task']!([s.actionId], s.world, TICK).resultKeySuffix).toBe('');
  });

  it('ignores an id that is no longer queued without touching cash', () => {
    const s = setupUnqualified();
    UNQUALIFIED_TASK_EFFECTS['cancel_task']!([s.actionId + 99], s.world, TICK);
    expect(s.state.pendingActions.some(a => a.id === s.actionId)).toBe(true);
    expect(s.state.cash).toBe(s.cashAfterOrder);
  });

  it('cancels every blocked action it is given', () => {
    const s = setupUnqualified();
    const second = s.state.nextPendingActionId;
    s.state.pendingActions.push({ ...s.state.pendingActions[0]!, id: second });
    s.state.nextPendingActionId++;
    UNQUALIFIED_TASK_EFFECTS['cancel_task']!([s.actionId, second], s.world, TICK);
    expect(s.state.pendingActions.filter(a => a.type === 'survey')).toHaveLength(0);
  });
});

describe('hire_contractor', () => {
  it('completes the work with its normal effects: the survey result is recorded', () => {
    const s = setupUnqualified();
    expect(s.state.surveyResults).toHaveLength(0);
    UNQUALIFIED_TASK_EFFECTS['hire_contractor']!([s.actionId], s.world, TICK);
    expect(s.state.surveyResults).toHaveLength(1);
    expect(s.state.surveyResults[0]!.method).toBe('seismic');
    expect(s.state.surveyResults[0]!.centerX).toBe(12);
  });

  it('removes the action and its ghost from the pending pool', () => {
    const s = setupUnqualified();
    UNQUALIFIED_TASK_EFFECTS['hire_contractor']!([s.actionId], s.world, TICK);
    expect(s.state.pendingActions.find(a => a.id === s.actionId)).toBeUndefined();
    expect(s.state.ghostPreviews.find(g => g.id === s.actionId)).toBeUndefined();
  });
});

describe('hire_contractor with nothing completable', () => {
  it('returns the fee once with the _alt text and keeps the action queued', () => {
    const s = setupUnqualified();
    // A survey needs the voxel grid; without one the contractor cannot do it.
    const gridless = { state: s.state };
    const ledgerBefore = s.state.finances.cash;
    const outcome = UNQUALIFIED_TASK_EFFECTS['hire_contractor']!([s.actionId], gridless, TICK);
    expect(outcome.resultKeySuffix).toBe('_alt');
    expect(outcome.cashChange).toBe(UNQUALIFIED_CONTRACTOR_FEE);
    expect(outcome.cashSettled).toBe(0);
    // The ledger gets the refund exactly once; state.cash is left for the caller to apply cashChange.
    expect(s.state.finances.cash).toBe(ledgerBefore + UNQUALIFIED_CONTRACTOR_FEE);
    expect(s.state.cash).toBe(s.cashAfterOrder);
    expect(s.state.surveyResults).toHaveLength(0);
    expect(s.state.pendingActions.some(a => a.id === s.actionId)).toBe(true);
  });

  it('refunds when the id is no longer queued', () => {
    const s = setupUnqualified();
    const outcome = UNQUALIFIED_TASK_EFFECTS['hire_contractor']!([s.actionId + 99], s.world, TICK);
    expect(outcome.resultKeySuffix).toBe('_alt');
    expect(outcome.cashChange).toBe(UNQUALIFIED_CONTRACTOR_FEE);
  });
});

describe('hire_contractor on a drill order', () => {
  it('lands the planned hole and removes the action', () => {
    const s = setupUnqualified();
    const action = s.state.pendingActions.find(a => a.id === s.actionId)!;
    action.type = 'drill_hole';
    action.requiredSkill = null;
    action.payload = { holeId: 'h1' };
    s.state.plannedDrillHoles.push({ id: 'h1', x: 12, z: 12, depth: 5, diameter: 0.2 } as never);
    const outcome = UNQUALIFIED_TASK_EFFECTS['hire_contractor']!([s.actionId], s.world, TICK);
    expect(outcome.resultKeySuffix).toBe('');
    expect(s.state.plannedDrillHoles).toHaveLength(0);
    expect(s.state.drillHoles.map(h => h.id)).toEqual(['h1']);
    expect(s.state.pendingActions.some(a => a.id === s.actionId)).toBe(false);
  });
});

describe('train_employee', () => {
  it('enrols the eligible employee on the missing skill and debits the fee once', () => {
    const s = setupUnqualified({ school: true });
    const fee = planTraining(s.driver!, 'geology', 1)!.fee;
    const outcome = UNQUALIFIED_TASK_EFFECTS['train_employee']!([s.actionId], s.world, TICK);
    const driver = s.state.employees.employees.find(e => e.id === s.driver!.id)!;
    const enrolment = driver.pendingTrainingState ?? driver.trainingState;
    expect(enrolment).not.toBeNull();
    expect(enrolment!.skill).toBe('geology');
    expect(totalDebit(s.cashAfterOrder, s.state, outcome)).toBe(fee);
    expect(outcome.resultKeySuffix).toBe('');
  });

  it('leaves the blocked action queued: the trainee will take it once qualified', () => {
    const s = setupUnqualified({ school: true });
    UNQUALIFIED_TASK_EFFECTS['train_employee']!([s.actionId], s.world, TICK);
    expect(s.state.pendingActions.some(a => a.id === s.actionId)).toBe(true);
  });

  it('books nothing and falls back to the _alt text when no school teaches the skill', () => {
    const s = setupUnqualified({ school: false });
    const outcome = UNQUALIFIED_TASK_EFFECTS['train_employee']!([s.actionId], s.world, TICK);
    expect(outcome.resultKeySuffix).toBe('_alt');
    expect(s.state.cash + outcome.cashChange).toBe(s.cashAfterOrder);
    expect(s.state.employees.employees.every(e => e.trainingState === null && (e.pendingTrainingState ?? null) === null)).toBe(true);
  });

  it('books nothing and falls back to _alt when nobody is left to send', () => {
    const s = setupUnqualified({ school: true, candidate: false });
    const outcome = UNQUALIFIED_TASK_EFFECTS['train_employee']!([s.actionId], s.world, TICK);
    expect(outcome.resultKeySuffix).toBe('_alt');
    expect(s.state.cash + outcome.cashChange).toBe(s.cashAfterOrder);
  });

  it('books nothing and falls back to _alt when the fee is unaffordable', () => {
    const s = setupUnqualified({ school: true, cash: SURVEY_FEE + 10 });
    const outcome = UNQUALIFIED_TASK_EFFECTS['train_employee']!([s.actionId], s.world, TICK);
    expect(outcome.resultKeySuffix).toBe('_alt');
    expect(s.state.cash + outcome.cashChange).toBe(s.cashAfterOrder);
    expect(s.driver!.pendingTrainingState ?? null).toBeNull();
    expect(s.driver!.trainingState).toBeNull();
  });

  it('never enrols an injured employee', () => {
    const s = setupUnqualified({ school: true });
    s.driver!.injured = true;
    const outcome = UNQUALIFIED_TASK_EFFECTS['train_employee']!([s.actionId], s.world, TICK);
    expect(outcome.resultKeySuffix).toBe('_alt');
    expect(s.driver!.pendingTrainingState ?? null).toBeNull();
  });
});

describe('unqualified_task_error fallback text (#1380)', () => {
  it.each(['res0_alt', 'res1_alt'])('has an %s result key in both locales', suffix => {
    const key = `event.unqualified_task_error.${suffix}`;
    expect((enLocale as Record<string, string>)[key]).toEqual(expect.any(String));
    expect((frLocale as Record<string, string>)[key]).toEqual(expect.any(String));
    expect((enLocale as Record<string, string>)[key]).not.toBe((frLocale as Record<string, string>)[key]);
  });
});
