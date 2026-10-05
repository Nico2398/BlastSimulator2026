// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NotificationCenter, buildBlockedOrderMessage } from '../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { PendingAction, PlannedRamp } from '../../../src/core/state/GameState.js';
import { ACTION_LABEL_KEY } from '../../../src/ui/crewDetailSections.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { formatGameDuration } from '../../../src/ui/formatGameDuration.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { Random } from '../../../src/core/math/Random.js';
import { WELL_BEING_ALERT_THRESHOLD, REVOLT_TICKS, BANKRUPTCY_THRESHOLD } from '../../../src/core/config/balance.js';
import * as fs from 'fs';
import * as path from 'path';

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

    it('derives no wellbeing pip at or above the alert threshold', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.scores.wellBeing = WELL_BEING_ALERT_THRESHOLD;
      expect(center.update(state).some(p => p.kind === 'wellbeing')).toBe(false);
    });

    it('derives a warn wellbeing pip just below the alert threshold', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.scores.wellBeing = 19.9;
      const pips = center.update(state).filter(p => p.kind === 'wellbeing');
      expect(pips).toHaveLength(1);
      expect(pips[0]!.tone).toBe('warn');
    });

    it('derives a single critical wellbeing pip at zero, labelled with the remaining revolt time in days/hours that counts down', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.scores.wellBeing = 0;
      state.revolt.ticksAtZero = 40;
      let pips = center.update(state).filter(p => p.kind === 'wellbeing');
      expect(pips).toHaveLength(1);
      expect(pips[0]!.tone).toBe('critical');
      expect(pips[0]!.label).toContain(formatGameDuration(REVOLT_TICKS - 40));

      state.revolt.ticksAtZero = 41;
      pips = center.update(state).filter(p => p.kind === 'wellbeing');
      expect(pips).toHaveLength(1);
      expect(pips[0]!.label).toContain(formatGameDuration(REVOLT_TICKS - 41));
    });

    it('derives no wellbeing pip once the crew has already revolted', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.scores.wellBeing = 0;
      state.revolt.revolted = true;
      expect(center.update(state).some(p => p.kind === 'wellbeing')).toBe(false);
    });

    it('labels the warn wellbeing pip with the rounded value', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.scores.wellBeing = 12.6;
      const pips = center.update(state).filter(p => p.kind === 'wellbeing');
      expect(pips).toHaveLength(1);
      expect(pips[0]!.label).toContain('13');
    });

    it('derives a critical exposure pip at exactly the arrest threshold of 0.9', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.mafia.exposureRisk = 0.9;
      const pips = center.update(state).filter(p => p.kind === 'exposure');
      expect(pips).toHaveLength(1);
      expect(pips[0]!.tone).toBe('critical');
    });

    it('derives no exposure pip just below the warning exposure', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.mafia.exposureRisk = 0.74;
      expect(center.update(state).some(p => p.kind === 'exposure')).toBe(false);
    });

    it('derives a warn exposure pip from 0.75 up to the arrest threshold', () => {
      for (const risk of [0.75, 0.85]) {
        const center = new NotificationCenter();
        const state = makeState();
        state.mafia.exposureRisk = risk;
        const pips = center.update(state).filter(p => p.kind === 'exposure');
        expect(pips).toHaveLength(1);
        expect(pips[0]!.tone).toBe('warn');
        expect(pips[0]!.label).toContain(String(Math.round(risk * 100)));
      }
    });

    it('derives a critical exposure pip at or above 0.9 showing the rounded percent', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.mafia.exposureRisk = 0.93;
      const pips = center.update(state).filter(p => p.kind === 'exposure');
      expect(pips).toHaveLength(1);
      expect(pips[0]!.tone).toBe('critical');
      expect(pips[0]!.label).toContain('93');
    });

    it('derives a bankruptcy pip when cash is negative', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.cash = -100;
      const pips = center.update(state);
      expect(pips.some(p => p.kind === 'bankruptcy')).toBe(true);
    });

    it('derives a bankruptcy pip as soon as cash drops below the real grace-tick threshold, before going negative', () => {
      // Bankruptcy.ts starts counting ticksBelowThreshold at cash < BANKRUPTCY_THRESHOLD
      // ($5,000) — the pip must warn the player from that point, not only once cash < 0.
      const center = new NotificationCenter();
      const state = makeState();
      state.cash = 3000;
      const pips = center.update(state);
      expect(pips.some(p => p.kind === 'bankruptcy')).toBe(true);
    });

    it('does not derive a bankruptcy pip comfortably above the threshold', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.cash = 10000;
      const pips = center.update(state);
      expect(pips.some(p => p.kind === 'bankruptcy')).toBe(false);
    });

    it('derives a crew pip counting collapsed employees', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.employees.employees.push({
        id: 900, name: 'X', role: 'driller', salary: 100, morale: 50, unionized: false,
        injured: false, alive: true, x: 0, z: 0, qualifications: [], trainingState: null,
        activeActionId: null, fatigue: 50, collapsing: true,
        interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null,
        taskTicksRemaining: null, activeSkillCategory: null,
      } as never);
      const pips = center.update(state);
      const crewPip = pips.find(p => p.kind === 'crew');
      expect(crewPip?.label).toBe('1');
    });

    describe('stuck pip counts on-foot employees (#1387)', () => {
      function stuckWalker(state: ReturnType<typeof makeState>, seed: number) {
        const { employee } = hireEmployee(state.employees, 'driller', new Random(seed), 0, 0);
        employee.isMoveStuck = true;
        return employee;
      }

      it('counts a stuck on-foot employee', () => {
        const center = new NotificationCenter();
        const state = makeState();
        stuckWalker(state, 1);
        const pip = center.update(state).find(p => p.label === '1' && p.tone === 'warn');
        expect(pip).toBeDefined();
        expect(pip!.tip).toBe(t('notification.pip.crew_stuck_tip', { count: 1 }));
      });

      it('counts walkers and drivers together without double counting the driver', () => {
        const center = new NotificationCenter();
        const state = makeState();
        const walker = stuckWalker(state, 1);
        const driver = stuckWalker(state, 2);
        state.vehicles.vehicles.push({
          id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100,
          payload: null, occupantIds: [driver.id],
        });
        expect(walker.id).not.toBe(driver.id);
        const pip = center.update(state).find(p => p.tone === 'warn' && p.tip === t('notification.pip.crew_stuck_tip', { count: 2 }));
        expect(pip).toBeDefined();
        expect(pip!.label).toBe('2');
      });

      it('does not count a dead stuck employee', () => {
        const center = new NotificationCenter();
        const state = makeState();
        const e = stuckWalker(state, 1);
        e.alive = false;
        const tip1 = t('notification.pip.crew_stuck_tip', { count: 1 });
        expect(center.update(state).some(p => p.tip === tip1)).toBe(false);
      });

      it('does not count a non-stuck employee', () => {
        const center = new NotificationCenter();
        const state = makeState();
        hireEmployee(state.employees, 'driller', new Random(1), 0, 0);
        expect(center.update(state)).toHaveLength(0);
      });
    });

    it('derives a fleet pip counting stuck vehicles', () => {
      // #1138: isMoveStuck lives on the driving Employee now, not the
      // vehicle — a stuck vehicle is one whose occupant (occupantIds[0])
      // reads isMoveStuck: true.
      const center = new NotificationCenter();
      const state = makeState();
      const { employee } = hireEmployee(state.employees, 'driller', new Random(1), 0, 0);
      employee.isMoveStuck = true;
      state.vehicles.vehicles.push({
        id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100,
        payload: null, occupantIds: [employee.id],
      });
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

    // ── #1061: blocked-order warnings ─────────────────────────────────────

    function makeBlockedLevelGroundAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
      return {
        type: 'level_ground',
        requiredSkill: 'driving.excavator',
        requiredVehicleRole: 'rock_digger',
        targetX: 0, targetZ: 0, targetY: 0,
        payload: {},
        targetEmployeeId: null,
        status: 'queued',
        holderId: null,
        queuedAtTick: 0,
        blockedReason: 'no_vehicle_in_fleet',
        ...overrides,
      };
    }

    it('notifies exactly once for a newly-blocked order, with a body naming the order type and the missing vehicle role', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.pendingActions.push(makeBlockedLevelGroundAction({ id: 1 }));

      center.update(state);

      const entries = center.getLog().filter(e => e.title === t('notification.title.order_blocked'));
      expect(entries).toHaveLength(1);
      expect(entries[0]!.body).toContain(t('vehicle_type.rock_digger'));
      expect(entries[0]!.body).toContain(t(ACTION_LABEL_KEY.level_ground));
    });

    it('does not re-notify on a second update() call for the same still-blocked action and reason (dedup holds)', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.pendingActions.push(makeBlockedLevelGroundAction({ id: 1 }));

      center.update(state);
      center.update(state);

      const entries = center.getLog().filter(e => e.title === t('notification.title.order_blocked'));
      expect(entries).toHaveLength(1);
    });

    it('re-notifies when the same action\'s blockedReason changes (vehicle bought, still no driver)', () => {
      const center = new NotificationCenter();
      const state = makeState();
      const action = makeBlockedLevelGroundAction({ id: 1 });
      state.pendingActions.push(action);

      center.update(state);
      action.blockedReason = 'no_licensed_driver';
      center.update(state);

      const entries = center.getLog().filter(e => e.title === t('notification.title.order_blocked'));
      expect(entries).toHaveLength(2);
      expect(entries[0]!.body).toContain(t(ACTION_LABEL_KEY.level_ground)); // most recent, unshifted to front
    });

    it('stops notifying once blockedReason clears, and the orders alert pip disappears with it', () => {
      const center = new NotificationCenter();
      const state = makeState();
      const action = makeBlockedLevelGroundAction({ id: 1 });
      state.pendingActions.push(action);

      let pips = center.update(state);
      expect(pips.some(p => p.kind === 'orders')).toBe(true);

      action.blockedReason = null;
      pips = center.update(state);

      const entries = center.getLog().filter(e => e.title === t('notification.title.order_blocked'));
      expect(entries).toHaveLength(1); // only the original notification, nothing new
      expect(pips.some(p => p.kind === 'orders')).toBe(false);
    });

    it('re-notifies when a previously-blocked (then resolved) action becomes blocked again later', () => {
      const center = new NotificationCenter();
      const state = makeState();
      const action = makeBlockedLevelGroundAction({ id: 1 });
      state.pendingActions.push(action);

      center.update(state); // first block
      action.blockedReason = null;
      center.update(state); // resolved
      action.blockedReason = 'no_vehicle_in_fleet'; // blocked again, same reason as before
      center.update(state);

      const entries = center.getLog().filter(e => e.title === t('notification.title.order_blocked'));
      expect(entries).toHaveLength(2);
    });

    it('derives an orders pip whose count matches the number of currently-blocked queued actions', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.pendingActions.push(makeBlockedLevelGroundAction({ id: 1 }));
      state.pendingActions.push(makeBlockedLevelGroundAction({ id: 2, blockedReason: 'no_licensed_driver' }));

      const pips = center.update(state);

      const ordersPip = pips.find(p => p.kind === 'orders');
      expect(ordersPip).toBeDefined();
      expect(ordersPip!.label).toContain('2');
    });
  });

  // ── #1302: stranded auto-generated debris is a summary pip, not a toast per piece ──
  describe('stranded debris summary (#1302)', () => {
    function makeDebrisAction(id: number, overrides: Partial<PendingAction> = {}): PendingAction {
      return {
        id,
        type: 'haul_debris',
        requiredSkill: null,
        requiredVehicleRole: 'debris_hauler',
        targetX: id, targetZ: 0, targetY: 0,
        payload: { fragmentId: id },
        targetEmployeeId: null,
        status: 'queued',
        holderId: null,
        queuedAtTick: 0,
        blockedReason: 'debris_out_of_reach',
        ...overrides,
      };
    }
    const strandedLabel = (count: number) => t('notification.pip.stranded_debris_label', { count });
    const orderBlockedEntries = (center: NotificationCenter) =>
      center.getLog().filter(e => e.title === t('notification.title.order_blocked'));
    const findStrandedPips = (pips: ReturnType<NotificationCenter['update']>, count: number) =>
      pips.filter(p => p.label === strandedLabel(count));

    it('raises no toast and no log entry for N stranded debris actions', () => {
      const center = new NotificationCenter();
      const state = makeState();
      for (let i = 1; i <= 25; i++) state.pendingActions.push(makeDebrisAction(i));

      center.update(state);

      expect(center.getToasts()).toHaveLength(0);
      expect(orderBlockedEntries(center)).toHaveLength(0);
    });

    it('raises exactly one non-warn summary pip carrying the stranded count', () => {
      const center = new NotificationCenter();
      const state = makeState();
      for (let i = 1; i <= 25; i++) state.pendingActions.push(makeDebrisAction(i, i % 2 ? {} : { type: 'fragment_debris', requiredVehicleRole: 'rock_fragmenter' }));

      const pips = center.update(state);

      expect(pips).toHaveLength(1);
      expect(findStrandedPips(pips, 25)).toHaveLength(1);
      expect(pips[0]!.tone).not.toBe('warn');
      expect(pips[0]!.tone).not.toBe('critical');
      expect(pips[0]!.kind).not.toBe('orders');
      expect(pips[0]!.tip).toBe(t('notification.pip.stranded_debris_tip', { count: 25 }));
    });

    it('does not repeat the summary on a second update() call', () => {
      const center = new NotificationCenter();
      const state = makeState();
      for (let i = 1; i <= 5; i++) state.pendingActions.push(makeDebrisAction(i));

      center.update(state);
      const pips = center.update(state);

      expect(pips).toHaveLength(1);
      expect(center.getToasts()).toHaveLength(0);
    });

    it('updates the pip count as debris is hauled and removes the pip once none remain', () => {
      const center = new NotificationCenter();
      const state = makeState();
      for (let i = 1; i <= 3; i++) state.pendingActions.push(makeDebrisAction(i));
      expect(findStrandedPips(center.update(state), 3)).toHaveLength(1);

      state.pendingActions.pop();
      expect(findStrandedPips(center.update(state), 2)).toHaveLength(1);

      for (const a of state.pendingActions) a.blockedReason = null;
      expect(center.update(state)).toHaveLength(0);

      state.pendingActions.length = 0;
      expect(center.update(state)).toHaveLength(0);
    });

    it('mixed: a player-ordered target_unreachable action still gets one warn toast and the BLOCKED pip, alongside the stranded pip', () => {
      const center = new NotificationCenter();
      const state = makeState();
      for (let i = 1; i <= 4; i++) state.pendingActions.push(makeDebrisAction(i));
      state.pendingActions.push({
        id: 100, type: 'survey', requiredSkill: null, requiredVehicleRole: null,
        targetX: 9, targetZ: 9, targetY: 0, payload: {}, targetEmployeeId: null,
        status: 'queued', holderId: null, queuedAtTick: 0, blockedReason: 'target_unreachable',
      });

      const pips = center.update(state);

      const toasts = center.getToasts();
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.severity).toBe('warn');
      expect(orderBlockedEntries(center)).toHaveLength(1);
      const ordersPip = pips.find(p => p.kind === 'orders');
      expect(ordersPip).toBeDefined();
      expect(ordersPip!.label).toContain('1');
      expect(ordersPip!.tone).toBe('warn');
      expect(findStrandedPips(pips, 4)).toHaveLength(1);
      expect(pips).toHaveLength(2);
    });
  });

  describe('per-ramp blocked-order dedupe (#1306)', () => {
    function layerAction(id: number): PendingAction {
      return {
        id, type: 'dig_ramp_segment', requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger',
        targetX: id, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
        status: 'queued', holderId: null, queuedAtTick: 0, blockedReason: 'target_unreachable',
      };
    }
    function rampOf(id: number, actionIds: number[]): PlannedRamp {
      return {
        id,
        def: {} as PlannedRamp['def'], footprint: {} as PlannedRamp['footprint'],
        segments: actionIds.map((actionId, index) => ({
          index, actionId, cells: [], region: null, done: false, carvedCount: 0,
        })),
      };
    }
    const orderBlockedToasts = (center: NotificationCenter) =>
      center.getLog().filter(e => e.title === t('notification.title.order_blocked'));

    it('warns once for a ramp whose three layers are all unreachable', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.pendingActions.push(layerAction(1), layerAction(2), layerAction(3));
      state.plannedRamps.push(rampOf(1, [1, 2, 3]));

      center.update(state);
      center.update(state);

      expect(orderBlockedToasts(center)).toHaveLength(1);
    });

    it('warns once per ramp, not once overall, for two unreachable ramps', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.pendingActions.push(layerAction(1), layerAction(2), layerAction(3), layerAction(4));
      state.plannedRamps.push(rampOf(1, [1, 2]), rampOf(2, [3, 4]));

      center.update(state);

      expect(orderBlockedToasts(center)).toHaveLength(2);
    });

    it('still warns once per order when the blocked orders are not ramp layers', () => {
      const center = new NotificationCenter();
      const state = makeState();
      state.pendingActions.push(layerAction(1), layerAction(2));

      center.update(state);

      expect(orderBlockedToasts(center)).toHaveLength(2);
    });
  });

  describe('buildBlockedOrderMessage (#1061)', () => {
    function makeAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
      return {
        type: 'level_ground',
        requiredSkill: 'driving.excavator',
        requiredVehicleRole: 'rock_digger',
        targetX: 0, targetZ: 0, targetY: 0,
        payload: {},
        targetEmployeeId: null,
        status: 'queued',
        holderId: null,
        queuedAtTick: 0,
        ...overrides,
      };
    }

    it('names the order type and the vehicle role for no_vehicle_in_fleet', () => {
      const action = makeAction({ id: 1, blockedReason: 'no_vehicle_in_fleet' });
      const message = buildBlockedOrderMessage(action);
      expect(message).toContain(t(ACTION_LABEL_KEY.level_ground));
      expect(message).toContain(t('vehicle_type.rock_digger'));
    });

    it('names the order type and the vehicle role for no_licensed_driver, with wording distinct from no_vehicle_in_fleet', () => {
      const action = makeAction({ id: 1, blockedReason: 'no_licensed_driver' });
      const message = buildBlockedOrderMessage(action);
      expect(message).toContain(t(ACTION_LABEL_KEY.level_ground));
      expect(message).toContain(t('vehicle_type.rock_digger'));

      const otherMessage = buildBlockedOrderMessage(makeAction({ id: 1, blockedReason: 'no_vehicle_in_fleet' }));
      expect(message).not.toBe(otherMessage);
    });

    it('names the order type and required skill for no_qualified_employee', () => {
      const action = makeAction({
        id: 1, type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: null,
        blockedReason: 'no_qualified_employee',
      });
      const message = buildBlockedOrderMessage(action);
      expect(message).toContain(t(ACTION_LABEL_KEY.drill_hole));
      expect(message).toContain(t('skill.blasting'));
    });

    it('names the order, the licence and the skill for no_dual_qualified_employee (#1386), distinct from no_qualified_employee', () => {
      const base = { id: 1, type: 'drill_hole' as const, requiredSkill: 'blasting' as const, requiredVehicleRole: 'drill_rig' as const };
      const message = buildBlockedOrderMessage(makeAction({ ...base, blockedReason: 'no_dual_qualified_employee' }));
      expect(message).toContain(t(ACTION_LABEL_KEY.drill_hole));
      expect(message).toContain(t('vehicle_type.drill_rig'));
      expect(message).toContain(t('skill.blasting'));
      expect(message).not.toContain('notification.');
      expect(message).not.toBe(buildBlockedOrderMessage(makeAction({ ...base, blockedReason: 'no_qualified_employee' })));
    });

    it('names the order type for target_unreachable (#1231), with a translated, non-generic body distinct from the other three reasons', () => {
      // Red until the implementer adds
      // `notification.order_blocked_target_unreachable` to en.json/fr.json —
      // t() (I18n.ts) returns the bare key string unmodified (no
      // interpolation attempted) when the key is missing, so `message` today
      // is the literal string 'notification.order_blocked_target_unreachable'
      // — it contains neither the translated order label nor any real
      // wording, and it collides with none of the assertions below only
      // because the key IS added (mirror the existing 3 reasons exactly).
      const action = makeAction({
        id: 1, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler',
        blockedReason: 'target_unreachable',
      });
      const message = buildBlockedOrderMessage(action);
      expect(message).toContain(t(ACTION_LABEL_KEY.haul_debris));
      // Never the raw untranslated key — that would mean the locale entry
      // still doesn't exist (I18n.ts's own missing-key fallback).
      expect(message).not.toBe('notification.order_blocked_target_unreachable');
      expect(message).not.toContain('notification.order_blocked_target_unreachable');

      const noVehicleMessage = buildBlockedOrderMessage(
        makeAction({ id: 1, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler', blockedReason: 'no_vehicle_in_fleet' }),
      );
      expect(message).not.toBe(noVehicleMessage);
    });
  });
});

