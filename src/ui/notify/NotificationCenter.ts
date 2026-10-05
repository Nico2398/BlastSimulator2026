// BlastSimulator2026 — Notification center (redesign P1)
//
// Single source of truth for toasts, the activity log, and the top-bar
// alert pips. Toasts and the log share every entry (design: "everything
// lands in the log"); alert pips are derived fresh from GameState each
// frame rather than stored, so they can never go stale.
//
// Consumed by shell/Toasts.ts, shell/ActivityLog.ts and shell/TopBar.ts,
// each of which polls this per UIManager.update() the same way every other
// panel polls GameState — no event-callback wiring needed.

import type { IconName } from '../icons.js';
import type { GameState, PendingAction, BlockedOrderReason } from '../../core/state/GameState.js';
import { BANKRUPTCY_THRESHOLD } from '../../core/campaign/Bankruptcy.js';
import { ARREST_EXPOSURE_THRESHOLD, ARREST_WARNING_EXPOSURE } from '../../core/campaign/CriminalArrest.js';
import { revoltTicksRemaining } from '../../core/campaign/WorkerRevolt.js';
import { WELL_BEING_ALERT_THRESHOLD } from '../../core/config/balance.js';
import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { formatGameDuration } from '../formatGameDuration.js';
import { ACTION_LABEL_KEY } from '../crewDetailSections.js';
import { findTrafficJams } from '../../core/events/TrafficJams.js';
import { isHaulBlockedReason } from '../../core/economy/HaulDispatch.js';

export type Severity = 'info' | 'positive' | 'warn' | 'critical';

const SEVERITY_ICON: Record<Severity, IconName> = {
  info: 'clock',
  positive: 'check',
  warn: 'warn',
  critical: 'crit',
};
const SEVERITY_COLOR: Record<Severity, string> = {
  info: 'var(--bsx-info)',
  positive: 'var(--bsx-positive)',
  warn: 'var(--bsx-amber)',
  critical: 'var(--bsx-critical-text)',
};

export interface NotifyInput {
  severity: Severity;
  title: string;
  body: string;
  /** Overrides the severity's default icon. */
  icon?: IconName;
  /** Optional call-to-action label + handler, shown on the toast only. */
  cta?: string;
  onCta?: () => void;
}

export interface LogEntry {
  readonly id: number;
  readonly icon: IconName;
  readonly color: string;
  readonly title: string;
  readonly body: string;
  /** Game tick the notification landed on, for the log's "when" column. */
  readonly tick: number;
}

export interface Toast extends LogEntry {
  readonly severity: Severity;
  readonly cta?: string;
  readonly onCta?: () => void;
}

/** Max toasts visible/queued at once before the oldest is dropped from the toast list (it stays in the log). */
export const MAX_TOASTS = 4;
/** Ring-buffer cap for the activity log. */
const MAX_LOG = 100;
/** Auto-dismiss delay, matching the design's toast motion spec. */
const TOAST_LIFETIME_MS = 6500;

export type AlertKind = 'event' | 'ecology' | 'bankruptcy' | 'contract' | 'crew' | 'fleet' | 'orders' | 'traffic' | 'debris' | 'wellbeing' | 'exposure';

export interface AlertPip {
  readonly kind: AlertKind;
  readonly icon: IconName;
  readonly label: string;
  readonly tone: 'neutral' | 'warn' | 'critical';
  readonly tip: string;
}

export class NotificationCenter {
  private readonly log: LogEntry[] = [];
  private readonly toasts: Toast[] = [];
  private nextId = 1;
  private currentTick = 0;
  /** Contracts already warned about expiry, so the same contract doesn't re-toast every frame. */
  private readonly warnedContracts = new Set<number>();
  /** PendingAction ids already warned about being blocked, keyed to the reason last warned (#1061), so a re-classification to a different reason re-toasts but the same one doesn't repeat every frame. */
  private readonly warnedBlockedOrders = new Map<number, BlockedOrderReason>();
  /** Haul reasons already toasted; one toast per reason while it persists, not per haul action (#1369). */
  private readonly warnedHaulReasons = new Set<BlockedOrderReason>();

