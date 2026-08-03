// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotificationCenter } from '../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../src/core/state/GameState.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

describe('NotificationCenter (redesign P1)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('notify() adds an entry to both the toast list and the log', () => {
    const center = new NotificationCenter();
    center.notify({ severity: 'warn', title: 'Test', body: 'Body text' });
    expect(center.getToasts()).toHaveLength(1);
    expect(center.getLog()).toHaveLength(1);
    expect(center.getLog()[0]!.title).toBe('Test');
    expect(center.getLog()[0]!.body).toBe('Body text');
  });

  it('assigns increasing ids to successive notifications', () => {
    const center = new NotificationCenter();
    center.notify({ severity: 'info', title: 'A', body: '' });
    center.notify({ severity: 'info', title: 'B', body: '' });
    const [first, second] = center.getLog().slice().reverse();
    expect(second!.id).toBeGreaterThan(first!.id);
  });

  it('dismissToast removes only the toast, not the log entry', () => {
    const center = new NotificationCenter();
    center.notify({ severity: 'critical', title: 'X', body: 'Y' });
    const id = center.getToasts()[0]!.id;
    center.dismissToast(id);
    expect(center.getToasts()).toHaveLength(0);
    expect(center.getLog()).toHaveLength(1);
  });

  it('auto-dismisses a toast after its lifetime', () => {
    vi.useFakeTimers();
    const center = new NotificationCenter();
    center.notify({ severity: 'info', title: 'Timed', body: '' });
    expect(center.getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(7000);
    expect(center.getToasts()).toHaveLength(0);
    expect(center.getLog()).toHaveLength(1); // log entry survives
  });

  it('caps the toast list at its max size, dropping the oldest', () => {
    const center = new NotificationCenter();
    for (let i = 0; i < 6; i++) center.notify({ severity: 'info', title: `T${i}`, body: '' });
    expect(center.getToasts().length).toBeLessThanOrEqual(4);
    expect(center.getToasts().at(-1)!.title).toBe('T5');
  });

  it('unreadCount reflects the log size', () => {
    const center = new NotificationCenter();
    expect(center.unreadCount).toBe(0);
    center.notify({ severity: 'info', title: 'A', body: '' });
    center.notify({ severity: 'info', title: 'B', body: '' });
    expect(center.unreadCount).toBe(2);
  });

  describe('update() alert derivation', () => {
    it('returns no pips for a healthy state', () => {
      const center = new NotificationCenter();
      const pips = center.update(makeState());
      expect(pips).toHaveLength(0);
    });

    it('derives an event pip when an event is pending', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.events.pendingEvent = { eventId: 'test', firedAtTick: 1 };
      const pips = center.update(state);
      expect(pips.some(p => p.kind === 'event')).toBe(true);
    });

    it('derives an ecology pip when ecology is critical', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.scores.ecology = 10;
      const pips = center.update(state);
      expect(pips.some(p => p.kind === 'ecology')).toBe(true);
    });

    it('does not derive an ecology pip above the critical threshold', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.scores.ecology = 45;
      const pips = center.update(state);
      expect(pips.some(p => p.kind === 'ecology')).toBe(false);
    });

    it('derives a bankruptcy pip when cash is negative', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.cash = -100;
      const pips = center.update(state);
      expect(pips.some(p => p.kind === 'bankruptcy')).toBe(true);
    });

    it('derives a crew pip counting collapsed employees', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.employees.employees.push({
        id: 1, name: 'X', role: 'driller', salary: 100, morale: 50, unionized: false,
        injured: false, alive: true, x: 0, z: 0, qualifications: [], trainingState: null,
        activeActionId: null, hunger: 50, fatigue: 50, breakNeed: 50, collapsing: true,
        interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null,
        taskTicksRemaining: null, activeSkillCategory: null,
      } as never);
      const pips = center.update(state);
      const crewPip = pips.find(p => p.kind === 'crew');
      expect(crewPip?.label).toBe('1');
    });

    it('derives a fleet pip counting stuck vehicles', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.vehicles.vehicles.push({
        id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, task: 'idle',
        targetX: 0, targetZ: 0, driverId: null, state: 'idle', payloadKg: 0,
        waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: true,
        haulingFragmentId: null, haulingPhase: null, haulDepotId: null,
      } as never);
      const pips = center.update(state);
      expect(pips.find(p => p.kind === 'fleet')?.label).toBe('1');
    });

    it('derives a contract pip and fires exactly one expiry toast per contract', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.contracts.active.push({
        id: 7, type: 'ore_sale', materialId: 'grumpite', description: 'test',
        quantityKg: 100, deliveredKg: 0, pricePerKg: 1, deadlineTicks: 5,
        acceptedAtTick: 0, penaltyAmount: 500, earlyBonus: 0, completed: false, expired: false,
      });
      state.tickCount = 2; // 3 ticks remaining
      center.update(state);
      center.update(state); // second call with the same contract must not re-toast
      const contractToasts = center.getLog().filter(e => e.title.includes('#7'));
      expect(contractToasts).toHaveLength(1);
    });

    it('does not flag a contract with plenty of time left', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.contracts.active.push({
        id: 8, type: 'ore_sale', materialId: 'grumpite', description: 'test',
        quantityKg: 100, deliveredKg: 0, pricePerKg: 1, deadlineTicks: 500,
        acceptedAtTick: 0, penaltyAmount: 500, earlyBonus: 0, completed: false, expired: false,
      });
      state.tickCount = 2;
      const pips = center.update(state);
      expect(pips.some(p => p.kind === 'contract')).toBe(false);
    });
  });
});