// ── #1369: freight warehouse / storage-full blocked haul orders ────────────
describe('blocked haul orders: warehouse gating (#1369)', () => {
  function makeHaulAction(id: number, reason: NonNullable<PendingAction['blockedReason']>): PendingAction {
    return {
      id, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler',
      targetX: id, targetZ: 0, targetY: 0, payload: { fragmentId: id }, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0, blockedReason: reason,
    };
  }
  const blockedEntries = (c: NotificationCenter) => c.getLog().filter(e => e.title === t('notification.title.order_blocked'));
  const locale = (name: string) => JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'src/core/i18n/locales', `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;

  it('buildBlockedOrderMessage returns a translated message for no_freight_warehouse', () => {
    const msg = buildBlockedOrderMessage(makeHaulAction(1, 'no_freight_warehouse'));
    expect(msg).not.toContain('notification.order_blocked_no_warehouse');
    expect(msg).not.toBe(t(ACTION_LABEL_KEY.haul_debris));
    expect(msg).toBe(t('notification.order_blocked_no_warehouse', { order: t(ACTION_LABEL_KEY.haul_debris) }));
  });

  it('buildBlockedOrderMessage returns a translated message for storage_full', () => {
    const msg = buildBlockedOrderMessage(makeHaulAction(1, 'storage_full'));
    expect(msg).not.toContain('notification.order_blocked_storage_full');
    expect(msg).not.toBe(t(ACTION_LABEL_KEY.haul_debris));
    expect(msg).toBe(t('notification.order_blocked_storage_full', { order: t(ACTION_LABEL_KEY.haul_debris) }));
  });

  it('the two reasons read differently', () => {
    expect(buildBlockedOrderMessage(makeHaulAction(1, 'no_freight_warehouse')))
      .not.toBe(buildBlockedOrderMessage(makeHaulAction(1, 'storage_full')));
  });

  it.each(['notification.order_blocked_no_warehouse', 'notification.order_blocked_storage_full'])(
    'en and fr both define %s with different text', (key) => {
      const en = locale('en')[key];
      const fr = locale('fr')[key];
      expect(typeof en).toBe('string');
      expect(typeof fr).toBe('string');
      expect(fr).not.toBe(en);
    });

  it('raises one toast for N haul actions blocked by no_freight_warehouse', () => {
    const center = new NotificationCenter();
    const state = makeState();
    for (let i = 1; i <= 12; i++) state.pendingActions.push(makeHaulAction(i, 'no_freight_warehouse'));
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(1);
  });

  it('raises one toast for N haul actions blocked by storage_full', () => {
    const center = new NotificationCenter();
    const state = makeState();
    for (let i = 1; i <= 12; i++) state.pendingActions.push(makeHaulAction(i, 'storage_full'));
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(1);
  });

  it('raises one toast per distinct haul reason when both are present', () => {
    const center = new NotificationCenter();
    const state = makeState();
    for (let i = 1; i <= 4; i++) state.pendingActions.push(makeHaulAction(i, 'no_freight_warehouse'));
    for (let i = 5; i <= 8; i++) state.pendingActions.push(makeHaulAction(i, 'storage_full'));
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(2);
  });

  it('does not re-toast on a second update with the same reason', () => {
    const center = new NotificationCenter();
    const state = makeState();
    for (let i = 1; i <= 3; i++) state.pendingActions.push(makeHaulAction(i, 'no_freight_warehouse'));
    center.update(state);
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(1);
  });

  it('re-toasts when the shared reason changes (warehouse built, then storage fills)', () => {
    const center = new NotificationCenter();
    const state = makeState();
    const actions = [1, 2, 3].map(i => makeHaulAction(i, 'no_freight_warehouse'));
    state.pendingActions.push(...actions);
    center.update(state);
    for (const a of actions) a.blockedReason = 'storage_full';
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(2);
  });

  it('re-toasts when the reason clears and then reappears', () => {
    const center = new NotificationCenter();
    const state = makeState();
    const actions = [1, 2, 3].map(i => makeHaulAction(i, 'storage_full'));
    state.pendingActions.push(...actions);
    center.update(state);
    for (const a of actions) a.blockedReason = null;
    center.update(state);
    for (const a of actions) a.blockedReason = 'storage_full';
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(2);
  });

  it('re-toasts once when no_qualified_employee becomes no_dual_qualified_employee (#1386)', () => {
    const center = new NotificationCenter();
    const state = makeState();
    const action: PendingAction = {
      id: 1, type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig',
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0, blockedReason: 'no_qualified_employee',
    };
    state.pendingActions.push(action);
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(1);
    action.blockedReason = 'no_dual_qualified_employee';
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(2);
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(2);
  });

  it('toasts once for the haul reason plus once per non-haul blocked action in the same update', () => {
    const center = new NotificationCenter();
    const state = makeState();
    for (let i = 1; i <= 5; i++) state.pendingActions.push(makeHaulAction(i, 'storage_full'));
    state.pendingActions.push(makeHaulAction(6, 'no_vehicle_in_fleet'));
    state.pendingActions.push(makeHaulAction(7, 'no_licensed_driver'));
    center.update(state);
    expect(blockedEntries(center)).toHaveLength(3);
  });
});

describe('NotificationCenter localization (#1417)', () => {
  afterEach(() => { setLocale('en'); });

  const ENGLISH_LEAKS = [/Balance/, /expires/, /collapsed/, /\bleft\b/, /\bstuck\b/, /critical/i, /waiting/, /Contract #/, /penalty/, /proceedings/];

  function allText(items: readonly { label: string; tip: string }[]): string {
    return items.map(p => `${p.label} | ${p.tip}`).join('\n');
  }

  function stressedState() {
    const state = makeState();
    state.events.pendingEvent = { eventId: 'test', firedAtTick: 1 };
    state.scores.ecology = 10;
    state.cash = 100;
    state.employees.employees.push({
      id: 900, name: 'X', role: 'driller', salary: 100, morale: 50, unionized: false,
      injured: false, alive: true, x: 0, z: 0, qualifications: [], trainingState: null,
      activeActionId: null, fatigue: 50, collapsing: true,
      interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null,
      taskTicksRemaining: null, activeSkillCategory: null,
    } as never);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1), 0, 0);
    employee.isMoveStuck = true;
    state.vehicles.vehicles.push({
      id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100,
      occupantIds: [employee.id],
    } as never);
    state.contracts.active.push({
      id: 7, type: 'ore_sale', materialId: 'grumpite', description: 'test',
      quantityKg: 100, deliveredKg: 0, pricePerKg: 1, deadlineTicks: 5,
      acceptedAtTick: 0, penaltyAmount: 500, earlyBonus: 0, completed: false, expired: false,
    });
    state.tickCount = 2;
    return state;
  }

  it('pip tooltips are French in fr: no English fragments leak', () => {
    setLocale('fr');
    const center = new NotificationCenter();
    const pips = center.update(stressedState());
    for (const kind of ['event', 'ecology', 'bankruptcy', 'crew', 'fleet', 'contract']) {
      expect(pips.some(p => p.kind === kind), `pip ${kind} present`).toBe(true);
    }
    const text = allText(pips);
    for (const leak of ENGLISH_LEAKS) expect(text).not.toMatch(leak);
  });

  it('pip tooltips differ between en and fr for every derived pip kind', () => {
    const state = stressedState();
    setLocale('en');
    const en = new NotificationCenter().update(state);
    setLocale('fr');
    const fr = new NotificationCenter().update(state);
    expect(fr.length).toBe(en.length);
    for (const kind of ['event', 'ecology', 'bankruptcy', 'crew', 'fleet', 'contract']) {
      expect(en.some(p => p.kind === kind), `pip ${kind} present`).toBe(true);
    }
    for (const e of en.filter(p => ['event', 'ecology', 'bankruptcy', 'crew', 'fleet', 'contract'].includes(p.kind))) {
      const f = fr.find(p => p.kind === e.kind)!;
      expect(f.tip, `${e.kind} tip`).not.toBe(e.tip);
    }
  });

  it('the low-cash pip tooltip in fr names the threshold and is not the English sentence', () => {
    setLocale('fr');
    const state = makeState();
    state.cash = 100;
    const pip = new NotificationCenter().update(state).find(p => p.kind === 'bankruptcy')!;
    expect(pip.tip).not.toMatch(/Balance|bankruptcy/i);
    expect(pip.tip).toContain(formatMoney(BANKRUPTCY_THRESHOLD));
    expect(pip.tip.length).toBeGreaterThan(10);
    expect(pip.tip).not.toMatch(/^notification\./);
  });

  it('pip tooltips never surface raw i18n keys', () => {
    for (const locale of ['en', 'fr'] as const) {
      setLocale(locale);
      const pips = new NotificationCenter().update(stressedState());
      for (const p of pips) {
        expect(p.label).not.toMatch(/notification\./);
        expect(p.tip).not.toMatch(/notification\./);
      }
    }
  });

  it('the contract-expiry toast is French in fr', () => {
    setLocale('fr');
    const center = new NotificationCenter();
    center.update(stressedState());
    const entry = center.getLog().find(e => e.title.includes('#7'));
    expect(entry).toBeDefined();
    expect(entry!.title).not.toMatch(/Contract|expiring/);
    expect(entry!.body).not.toMatch(/left|penalty|lapses/);
    expect(entry!.body).toContain('500');
  });

  it('the contract-expiry toast in en reads from the notification.contract_expiring_* keys', () => {
    setLocale('en');
    const center = new NotificationCenter();
    center.update(stressedState());
    const entry = center.getLog().find(e => e.title.includes('#7'))!;
    expect(entry.title).toContain('#7');
    expect(entry.title).not.toBe('notification.contract_expiring_title');
    expect(entry.body).not.toBe('notification.contract_expiring_body');
    expect(t('notification.contract_expiring_title', { id: 7 })).not.toBe('notification.contract_expiring_title');
  });

  it('the revolt pip label speaks in days and hours, not raw ticks', () => {
    for (const locale of ['en', 'fr'] as const) {
      setLocale(locale);
      const state = makeState();
      state.scores.wellBeing = 0;
      state.revolt.ticksAtZero = 40; // 80 ticks left = 3 days 8 hours
      const pip = new NotificationCenter().update(state).find(p => p.kind === 'wellbeing')!;
      expect(pip.label).toContain(formatGameDuration(80));
      expect(pip.tip).toContain(formatGameDuration(80));
    }
    setLocale('en');
    const state = makeState();
    state.scores.wellBeing = 0;
    state.revolt.ticksAtZero = 40;
    const pip = new NotificationCenter().update(state).find(p => p.kind === 'wellbeing')!;
    expect(pip.label).toContain('3d 8h');
  });
});