  /** Push a notification: it appears as a toast now and stays in the log. */
  notify(input: NotifyInput): void {
    const entry: LogEntry = {
      id: this.nextId++,
      icon: input.icon ?? SEVERITY_ICON[input.severity],
      color: SEVERITY_COLOR[input.severity],
      title: input.title,
      body: input.body,
      tick: this.currentTick,
    };
    this.log.unshift(entry);
    if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;

    const toastFields: { cta?: string; onCta?: () => void } = {};
    if (input.cta !== undefined) toastFields.cta = input.cta;
    if (input.onCta !== undefined) toastFields.onCta = input.onCta;
    const toast: Toast = { ...entry, severity: input.severity, ...toastFields };
    this.toasts.push(toast);
    if (this.toasts.length > MAX_TOASTS) this.toasts.shift();
    // Auto-dismiss only the toast surface; the log entry is permanent.
    setTimeout(() => this.dismissToast(entry.id), TOAST_LIFETIME_MS);
  }

  dismissToast(id: number): void {
    const idx = this.toasts.findIndex(t => t.id === id);
    if (idx !== -1) this.toasts.splice(idx, 1);
  }

  getToasts(): readonly Toast[] { return this.toasts; }
  getLog(): readonly LogEntry[] { return this.log; }
  get unreadCount(): number { return this.log.length; }

