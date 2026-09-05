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
import type { GameState } from '../../core/state/GameState.js';
import { BANKRUPTCY_THRESHOLD } from '../../core/campaign/Bankruptcy.js';

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

export type AlertKind = 'event' | 'ecology' | 'bankruptcy' | 'contract' | 'crew' | 'fleet';

export interface AlertPip {
  readonly kind: AlertKind;
  readonly icon: IconName;
  readonly label: string;
  readonly tone: 'warn' | 'critical';
  readonly tip: string;
}

export class NotificationCenter {
  private readonly log: LogEntry[] = [];
  private readonly toasts: Toast[] = [];
  private nextId = 1;
  private currentTick = 0;
  /** Contracts already warned about expiry, so the same contract doesn't re-toast every frame. */
  private readonly warnedContracts = new Set<number>();

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
      pips.push({ kind: 'event', icon: 'warn', label: 'EVENT', tone: 'critical', tip: 'An event is waiting — the clock is held' });
    }
    if (state.scores.ecology < 20) {
      pips.push({ kind: 'ecology', icon: 'crit', label: `ECO ${Math.round(state.scores.ecology)}`, tone: 'critical', tip: `Ecology critical (${Math.round(state.scores.ecology)}) — shutdown proceedings begin once it hits zero` });
    }
    // Real bankruptcy grace-tick countdown (Bankruptcy.ts) starts the moment cash drops
    // below BANKRUPTCY_THRESHOLD, not merely once it goes negative — firing this pip only
    // at cash < 0 left the player with no warning for most of that countdown.
    if (state.cash < BANKRUPTCY_THRESHOLD) {
      pips.push({ kind: 'bankruptcy', icon: 'crit', label: 'CASH', tone: 'critical', tip: `Balance is below $${BANKRUPTCY_THRESHOLD.toLocaleString('en-US')} — bankruptcy proceedings may follow` });
    }
    const collapsedCount = state.employees.employees.filter(e => e.alive && e.collapsing).length;
    if (collapsedCount > 0) {
      pips.push({ kind: 'crew', icon: 'collapse', label: String(collapsedCount), tone: 'critical', tip: `${collapsedCount} employee(s) collapsed` });
    }
    const stuckCount = state.vehicles.vehicles.filter(v => v.isMoveStuck).length;
    if (stuckCount > 0) {
      pips.push({ kind: 'fleet', icon: 'vehicle', label: String(stuckCount), tone: 'warn', tip: `${stuckCount} vehicle(s) stuck` });
    }
    const urgentContract = state.contracts.active.find(c => {
      const remaining = c.acceptedAtTick + c.deadlineTicks - state.tickCount;
      return remaining <= 10 && remaining > 0;
    });
    if (urgentContract) {
      const remaining = urgentContract.acceptedAtTick + urgentContract.deadlineTicks - state.tickCount;
      pips.push({ kind: 'contract', icon: 'clock', label: `#${urgentContract.id} · ${remaining}h`, tone: 'warn', tip: `Contract #${urgentContract.id} expires in ${remaining}h` });
      if (!this.warnedContracts.has(urgentContract.id)) {
        this.warnedContracts.add(urgentContract.id);
        this.notify({
          severity: 'warn',
          icon: 'clock',
          title: `Contract #${urgentContract.id} is expiring soon`,
          body: `${remaining}h left — penalty $${urgentContract.penaltyAmount.toLocaleString('en-US')} if it lapses.`,
        });
      }
    }
    // Forget expiry warnings for contracts that are no longer active (completed, expired, or declined).
    if (this.warnedContracts.size > 0) {
      const activeIds = new Set(state.contracts.active.map(c => c.id));
      for (const id of this.warnedContracts) if (!activeIds.has(id)) this.warnedContracts.delete(id);
    }

    return pips;
  }
}