  /**
   * Re-derive alert pips and fire any newly-crossed threshold as a toast.
   * Called once per UIManager.update() — cheap: no allocation beyond the
   * returned array, and the contract-expiry toast guard is the only state
   * this mutates.
   */
  update(state: GameState): AlertPip[] {
    this.currentTick = state.tickCount;
    const pips: AlertPip[] = [];

    if (state.events.pendingEvent) {
      pips.push({ kind: 'event', icon: 'warn', label: t('notification.pip.event_label'), tone: 'critical', tip: t('notification.pip.event_tip') });
    }
    if (state.scores.ecology < 20) {
      pips.push({ kind: 'ecology', icon: 'crit', label: t('notification.pip.ecology_label', { value: Math.round(state.scores.ecology) }), tone: 'critical', tip: t('notification.pip.ecology_tip', { value: Math.round(state.scores.ecology) }) });
    }
    const wellBeing = state.scores.wellBeing;
    if (wellBeing < WELL_BEING_ALERT_THRESHOLD) {
      if (wellBeing > 0) {
        pips.push({ kind: 'wellbeing', icon: 'warn', label: t('notification.pip.wellbeing_label', { value: Math.round(wellBeing) }), tone: 'warn', tip: t('notification.pip.wellbeing_tip') });
      } else if (!state.revolt.revolted) {
        const duration = formatGameDuration(revoltTicksRemaining(state.revolt));
        pips.push({ kind: 'wellbeing', icon: 'crit', label: t('notification.pip.revolt_label', { duration }), tone: 'critical', tip: t('notification.pip.revolt_tip', { duration }) });
      }
    }
    const exposure = state.mafia.exposureRisk;
    if (exposure >= ARREST_WARNING_EXPOSURE) {
      const percent = Math.round(exposure * 100);
      pips.push({ kind: 'exposure', icon: 'gavel', label: t('notification.pip.exposure_label', { percent }), tone: exposure >= ARREST_EXPOSURE_THRESHOLD ? 'critical' : 'warn', tip: t('notification.pip.exposure_tip', { percent }) });
    }
    // Real bankruptcy grace-tick countdown (Bankruptcy.ts) starts the moment cash drops
    // below BANKRUPTCY_THRESHOLD, not merely once it goes negative — firing this pip only
    // at cash < 0 left the player with no warning for most of that countdown.
    if (state.cash < BANKRUPTCY_THRESHOLD) {
      pips.push({ kind: 'bankruptcy', icon: 'crit', label: t('notification.pip.cash_label'), tone: 'critical', tip: t('notification.pip.cash_tip', { threshold: formatMoney(BANKRUPTCY_THRESHOLD) }) });
    }
    const collapsedCount = state.employees.employees.filter(e => e.alive && e.collapsing).length;
    if (collapsedCount > 0) {
      pips.push({ kind: 'crew', icon: 'collapse', label: String(collapsedCount), tone: 'critical', tip: t('notification.pip.crew_collapsed_tip', { count: collapsedCount }) });
    }
    const stuckCount = state.employees.employees.filter(e => e.alive && e.isMoveStuck).length;
    if (stuckCount > 0) {
      pips.push({ kind: 'fleet', icon: 'vehicle', label: String(stuckCount), tone: 'warn', tip: t('notification.pip.crew_stuck_tip', { count: stuckCount }) });
    }
    const jams = findTrafficJams(state.builtRamps, state.employees.employees);
    if (jams.length > 0) {
      const where = jams.map(j => t(`traffic.chokepoint.${j.kind === 'ramp_head' ? 'ramp' : j.kind}`)).join(', ');
      pips.push({ kind: 'traffic', icon: 'vehicle', label: t('ui.alert.traffic_jam', { count: jams.length }), tone: 'warn', tip: where });
    }
    const urgentContract = state.contracts.active.find(c => {
      const remaining = c.acceptedAtTick + c.deadlineTicks - state.tickCount;
      return remaining <= 10 && remaining > 0;
    });
    if (urgentContract) {
      const remaining = urgentContract.acceptedAtTick + urgentContract.deadlineTicks - state.tickCount;
      const duration = formatGameDuration(remaining);
      pips.push({ kind: 'contract', icon: 'clock', label: t('notification.pip.contract_label', { id: urgentContract.id, duration }), tone: 'warn', tip: t('notification.pip.contract_tip', { id: urgentContract.id, duration }) });
      if (!this.warnedContracts.has(urgentContract.id)) {
        this.warnedContracts.add(urgentContract.id);
        this.notify({
          severity: 'warn',
          icon: 'clock',
          title: t('notification.contract_expiring_title', { id: urgentContract.id }),
          body: t('notification.contract_expiring_body', { duration, penalty: formatMoney(urgentContract.penaltyAmount) }),
        });
      }
    }
    // Forget expiry warnings for contracts that are no longer active (completed, expired, or declined).
    if (this.warnedContracts.size > 0) {
      this.pruneStaleKeys(this.warnedContracts, new Set(state.contracts.active.map(c => c.id)));
    }

    // Blocked orders (#1061): EmployeeDispatch.ts's classification pass
    // stamps action.blockedReason every tick — this just surfaces it. Mirrors
    // the contract-expiry pattern just above: warn once per (action,
    // reason) pair, re-toast only if the reason itself changes, and forget
    // ids that are no longer blocked.
    // Stranded debris (#1302) is a player-owned state, not a failure: no toast,
    // no log entry, just one neutral summary pip.
    const queuedBlocked = state.pendingActions.filter(
      a => a.status === 'queued' && a.blockedReason != null,
    );
    const strandedCount = queuedBlocked.filter(a => a.blockedReason === 'debris_out_of_reach').length;
    const blockedActions = queuedBlocked.filter(a => a.blockedReason !== 'debris_out_of_reach');
    // Hundreds of haul actions share one cause: toast once per reason, not per action.
    const haulActions = new Map<BlockedOrderReason, PendingAction>();
    for (const a of blockedActions) {
      const r = a.blockedReason;
      if (isHaulBlockedReason(r) && !haulActions.has(r)) haulActions.set(r, a);
    }
    for (const [reason, action] of haulActions) {
      if (this.warnedHaulReasons.has(reason)) continue;
      this.warnedHaulReasons.add(reason);
      this.notify({ severity: 'warn', icon: 'warn', title: t('notification.title.order_blocked'), body: buildBlockedOrderMessage(action) });
    }
    for (const reason of this.warnedHaulReasons) {
      if (!haulActions.has(reason)) this.warnedHaulReasons.delete(reason);
    }
    // A ramp's layers are judged together (#1306), so one unreachable ramp
    // would otherwise toast once per layer: warn once per ramp instead.
    const siblingActionIds = new Map<number, readonly number[]>();
    for (const ramp of state.plannedRamps) {
      const ids = ramp.segments.map(s => s.actionId);
      for (const id of ids) siblingActionIds.set(id, ids);
    }
    for (const action of blockedActions) {
      const reason = action.blockedReason as BlockedOrderReason;
      if (isHaulBlockedReason(reason)) continue;
      if (this.warnedBlockedOrders.get(action.id) === reason) continue;
      const alreadyWarnedForRamp = (siblingActionIds.get(action.id) ?? [])
        .some(id => this.warnedBlockedOrders.get(id) === reason);
      this.warnedBlockedOrders.set(action.id, reason);
      if (alreadyWarnedForRamp) continue;
      this.notify({
        severity: 'warn',
        icon: 'warn',
        title: t('notification.title.order_blocked'),
        body: buildBlockedOrderMessage(action),
      });
    }
    if (this.warnedBlockedOrders.size > 0) {
      this.pruneStaleKeys(this.warnedBlockedOrders, new Set(blockedActions.map(a => a.id)));
    }
    if (strandedCount > 0) {
      pips.push({
        kind: 'debris',
        icon: 'clock',
        label: t('notification.pip.stranded_debris_label', { count: strandedCount }),
        tone: 'neutral',
        tip: t('notification.pip.stranded_debris_tip', { count: strandedCount }),
      });
    }
    if (blockedActions.length > 0) {
      pips.push({
        kind: 'orders',
        icon: 'warn',
        label: t('notification.pip.blocked_orders_label', { count: blockedActions.length }),
        tone: 'warn',
        tip: t('notification.pip.blocked_orders_tip', { count: blockedActions.length }),
      });
    }

    return pips;
  }

  /**
   * Deletes keys from `map` that are no longer present in `currentIds` — the
   * "forget stale warn-once state" half shared by the contract-expiry and
   * blocked-orders guards above (#1061 review: identical prune shape).
   */
  private pruneStaleKeys(map: Map<number, BlockedOrderReason> | Set<number>, currentIds: Set<number>): void {
    for (const key of map instanceof Map ? map.keys() : map) {
      if (!currentIds.has(key)) map.delete(key);
    }
  }
}

/** Builds the notification body naming the blocked order and its missing requirement (#1061). */
export function buildBlockedOrderMessage(action: PendingAction): string {
  const order = t(ACTION_LABEL_KEY[action.type]);
  switch (action.blockedReason) {
    case 'no_vehicle_in_fleet':
      return t('notification.order_blocked_no_vehicle', { order, role: t(`vehicle_type.${action.requiredVehicleRole}`) });
    case 'no_licensed_driver':
      return t('notification.order_blocked_no_driver', { order, role: t(`vehicle_type.${action.requiredVehicleRole}`) });
    case 'no_qualified_employee':
      return action.requiredSkill !== null
        ? t('notification.order_blocked_no_employee', { order, skill: t(`skill.${action.requiredSkill}`) })
        : t('notification.order_blocked_no_staff', { order });
    case 'no_dual_qualified_employee':
      return t('notification.order_blocked_no_dual_employee', {
        order,
        licence: t(`vehicle_type.${action.requiredVehicleRole}`),
        skill: t(`skill.${action.requiredSkill}`),
      });
    case 'target_unreachable':
      return t('notification.order_blocked_target_unreachable', { order });
    case 'no_freight_warehouse':
      return t('notification.order_blocked_no_warehouse', { order });
    case 'storage_full':
      return t('notification.order_blocked_storage_full', { order });
    case 'debris_out_of_reach':
      // Unreachable from update(): stranded debris is surfaced as one summary pip, not a per-order toast. Kept for exhaustiveness.
      return t('notification.pip.stranded_debris_tip', { count: 1 });
    default:
      return order;
  }
}
